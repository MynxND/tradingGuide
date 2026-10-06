import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { redisEnabled, redisGet, redisSet, redisSetAdd, redisSetIfAbsent, redisSetMembers } from '@/lib/redis';

const SESSION_COOKIE = 'tg_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const LICENSE_PREFIX = 'tg:license:';
const SESSION_PREFIX = 'tg:session:';
const ACCESS_KEY_PREFIX = 'tg:access-key:';
const ACCESS_KEY_INDEX = 'tg:access-keys';
const ADMIN_SESSION_COOKIE = 'tg_admin_session';
const ADMIN_SESSION_PREFIX = 'tg:admin-session:';

type Session = { licenseHash: string; browserId: string; expiresAt: number };
type License = { browserId: string; redeemedAt: number };
type ManagedKey = { hash: string; label: string; createdAt: number; status: 'active' | 'revoked' };

function configuredKeyHashes() {
  const raw = process.env.AUTH_KEY_HASHES?.trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => /^[a-f0-9]{64}$/i.test(v));
  } catch {
    // รองรับ comma-separated สำหรับตั้งค่าใน Vercel ได้สะดวก
  }
  return raw.split(',').map((v) => v.trim()).filter((v) => /^[a-f0-9]{64}$/i.test(v));
}

export function hashAccessKey(key: string) {
  return createHash('sha256').update(key.trim()).digest('hex');
}

function safeEqualHash(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionKey(id: string) {
  return `${SESSION_PREFIX}${id}`;
}

export function authIsConfigured() {
  return redisEnabled;
}

async function accessKeyAllowed(hash: string) {
  if (configuredKeyHashes().some((item) => safeEqualHash(item.toLowerCase(), hash))) return true;
  const raw = await redisGet(`${ACCESS_KEY_PREFIX}${hash}`);
  if (!raw) return false;
  try { return (JSON.parse(raw) as ManagedKey).status === 'active'; } catch { return false; }
}

export async function redeemAccessKey(accessKey: string, browserId: string) {
  if (!authIsConfigured()) return { ok: false as const, status: 503, error: 'ระบบล็อกอินยังไม่ได้ตั้งค่า' };
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(accessKey) || !/^[A-Za-z0-9_-]{32,160}$/.test(browserId)) {
    return { ok: false as const, status: 400, error: 'ข้อมูลล็อกอินไม่ถูกต้อง' };
  }

  const hash = hashAccessKey(accessKey);
  const allowed = await accessKeyAllowed(hash);
  if (!allowed) return { ok: false as const, status: 401, error: 'คีย์ไม่ถูกต้องหรือถูกยกเลิกแล้ว' };

  const license: License = { browserId, redeemedAt: Date.now() };
  const claimed = await redisSetIfAbsent(`${LICENSE_PREFIX}${hash}`, JSON.stringify(license));
  if (!claimed) {
    return { ok: false as const, status: 409, error: 'คีย์นี้ถูกใช้ไปแล้วและผูกกับเบราว์เซอร์อื่น' };
  }

  const id = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await redisSet(sessionKey(id), JSON.stringify({ licenseHash: hash, browserId, expiresAt } satisfies Session));
  return { ok: true as const, sessionId: id, expiresAt };
}

export async function getRequestSession(request: Request): Promise<Session | null> {
  if (!authIsConfigured()) return null;
  const cookie = request.headers.get('cookie') ?? '';
  const id = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  const browserId = request.headers.get('x-tg-browser-id') ?? '';
  if (!id || !browserId) return null;
  const raw = await redisGet(sessionKey(id));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (session.expiresAt <= Date.now() || session.browserId !== browserId) return null;
    if (!(await accessKeyAllowed(session.licenseHash))) return null;
    const licenseRaw = await redisGet(`${LICENSE_PREFIX}${session.licenseHash}`);
    const license = licenseRaw ? (JSON.parse(licenseRaw) as License) : null;
    return license?.browserId === browserId ? session : null;
  } catch {
    return null;
  }
}

/** namespace ที่ไม่เผย access key จริง และแยกข้อมูลของแต่ละ license ออกจากกัน */
export function workspaceForSession(session: Session) {
  return `license_${session.licenseHash.slice(0, 24)}`;
}

export async function requireAuth(request: Request) {
  if (!authIsConfigured()) return NextResponse.json({ error: 'ระบบล็อกอินยังไม่ได้ตั้งค่า' }, { status: 503 });
  if (!(await getRequestSession(request))) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401 });
  return null;
}

export async function setSessionCookie(response: NextResponse, sessionId: string, expiresAt: number) {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(expiresAt),
    path: '/',
  });
  return response;
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

function configuredAdminHash() {
  const value = process.env.ADMIN_ACCESS_KEY_HASH?.trim().replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase();
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export async function createAdminSession(adminKey: string) {
  const expected = configuredAdminHash();
  if (!redisEnabled || !expected) return null;
  // ก็อปคีย์มาวางมักติดช่องว่าง/ขึ้นบรรทัดใหม่มาด้วย ทำให้ hash ไม่ตรงทั้งที่คีย์ถูก
  const actual = hashAccessKey(adminKey.trim());
  if (!safeEqualHash(expected, actual)) return null;
  const id = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await redisSet(`${ADMIN_SESSION_PREFIX}${id}`, JSON.stringify({ expiresAt }));
  return { id, expiresAt };
}

export async function adminAuthorized(request: Request) {
  const id = (request.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${ADMIN_SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!id) return false;
  const raw = await redisGet(`${ADMIN_SESSION_PREFIX}${id}`);
  try { return Boolean(raw && (JSON.parse(raw) as { expiresAt: number }).expiresAt > Date.now()); } catch { return false; }
}

export async function requireAdmin(request: Request) {
  if (!(await adminAuthorized(request))) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบผู้ดูแล' }, { status: 401 });
  return null;
}

export async function setAdminSessionCookie(id: string, expiresAt: number) {
  const store = await cookies();
  // API อยู่ที่ /api/admin จึงต้องใช้ path / ไม่เช่นนั้น browser จะไม่ส่ง cookie ไปตรวจสิทธิ์
  store.set(ADMIN_SESSION_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', expires: new Date(expiresAt), path: '/' });
}

export async function createManagedKey(label: string) {
  if (!redisEnabled) throw new Error('Redis ไม่พร้อมใช้งาน');
  const key = `TG_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const hash = hashAccessKey(key);
  const record: ManagedKey = { hash, label: label.slice(0, 100), createdAt: Date.now(), status: 'active' };
  await redisSet(`${ACCESS_KEY_PREFIX}${hash}`, JSON.stringify(record));
  await redisSetAdd(ACCESS_KEY_INDEX, hash);
  return { key, record };
}

export async function listManagedKeys() {
  const hashes = await redisSetMembers(ACCESS_KEY_INDEX);
  const records = await Promise.all(hashes.map(async (hash) => {
    const raw = await redisGet(`${ACCESS_KEY_PREFIX}${hash}`);
    const license = await redisGet(`${LICENSE_PREFIX}${hash}`);
    try {
      const record = raw ? (JSON.parse(raw) as ManagedKey) : null;
      return record ? { ...record, redeemedAt: license ? (JSON.parse(license) as License).redeemedAt : null } : null;
    } catch { return null; }
  }));
  return records.filter((record): record is NonNullable<typeof record> => Boolean(record)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function setManagedKeyStatus(hash: string, status: 'active' | 'revoked') {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  const raw = await redisGet(`${ACCESS_KEY_PREFIX}${hash}`);
  if (!raw) return false;
  const record = JSON.parse(raw) as ManagedKey;
  await redisSet(`${ACCESS_KEY_PREFIX}${hash}`, JSON.stringify({ ...record, status }));
  return true;
}

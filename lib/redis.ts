/**
 * Upstash Redis ผ่าน REST API — ใช้ fetch ตรง ๆ ไม่ต้องเพิ่ม dependency
 * ถ้าไม่ได้ตั้ง env ไว้ ฟังก์ชันจะคืน null ให้ผู้เรียกไปใช้ทางสำรอง (localStorage)
 */

/**
 * ช่อง env ของ Vercel เก็บค่าตามที่พิมพ์ทุกตัวอักษร ต่างจาก .env.local ที่ตัด "..." ให้เอง
 * ถ้าก็อปมาพร้อมเครื่องหมายคำพูด/ช่องว่าง fetch จะพังว่า "Failed to parse URL"
 */
const cleanEnv = (v: string | undefined) => v?.trim().replace(/^(['"])(.*)\1$/, '$2').trim() || undefined;

const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL)?.replace(/\/+$/, '');
const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);

export const redisEnabled = Boolean(url && token);

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!url || !token) return null;
  const res = await fetch(`${url}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash ตอบ ${res.status}`);
  const json = (await res.json()) as { result: T };
  return json.result;
}

export async function redisGet(key: string): Promise<string | null> {
  return call<string | null>(`get/${encodeURIComponent(key)}`);
}

/**
 * value ต้องเป็นสตริงที่พร้อมเก็บแล้ว (ปกติคือ JSON.stringify มาก่อน)
 * ห้าม JSON.stringify ซ้ำที่นี่ ไม่งั้นจะได้ JSON ซ้อน JSON
 * แล้วตอนอ่านกลับ JSON.parse รอบเดียวจะได้ "สตริง" ไม่ใช่ object
 */
export async function redisSet(key: string, value: string): Promise<void> {
  await call(`set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: value,
  });
}

/** เขียนเฉพาะเมื่อ key นี้ยังไม่มีอยู่ ใช้จอง license แบบ atomic */
export async function redisSetIfAbsent(key: string, value: string): Promise<boolean> {
  const result = await call<string | null>(
    `set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/NX`,
    { method: 'POST' },
  );
  return result === 'OK';
}

export async function redisDelete(key: string): Promise<void> {
  await call(`del/${encodeURIComponent(key)}`, { method: 'POST' });
}

/** ใช้เก็บรายชื่อ workspace ที่มีอยู่ เผื่อ cron ต้องวนตรวจทุกอัน */
export async function redisSetAdd(key: string, member: string): Promise<void> {
  await call(`sadd/${encodeURIComponent(key)}/${encodeURIComponent(member)}`, { method: 'POST' });
}

export async function redisSetMembers(key: string): Promise<string[]> {
  return (await call<string[]>(`smembers/${encodeURIComponent(key)}`)) ?? [];
}

export async function redisSetRemove(key: string, member: string): Promise<void> {
  await call(`srem/${encodeURIComponent(key)}/${encodeURIComponent(member)}`, { method: 'POST' });
}

import { NextResponse } from 'next/server';
import { createAdminSession, setAdminSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { key?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'body ไม่ถูกต้อง' }, { status: 400 }); }
  const session = await createAdminSession(typeof body.key === 'string' ? body.key : '');
  if (!session) return NextResponse.json({ error: 'รหัสผู้ดูแลไม่ถูกต้อง หรือยังไม่ได้ตั้งค่า ADMIN_ACCESS_KEY_HASH' }, { status: 401 });
  await setAdminSessionCookie(session.id, session.expiresAt);
  return NextResponse.json({ ok: true });
}

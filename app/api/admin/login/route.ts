import { NextResponse } from 'next/server';
import { createAdminSession, setAdminSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { key?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'body ไม่ถูกต้อง' }, { status: 400 }); }
  let session: Awaited<ReturnType<typeof createAdminSession>>;
  try {
    session = await createAdminSession(typeof body.key === 'string' ? body.key : '');
  } catch (err) {
    // คีย์ถูกแล้วแต่เขียน session ไม่ได้ — ส่วนใหญ่คือ Upstash URL/token บน server ผิด
    console.error('admin login failed', err);
    return NextResponse.json({ error: `ระบบจัดเก็บ session ผิดพลาด: ${err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'}` }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: 'รหัสผู้ดูแลไม่ถูกต้อง หรือยังไม่ได้ตั้งค่า ADMIN_ACCESS_KEY_HASH' }, { status: 401 });
  await setAdminSessionCookie(session.id, session.expiresAt);
  return NextResponse.json({ ok: true });
}

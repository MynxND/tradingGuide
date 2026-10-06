import { NextResponse } from 'next/server';
import { redeemAccessKey, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { key?: unknown; browserId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'body ไม่ถูกต้อง' }, { status: 400 }); }
  const result = await redeemAccessKey(typeof body.key === 'string' ? body.key : '', typeof body.browserId === 'string' ? body.browserId : '');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const response = NextResponse.json({ ok: true });
  return setSessionCookie(response, result.sessionId, result.expiresAt);
}

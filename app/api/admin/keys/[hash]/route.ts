import { NextResponse } from 'next/server';
import { requireAdmin, setManagedKeyStatus } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  let body: { status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'body ไม่ถูกต้อง' }, { status: 400 }); }
  if (body.status !== 'active' && body.status !== 'revoked') return NextResponse.json({ error: 'status ไม่ถูกต้อง' }, { status: 400 });
  const { hash } = await params;
  if (!(await setManagedKeyStatus(hash, body.status))) return NextResponse.json({ error: 'ไม่พบคีย์' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

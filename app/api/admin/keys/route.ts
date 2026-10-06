import { NextResponse } from 'next/server';
import { createManagedKey, listManagedKeys, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ keys: await listManagedKeys() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  let body: { label?: unknown } = {};
  try { body = await request.json(); } catch { /* optional body */ }
  const result = await createManagedKey(typeof body.label === 'string' ? body.label.trim() : '');
  return NextResponse.json(result, { status: 201 });
}

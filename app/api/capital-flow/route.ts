import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCapitalFlow } from '@/lib/capital-flow';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const symbol = (new URL(request.url).searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: 'ชื่อย่อหุ้นไม่ถูกต้อง' }, { status: 400 });
  }

  try {
    const result = await getCapitalFlow(symbol);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'ผิดพลาด' },
      { status: 502 },
    );
  }
}

import { NextResponse } from 'next/server';
import { getHistory } from '@/lib/history';
import { toEndMin } from '@/lib/strategy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.get('date') ?? '';
  const endMin = toEndMin(params.get('end'));
  const symbols = [
    ...new Set(
      (params.get('symbols') ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 40);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'ต้องระบุ date เป็น YYYY-MM-DD' }, { status: 400 });
  }
  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [], pending: 0 });
  }

  try {
    const result = await getHistory(date, symbols, endMin);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { quotes: [], pending: symbols.length, error: err instanceof Error ? err.message : 'ผิดพลาด' },
      { status: 502 },
    );
  }
}

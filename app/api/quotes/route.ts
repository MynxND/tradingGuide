import { NextResponse } from 'next/server';
import { getQuotes } from '@/lib/quotes';
import { toEndMin } from '@/lib/strategy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get('symbols') ?? '';
  const endMin = toEndMin(params.get('end'));
  const symbols = [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 40);

  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [], provider: 'none', serverTime: Date.now() });
  }

  try {
    const result = await getQuotes(symbols, endMin);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { quotes: [], provider: 'none', serverTime: Date.now(), warning: err instanceof Error ? err.message : 'ผิดพลาด' },
      { status: 500 },
    );
  }
}

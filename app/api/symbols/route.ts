import { NextResponse } from 'next/server';
import { listStatus, searchSymbols } from '@/lib/symbols';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const { hits, source } = await searchSymbols(q);
  return NextResponse.json(
    { hits, source, list: listStatus() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

import { NextResponse } from 'next/server';
import { getGainers } from '@/lib/gainers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limitParam = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  try {
    const result = await getGainers(limit);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { gainers: [], fetchedAt: Date.now(), error: err instanceof Error ? err.message : 'ผิดพลาด' },
      { status: 502 },
    );
  }
}

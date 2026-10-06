import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getGainers, isGainerPeriod } from '@/lib/gainers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const limitParam = Number(params.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
  const requestedPeriod = params.get('period');
  const period = isGainerPeriod(requestedPeriod) ? requestedPeriod : '1d';

  try {
    const result = await getGainers(limit, period);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { gainers: [], fetchedAt: Date.now(), error: err instanceof Error ? err.message : 'ผิดพลาด' },
      { status: 502 },
    );
  }
}

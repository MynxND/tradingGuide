import { NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: Boolean(await getRequestSession(request)) }, { headers: { 'Cache-Control': 'no-store' } });
}

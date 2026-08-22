import { SESSION_END_MIN, SESSION_START_MIN, etMinuteOfDay } from '../strategy';
import type { LiveResult, LivePrice, Provider } from './types';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

async function chart(symbol: string) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? 'Yahoo บล็อก (429) — ใส่ TWELVEDATA_API_KEY เพื่อใช้แหล่งข้อมูลที่เสถียร'
        : `Yahoo ตอบ ${res.status}`,
    );
  }
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description ?? 'ไม่พบข้อมูล');
  return result;
}

/**
 * Yahoo Finance — ไม่ต้องใช้ key แต่เป็น endpoint ที่ไม่เป็นทางการ
 * ใช้เป็นตัวสำรองสำหรับรันเครื่องตัวเองเท่านั้น ไม่แนะนำบน production
 */
export const yahoo: Provider = {
  name: 'yahoo',
  maxPerCycle: 6,
  minCycleMs: 60_000,

  async fetchLive(symbols): Promise<LiveResult> {
    const out = new Map<string, LivePrice>();
    // Yahoo ไม่มี batch ที่ใช้ได้โดยไม่มี crumb — ยิงทีละตัวแบบจำกัด concurrency
    for (let i = 0; i < symbols.length; i += 3) {
      const chunk = symbols.slice(i, i + 3);
      const results = await Promise.allSettled(chunk.map((s) => chart(s)));
      results.forEach((r, idx) => {
        if (r.status !== 'fulfilled') return;
        const meta = r.value.meta ?? {};
        out.set(chunk[idx], {
          symbol: chunk[idx],
          open: meta.regularMarketOpen ?? null,
          last: meta.regularMarketPrice ?? null,
          dayHigh: meta.regularMarketDayHigh ?? null,
        });
      });
    }
    if (out.size === 0 && symbols.length > 0) {
      throw new Error('Yahoo บล็อก (429) — ใส่ TWELVEDATA_API_KEY เพื่อใช้แหล่งข้อมูลที่เสถียร');
    }
    return { prices: out, attempted: symbols };
  },

  async fetchWindowEnd(symbol) {
    const result = await chart(symbol);
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    let fallback: number | null = null;
    for (let i = 0; i < ts.length; i++) {
      const minute = etMinuteOfDay(ts[i]);
      if (minute === SESSION_END_MIN) return q.open?.[i] ?? q.close?.[i] ?? null;
      if (minute >= SESSION_START_MIN && minute < SESSION_END_MIN && q.close?.[i] != null) {
        fallback = q.close[i];
      }
    }
    return fallback;
  },
};

import { SESSION_START_MIN, etMinuteOfDay } from '../strategy';
import type { LiveResult, LivePrice, Provider } from './types';

/** แท่งแรกช้ากว่านาทีเปิดได้ไม่เกินเท่านี้ ก่อนจะถือว่า high ครอบช่วงไม่ครบ */
const COVERAGE_TOLERANCE_MIN = 2;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

async function chart(symbol: string) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    next: { revalidate: 60 },
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
  capacity: 6, // ยิงทีละตัว จำกัดเองกันโดนบล็อก

  async fetchLive(symbols): Promise<LiveResult> {
    const out = new Map<string, LivePrice>();
    const attempted: string[] = [];
    // Yahoo ไม่มี batch ที่ใช้ได้โดยไม่มี crumb — ยิงทีละตัวแบบจำกัด concurrency
    for (let i = 0; i < symbols.length; i += 3) {
      const chunk = symbols.slice(i, i + 3);
      const results = await Promise.allSettled(chunk.map((s) => chart(s)));
      results.forEach((r, idx) => {
        // ตัวที่ error ไม่นับเป็น attempted จะได้ไม่ถูกมาร์คว่าไม่มีข้อมูล
        if (r.status !== 'fulfilled') return;
        attempted.push(chunk[idx]);
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
    return { prices: out, attempted };
  },

  async fetchWindowSnapshot(symbol, endMin) {
    const result = await chart(symbol);
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    let end: number | null = null;
    let fallback: number | null = null;
    let high: number | null = null;
    let firstMinute: number | null = null;

    for (let i = 0; i < ts.length; i++) {
      const minute = etMinuteOfDay(ts[i]);
      if (minute < SESSION_START_MIN || minute > endMin) continue;

      const barHigh = q.high?.[i];
      if (typeof barHigh === 'number') {
        high = high === null ? barHigh : Math.max(high, barHigh);
        if (firstMinute === null || minute < firstMinute) firstMinute = minute;
      }

      if (minute === endMin && end === null) end = q.open?.[i] ?? q.close?.[i] ?? null;
      else if (minute < endMin && q.close?.[i] != null) fallback = q.close[i];
    }
    // ขาดแท่งช่วงหัว = high ต่ำกว่าจริงได้ ต้องบอกชั้นบนไม่ให้เชื่อเต็มร้อย
    const highPartial =
      firstMinute === null || firstMinute > SESSION_START_MIN + COVERAGE_TOLERANCE_MIN;
    return { end: end ?? fallback, high, highPartial };
  },
};

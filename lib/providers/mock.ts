import type { LiveResult, LivePrice, Provider } from './types';

/**
 * ตัวเลขชุดเดียวกับในไฟล์ Excel — ใช้ตรวจว่าสูตรบนเว็ปให้ผลตรงกับชีตเป๊ะ
 * เปิดใช้ด้วย QUOTE_PROVIDER=mock
 */
export const EXCEL_FIXTURE: Record<string, { open: number; end: number }> = {
  USDC: { open: 4.96, end: 7.2 },
  EXYN: { open: 1.72, end: 1.88 },
  SNDK: { open: 1606.15, end: 1587.02 },
  MU: { open: 982.98, end: 967.25 },
  NVDA: { open: 217.84, end: 215.54 },
  LSTA: { open: 1.12, end: 1.34 },
  TSM: { open: 423.77, end: 418.4 },
  TSLA: { open: 350.29, end: 359.08 },
  NCTY: { open: 4.58, end: 4.91 },
  DTCX: { open: 1.98, end: 2.29 },
  ASTS: { open: 67.88, end: 67.64 },
  RKLB: { open: 73.74, end: 72.87 },
  MRNG: { open: 137.17, end: 151.59 },
};

export const mock: Provider = {
  name: 'mock',
  maxPerCycle: 100,
  minCycleMs: 10_000,
    capacity: 100, // ไม่มีโควตา

  async fetchLive(symbols): Promise<LiveResult> {
    const out = new Map<string, LivePrice>();
    for (const symbol of symbols) {
      const f = EXCEL_FIXTURE[symbol];
      if (!f) continue;
      out.set(symbol, {
        symbol,
        name: `${symbol} (ตัวเลขจาก Excel)`,
        open: f.open,
        last: f.end,
        dayHigh: Math.max(f.open, f.end),
      });
    }
    return { prices: out, attempted: symbols };
  },

  async fetchWindowEnd(symbol) {
    return EXCEL_FIXTURE[symbol]?.end ?? null;
  },
};

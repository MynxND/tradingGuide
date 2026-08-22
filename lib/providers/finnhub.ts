import type { LiveResult, LivePrice, Provider } from './types';

const BASE = 'https://finnhub.io/api/v1';

/**
 * Finnhub — free tier 60 calls/นาที ขอได้ทีละ 1 หุ้น
 * เหมาะกับการ poll ถี่ ๆ (13 หุ้น/20 วิ ≈ 39 calls/นาที ยังอยู่ในโควตา)
 * แต่ candle ย้อนหลังเป็นฟีเจอร์ของแพ็กเกจจ่ายเงิน จึงหาราคา ณ 11:30 ไม่ได้
 */
export function finnhub(apiKey: string): Provider {
  async function one(symbol: string): Promise<LivePrice | null> {
    const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'Finnhub เกินโควตา (429)' : `Finnhub ตอบ ${res.status}`);
    const q = await res.json();
    // หุ้นที่ไม่มีในระบบ/ไม่มีการซื้อขาย Finnhub ตอบเลข 0 ทุกช่อง ไม่ได้ตอบ error
    const hasPrice = [q?.o, q?.c, q?.h].some((v) => typeof v === 'number' && v > 0);
    if (!hasPrice) return null;
    return {
      symbol,
      open: typeof q.o === 'number' && q.o !== 0 ? q.o : null,
      last: typeof q.c === 'number' && q.c !== 0 ? q.c : null,
      dayHigh: typeof q.h === 'number' && q.h !== 0 ? q.h : null,
    };
  }

  return {
    name: 'finnhub',
    maxPerCycle: 40,
    // 60 calls/นาที — 13 หุ้นทุก 20 วิ ≈ 39 calls/นาที
    minCycleMs: 20_000,

    async fetchLive(symbols): Promise<LiveResult> {
      const out = new Map<string, LivePrice>();
      let lastError: unknown = null;
      for (let i = 0; i < symbols.length; i += 5) {
        const chunk = symbols.slice(i, i + 5);
        const results = await Promise.allSettled(chunk.map(one));
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            if (r.value) out.set(chunk[idx], r.value);
          } else {
            lastError = r.reason;
          }
        });
      }
      if (out.size === 0 && lastError) throw lastError;
      return { prices: out, attempted: symbols };
    },

    async fetchWindowEnd() {
      return null; // ต้องใช้ candle ซึ่งเป็นแพ็กเกจจ่ายเงิน
    },

    async fetchName(symbol) {
      const res = await fetch(`${BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Finnhub ตอบ ${res.status}`);
      const p = await res.json();
      return typeof p?.name === 'string' && p.name ? p.name : null;
    },
  };
}

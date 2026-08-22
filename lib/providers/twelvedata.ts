import type { LiveResult, LivePrice, Provider } from './types';

const BASE = 'https://api.twelvedata.com';

/**
 * free tier จำกัด 8 credits/นาที และ 1 หุ้น = 1 credit
 * จดไว้เองว่าใช้ไปเท่าไรในนาทีที่ผ่านมา จะได้ไม่ยิงเกินแล้วโดน 429 ทิ้งเปล่า
 */
const CREDITS_PER_MINUTE = 8;
const spent: number[] = [];

function allowance() {
  const cutoff = Date.now() - 60_000;
  while (spent.length > 0 && spent[0] < cutoff) spent.shift();
  return Math.max(0, CREDITS_PER_MINUTE - spent.length);
}

function charge(n: number) {
  const now = Date.now();
  for (let i = 0; i < n; i++) spent.push(now);
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Twelve Data — free tier: 800 req/วัน, 8 req/นาที, มี API key ถูกต้องตาม ToS
 * https://twelvedata.com/pricing
 */
export function twelveData(apiKey: string): Provider {
  return {
    name: 'twelvedata',
    // free tier: 8 credits/นาที และ 1 หุ้น = 1 credit ต่อการขอราคา
    // กันโควตาไว้ให้ time_series (ราคา ณ 11:30) ด้วย จึงดึงราคาสดรอบละ 6 ตัว
    maxPerCycle: 6,
    // 6 credits/รอบ × 1 รอบ/นาที = 6 credits/นาที ยังเหลือที่ให้ time_series
    minCycleMs: 60_000,
    capacity: 6, // 6 credits ต่อรอบ 60 วิ

    async fetchLive(requested): Promise<LiveResult> {
      const out = new Map<string, LivePrice>();
      // เผื่อ 1 credit ไว้ให้ time_series เสมอ
      const room = Math.max(0, allowance() - 1);
      const symbols = requested.slice(0, room);
      if (symbols.length === 0) return { prices: out, attempted: [] };

      charge(symbols.length);
      const url = `${BASE}/quote?symbol=${symbols.join(',')}&apikey=${apiKey}`;
      // แชร์ผลข้าม request/instance ต้นทางถูกเรียกครั้งเดียวต่อรอบ 60 วิ
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) throw new Error(`Twelve Data ตอบ ${res.status}`);
      const json = await res.json();

      if (json?.status === 'error') throw new Error(json.message ?? 'Twelve Data error');

      // ขอ 1 ตัวจะได้ object เดี่ยว ขอหลายตัวจะได้ map ของ symbol
      const entries = symbols.length === 1 ? { [symbols[0]]: json } : json;
      for (const symbol of symbols) {
        const q = entries?.[symbol];
        if (!q || q.status === 'error') continue;
        out.set(symbol, {
          symbol,
          name: q.name ?? null,
          open: num(q.open),
          last: num(q.close),
          dayHigh: num(q.high),
        });
      }
      return { prices: out, attempted: symbols };
    },

    async fetchWindowEnd(symbol) {
      if (allowance() < 1) throw new Error('โควตา Twelve Data เต็มในนาทีนี้ จะลองใหม่รอบหน้า');
      charge(1);
      // แท่ง 1 นาทีที่ 11:30 ET — ขอย้อน 3 ชม.พอ ไม่ต้องดึงทั้งวัน
      const url =
        `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}` +
        `&interval=1min&outputsize=400&timezone=America/New_York&apikey=${apiKey}`;
      // ราคา ณ 11:30 นิ่งแล้วหลังพ้นเวลา แคชได้นาน
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) throw new Error(`Twelve Data ตอบ ${res.status}`);
      const json = await res.json();
      if (json?.status === 'error') throw new Error(json.message ?? 'Twelve Data error');

      const values: Array<{ datetime: string; open: string; close: string }> = json?.values ?? [];
      // datetime อยู่ใน timezone ET แล้ว รูปแบบ "YYYY-MM-DD HH:MM:SS"
      const bar = values.find((v) => v.datetime.slice(11, 16) === '11:30');
      return bar ? num(bar.open) ?? num(bar.close) : null;
    },
  };
}

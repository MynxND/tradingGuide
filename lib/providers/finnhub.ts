import type { LiveResult, LivePrice, Provider } from './types';

const BASE = 'https://finnhub.io/api/v1';

/**
 * free tier ให้ 60 calls/นาที (ยืนยันจาก header x-ratelimit-limit) และขอได้ทีละ 1 หุ้น
 * ที่รีเฟรช 20 วิ = 3 รอบ/นาที เพดานจึงอยู่ที่ ~20 ตัวเท่านั้น
 * จดไว้เองว่าใช้ไปเท่าไรในนาทีที่ผ่านมา เกินกว่านั้นจะทยอยเก็บรอบถัดไปแทนการโดน 429
 */
const CALLS_PER_MINUTE = 55; // เผื่อ buffer จาก 60 ไว้ให้ profile2 และการกดรีเฟรชมือ
const spent: number[] = [];

/** อายุ cache ของราคาสด — ผู้ใช้ทุกคนในช่วงนี้อ่านผลเดียวกัน ไม่ยิงต้นทางซ้ำ */
export const LIVE_TTL_S = 20;

/**
 * URL ที่ยิงไปแล้วเมื่อไร
 * ระหว่างที่ยังอยู่ใน cache window การขอซ้ำจะไม่ถึงต้นทาง จึงต้องไม่คิดโควตาซ้ำ
 * ไม่งั้นผู้ใช้หลายคน (หรือกด refresh รัว ๆ) จะทำให้ ledger เต็มทั้งที่ไม่ได้ยิงจริง
 */
const chargedAt = new Map<string, number>();

function allowance() {
  const cutoff = Date.now() - 60_000;
  while (spent.length > 0 && spent[0] < cutoff) spent.shift();
  return Math.max(0, CALLS_PER_MINUTE - spent.length);
}

function charge(n = 1) {
  const now = Date.now();
  for (let i = 0; i < n; i++) spent.push(now);
}

/** คิดโควตาเฉพาะครั้งที่คาดว่าจะทะลุ cache ไปถึงต้นทางจริง */
function chargeIfUpstream(url: string, ttlMs: number) {
  const last = chargedAt.get(url);
  if (last != null && Date.now() - last < ttlMs) return false;
  chargedAt.set(url, Date.now());
  charge(1);
  return true;
}

/** ให้หน้าเว็ปรู้ว่าเหลือโควตาเท่าไรในนาทีนี้ */
export function finnhubAllowance() {
  return { remaining: allowance(), limit: CALLS_PER_MINUTE };
}

/**
 * Finnhub — free tier 60 calls/นาที ขอได้ทีละ 1 หุ้น
 * เหมาะกับการ poll ถี่ ๆ (13 หุ้น/20 วิ ≈ 39 calls/นาที ยังอยู่ในโควตา)
 * แต่ candle ย้อนหลังเป็นฟีเจอร์ของแพ็กเกจจ่ายเงิน จึงหาราคา ณ 11:30 ไม่ได้
 */
export function finnhub(apiKey: string): Provider {
  async function one(symbol: string): Promise<LivePrice | null> {
    const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    chargeIfUpstream(url, LIVE_TTL_S * 1000);
    const res = await fetch(url, {
      // แชร์ผลข้าม request และข้าม instance: มีผู้ใช้ 100 คนดูหุ้นตัวเดียวกัน
      // ต้นทางก็ถูกเรียกครั้งเดียวต่อ 20 วิ
      next: { revalidate: LIVE_TTL_S },
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
    // เท่ากับ capacity: 18 ตัว/รอบ 20 วิ = 54 calls/นาที พอดีกับเพดาน 55 ที่จดไว้
    // เดิมตั้ง 40 ทำให้ยิงรัวทีเดียว 40 calls แล้วโดน 429 ก่อน ledger จะช่วย
    maxPerCycle: 18,
    // 60 calls/นาที — 13 หุ้นทุก 20 วิ ≈ 39 calls/นาที
    minCycleMs: 20_000,
    capacity: 18, // 55 calls/นาที ÷ 3 รอบ/นาที

    async fetchLive(requested): Promise<LiveResult> {
      const out = new Map<string, LivePrice>();
      // เผื่อโควตาไว้ให้ fetchName ด้วย จะได้ไม่แย่งกันจนชื่อบริษัทไม่ขึ้นเลย
      const symbols = requested.slice(0, Math.max(0, allowance() - 2));
      if (symbols.length === 0) return { prices: out, attempted: [] };

      let lastError: unknown = null;
      /**
       * นับเป็น attempted ได้แค่ตัวที่ได้คำตอบชัดเจนจาก Finnhub
       * ตัวที่ error (เช่น 429) เป็นปัญหาชั่วคราว ถ้ารายงานว่า attempted
       * ชั้นบนจะมาร์คว่า "ไม่มีข้อมูล" แล้วพักไป 10 นาทีทั้งที่หุ้นมีอยู่จริง
       */
      const attempted: string[] = [];
      for (let i = 0; i < symbols.length; i += 5) {
        const chunk = symbols.slice(i, i + 5);
        const results = await Promise.allSettled(chunk.map(one));
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            attempted.push(chunk[idx]);
            if (r.value) out.set(chunk[idx], r.value);
          } else {
            lastError = r.reason;
          }
        });
      }
      if (out.size === 0 && lastError) throw lastError;
      return { prices: out, attempted };
    },

    async fetchWindowSnapshot() {
      return null; // ต้องใช้ candle ซึ่งเป็นแพ็กเกจจ่ายเงิน
    },

    async fetchName(symbol) {
      if (allowance() < 1) return null;
      const url = `${BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
      chargeIfUpstream(url, 7 * 24 * 3600_000);
      const res = await fetch(url, {
        // ชื่อบริษัทไม่เปลี่ยนรายวัน แคชไว้เป็นสัปดาห์
        next: { revalidate: 604_800 },
      });
      if (!res.ok) throw new Error(`Finnhub ตอบ ${res.status}`);
      const p = await res.json();
      return typeof p?.name === 'string' && p.name ? p.name : null;
    },
  };
}

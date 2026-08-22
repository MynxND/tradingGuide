import { resolveProviders, type LivePrice } from './providers';
import { etDateString, windowState } from './strategy';

export type SymbolQuote = {
  symbol: string;
  /** ชื่อบริษัทตามที่ provider หาเจอ — ใช้ตรวจว่า ticker ไม่ผิดตัว */
  name: string | null;
  /** ราคาเปิด 09:30 ET (20:30 น. ไทย) */
  open: number | null;
  /** ราคา ณ 11:30 ET (22:30 น. ไทย) — null ถ้ายังไม่ถึงเวลา */
  windowEnd: number | null;
  /** ราคาซื้อขายล่าสุดที่ดึงได้ */
  last: number | null;
  dayHigh: number | null;
  /** เวลาที่ราคาสดของหุ้นตัวนี้ถูกอัปเดตล่าสุด (epoch ms) */
  updatedAt: number | null;
  error?: string;
};

export type QuotesResult = {
  quotes: SymbolQuote[];
  provider: string;
  windowEndProvider: string;
  serverTime: number;
  /** รอบหนึ่งดึงราคาสดได้กี่ตัว ตามโควตา provider */
  perCycle: number;
  /** จังหวะรีเฟรชที่โควตารับได้ (ms) */
  refreshMs: number;
  /** หุ้นที่ provider หาไม่เจอ — สะกดผิดหรือไม่มีในแพ็กเกจ */
  unavailable: string[];
  warning?: string;
};

/** ถือว่าราคายัง "สด" ภายในกี่มิลลิวินาที */
const FRESH_MS = 15_000;
/** ราคา ณ 11:30 นิ่งแล้ว ดึงทีละไม่กี่ตัวต่อรอบเพื่อไม่ชนโควตา */
const WINDOW_END_PER_CYCLE = 2;

type Stored = { price: LivePrice; at: number };

let storeDay: string | null = null;
const liveStore = new Map<string, Stored>();
/** คีย์ "YYYY-MM-DD:SYMBOL" */
const windowEndCache = new Map<string, number | null>();
/** หุ้นที่ provider ตอบสำเร็จแต่ไม่มีข้อมูลให้ — พักไว้ ไม่ยิงซ้ำทุกรอบให้เปลืองโควตา */
const misses = new Map<string, { count: number; until: number }>();
const MISS_BACKOFF_MS = 10 * 60_000;
/** ชื่อบริษัทไม่เปลี่ยนรายวัน เก็บไว้ตลอดอายุ process */
const nameCache = new Map<string, string | null>();
const NAMES_PER_CYCLE = 2;

export async function getQuotes(symbols: string[]): Promise<QuotesResult> {
  const { live: liveProvider, windowEnd: windowEndProvider } = resolveProviders();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const day = etDateString(nowSec);
  const state = windowState(nowSec);

  // ข้ามวันซื้อขายแล้วราคาเก่าใช้ไม่ได้
  if (storeDay !== day) {
    liveStore.clear();
    storeDay = day;
  }

  let warning: string | undefined;

  // เลือกดึงเฉพาะตัวที่เก่าที่สุด ตามจำนวนที่โควตายอมให้ต่อรอบ
  const stale = symbols
    .filter((s) => {
      const miss = misses.get(s);
      if (miss && nowMs < miss.until) return false;
      const hit = liveStore.get(s);
      return !hit || nowMs - hit.at >= FRESH_MS;
    })
    .sort((a, b) => (liveStore.get(a)?.at ?? 0) - (liveStore.get(b)?.at ?? 0))
    .slice(0, liveProvider.maxPerCycle);

  if (stale.length > 0) {
    try {
      const { prices, attempted } = await liveProvider.fetchLive(stale);
      for (const [symbol, price] of prices) {
        liveStore.set(symbol, { price, at: Date.now() });
        misses.delete(symbol);
        if (price.name) nameCache.set(symbol, price.name);
      }
      // นับเป็น "ไม่มีข้อมูล" ได้เฉพาะตัวที่ยิงถามไปจริงแล้วไม่ได้คำตอบ
      // ตัวที่ถูกตัดออกเพราะโควตาไม่พอจะไม่อยู่ใน attempted
      for (const symbol of attempted) {
        if (prices.has(symbol)) continue;
        const prev = misses.get(symbol)?.count ?? 0;
        misses.set(symbol, { count: prev + 1, until: Date.now() + MISS_BACKOFF_MS });
      }
    } catch (err) {
      warning = err instanceof Error ? err.message : 'ดึงราคาสดไม่สำเร็จ';
    }
  }

  // ราคาปิดหน้าต่างดึงครั้งเดียวต่อหุ้นต่อวัน และเฉพาะเมื่อเลย 11:30 ET แล้ว
  if (state === 'after') {
    const missing = symbols
      .filter((s) => !windowEndCache.has(`${day}:${s}`))
      .slice(0, WINDOW_END_PER_CYCLE);
    for (const symbol of missing) {
      try {
        windowEndCache.set(`${day}:${symbol}`, await windowEndProvider.fetchWindowEnd(symbol));
      } catch (err) {
        // ดึงไม่ได้ก็ใช้ราคาล่าสุดไปก่อน แล้วลองใหม่รอบหน้า
        warning ??= err instanceof Error ? err.message : undefined;
      }
    }
  }

  // provider ที่ไม่ส่งชื่อมากับราคา ค่อย ๆ เติมชื่อทีละไม่กี่ตัวต่อรอบ
  if (liveProvider.fetchName) {
    const needName = symbols
      .filter((s) => liveStore.has(s) && !nameCache.has(s))
      .slice(0, NAMES_PER_CYCLE);
    for (const symbol of needName) {
      try {
        nameCache.set(symbol, await liveProvider.fetchName(symbol));
      } catch {
        // ชื่อไม่ใช่ข้อมูลสำคัญต่อการคำนวณ ปล่อยไว้ลองรอบหน้า
      }
    }
  }

  const quotes: SymbolQuote[] = symbols.map((symbol) => {
    const stored = liveStore.get(symbol);
    const windowEnd = state === 'after' ? windowEndCache.get(`${day}:${symbol}`) ?? null : null;
    return {
      symbol,
      name: stored?.price.name ?? nameCache.get(symbol) ?? null,
      open: stored?.price.open ?? null,
      windowEnd,
      last: stored?.price.last ?? null,
      dayHigh: stored?.price.dayHigh ?? null,
      updatedAt: stored?.at ?? null,
      error: stored ? undefined : warning ?? 'ยังไม่มีข้อมูล',
    };
  });

  const unavailable = symbols.filter((s) => (misses.get(s)?.count ?? 0) > 0 && !liveStore.has(s));
  const pending = symbols.filter((s) => !liveStore.has(s) && !unavailable.includes(s)).length;

  if (!warning && pending > 0) {
    warning =
      `โควตา ${liveProvider.name} ดึงได้รอบละ ${liveProvider.maxPerCycle} ตัว ` +
      `กำลังทยอยเก็บอีก ${pending} ตัว`;
  }

  return {
    quotes,
    provider: liveProvider.name,
    windowEndProvider: windowEndProvider.name,
    serverTime: Date.now(),
    perCycle: liveProvider.maxPerCycle,
    refreshMs: liveProvider.minCycleMs,
    unavailable,
    warning,
  };
}

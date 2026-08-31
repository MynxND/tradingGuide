import { resolveProviders, type LivePrice } from './providers';
import type { WindowSnapshot } from './providers/types';
import { DEFAULT_END_MIN, etDateString, windowState } from './strategy';

export type SymbolQuote = {
  symbol: string;
  /** ชื่อบริษัทตามที่ provider หาเจอ — ใช้ตรวจว่า ticker ไม่ผิดตัว */
  name: string | null;
  /** ราคาเปิด 09:30 ET (20:30 น. ไทย) */
  open: number | null;
  /** ราคา ณ นาทีปลายช่วงที่เลือก (ET) — null ถ้ายังไม่ถึงเวลา */
  windowEnd: number | null;
  /** ราคาซื้อขายล่าสุดที่ดึงได้ */
  last: number | null;
  dayHigh: number | null;
  /** ราคาสูงสุดในหน้าต่างที่เลือก (นิ่งแล้วเมื่อพ้นเวลา) */
  windowHigh: number | null;
  /**
   * true เมื่อ windowHigh อาจต่ำกว่าจริง เพราะแท่งราคาช่วงหัวหน้าต่างขาด
   * และ process นี้ก็ไม่ได้เห็นราคาสดตอนช่วงยังไม่จบ (เช่นเพิ่งสตาร์ท server)
   */
  windowHighPartial: boolean;
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
  /** จำนวนหุ้นสูงสุดที่โควตารีเฟรชได้ทันทุกรอบ */
  capacity: number;
  /** จังหวะรีเฟรชที่โควตารับได้ (ms) */
  refreshMs: number;
  /** หุ้นที่ provider หาไม่เจอ — สะกดผิดหรือไม่มีในแพ็กเกจ */
  unavailable: string[];
  warning?: string;
};

/** ถือว่าราคายัง "สด" ภายในกี่มิลลิวินาที */
const FRESH_MS = 15_000;
/** ราคาปลายช่วงนิ่งแล้ว ดึงทีละไม่กี่ตัวต่อรอบเพื่อไม่ชนโควตา */
const WINDOW_END_PER_CYCLE = 2;

type Stored = { price: LivePrice; at: number };

/**
 * งานดึงราคาที่กำลังวิ่งอยู่ แยกตามหุ้น
 *
 * ถ้าไม่มีตัวนี้ ผู้ใช้ 10 คนที่เข้ามาพร้อมกันจะเห็น store ว่างเหมือนกันหมด
 * แล้วยิงต้นทางคนละชุด (cache stampede) — วัดแล้วกิน quota 19 ครั้งสำหรับ 3 หุ้น
 * เมื่อมี single-flight คนแรกเป็นคนยิง คนที่เหลือรอผลเดียวกัน
 */
const inflight = new Map<string, Promise<void>>();

let storeDay: string | null = null;
const liveStore = new Map<string, Stored>();
/**
 * คีย์ "YYYY-MM-DD:ENDMIN:SYMBOL"
 * ต้องมี endMin ในคีย์ ไม่งั้นสลับเวลาปลายช่วงแล้วจะได้ราคาของเวลาเดิมที่แคชไว้
 */
const windowEndCache = new Map<string, WindowSnapshot>();
/**
 * high สูงสุดที่เห็นจากราคาสดระหว่างที่หน้าต่างยังไม่จบ คีย์ "YYYY-MM-DD:ENDMIN:SYMBOL"
 *
 * มีไว้กู้เคสที่ provider ประวัติศาสตร์ให้แท่งไม่ครบช่วงหัว — วัดจริงพบว่า Twelve Data
 * ไม่มีแท่ง 09:30–09:45 ของวันปัจจุบัน ทำให้ high ที่ได้ต่ำกว่าราคาเปิดด้วยซ้ำ
 * ระหว่างช่วงเราเห็น dayHigh จาก provider ราคาสดอยู่แล้วทุก 20 วิ จดไว้ไม่กินโควตาเพิ่ม
 */
const liveWindowHigh = new Map<string, number>();

/** หุ้นที่ provider ตอบสำเร็จแต่ไม่มีข้อมูลให้ — พักไว้ ไม่ยิงซ้ำทุกรอบให้เปลืองโควตา */
const misses = new Map<string, { count: number; until: number }>();
const MISS_BACKOFF_MS = 10 * 60_000;
/** ชื่อบริษัทไม่เปลี่ยนรายวัน เก็บไว้ตลอดอายุ process */
const nameCache = new Map<string, string | null>();
const NAMES_PER_CYCLE = 2;

export async function getQuotes(
  symbols: string[],
  endMin: number = DEFAULT_END_MIN,
): Promise<QuotesResult> {
  const { live: liveProvider, windowEnd: windowEndProvider } = resolveProviders();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const day = etDateString(nowSec);
  const state = windowState(nowSec, endMin);

  // ข้ามวันซื้อขายแล้วราคาเก่าใช้ไม่ได้
  if (storeDay !== day) {
    liveStore.clear();
    liveWindowHigh.clear();
    storeDay = day;
  }

  const highKey = (symbol: string) => `${day}:${endMin}:${symbol}`;

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

  // ตัวที่มีคนอื่นกำลังดึงอยู่แล้ว ให้รอผลของเขา ไม่ยิงซ้ำ
  const waitFor = stale.filter((s) => inflight.has(s)).map((s) => inflight.get(s)!);
  const toFetch = stale.filter((s) => !inflight.has(s));

  if (toFetch.length > 0) {
    const job = (async () => {
      try {
        const { prices, attempted } = await liveProvider.fetchLive(toFetch);
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
      } finally {
        for (const symbol of toFetch) inflight.delete(symbol);
      }
    })();
    for (const symbol of toFetch) inflight.set(symbol, job);
    waitFor.push(job);
  }

  if (waitFor.length > 0) await Promise.all(waitFor);

  // ราคาปิดหน้าต่างดึงครั้งเดียวต่อหุ้นต่อวันต่อเวลาปลายช่วง และเฉพาะเมื่อพ้นเวลาแล้ว
  if (state === 'after') {
    const missing = symbols
      .filter((s) => !windowEndCache.has(`${day}:${endMin}:${s}`))
      .slice(0, WINDOW_END_PER_CYCLE);
    for (const symbol of missing) {
      try {
        const snap = await windowEndProvider.fetchWindowSnapshot(symbol, endMin);
        windowEndCache.set(`${day}:${endMin}:${symbol}`, {
          end: snap?.end ?? null,
          high: snap?.high ?? null,
          highPartial: snap?.highPartial ?? true,
        });
      } catch (err) {
        // ดึงไม่ได้ก็ใช้ราคาล่าสุดไปก่อน แล้วลองใหม่รอบหน้า
        warning ??= err instanceof Error ? err.message : undefined;
      }
    }
  }

  /**
   * ยังอยู่ในช่วง: จดราคาสูงสุดที่เห็นไว้ก่อน
   * ต้องจดตอนนี้เท่านั้น พ้นเวลาแล้ว dayHigh จะรวมราคาหลังหน้าต่างเข้ามาด้วยและใช้ไม่ได้
   */
  if (state === 'live') {
    for (const symbol of symbols) {
      const high = liveStore.get(symbol)?.price.dayHigh;
      if (high == null) continue;
      const seen = liveWindowHigh.get(highKey(symbol));
      if (seen == null || high > seen) liveWindowHigh.set(highKey(symbol), high);
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
    const snap = state === 'after' ? windowEndCache.get(`${day}:${endMin}:${symbol}`) : undefined;
    const seenLive = liveWindowHigh.get(highKey(symbol)) ?? null;

    /**
     * ยังไม่พ้นช่วง: high ของวันคือ high ของช่วงนี้อยู่แล้ว
     * พ้นช่วงแล้ว: ใช้ค่าที่คิดจากแท่งในช่วง แต่ต้อง max กับค่าที่เราเห็นเองตอนช่วงยังไม่จบ
     * เพราะแท่งจาก provider อาจขาดช่วงหัวไป (วัดจริง: ขาด 09:30–09:45 ของวันปัจจุบัน)
     */
    const candidates = snap
      ? [snap.high, seenLive]
      : [stored?.price.dayHigh ?? null, seenLive];
    const highs = candidates.filter((n): n is number => n != null);
    const windowHigh = highs.length > 0 ? Math.max(...highs) : null;

    return {
      symbol,
      name: stored?.price.name ?? nameCache.get(symbol) ?? null,
      open: stored?.price.open ?? null,
      windowEnd: snap?.end ?? null,
      last: stored?.price.last ?? null,
      dayHigh: stored?.price.dayHigh ?? null,
      windowHigh,
      // ธงขึ้นเฉพาะเมื่อแท่งขาดช่วงหัว *และ* เราก็ไม่ได้เห็นราคาสดตอนช่วงยังไม่จบ
      windowHighPartial: Boolean(snap?.highPartial) && seenLive == null,
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

  // ลิสต์ใหญ่เกินโควตา ราคาจะยังอัปเดตแต่หมุนช้าลง บอกให้รู้ดีกว่าปล่อยให้เงียบ ๆ ช้า
  const tracked = symbols.length - unavailable.length;
  if (!warning && tracked > liveProvider.capacity) {
    const cycles = Math.ceil(tracked / liveProvider.capacity);
    const seconds = Math.round((cycles * liveProvider.minCycleMs) / 1000);
    warning =
      `ลิสต์ ${tracked} ตัว เกินที่โควตา ${liveProvider.name} รีเฟรชได้ทันรอบเดียว ` +
      `(ไหวสูงสุด ${liveProvider.capacity} ตัว) — ราคาแต่ละตัวจะหมุนอัปเดตทุก ~${seconds} วิ`;
  }

  return {
    quotes,
    provider: liveProvider.name,
    windowEndProvider: windowEndProvider.name,
    serverTime: Date.now(),
    perCycle: liveProvider.maxPerCycle,
    capacity: liveProvider.capacity,
    refreshMs: liveProvider.minCycleMs,
    unavailable,
    warning,
  };
}

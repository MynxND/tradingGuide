import { resolveProviders } from './providers';
import { DEFAULT_END_MIN, SESSION_START_MIN, minuteLabel } from './strategy';

export type HistoryQuote = {
  symbol: string;
  open: number | null;
  windowEnd: number | null;
  /** ราคาสูงสุดในช่วง 09:30 ถึงปลายช่วงที่เลือก (ET) ของวันนั้น */
  windowHigh: number | null;
  /** true เมื่อแท่งราคาไม่ครอบตั้งแต่นาทีเปิด — windowHigh อาจต่ำกว่าจริง */
  windowHighPartial?: boolean;
  name: string | null;
};

/**
 * คีย์ "YYYY-MM-DD:ENDMIN:SYMBOL" — ราคาย้อนหลังนิ่งแล้ว เก็บได้ตลอดอายุ process
 * endMin อยู่ในคีย์เพราะเปลี่ยนเวลาปลายช่วงแล้วต้องดึงราคาของเวลาใหม่ ไม่ใช่ใช้ของเดิม
 */
const cache = new Map<string, HistoryQuote>();
/** ตัวที่ดึงแล้วไม่มีข้อมูล ไม่ต้องยิงซ้ำ */
const misses = new Set<string>();

/** โควตาฟรีจำกัดต่อนาที ดึงทีละไม่กี่ตัวต่อรอบแล้วให้ client เรียกซ้ำ */
const PER_REQUEST = 4;

const BASE = 'https://api.twelvedata.com';

/** แท่งแรกช้ากว่านาทีเปิดได้ไม่เกินเท่านี้ ก่อนจะถือว่า high ครอบช่วงไม่ครบ */
const COVERAGE_TOLERANCE_MIN = 2;

async function fetchOne(
  symbol: string,
  date: string,
  apiKey: string,
  endMin: number,
): Promise<HistoryQuote | null> {
  // ขอเผื่อหัวท้ายข้างละนาที ให้แน่ใจว่าได้แท่งของนาทีเปิดและนาทีปลายช่วงมาครบ
  const url =
    `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1min` +
    `&start_date=${date}%20${minuteLabel(SESSION_START_MIN - 1)}:00` +
    `&end_date=${date}%20${minuteLabel(endMin + 1)}:00` +
    `&timezone=America/New_York&apikey=${apiKey}`;

  // ราคาย้อนหลังของวันที่ปิดไปแล้วไม่เปลี่ยนอีก แคชยาวได้เลย
  // ผู้ใช้คนที่สองที่ขอวันเดียวกันจะไม่กิน quota ซ้ำ
  const res = await fetch(url, { next: { revalidate: 2_592_000 } });
  if (!res.ok) throw new Error(`Twelve Data ตอบ ${res.status}`);
  const json = await res.json();
  if (json?.status === 'error') {
    // ไม่มีข้อมูลวันนั้น (วันหยุด/หุ้นยังไม่ IPO) ไม่ใช่ error ที่ต้องหยุดทั้งชุด
    if (/no data|not found|invalid symbol/i.test(json.message ?? '')) return null;
    throw new Error(json.message ?? 'Twelve Data error');
  }

  const values: Array<{ datetime: string; open: string; close: string; high: string }> =
    json?.values ?? [];
  if (values.length === 0) return null;

  const at = (minute: number) => {
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    return values.find((v) => v.datetime.slice(11, 16) === `${hh}:${mm}`);
  };

  /**
   * แท่งแรกที่ได้มาต้องอยู่ที่นาทีเปิด ไม่งั้น high ขาดช่วงหัวไป
   * วันย้อนหลังปกติครบ (วัดจริง 122 แท่ง เริ่ม 09:30) แต่เช็คไว้ดีกว่าโชว์เลขต่ำกว่าจริงเงียบ ๆ
   */
  const firstMinute = values.at(-1)?.datetime.slice(11, 16);
  const windowHighPartial =
    firstMinute == null || firstMinute > minuteLabel(SESSION_START_MIN + COVERAGE_TOLERANCE_MIN);

  const openBar = at(SESSION_START_MIN);
  // หุ้นสภาพคล่องต่ำอาจไม่มีแท่งของนาทีปลายช่วง — ถอยไปใช้แท่งล่าสุดที่ไม่เกินเวลานั้น
  const endBar = at(endMin) ?? values.at(0);
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const highs = values
    .map((v) => num(v.high))
    .filter((n): n is number => n != null);

  return {
    symbol,
    open: num(openBar?.open),
    windowEnd: num(endBar?.open) ?? num(endBar?.close),
    // ช่วงที่ขอมาครอบแค่หน้าต่างที่เลือกอยู่แล้ว high ของชุดนี้จึงเป็น high ของช่วงพอดี
    windowHigh: highs.length > 0 ? Math.max(...highs) : null,
    windowHighPartial,
    name: null,
  };
}

export async function getHistory(date: string, symbols: string[], endMin = DEFAULT_END_MIN) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  const { windowEnd: provider } = resolveProviders();

  // โหมด mock ใช้ตัวเลขชุดเดียวกับ Excel เพื่อทดสอบ flow ได้โดยไม่กิน quota
  if (provider.name === 'mock' || !apiKey) {
    const quotes: HistoryQuote[] = [];
    for (const symbol of symbols) {
      const snap = await provider.fetchWindowSnapshot(symbol, endMin).catch(() => null);
      quotes.push({
        symbol,
        open: snap?.end ?? null,
        windowEnd: snap?.end ?? null,
        windowHigh: snap?.high ?? null,
        windowHighPartial: snap?.highPartial ?? false,
        name: null,
      });
    }
    return { quotes, pending: 0, provider: provider.name };
  }

  const key = (s: string) => `${date}:${endMin}:${s}`;
  const todo = symbols.filter((s) => !cache.has(key(s)) && !misses.has(key(s)));
  const batch = todo.slice(0, PER_REQUEST);
  let warning: string | undefined;

  for (const symbol of batch) {
    try {
      const q = await fetchOne(symbol, date, apiKey, endMin);
      if (q && (q.open != null || q.windowEnd != null)) cache.set(key(symbol), q);
      else misses.add(key(symbol));
    } catch (err) {
      warning = err instanceof Error ? err.message : 'ดึงข้อมูลย้อนหลังไม่สำเร็จ';
      break; // โควตาหมดหรือ provider ล่ม หยุดรอบนี้ไว้ก่อน
    }
  }

  const quotes = symbols
    .map((s) => cache.get(key(s)))
    .filter((q): q is HistoryQuote => Boolean(q));

  const pending = symbols.filter(
    (s) => !cache.has(`${date}:${s}`) && !misses.has(`${date}:${s}`),
  ).length;

  const unavailable = symbols.filter((s) => misses.has(`${date}:${s}`));

  return { quotes, pending, unavailable, warning, provider: provider.name };
}

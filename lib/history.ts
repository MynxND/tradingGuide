import { resolveProviders } from './providers';
import { SESSION_END_MIN, SESSION_START_MIN } from './strategy';

export type HistoryQuote = {
  symbol: string;
  open: number | null;
  windowEnd: number | null;
  name: string | null;
};

/** คีย์ "YYYY-MM-DD:SYMBOL" — ราคาย้อนหลังนิ่งแล้ว เก็บได้ตลอดอายุ process */
const cache = new Map<string, HistoryQuote>();
/** ตัวที่ดึงแล้วไม่มีข้อมูล ไม่ต้องยิงซ้ำ */
const misses = new Set<string>();

/** โควตาฟรีจำกัดต่อนาที ดึงทีละไม่กี่ตัวต่อรอบแล้วให้ client เรียกซ้ำ */
const PER_REQUEST = 4;

const BASE = 'https://api.twelvedata.com';

async function fetchOne(symbol: string, date: string, apiKey: string): Promise<HistoryQuote | null> {
  const url =
    `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1min` +
    `&start_date=${date}%2009:29:00&end_date=${date}%2011:31:00` +
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

  const values: Array<{ datetime: string; open: string; close: string }> = json?.values ?? [];
  if (values.length === 0) return null;

  const at = (minute: number) => {
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    return values.find((v) => v.datetime.slice(11, 16) === `${hh}:${mm}`);
  };

  const openBar = at(SESSION_START_MIN);
  const endBar = at(SESSION_END_MIN);
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    symbol,
    open: num(openBar?.open),
    windowEnd: num(endBar?.open) ?? num(endBar?.close),
    name: null,
  };
}

export async function getHistory(date: string, symbols: string[]) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  const { windowEnd: provider } = resolveProviders();

  // โหมด mock ใช้ตัวเลขชุดเดียวกับ Excel เพื่อทดสอบ flow ได้โดยไม่กิน quota
  if (provider.name === 'mock' || !apiKey) {
    const quotes: HistoryQuote[] = [];
    for (const symbol of symbols) {
      const windowEnd = await provider.fetchWindowEnd(symbol).catch(() => null);
      quotes.push({ symbol, open: windowEnd, windowEnd, name: null });
    }
    return { quotes, pending: 0, provider: provider.name };
  }

  const todo = symbols.filter((s) => !cache.has(`${date}:${s}`) && !misses.has(`${date}:${s}`));
  const batch = todo.slice(0, PER_REQUEST);
  let warning: string | undefined;

  for (const symbol of batch) {
    try {
      const q = await fetchOne(symbol, date, apiKey);
      if (q && (q.open != null || q.windowEnd != null)) cache.set(`${date}:${symbol}`, q);
      else misses.add(`${date}:${symbol}`);
    } catch (err) {
      warning = err instanceof Error ? err.message : 'ดึงข้อมูลย้อนหลังไม่สำเร็จ';
      break; // โควตาหมดหรือ provider ล่ม หยุดรอบนี้ไว้ก่อน
    }
  }

  const quotes = symbols
    .map((s) => cache.get(`${date}:${s}`))
    .filter((q): q is HistoryQuote => Boolean(q));

  const pending = symbols.filter(
    (s) => !cache.has(`${date}:${s}`) && !misses.has(`${date}:${s}`),
  ).length;

  const unavailable = symbols.filter((s) => misses.has(`${date}:${s}`));

  return { quotes, pending, unavailable, warning, provider: provider.name };
}

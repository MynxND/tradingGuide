/** หุ้น US ที่บวกสูงสุดในช่วงเวลาที่เลือก (จัดอันดับทั้งตลาดฝั่งต้นทาง) */

import { fetchWebullGainers } from './gainers-webull';
import { finnhubDailyChange } from './providers/finnhub';
import { etDateString } from './strategy';

const TRADINGVIEW_URL = 'https://scanner.tradingview.com/america/scan';
const NASDAQ_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&offset=0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
/** อันดับช่วงนาทีเปลี่ยนเร็ว แคชสั้น ๆ พอกันคนกดรีเฟรชรัว ๆ */
const CACHE_TTL_MS = 20_000;
const DEFAULT_LIMIT = 50;

/**
 * ช่วงที่ต้นทางอันดับรองรับจริง — ไม่มี 1 นาที เพราะ Webull เองก็สั้นสุดที่ 3 นาที
 * (ในแอป Webull ปุ่มซ้ายสุดคือ "3 Minutes") ขอ rankType=1min แล้วตอบ 417 กลับมา
 */
export const GAINER_PERIODS = ['3m', '5m', '1d', '5d', '1mo'] as const;
export type GainerPeriod = (typeof GAINER_PERIODS)[number];

/**
 * คอลัมน์ TradingView ที่ใช้เป็นทางสำรองเมื่อต้นทางอันดับล่ม
 * มีแค่ช่วงที่เทียบราคาปิด — ช่วงนาทีของมันเป็น % ในแท่งเทียนที่กำลังก่อตัว
 * ไม่ใช่ย้อนหลัง N นาที จึงใช้แทนกันไม่ได้ ต้องบอกผู้ใช้ว่าช่วงนั้นดูไม่ได้ชั่วคราว
 */
const FALLBACK_COLUMN: Partial<Record<GainerPeriod, string>> = {
  '1d': 'change',
  '5d': 'Perf.5D',
};

/**
 * % รายวันที่สูงกว่านี้ในทางสำรองถือว่าเป็นผลของ reverse split ที่ prevClose ยังไม่ปรับ
 * ไม่ใช่การวิ่งจริง (วัดจริงวันเดียวเจอ 7 ตัวย่าน 800–4700% ซึ่งของจริงคือ ±5%)
 */
const IMPOSSIBLE_DAILY_PCT = 500;
/** ตรวจกี่ตัวต่อรอบ — กันไม่ให้แย่งโควตา Finnhub ไปจากการ poll ราคาในลิสต์สูตร */
const VERIFY_BUDGET = 10;
/** ต่างกันเกินเท่านี้ (จุด %) ถือว่า prevClose ของ screener ใช้ไม่ได้ */
const VERIFY_TOLERANCE_PCT = 15;
/** ตรวจเผื่อไว้เต็มจำนวนที่หน้าเว็ปเลือกแสดงได้ ผลที่แคชจะใช้ได้ทุก limit */
const VERIFY_DEPTH = 100;

export type Gainer = {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number;
  marketCap: number | null;
};

export type GainersResult = {
  gainers: Gainer[];
  fetchedAt: number;
  cached: boolean;
  period: GainerPeriod;
  /** ต้นทางที่ให้อันดับชุดนี้มา — บอกผู้ใช้เมื่อหลุดไปใช้ทางสำรองที่ดีเลย์กว่า */
  source: 'webull' | 'tradingview' | 'nasdaq';
  error?: string;
};

type NasdaqRow = { symbol: string; name: string; lastsale: string; pctchange: string; marketCap: string };
type ScanRow = { s?: string; d?: unknown[] };

const EXCLUDE_NAME = /\b(warrants?|units?|rights?|preferred|notes?|debentures?)\b/i;

const toNumber = (raw: unknown) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || !raw) return null;
  const n = Number(raw.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const tradable = (symbol: string, name: string) =>
  Boolean(symbol) && !EXCLUDE_NAME.test(name);

type Loaded = { data: Gainer[]; source: GainersResult['source'] };

const cache = new Map<GainerPeriod, { at: number } & Loaded>();
const inflight = new Map<GainerPeriod, Promise<Loaded>>();

export function isGainerPeriod(value: string | null): value is GainerPeriod {
  return GAINER_PERIODS.includes(value as GainerPeriod);
}

/** จัดอันดับด้วยคอลัมน์ของ TradingView — ทางสำรองสำหรับ 1 วัน / 5 วันเท่านั้น */
async function fetchByColumn(column: string): Promise<Gainer[]> {
  const res = await fetch(TRADINGVIEW_URL, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      filter: [
        { left: 'type', operation: 'equal', right: 'stock' },
        { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
        { left: column, operation: 'greater', right: 0 },
      ],
      options: { lang: 'en' },
      symbols: { query: { types: [] }, tickers: [] },
      columns: ['name', 'description', 'close', column, 'market_cap_basic'],
      sort: { sortBy: column, sortOrder: 'desc' },
      range: [0, 199],
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ข้อมูลตลาดตอบ ${res.status}`);
  const json = await res.json();
  const rows: ScanRow[] = json?.data ?? [];

  const data = rows
    .map((row) => {
      const [symbol, name, price, changePct, marketCap] = (row.d ?? []) as unknown[];
      return {
        symbol: String(symbol ?? row.s?.split(':').at(-1) ?? ''),
        name: String(name ?? ''),
        price: toNumber(price),
        changePct: toNumber(changePct) ?? Number.NaN,
        marketCap: toNumber(marketCap),
      };
    })
    .filter((g) => tradable(g.symbol, g.name) && Number.isFinite(g.changePct) && g.changePct > 0);
  if (data.length === 0) throw new Error('ไม่พบข้อมูลหุ้นบวกในช่วงนี้');
  return data;
}

/** fallback รายวันจาก NASDAQ เผื่อ screener ขัดข้องด้วย */
async function fetchNasdaqDaily(): Promise<Gainer[]> {
  const res = await fetch(NASDAQ_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    next: { revalidate: 600 },
  });
  if (!res.ok) throw new Error(`NASDAQ ตอบ ${res.status}`);
  const json = await res.json();
  const rows: NasdaqRow[] = json?.data?.table?.rows ?? [];
  if (rows.length === 0) throw new Error('NASDAQ ไม่ส่งข้อมูลมา');
  return rows
    .filter((r) => r.symbol && r.name && tradable(r.symbol, r.name))
    .map((r) => ({
      symbol: r.symbol,
      name: r.name.replace(/\s+Common Stock$/i, '').trim(),
      price: toNumber(r.lastsale),
      changePct: toNumber(r.pctchange) ?? Number.NaN,
      marketCap: toNumber(r.marketCap),
    }))
    .filter((g) => Number.isFinite(g.changePct) && g.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct);
}

/**
 * ผลตรวจ prevClose แยกตามวัน — หุ้นที่ reverse split วันนี้ก็เพี้ยนทั้งวัน
 * จำไว้ได้เลยไม่ต้องเปลืองโควตาถามซ้ำทุกรอบรีเฟรช
 */
const verdicts = new Map<string, { day: string; ok: boolean; changePct: number; last: number }>();

/**
 * คัด % รายวันปลอมออกจากทางสำรอง แล้วแทนค่าที่เหลือด้วยราคาสดจาก Finnhub
 *
 * ใช้เฉพาะตอนหลุดมาใช้ TradingView — prevClose ของมันไม่ปรับ reverse split
 * (วัดจริง: HCWC prevClose 0.2413 แต่ของจริง 8.4455 → โชว์ +3282% ทั้งที่ลง 3.97%)
 */
async function verifyDaily(rows: Gainer[], limit: number): Promise<Gainer[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  // ไม่มี key ก็ยังตัดตัวที่เป็นไปไม่ได้ออกได้ ดีกว่าปล่อย +4700% ขึ้นหน้าแรก
  const plausible = rows.filter((g) => g.changePct <= IMPOSSIBLE_DAILY_PCT);
  if (!apiKey) return plausible;

  const day = etDateString(Math.floor(Date.now() / 1000));
  const out: Gainer[] = [];
  let budget = VERIFY_BUDGET;

  for (const row of plausible) {
    if (out.length >= limit) break;

    const known = verdicts.get(row.symbol);
    let verdict = known?.day === day ? known : null;

    if (!verdict && budget > 0) {
      budget--;
      try {
        const quote = await finnhubDailyChange(apiKey, row.symbol);
        if (quote) {
          verdict = {
            day,
            ok: Math.abs(quote.changePct - row.changePct) <= VERIFY_TOLERANCE_PCT,
            changePct: quote.changePct,
            last: quote.last,
          };
          verdicts.set(row.symbol, verdict);
        }
      } catch {
        // โควตาหมดหรือต้นทางล่ม — ปล่อยผ่านโดยไม่ตรวจ ดีกว่าทำให้ทั้งลิสต์พัง
      }
    }

    if (!verdict) {
      out.push(row); // ตรวจไม่ทัน แต่ผ่านเพดานความเป็นไปได้มาแล้ว
      continue;
    }
    if (!verdict.ok) continue; // prevClose ของ screener เพี้ยน ตัดทิ้ง
    out.push({ ...row, changePct: verdict.changePct, price: verdict.last });
  }

  return out.filter((g) => g.changePct > 0).sort((a, b) => b.changePct - a.changePct);
}

async function loadFallback(period: GainerPeriod): Promise<Loaded> {
  const column = FALLBACK_COLUMN[period];
  if (!column) {
    throw new Error(
      `ต้นทางอันดับช่วง ${period} ใช้ไม่ได้ชั่วคราว และไม่มีแหล่งสำรองที่ให้ % ย้อนหลังตามนาทีได้ — ` +
        'ลองใหม่อีกครั้ง หรือเลือกช่วง 1 วัน / 5 วัน',
    );
  }
  try {
    const data = await verifyDaily(await fetchByColumn(column), VERIFY_DEPTH);
    if (data.length === 0) throw new Error('ไม่พบข้อมูลหุ้นบวกในช่วงนี้');
    return { data, source: 'tradingview' };
  } catch (err) {
    if (period !== '1d') throw err;
    return { data: await verifyDaily(await fetchNasdaqDaily(), VERIFY_DEPTH), source: 'nasdaq' };
  }
}

async function load(period: GainerPeriod): Promise<Loaded> {
  try {
    return { data: await fetchWebullGainers(period), source: 'webull' };
  } catch {
    return loadFallback(period);
  }
}

export async function getGainers(
  limit = DEFAULT_LIMIT,
  period: GainerPeriod = '1d',
): Promise<GainersResult> {
  const saved = cache.get(period);
  if (saved && Date.now() - saved.at < CACHE_TTL_MS) {
    return {
      gainers: slice(saved.data, limit),
      fetchedAt: saved.at,
      cached: true,
      period,
      source: saved.source,
    };
  }

  let request = inflight.get(period);
  if (!request) {
    request = load(period);
    inflight.set(period, request);
    request.finally(() => inflight.delete(period)).catch(() => undefined);
  }

  try {
    const { data, source } = await request;
    const at = Date.now();
    cache.set(period, { at, data, source });
    return { gainers: slice(data, limit), fetchedAt: at, cached: false, period, source };
  } catch (err) {
    if (saved) {
      return {
        gainers: slice(saved.data, limit),
        fetchedAt: saved.at,
        cached: true,
        period,
        source: saved.source,
        error: err instanceof Error ? err.message : 'ดึงข้อมูลไม่สำเร็จ',
      };
    }
    throw err;
  }
}

function slice(data: Gainer[], limit: number) {
  return data.slice(0, Math.min(Math.max(limit, 1), 200));
}

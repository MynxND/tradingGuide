/** หุ้น US ที่บวกสูงสุดในช่วงเวลาที่เลือก (จัดอันดับทั้งตลาดฝั่งต้นทาง) */

const TRADINGVIEW_URL = 'https://scanner.tradingview.com/america/scan';
const NASDAQ_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&offset=0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_LIMIT = 50;

export const GAINER_PERIODS = ['30m', '1h', '1d', '5d'] as const;
export type GainerPeriod = (typeof GAINER_PERIODS)[number];

const PERIOD_COLUMN: Record<GainerPeriod, string> = {
  '30m': 'change|30',
  '1h': 'change|60',
  '1d': 'change',
  '5d': 'Perf.5D',
};

export type Gainer = {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number;
  marketCap: number | null;
};

type NasdaqRow = { symbol: string; name: string; lastsale: string; pctchange: string; marketCap: string };
type TradingViewRow = { s?: string; d?: [string?, string?, number?, number?, number?] };

const EXCLUDE_NAME = /\b(warrants?|units?|rights?|preferred|notes?|debentures?)\b/i;

const toNumber = (raw: string | number | null | undefined) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (!raw) return null;
  const n = Number(raw.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const cache = new Map<GainerPeriod, { at: number; data: Gainer[] }>();
const inflight = new Map<GainerPeriod, Promise<Gainer[]>>();

export function isGainerPeriod(value: string | null): value is GainerPeriod {
  return GAINER_PERIODS.includes(value as GainerPeriod);
}

async function fetchTradingView(period: GainerPeriod): Promise<Gainer[]> {
  const changeColumn = PERIOD_COLUMN[period];
  const res = await fetch(TRADINGVIEW_URL, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      filter: [
        { left: 'type', operation: 'equal', right: 'stock' },
        { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
        { left: changeColumn, operation: 'greater', right: 0 },
      ],
      options: { lang: 'en' },
      symbols: { query: { types: [] }, tickers: [] },
      columns: ['name', 'description', 'close', changeColumn, 'market_cap_basic'],
      sort: { sortBy: changeColumn, sortOrder: 'desc' },
      range: [0, 199],
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ข้อมูลตลาดตอบ ${res.status}`);

  const json = await res.json();
  const rows: TradingViewRow[] = json?.data ?? [];
  const data = rows
    .map((row) => {
      const [symbol, name, price, changePct, marketCap] = row.d ?? [];
      return {
        symbol: symbol ?? row.s?.split(':').at(-1) ?? '',
        name: name ?? '',
        price: toNumber(price),
        changePct: toNumber(changePct) ?? Number.NaN,
        marketCap: toNumber(marketCap),
      };
    })
    .filter((g) => g.symbol && g.name && !EXCLUDE_NAME.test(g.name) && Number.isFinite(g.changePct) && g.changePct > 0);
  if (data.length === 0) throw new Error('ไม่พบข้อมูลหุ้นบวกในช่วงนี้');
  return data;
}

/** fallback รายวันจาก NASDAQ เผื่อต้นทาง screener ขัดข้อง */
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
    .filter((r) => r.symbol && r.name && !EXCLUDE_NAME.test(r.name))
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

export async function getGainers(limit = DEFAULT_LIMIT, period: GainerPeriod = '1d') {
  const saved = cache.get(period);
  if (saved && Date.now() - saved.at < CACHE_TTL_MS) {
    return { gainers: slice(saved.data, limit), fetchedAt: saved.at, cached: true, period };
  }

  let request = inflight.get(period);
  if (!request) {
    request = fetchTradingView(period).catch((error) => {
      if (period === '1d') return fetchNasdaqDaily();
      throw error;
    });
    inflight.set(period, request);
    request.finally(() => inflight.delete(period)).catch(() => undefined);
  }

  try {
    const data = await request;
    const at = Date.now();
    cache.set(period, { at, data });
    return { gainers: slice(data, limit), fetchedAt: at, cached: false, period };
  } catch (err) {
    if (saved) {
      return {
        gainers: slice(saved.data, limit), fetchedAt: saved.at, cached: true, period,
        error: err instanceof Error ? err.message : 'ดึงข้อมูลไม่สำเร็จ',
      };
    }
    throw err;
  }
}

function slice(data: Gainer[], limit: number) {
  return data.slice(0, Math.min(Math.max(limit, 1), 200));
}

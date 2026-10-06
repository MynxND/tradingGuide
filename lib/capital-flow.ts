/**
 * การกระจายคำสั่งซื้อขาย (capital flow) จาก Webull — ตัวเดียวกับหน้า "กราฟ" ในแอป Webull
 *
 * ต้นทางรับเป็น tickerId ภายในของ Webull ไม่ใช่ชื่อย่อ จึงต้องค้นหา id ก่อน 1 รอบ
 * id ไม่เปลี่ยนตามเวลา เลยแคชไว้ในหน่วยความจำของ instance (cold start ค่อยค้นใหม่)
 */

const BASE = 'https://quotes-gw.webullfintech.com/api';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
/** regionId 6 = สหรัฐ */
const REGION_US = 6;

export type FlowBucket = { inflow: number; outflow: number };

export type FlowDay = {
  /** YYYY-MM-DD */
  date: string;
  large: FlowBucket;
  medium: FlowBucket;
  small: FlowBucket;
};

export type CapitalFlow = {
  symbol: string;
  latest: FlowDay | null;
  /** ย้อนหลังเก่า → ใหม่ ไม่รวมวันล่าสุด */
  history: FlowDay[];
  fetchedAt: number;
};

const tickerIds = new Map<string, number>();

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Webull ตอบ ${res.status}`);
  return res.json();
}

async function resolveTickerId(symbol: string) {
  const cached = tickerIds.get(symbol);
  if (cached) return cached;
  const json = await getJson(
    `${BASE}/search/pc/tickers?keyword=${encodeURIComponent(symbol)}&pageIndex=1&pageSize=20&regionId=${REGION_US}`,
  );
  const rows: { tickerId?: number; symbol?: string; disSymbol?: string; regionId?: number }[] = json?.data ?? [];
  // ค้นด้วยคำค้นแล้วได้หุ้นชื่อคล้าย ๆ มาด้วย (TSLA → TSLL) ต้องเลือกตัวที่ตรงเป๊ะ
  const hit = rows.find(
    (r) => r.regionId === REGION_US && (r.disSymbol ?? r.symbol)?.toUpperCase() === symbol,
  );
  if (!hit?.tickerId) throw new Error(`ไม่พบ ${symbol} ใน Webull`);
  tickerIds.set(symbol, hit.tickerId);
  return hit.tickerId;
}

type RawItem = Record<string, number | string | null | undefined>;

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const isoDate = (raw: string) => `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;

function toDay(raw: { date?: string; item?: RawItem } | undefined): FlowDay | null {
  if (!raw?.date || !raw.item) return null;
  const it = raw.item;
  // "ขนาดใหญ่" ในแอป = large + superLarge (หุ้น US ต้นทางส่ง superLarge เป็น 0 แต่รวมไว้กันเปลี่ยน)
  return {
    date: isoDate(raw.date),
    large: {
      inflow: n(it.largeInflow) + n(it.superLargeInflow),
      outflow: n(it.largeOutflow) + n(it.superLargeOutflow),
    },
    medium: { inflow: n(it.mediumInflow), outflow: n(it.mediumOutflow) },
    small: { inflow: n(it.smallInflow), outflow: n(it.smallOutflow) },
  };
}

export async function getCapitalFlow(symbol: string): Promise<CapitalFlow> {
  const tickerId = await resolveTickerId(symbol);
  const json = await getJson(`${BASE}/stock/capitalflow/ticker?tickerId=${tickerId}&showHis=true`);
  if (json?.code) throw new Error(`Webull ปฏิเสธคำขอ (${json.code})`);

  const latest = toDay(json?.latest);
  const history = ((json?.historical ?? []) as { date?: string; item?: RawItem }[])
    .map(toDay)
    .filter((d): d is FlowDay => d != null && d.date !== latest?.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { symbol, latest, history, fetchedAt: Date.now() };
}

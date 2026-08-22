/**
 * รายชื่อหุ้นที่ปิดบวก % สูงสุด
 *
 * ที่มา: api.nasdaq.com/api/screener/stocks — endpoint สาธารณะที่หน้าเว็ป NASDAQ ใช้เอง
 * ขอครั้งเดียวได้ทั้งตลาด (~7,000 ตัว) แล้วเรียงเอง จึงไม่ต้องมี API key
 * หมายเหตุ: เป็น endpoint ที่ NASDAQ ไม่ได้ประกาศเป็น public API อย่างเป็นทางการ
 */

const URL_ALL =
  'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000&offset=0';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_LIMIT = 50;

export type Gainer = {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number;
  marketCap: number | null;
};

type Row = {
  symbol: string;
  name: string;
  lastsale: string;
  netchange: string;
  pctchange: string;
  marketCap: string;
};

/**
 * warrant / unit / right / preferred / ตราสารหนี้ ไม่ใช่หุ้นสามัญที่กลยุทธ์นี้เล่น
 * ADR ไม่ตัด เพราะเป็นหุ้นที่เทรดได้จริง (เช่น TSM, NCTY ในลิสต์)
 */
const EXCLUDE_NAME = /\b(warrants?|units?|rights?|preferred|notes?|debentures?)\b/i;

const toNumber = (raw: string | undefined) => {
  if (!raw) return null;
  const n = Number(raw.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

let cache: { at: number; data: Gainer[] } | null = null;
let inflight: Promise<Gainer[]> | null = null;

async function fetchAll(): Promise<Gainer[]> {
  const res = await fetch(URL_ALL, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`NASDAQ ตอบ ${res.status}`);
  const json = await res.json();
  const rows: Row[] = json?.data?.table?.rows ?? [];
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
    .filter((g) => Number.isFinite(g.changePct));
}

export async function getGainers(limit = DEFAULT_LIMIT) {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { gainers: slice(cache.data, limit), fetchedAt: cache.at, cached: true };
  }

  // มีคนขอพร้อมกันหลายคน ให้ยิงจริงแค่ครั้งเดียว
  inflight ??= fetchAll()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  try {
    const data = await inflight;
    return { gainers: slice(data, limit), fetchedAt: cache?.at ?? Date.now(), cached: false };
  } catch (err) {
    if (cache) {
      return {
        gainers: slice(cache.data, limit),
        fetchedAt: cache.at,
        cached: true,
        error: err instanceof Error ? err.message : 'ดึงข้อมูลไม่สำเร็จ',
      };
    }
    throw err;
  }
}

function slice(data: Gainer[], limit: number) {
  return data
    .filter((g) => g.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

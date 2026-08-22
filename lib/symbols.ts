/**
 * ค้นหาชื่อย่อหุ้นสำหรับช่อง "เพิ่มหุ้น"
 *
 * รายชื่อหุ้น US ทั้งตลาดมี ~31,000 ตัว (7 MB) ใหญ่เกินจะส่งไปกรองบนมือถือ
 * จึงโหลดมาเก็บในหน่วยความจำฝั่ง server ครั้งเดียวต่อวัน แล้วกรองให้
 * ระหว่างที่ยังโหลดไม่เสร็จ (เช่น cold start) ใช้ /search ของ Finnhub ไปก่อน
 */

const BASE = 'https://finnhub.io/api/v1';
const LIST_TTL_MS = 24 * 60 * 60_000;
const MAX_RESULTS = 30;

export type SymbolHit = {
  symbol: string;
  name: string;
  /** ตลาดแบบย่อ เช่น NASDAQ, NYSE, OTC — ใช้กันซื้อผิดตัวข้ามตลาด */
  exchange: string;
  /** OTC สภาพคล่องต่ำ ควรเตือนผู้ใช้ */
  otc: boolean;
};

type Entry = SymbolHit & { symbolLower: string; nameLower: string };

/** MIC code → ชื่อตลาดที่คนอ่านรู้เรื่อง */
const MIC_LABEL: Record<string, string> = {
  XNAS: 'NASDAQ',
  XNGS: 'NASDAQ',
  XNCM: 'NASDAQ',
  XNMS: 'NASDAQ',
  XNYS: 'NYSE',
  ARCX: 'NYSE Arca',
  XASE: 'NYSE American',
  AMXO: 'NYSE American',
  BATS: 'Cboe BZX',
  XCBO: 'Cboe',
  IEXG: 'IEX',
  OOTC: 'OTC',
  OTCM: 'OTC',
  PSGM: 'OTC',
  OTCB: 'OTC',
  OTCQ: 'OTC',
};

/** เอาเฉพาะประเภทที่เทรดได้จริง */
const KEEP_TYPES = new Set(['Common Stock', 'ADR', 'ETP', 'REIT']);

let entries: Entry[] | null = null;
let loadedAt = 0;
let loading: Promise<void> | null = null;

function exchangeOf(mic: string) {
  const label = MIC_LABEL[mic] ?? mic ?? '';
  return { exchange: label || '—', otc: label === 'OTC' };
}

async function loadList(apiKey: string) {
  const res = await fetch(`${BASE}/stock/symbol?exchange=US&token=${apiKey}`, {
    // รายชื่อหุ้นเปลี่ยนไม่กี่ตัวต่อวัน แคชได้นาน
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`Finnhub ตอบ ${res.status}`);
  const raw: Array<{ symbol: string; description: string; mic: string; type: string }> = await res.json();

  entries = raw
    .filter((r) => r.symbol && r.description && KEEP_TYPES.has(r.type))
    .map((r) => {
      const { exchange, otc } = exchangeOf(r.mic);
      return {
        symbol: r.symbol,
        name: r.description,
        exchange,
        otc,
        symbolLower: r.symbol.toLowerCase(),
        nameLower: r.description.toLowerCase(),
      };
    });
  loadedAt = Date.now();
}

function ensureLoaded(apiKey: string) {
  const fresh = entries && Date.now() - loadedAt < LIST_TTL_MS;
  if (fresh || loading) return;
  loading = loadList(apiKey)
    .catch(() => {
      /* โหลดไม่ได้ก็ยังมี /search เป็นทางสำรอง */
    })
    .finally(() => {
      loading = null;
    });
}

const strip = (s: string) => s.toLowerCase().trim();

/** เรียงผลลัพธ์: ตรงชื่อย่อเป๊ะ → ชื่อย่อขึ้นต้น → ชื่อบริษัทขึ้นต้น → มีคำนั้นอยู่ */
function score(e: Entry, q: string) {
  if (e.symbolLower === q) return 0;
  if (e.symbolLower.startsWith(q)) return 1;
  if (e.nameLower.startsWith(q)) return 2;
  if (e.symbolLower.includes(q)) return 3;
  if (e.nameLower.includes(q)) return 4;
  return -1;
}

/** ยังไม่พิมพ์อะไร — เรียงตามตัวอักษร เอาหุ้นในตลาดหลักก่อน */
function alphabetical(): SymbolHit[] {
  if (!entries) return [];
  return entries
    .filter((e) => !e.otc)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_RESULTS)
    .map((e) => ({ symbol: e.symbol, name: e.name, exchange: e.exchange, otc: e.otc }));
}

function searchLocal(query: string): SymbolHit[] {
  if (!entries) return [];
  const q = strip(query);
  const scored: Array<{ e: Entry; s: number }> = [];
  for (const e of entries) {
    const s = score(e, q);
    if (s < 0) continue;
    // OTC ถอยไปท้ายกลุ่มเดียวกัน เพราะมักไม่ใช่ตัวที่คนหา
    scored.push({ e, s: s * 2 + (e.otc ? 1 : 0) });
  }
  scored.sort((a, b) => a.s - b.s || a.e.symbol.length - b.e.symbol.length || a.e.symbol.localeCompare(b.e.symbol));
  return scored.slice(0, MAX_RESULTS).map(({ e }) => ({
    symbol: e.symbol,
    name: e.name,
    exchange: e.exchange,
    otc: e.otc,
  }));
}

async function searchRemote(query: string, apiKey: string): Promise<SymbolHit[]> {
  const res = await fetch(
    `${BASE}/search?q=${encodeURIComponent(query)}&exchange=US&token=${apiKey}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Finnhub ตอบ ${res.status}`);
  const json = await res.json();
  const result: Array<{ symbol: string; description: string; type: string }> = json?.result ?? [];
  return result
    .filter((r) => r.symbol && !r.symbol.includes('.'))
    .slice(0, MAX_RESULTS)
    .map((r) => ({ symbol: r.symbol, name: r.description, exchange: '—', otc: false }));
}

export async function searchSymbols(query: string): Promise<{ hits: SymbolHit[]; source: string }> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { hits: [], source: 'none' };

  ensureLoaded(apiKey);

  const q = strip(query);
  if (q.length === 0) {
    // ลิสต์ยังโหลดไม่เสร็จก็ตอบว่าง หน้าเว็ปจะโชว์ชุดจาก Excel ไปก่อน
    return { hits: alphabetical(), source: entries ? 'alphabetical' : 'loading' };
  }

  const local = searchLocal(q);
  if (local.length > 0) return { hits: local, source: 'local' };

  // รายชื่อยังโหลดไม่เสร็จ หรือไม่มีตัวตรงในลิสต์ — ลองถาม Finnhub ตรง ๆ
  try {
    return { hits: await searchRemote(q, apiKey), source: 'finnhub' };
  } catch {
    return { hits: [], source: 'error' };
  }
}

/** ให้หน้าเว็ปรู้ว่าลิสต์พร้อมหรือยัง และมีกี่ตัว */
export function listStatus() {
  return { ready: entries !== null, count: entries?.length ?? 0 };
}

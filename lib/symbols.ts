/**
 * ค้นหาชื่อย่อหุ้นสำหรับช่อง "เพิ่มหุ้น"
 *
 * รายชื่อหุ้น US ถูกดึงมาเก็บเป็นไฟล์ตอน build (`pnpm symbols:build` → data/us-symbols.json)
 * ไม่ใช่ดึงตอนมีคนเข้าเว็ป เพราะบน serverless จะเกิดใหม่ทุก cold start (7.3 MB)
 * และเสี่ยงชน function timeout
 *
 * ถ้าหาในไฟล์ไม่เจอ (หุ้น IPO ใหม่หลังวันที่ build) ค่อยถาม /search ของ Finnhub เป็นทางสำรอง
 */
import table from '@/data/us-symbols.json';

const BASE = 'https://finnhub.io/api/v1';
const MAX_RESULTS = 30;

export type SymbolHit = {
  symbol: string;
  name: string;
  /** ตลาดแบบย่อ เช่น NASDAQ, NYSE, OTC — ใช้กันซื้อผิดตัวข้ามตลาด */
  exchange: string;
  /** OTC สภาพคล่องต่ำ ควรเตือนผู้ใช้ */
  otc: boolean;
};

type Row = [symbol: string, name: string, exchange: string];

const rows = table.rows as Row[];

/** เตรียม lowercase ไว้ล่วงหน้าครั้งเดียว ไม่ต้องแปลงใหม่ทุกครั้งที่ค้น */
const lower = rows.map(([s, n]) => [s.toLowerCase(), n.toLowerCase()] as const);

const toHit = (i: number): SymbolHit => {
  const [symbol, name, exchange] = rows[i];
  return { symbol, name, exchange: exchange || '—', otc: exchange === 'OTC' };
};

const strip = (s: string) => s.toLowerCase().trim();

/** เรียงผลลัพธ์: ตรงชื่อย่อเป๊ะ → ชื่อย่อขึ้นต้น → ชื่อบริษัทขึ้นต้น → มีคำนั้นอยู่ */
function score(i: number, q: string) {
  const [sym, name] = lower[i];
  if (sym === q) return 0;
  if (sym.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (sym.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return -1;
}

/** ยังไม่พิมพ์อะไร — เรียงตามตัวอักษร เอาหุ้นในตลาดหลักก่อน (ไฟล์เรียงมาแล้ว) */
function alphabetical(): SymbolHit[] {
  const out: SymbolHit[] = [];
  for (let i = 0; i < rows.length && out.length < MAX_RESULTS; i++) {
    if (rows[i][2] === 'OTC') continue;
    out.push(toHit(i));
  }
  return out;
}

function searchLocal(q: string): SymbolHit[] {
  const scored: Array<{ i: number; s: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    const s = score(i, q);
    if (s < 0) continue;
    // OTC ถอยไปท้ายกลุ่มเดียวกัน เพราะมักไม่ใช่ตัวที่คนหา
    scored.push({ i, s: s * 2 + (rows[i][2] === 'OTC' ? 1 : 0) });
  }
  scored.sort(
    (a, b) =>
      a.s - b.s ||
      rows[a.i][0].length - rows[b.i][0].length ||
      rows[a.i][0].localeCompare(rows[b.i][0]),
  );
  return scored.slice(0, MAX_RESULTS).map(({ i }) => toHit(i));
}

async function searchRemote(query: string, apiKey: string): Promise<SymbolHit[]> {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(query)}&exchange=US&token=${apiKey}`, {
    // ผลค้นหาชื่อหุ้นไม่เปลี่ยนบ่อย ให้ Vercel แคชไว้ข้าม instance ได้
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`Finnhub ตอบ ${res.status}`);
  const json = await res.json();
  const result: Array<{ symbol: string; description: string }> = json?.result ?? [];
  return result
    .filter((r) => r.symbol && !r.symbol.includes('.'))
    .slice(0, MAX_RESULTS)
    .map((r) => ({ symbol: r.symbol, name: r.description, exchange: '—', otc: false }));
}

export async function searchSymbols(query: string): Promise<{ hits: SymbolHit[]; source: string }> {
  const q = strip(query);
  if (q.length === 0) return { hits: alphabetical(), source: 'alphabetical' };

  const local = searchLocal(q);
  if (local.length > 0) return { hits: local, source: 'local' };

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { hits: [], source: 'none' };
  try {
    return { hits: await searchRemote(q, apiKey), source: 'finnhub' };
  } catch {
    return { hits: [], source: 'error' };
  }
}

/** ให้หน้าเว็ปรู้ว่าลิสต์มาจากไฟล์วันไหนและมีกี่ตัว */
export function listStatus() {
  return { ready: true, count: rows.length, updatedAt: table.updatedAt as string };
}

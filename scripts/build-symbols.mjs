/**
 * ดึงรายชื่อหุ้น US มาเก็บเป็นไฟล์ในโปรเจกต์ (รันตอน build ไม่ใช่ตอนมีคนเข้าเว็ป)
 *
 * เดิม lib/symbols.ts ดึงไฟล์ 7.3 MB จาก Finnhub ตอน request แรก ซึ่งบน serverless
 * จะเกิดใหม่ทุก cold start และเสี่ยงชน function timeout
 * เก็บเป็นไฟล์แบบ tuple ให้เล็กแล้วอ่านจาก bundle เลย เร็วและไม่กินโควตา
 *
 *   pnpm symbols:build
 */
import { writeFile } from 'node:fs/promises';

const KEEP_TYPES = new Set(['Common Stock', 'ADR', 'ETP', 'REIT']);

const MIC_LABEL = {
  XNAS: 'NASDAQ', XNGS: 'NASDAQ', XNCM: 'NASDAQ', XNMS: 'NASDAQ',
  XNYS: 'NYSE', ARCX: 'NYSE Arca', XASE: 'NYSE American', AMXO: 'NYSE American',
  BATS: 'Cboe BZX', XCBO: 'Cboe', IEXG: 'IEX',
  OOTC: 'OTC', OTCM: 'OTC', PSGM: 'OTC', OTCB: 'OTC', OTCQ: 'OTC',
};

const key = process.env.FINNHUB_API_KEY;
if (!key) {
  console.error('ต้องตั้ง FINNHUB_API_KEY ก่อน (อ่านจาก .env.local ไม่ได้ ต้องส่งเข้ามาทาง env)');
  process.exit(1);
}

console.log('กำลังดึงรายชื่อหุ้น US จาก Finnhub…');
const res = await fetch(`https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${key}`);
if (!res.ok) {
  console.error(`Finnhub ตอบ ${res.status}`);
  process.exit(1);
}
const raw = await res.json();

const rows = raw
  .filter((r) => r.symbol && r.description && KEEP_TYPES.has(r.type) && !r.symbol.includes('.'))
  .map((r) => [r.symbol, r.description, MIC_LABEL[r.mic] ?? ''])
  .sort((a, b) => a[0].localeCompare(b[0]));

const out = { updatedAt: new Date().toISOString().slice(0, 10), rows };
await writeFile(new URL('../data/us-symbols.json', import.meta.url), JSON.stringify(out));

const bytes = JSON.stringify(out).length;
console.log(`เขียน data/us-symbols.json แล้ว: ${rows.length} ตัว, ${(bytes / 1024 / 1024).toFixed(2)} MB`);

import type { JournalEntry, RawQuote, Store } from './store';
import { DEFAULT_END_MIN, evaluate, type Thresholds } from './strategy';

export type SignalRow = {
  date: string;
  symbol: string;
  /** % ตอนปลายช่วงที่ทำให้เกิดสัญญาณ */
  pct: number;
  journal?: JournalEntry;
  /** กำไร/ขาดทุนจริงเป็น % (ต้องมีทั้งราคาเข้าและออก) */
  realized: number | null;
};

export type Stats = {
  /** สัญญาณ OK ทั้งหมดที่เคยเกิด */
  signals: number;
  /**
   * วันที่ถูกข้ามเพราะบันทึกไว้ด้วยเวลาปลายช่วงอื่น
   * เอามารวมกันไม่ได้ ผลของ 22:30 กับ 23:30 เป็นกลยุทธ์คนละแบบ
   */
  skippedDates: string[];
  /** ที่ซื้อจริง */
  taken: number;
  /** ที่ปิดจบแล้ว (มีทั้งเข้าและออก) */
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgReturn: number | null;
  best: SignalRow | null;
  worst: SignalRow | null;
  /** แยกตามช่วง % ของสัญญาณ */
  bands: Array<{ label: string; signals: number; closed: number; winRate: number | null; avgReturn: number | null }>;
  rows: SignalRow[];
};

const BANDS = [
  { label: '5.5–10%', min: 5.5, max: 10 },
  { label: '10–20%', min: 10, max: 20 },
  { label: '20–30%', min: 20, max: 30.000001 },
];

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * รวมสัญญาณ OK จากทุกวันที่บันทึกไว้ แล้วจับคู่กับบันทึกการเทรดจริง
 * เพื่อตอบว่าเกณฑ์ที่ใช้อยู่ให้ผลจริงแค่ไหน (เครื่องมือคำนวณให้ ไม่ใช่คำแนะนำการลงทุน)
 */
export function buildStats(store: Store, thresholds: Thresholds): Stats {
  const rows: SignalRow[] = [];
  const skippedDates: string[] = [];

  for (const [date, quotes] of Object.entries(store.snapshots)) {
    // วันที่บันทึกก่อนมีฟีเจอร์เลือกเวลาไม่มี snapshotEndMin — ถือว่าเป็นค่าตั้งต้น
    const recorded = store.snapshotEndMin[date] ?? DEFAULT_END_MIN;
    if (recorded !== store.endMin) {
      skippedDates.push(date);
      continue;
    }
    for (const q of quotes as RawQuote[]) {
      const ev = evaluate(q.open, q.windowEnd, thresholds);
      if (ev.decision !== 'OK' || ev.pct == null) continue;

      const journal = store.journal[`${date}:${q.symbol}`];
      const realized =
        journal?.entry != null && journal.entry !== 0 && journal.exit != null
          ? ((journal.exit - journal.entry) / journal.entry) * 100
          : null;

      rows.push({ date, symbol: q.symbol, pct: ev.pct, journal, realized });
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.pct - a.pct);

  const taken = rows.filter((r) => r.journal?.bought);
  const closed = rows.filter((r) => r.realized != null);
  const wins = closed.filter((r) => (r.realized ?? 0) > 0);
  const returns = closed.map((r) => r.realized as number);

  const sortedByReturn = [...closed].sort((a, b) => (b.realized ?? 0) - (a.realized ?? 0));

  const bands = BANDS.map((b) => {
    const inBand = rows.filter((r) => r.pct >= b.min && r.pct < b.max);
    const done = inBand.filter((r) => r.realized != null);
    const w = done.filter((r) => (r.realized ?? 0) > 0).length;
    return {
      label: b.label,
      signals: inBand.length,
      closed: done.length,
      winRate: done.length > 0 ? (w / done.length) * 100 : null,
      avgReturn: mean(done.map((r) => r.realized as number)),
    };
  });

  return {
    signals: rows.length,
    skippedDates: skippedDates.sort((a, b) => b.localeCompare(a)),
    taken: taken.length,
    closed: closed.length,
    wins: wins.length,
    losses: closed.length - wins.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : null,
    avgReturn: mean(returns),
    best: sortedByReturn[0] ?? null,
    worst: sortedByReturn[sortedByReturn.length - 1] ?? null,
    bands,
    rows,
  };
}

import { DEFAULT_END_MIN, DEFAULT_THRESHOLDS, toEndMin, type Thresholds } from './strategy';
import { DEFAULT_SYMBOLS } from './watchlist';

/** ข้อมูลดิบต่อหุ้นที่พอจะคำนวณสูตรใหม่ได้ — เก็บเท่านี้ เกณฑ์เปลี่ยนแล้วผลอัปเดตตาม */
export type RawQuote = {
  symbol: string;
  name: string | null;
  open: number | null;
  windowEnd: number | null;
  /** ราคาสูงสุดในหน้าต่างที่เลือก (snapshot เก่าที่บันทึกก่อนมีฟีเจอร์นี้จะเป็น null) */
  windowHigh?: number | null;
  /** true เมื่อ windowHigh อาจต่ำกว่าจริงเพราะแท่งราคาช่วงหัวหน้าต่างขาด */
  windowHighPartial?: boolean;
};

/** บันทึกการเทรดจริงของหุ้นตัวหนึ่งในวันหนึ่ง */
export type JournalEntry = {
  /** ซื้อจริงไหม */
  bought: boolean;
  /** ราคาที่เข้า */
  entry: number | null;
  /** ราคาที่ออก — ว่างไว้ได้ถ้ายังถืออยู่ */
  exit: number | null;
  note?: string;
};

export type Store = {
  v: 2;
  /** ลิสต์หุ้นแยกตามวันซื้อขาย (คีย์เป็นวันที่ ET แบบ YYYY-MM-DD) */
  lists: Record<string, string[]>;
  /** ผลที่บันทึกไว้ของวันที่ปิดไปแล้ว */
  snapshots: Record<string, RawQuote[]>;
  /**
   * นาทีปลายช่วง (ET) ที่ใช้คำนวณสูตร — 690 = 11:30 ET = 22:30 น. ตามไฟล์ Excel เดิม
   * เปลี่ยนค่านี้แล้วราคาปลายช่วงของทุกวันต้องถูกดึงใหม่ ไม่ใช้ของที่บันทึกไว้
   */
  endMin: number;
  /** เวลาปลายช่วงที่ snapshot แต่ละวันถูกบันทึกไว้ด้วย คีย์เป็นวันที่ */
  snapshotEndMin: Record<string, number>;
  thresholds: Thresholds;
  onlyOk: boolean;
  /** กรองจากราคาปลายช่วง หรือราคา live ถ้าช่วงยังไม่จบ */
  priceRange: { min: number | null; max: number | null };
  sort: { field: 'default' | 'symbol' | 'open' | 'price' | 'live' | 'high' | 'diff' | 'pct'; direction: 'asc' | 'desc' };
  /** บันทึกผลจริง คีย์เป็น "YYYY-MM-DD:SYMBOL" */
  journal: Record<string, JournalEntry>;
};

export const STORAGE_KEY = 'trading-guide:v2';
const LEGACY_KEY = 'usa-pop:v1';

export function emptyStore(today: string): Store {
  return {
    v: 2,
    lists: { [today]: [...DEFAULT_SYMBOLS] },
    snapshots: {},
    endMin: DEFAULT_END_MIN,
    snapshotEndMin: {},
    thresholds: { ...DEFAULT_THRESHOLDS },
    onlyOk: false,
    priceRange: { min: null, max: null },
    sort: { field: 'default', direction: 'desc' },
    journal: {},
  };
}

export const journalKey = (date: string, symbol: string) => `${date}:${symbol}`;

/** อ่านค่าที่เก็บไว้ พร้อมย้ายข้อมูลจากรูปแบบเก่า (ลิสต์เดียวไม่แยกวัน) */
export function loadStore(today: string): Store {
  const base = emptyStore(today);
  if (typeof window === 'undefined') return base;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      return {
        v: 2,
        lists: parsed.lists && Object.keys(parsed.lists).length ? parsed.lists : base.lists,
        snapshots: parsed.snapshots ?? {},
        endMin: toEndMin(parsed.endMin),
        snapshotEndMin: parsed.snapshotEndMin ?? {},
        thresholds: parsed.thresholds ?? base.thresholds,
        onlyOk: typeof parsed.onlyOk === 'boolean' ? parsed.onlyOk : false,
        priceRange: {
          min: typeof parsed.priceRange?.min === 'number' ? parsed.priceRange.min : null,
          max: typeof parsed.priceRange?.max === 'number' ? parsed.priceRange.max : null,
        },
        sort: parsed.sort && ['default', 'symbol', 'open', 'price', 'live', 'high', 'diff', 'pct'].includes(parsed.sort.field ?? '') && ['asc', 'desc'].includes(parsed.sort.direction ?? '')
          ? parsed.sort
          : base.sort,
        journal: parsed.journal ?? {},
      };
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const old = JSON.parse(legacy) as {
        symbols?: string[];
        thresholds?: Thresholds;
        onlyOk?: boolean;
      };
      return {
        v: 2,
        lists: { [today]: old.symbols?.length ? old.symbols : [...DEFAULT_SYMBOLS] },
        snapshots: {},
        endMin: base.endMin,
        snapshotEndMin: {},
        thresholds: old.thresholds ?? base.thresholds,
        onlyOk: old.onlyOk ?? false,
        priceRange: base.priceRange,
        sort: base.sort,
        journal: {},
      };
    }
  } catch {
    /* ค่าที่เสียหาย — เริ่มใหม่จากค่าเริ่มต้น */
  }
  return base;
}

export function saveStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** ตรวจว่า state ที่ได้จาก server ใช้งานได้จริง ก่อนเอาไปแทนของในเครื่อง */
export function normalizeStore(raw: unknown, today: string): Store | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<Store>;
  if (!r.lists || typeof r.lists !== 'object') return null;

  const base = emptyStore(today);
  return {
    v: 2,
    lists: Object.keys(r.lists).length > 0 ? r.lists : base.lists,
    snapshots: r.snapshots ?? {},
    endMin: toEndMin(r.endMin),
    snapshotEndMin: r.snapshotEndMin ?? {},
    thresholds: r.thresholds ?? base.thresholds,
    onlyOk: typeof r.onlyOk === 'boolean' ? r.onlyOk : false,
    priceRange: {
      min: typeof r.priceRange?.min === 'number' ? r.priceRange.min : null,
      max: typeof r.priceRange?.max === 'number' ? r.priceRange.max : null,
    },
    sort: r.sort && ['default', 'symbol', 'open', 'price', 'live', 'high', 'diff', 'pct'].includes(r.sort.field ?? '') && ['asc', 'desc'].includes(r.sort.direction ?? '')
      ? r.sort
      : base.sort,
    journal: r.journal ?? {},
  };
}

/** วันที่ที่มีลิสต์หรือมีผลบันทึกไว้ เรียงใหม่ก่อน */
export function savedDates(store: Store) {
  return [...new Set([...Object.keys(store.lists), ...Object.keys(store.snapshots)])].sort((a, b) =>
    b.localeCompare(a),
  );
}

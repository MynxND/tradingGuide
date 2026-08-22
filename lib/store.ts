import { DEFAULT_THRESHOLDS, type Thresholds } from './strategy';
import { DEFAULT_SYMBOLS } from './watchlist';

/** ข้อมูลดิบต่อหุ้นที่พอจะคำนวณสูตรใหม่ได้ — เก็บเท่านี้ เกณฑ์เปลี่ยนแล้วผลอัปเดตตาม */
export type RawQuote = {
  symbol: string;
  name: string | null;
  open: number | null;
  windowEnd: number | null;
};

export type Store = {
  v: 2;
  /** ลิสต์หุ้นแยกตามวันซื้อขาย (คีย์เป็นวันที่ ET แบบ YYYY-MM-DD) */
  lists: Record<string, string[]>;
  /** ผลที่บันทึกไว้ของวันที่ปิดไปแล้ว */
  snapshots: Record<string, RawQuote[]>;
  thresholds: Thresholds;
  onlyOk: boolean;
};

export const STORAGE_KEY = 'trading-guide:v2';
const LEGACY_KEY = 'usa-pop:v1';

export function emptyStore(today: string): Store {
  return {
    v: 2,
    lists: { [today]: [...DEFAULT_SYMBOLS] },
    snapshots: {},
    thresholds: { ...DEFAULT_THRESHOLDS },
    onlyOk: false,
  };
}

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
        thresholds: parsed.thresholds ?? base.thresholds,
        onlyOk: typeof parsed.onlyOk === 'boolean' ? parsed.onlyOk : false,
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
        thresholds: old.thresholds ?? base.thresholds,
        onlyOk: old.onlyOk ?? false,
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

/** วันที่ที่มีลิสต์หรือมีผลบันทึกไว้ เรียงใหม่ก่อน */
export function savedDates(store: Store) {
  return [...new Set([...Object.keys(store.lists), ...Object.keys(store.snapshots)])].sort((a, b) =>
    b.localeCompare(a),
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SymbolQuote } from '@/lib/quotes';
import { etDate, formatThaiDate, isWeekend } from '@/lib/session-date';
import { buildStats } from '@/lib/stats';
import {
  emptyStore,
  journalKey,
  loadStore,
  normalizeStore,
  saveStore,
  savedDates,
  type JournalEntry,
  type RawQuote,
  type Store,
} from '@/lib/store';
import { WORKSPACE_ID } from '@/lib/workspace';
import { evaluate, windowState, type Decision } from '@/lib/strategy';
import { DateBar } from './DateBar';
import { ExportButton, type ExportRow } from './ExportButton';
import { GainersTab } from './GainersTab';
import { JournalEditor } from './JournalEditor';
import { StatsTab } from './StatsTab';
import { SymbolPicker } from './SymbolPicker';
import {
  MagnitudeBar,
  Pill,
  QuoteStat,
  TrashIcon,
  fmtPrice,
  fmtSigned,
  priceDigits,
  toneClass,
} from './ui';

const FALLBACK_REFRESH_MS = 60_000;
const HISTORY_POLL_MS = 8_000;

type Row = RawQuote & {
  /** ราคาล่าสุด แสดงแยกจากราคา 22:30 และใช้แทนค่าชั่วคราวก่อนถึงเวลา */
  last: number | null;
  diff: number | null;
  pct: number | null;
  /** % จาก Open ถึง High ในช่วง — บอกว่าเคยขึ้นไปถึงไหนก่อนจะจบที่ 22:30 */
  highPct: number | null;
  decision: Decision;
  provisional: boolean;
  error?: string;
};

const thaiTime = (d: Date) =>
  d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });

export default function Page() {
  const [today, setToday] = useState(() => etDate());
  const [store, setStore] = useState<Store>(() => emptyStore(etDate()));
  const [date, setDate] = useState(today);
  const [hydrated, setHydrated] = useState(false);

  const [quotes, setQuotes] = useState<SymbolQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [provider, setProvider] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [refreshMs, setRefreshMs] = useState(FALLBACK_REFRESH_MS);
  const [tab, setTab] = useState<'formula' | 'gainers' | 'stats'>('formula');
  /** หุ้นที่กางช่องบันทึกผลอยู่ */
  const [editing, setEditing] = useState<string | null>(null);

  const [backfill, setBackfill] = useState<{ pending: number; error?: string } | null>(null);
  /** local = เก็บในเบราว์เซอร์เท่านั้น, redis = sync ข้ามเครื่อง */
  const [storage, setStorage] = useState<'local' | 'redis' | 'error'>('local');
  const [syncing, setSyncing] = useState(false);
  const abort = useRef<AbortController | null>(null);
  /** เก็บวันปัจจุบันไว้ใน ref ด้วย เพื่อให้ interval เทียบได้โดยไม่ค้างค่าเก่า */
  const todayRef = useRef(today);

  /**
   * โหลด state: เอาของบน server เป็นหลัก (sync ข้ามเครื่อง)
   * ถ้า server ไม่มีหรือล่ม ใช้ของในเบราว์เซอร์ไปก่อน จะได้ยังใช้งานได้
   */
  useEffect(() => {
    const t = etDate();
    todayRef.current = t;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- วันที่และ localStorage อ่านได้แค่ฝั่ง client
    setToday(t);
    setDate(t);
    setStore(loadStore(t));

    void (async () => {
      try {
        const res = await fetch(`/api/state?w=${WORKSPACE_ID}`, { cache: 'no-store' });
        const json = await res.json();
        setStorage(json.storage === 'redis' ? 'redis' : json.storage === 'error' ? 'error' : 'local');
        const remote = normalizeStore(json.state, t);
        if (remote) setStore(remote);
      } catch {
        setStorage('error');
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // เก็บลงเบราว์เซอร์ทุกครั้ง ใช้เป็นสำเนาออฟไลน์
  useEffect(() => {
    if (hydrated) saveStore(store);
  }, [hydrated, store]);

  /**
   * กลับมาที่แท็บนี้อีกครั้ง ให้ดึง state ใหม่จาก server ก่อน
   * แท็บที่เปิดค้างไว้นาน ๆ ถืออะไรเก่า ๆ อยู่ ถ้าไม่ดึงใหม่แล้วเผลอแก้อะไร
   * มันจะเอาของเก่าไปทับงานที่ทำบนอีกเครื่อง
   */
  useEffect(() => {
    if (!hydrated || storage !== 'redis') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch(`/api/state?w=${WORKSPACE_ID}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((json) => {
          const remote = normalizeStore(json.state, todayRef.current);
          if (remote) setStore(remote);
        })
        .catch(() => {
          /* ดึงไม่ได้ก็ใช้ของในมือต่อไป */
        });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [hydrated, storage]);

  // ส่งขึ้น server แบบหน่วงไว้ ไม่ยิงทุกการกด
  useEffect(() => {
    if (!hydrated || storage !== 'redis') return;
    const id = setTimeout(() => {
      setSyncing(true);
      void fetch(`/api/state?w=${WORKSPACE_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(store),
      })
        .catch(() => setStorage('error'))
        .finally(() => setSyncing(false));
    }, 800);
    return () => clearTimeout(id);
  }, [hydrated, store, storage]);

  const symbols = useMemo(() => store.lists[date] ?? [], [store.lists, date]);
  const isToday = date === today;
  const snapshot = store.snapshots[date];

  const load = useCallback(async (list: string[]) => {
    if (list.length === 0) {
      setQuotes([]);
      setLoading(false);
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch(`/api/quotes?symbols=${list.join(',')}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const json = await res.json();
      setQuotes(json.quotes ?? []);
      setProvider(json.provider ?? '');
      setWarning(json.warning ?? null);
      setUnavailable(json.unavailable ?? []);
      if (typeof json.refreshMs === 'number') setRefreshMs(json.refreshMs);
      setFetchedAt(new Date());
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setQuotes((prev) => prev);
    } finally {
      setLoading(false);
    }
  }, []);

  // ดึงราคาสดเฉพาะวันปัจจุบัน วันย้อนหลังใช้ผลที่บันทึกไว้
  useEffect(() => {
    if (!hydrated || !isToday) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ดูวันย้อนหลัง ไม่ต้องรอโหลด
      setLoading(false);
      return;
    }
    void load(symbols);
    const id = setInterval(() => void load(symbols), refreshMs);
    return () => clearInterval(id);
  }, [hydrated, isToday, symbols, load, refreshMs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- เวลาปัจจุบันเรนเดอร์ฝั่ง server ไม่ได้
    setNow(new Date());
    const id = setInterval(() => {
      const d = new Date();
      setNow(d);

      // เปิดเว็ปคาไว้ข้ามวันซื้อขาย ต้องเลื่อนเป็นวันใหม่เอง ไม่ต้องรอ reload
      const t = etDate(d);
      if (t !== todayRef.current) {
        const previous = todayRef.current;
        todayRef.current = t;
        setToday(t);
        // ถ้ากำลังดูวันที่เพิ่งกลายเป็นเมื่อวาน ให้ตามไปวันใหม่ แต่ถ้าเปิดวันย้อนหลังอยู่ก็ไม่ไปรบกวน
        setDate((cur) => (cur === previous ? t : cur));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const state = now ? windowState(Math.floor(now.getTime() / 1000)) : null;

  /** ข้อมูลดิบของวันที่กำลังดู */
  const raws: Array<RawQuote & { last: number | null; error?: string }> = useMemo(() => {
    if (!isToday) {
      return (snapshot ?? []).map((r) => ({ ...r, last: null }));
    }
    return quotes.map((q) => ({
      symbol: q.symbol,
      name: q.name,
      open: q.open,
      windowEnd: q.windowEnd,
      windowHigh: q.windowHigh,
      last: q.last,
      error: q.error,
    }));
  }, [isToday, snapshot, quotes]);

  const rows: Row[] = useMemo(
    () =>
      raws.map((r) => {
        const end = r.windowEnd ?? r.last;
        const provisional = r.windowEnd == null;
        const ev = evaluate(r.open, end, store.thresholds, provisional);
        const highPct =
          r.open != null && r.open !== 0 && r.windowHigh != null
            ? ((r.windowHigh - r.open) / r.open) * 100
            : null;
        return { ...r, diff: ev.diff, pct: ev.pct, highPct, decision: ev.decision, provisional };
      }),
    [raws, store.thresholds],
  );

  const sorted = useMemo(() => {
    const rank = (d: Decision) => (d === 'OK' ? 0 : d === 'NG' ? 1 : 2);
    return [...rows]
      .filter((r) => !store.onlyOk || r.decision === 'OK')
      .sort(
        (a, b) =>
          rank(a.decision) - rank(b.decision) ||
          (b.pct ?? -Infinity) - (a.pct ?? -Infinity) ||
          a.symbol.localeCompare(b.symbol),
      );
  }, [rows, store.onlyOk]);

  /**
   * บันทึกผลของวันนี้ไว้เรื่อย ๆ ไม่ใช่รอถึง 22:30
   * เพราะถ้าไม่บันทึก พอสลับไปดูวันย้อนหลังแล้ว export "ทุกวัน" ข้อมูลวันนี้จะหายไป
   * ก่อน 22:30 จะเก็บราคาล่าสุดเป็นค่าชั่วคราว แล้วถูกแทนด้วยราคา 22:30 จริงเมื่อพ้นเวลา
   */
  useEffect(() => {
    if (!hydrated || !isToday) return;
    const withData = quotes.filter((q) => q.open != null || q.last != null);
    if (withData.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- บันทึกผลของวันปัจจุบันลงเครื่อง
    setStore((prev) => {
      const next: RawQuote[] = withData.map((q) => ({
        symbol: q.symbol,
        name: q.name,
        open: q.open,
        windowEnd: q.windowEnd ?? q.last,
        windowHigh: q.windowHigh,
      }));
      if (JSON.stringify(prev.snapshots[today]) === JSON.stringify(next)) return prev;
      return { ...prev, snapshots: { ...prev.snapshots, [today]: next } };
    });
  }, [hydrated, isToday, quotes, today]);

  const setSymbolsForDate = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setStore((prev) => ({
        ...prev,
        lists: { ...prev.lists, [date]: updater(prev.lists[date] ?? []) },
      }));
    },
    [date],
  );

  const addSymbols = useCallback(
    (next: string[]) => {
      if (next.length === 0) return;
      setSymbolsForDate((prev) => [...new Set([...prev, ...next.map((s) => s.toUpperCase())])]);
    },
    [setSymbolsForDate],
  );

  const removeSymbol = useCallback(
    (symbol: string) => setSymbolsForDate((prev) => prev.filter((s) => s !== symbol)),
    [setSymbolsForDate],
  );

  const saveJournal = useCallback(
    (symbol: string, entry: JournalEntry) => {
      setStore((prev) => ({
        ...prev,
        journal: { ...prev.journal, [journalKey(date, symbol)]: entry },
      }));
    },
    [date],
  );

  const clearJournal = useCallback(
    (symbol: string) => {
      setStore((prev) => {
        const next = { ...prev.journal };
        delete next[journalKey(date, symbol)];
        return { ...prev, journal: next };
      });
    },
    [date],
  );

  const copyFromDate = useCallback(
    (from: string) => {
      setStore((prev) => ({
        ...prev,
        lists: { ...prev.lists, [date]: [...new Set(prev.lists[from] ?? [])] },
      }));
    },
    [date],
  );

  /** ดึงข้อมูลย้อนหลังของวันที่เลือก ทีละชุดจนครบตามโควตา */
  const runBackfill = useCallback(async () => {
    setBackfill({ pending: symbols.length });
    for (let guard = 0; guard < 40; guard++) {
      const res = await fetch(
        `/api/history?date=${date}&symbols=${symbols.join(',')}`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (json.error) {
        setBackfill({ pending: json.pending ?? 0, error: json.error });
        return;
      }
      if (Array.isArray(json.quotes) && json.quotes.length > 0) {
        setStore((prev) => ({
          ...prev,
          snapshots: { ...prev.snapshots, [date]: json.quotes as RawQuote[] },
        }));
      }
      if (!json.pending) {
        setBackfill(null);
        return;
      }
      setBackfill({ pending: json.pending, error: json.warning });
      await new Promise((r) => setTimeout(r, HISTORY_POLL_MS));
    }
    setBackfill(null);
  }, [date, symbols]);

  const buildDays = useCallback(
    (scope: 'current' | 'all') => {
      const toRows = (list: RawQuote[]): ExportRow[] =>
        list.map((r) => {
          const ev = evaluate(r.open, r.windowEnd, store.thresholds);
          return {
            symbol: r.symbol,
            name: r.name,
            open: r.open,
            windowEnd: r.windowEnd,
            windowHigh: r.windowHigh ?? null,
            diff: ev.diff,
            pct: ev.pct,
            decision: ev.decision === 'WAIT' ? '-' : ev.decision,
          };
        });

      if (scope === 'current') {
        const list: RawQuote[] = isToday
          ? raws.map((r) => ({
              symbol: r.symbol,
              name: r.name,
              open: r.open,
              windowEnd: r.windowEnd ?? r.last,
              windowHigh: r.windowHigh,
            }))
          : (snapshot ?? []);
        return [{ date, rows: toRows(list) }];
      }

      const dates = savedDates(store);
      return dates.map((d) => {
        if (d === today && isToday) {
          return {
            date: d,
            rows: toRows(
              raws.map((r) => ({
                symbol: r.symbol,
                name: r.name,
                open: r.open,
                windowEnd: r.windowEnd ?? r.last,
                windowHigh: r.windowHigh,
              })),
            ),
          };
        }
        return { date: d, rows: toRows(store.snapshots[d] ?? []) };
      });
    },
    [date, isToday, raws, snapshot, store, today],
  );

  const stats = useMemo(() => buildStats(store, store.thresholds), [store]);
  const okCount = rows.filter((r) => r.decision === 'OK').length;
  const errors = rows.filter((r) => r.error);
  const dates = savedDates(store);
  const otherDatesWithList = dates.filter((d) => d !== date && (store.lists[d]?.length ?? 0) > 0);
  const needsBackfill = !isToday && symbols.length > 0 && !snapshot;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-panel-alt/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tracking-tight text-ink-bright">
              Trading Guide
            </span>
            <span className="hidden text-[11px] text-ink-dim sm:inline">US Equities</span>
          </div>

          <MarketStatus state={state} />

          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="num text-[15px] font-semibold leading-none text-ink-bright">
                {now ? thaiTime(now) : '--:--:--'}
              </div>
              <div className="mt-1 text-[10px] leading-none text-ink-dim">เวลาไทย</div>
            </div>
            {provider && (
              <div className="hidden text-right sm:block">
                <div className="text-[11px] leading-none text-ink">{provider}</div>
                <div className="mt-1 text-[10px] leading-none text-ink-dim">
                  {fetchedAt ? thaiTime(fetchedAt) : '—'}
                </div>
              </div>
            )}
            <SyncBadge storage={storage} syncing={syncing} />
          </div>
        </div>

        <nav className="mx-auto flex max-w-[1400px] gap-1 px-4">
          {(
            [
              ['formula', 'สูตรของฉัน'],
              ['gainers', 'บวกสูงสุด'],
              ['stats', 'สถิติ'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                tab === key
                  ? 'text-ink-bright after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent'
                  : 'text-ink-dim hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-16">
        {tab === 'gainers' && <GainersTab existing={symbols} onAdd={addSymbols} />}

        {tab === 'stats' && (
          <StatsTab
            stats={stats}
            onOpenDate={(d) => {
              setDate(d);
              setTab('formula');
            }}
          />
        )}

        {tab === 'formula' && (
          <>
            <DateBar date={date} today={today} saved={dates} onChange={setDate} />

            <div className="grid grid-cols-2 gap-x-6 divide-line border-b border-line sm:grid-cols-4 sm:gap-x-0 sm:divide-x">
              <QuoteStat label="หุ้นในลิสต์" value={String(rows.length)} tone="accent" />
              <QuoteStat
                label="ผ่านเกณฑ์ (OK)"
                value={String(okCount)}
                tone={okCount > 0 ? 'up' : undefined}
              />
              <QuoteStat
                label={isToday ? 'อัปเดตล่าสุด' : 'สถานะ'}
                value={
                  isToday
                    ? fetchedAt
                      ? thaiTime(fetchedAt)
                      : loading
                        ? '···'
                        : '—'
                    : snapshot
                      ? 'บันทึกแล้ว'
                      : 'ยังไม่มีผล'
                }
              />
              <QuoteStat
                label={isToday ? 'รอบรีเฟรช' : 'วันที่'}
                value={isToday ? `${Math.round(refreshMs / 1000)}s` : formatThaiDate(date)}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-md border border-line bg-panel px-4 py-3">
              <NumField
                label="เกณฑ์ต่ำสุด %"
                value={store.thresholds.min}
                onChange={(v) =>
                  setStore((p) => ({ ...p, thresholds: { ...p.thresholds, min: v } }))
                }
              />
              <NumField
                label="เกณฑ์สูงสุด %"
                value={store.thresholds.max}
                onChange={(v) =>
                  setStore((p) => ({ ...p, thresholds: { ...p.thresholds, max: v } }))
                }
              />
              <div className="h-9 w-px self-end bg-line max-sm:hidden" />
              <SymbolPicker existing={symbols} onAdd={addSymbols} />
              <label className="flex h-9 cursor-pointer select-none items-center gap-2 self-end text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={store.onlyOk}
                  onChange={(e) => setStore((p) => ({ ...p, onlyOk: e.target.checked }))}
                  className="size-[15px] accent-[var(--tv-accent)]"
                />
                เฉพาะที่ซื้อได้
              </label>
              <div className="self-end">
                <ExportButton buildDays={buildDays} thresholds={store.thresholds} />
              </div>
            </div>

            {/* ลิสต์ว่างของวันใหม่ — เสนอก๊อปจากวันก่อน */}
            {symbols.length === 0 && otherDatesWithList.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-4 py-3 text-[12px] text-ink-dim">
                <span>ยังไม่มีหุ้นในลิสต์ของ {formatThaiDate(date)} — ก๊อปจากวันอื่น:</span>
                {otherDatesWithList.slice(0, 5).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => copyFromDate(d)}
                    className="rounded border border-line-strong px-2 py-1 text-ink hover:border-accent"
                  >
                    {d === today ? 'วันนี้' : formatThaiDate(d)} ({store.lists[d].length})
                  </button>
                ))}
              </div>
            )}

            {needsBackfill && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-[12px]">
                <span className="text-ink">
                  {formatThaiDate(date)} มีลิสต์ {symbols.length} ตัว แต่ยังไม่มีผล —
                  ดึงราคา 20:30 และ 22:30 ของวันนั้นย้อนหลังได้
                </span>
                <button
                  type="button"
                  disabled={backfill !== null}
                  onClick={() => void runBackfill()}
                  className="rounded bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--tv-accent-hover)] disabled:opacity-60"
                >
                  {backfill ? `กำลังดึง… เหลือ ${backfill.pending}` : 'ดึงข้อมูลย้อนหลัง'}
                </button>
                {isWeekend(date) && <span className="text-warn">วันนี้ตลาดปิด อาจไม่มีข้อมูล</span>}
                {backfill?.error && <span className="text-warn">{backfill.error}</span>}
              </div>
            )}

            {isToday && (warning || unavailable.length > 0 || errors.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-[var(--tv-warn)]/30 bg-[var(--tv-warn-soft)] px-3 py-2 text-[12px] text-warn">
                {warning && <span>{warning}</span>}
                {unavailable.length > 0 && (
                  <span className="text-warn/80">
                    หาไม่เจอในแหล่งข้อมูล: {unavailable.join(', ')}
                  </span>
                )}
                {unavailable.length === 0 && errors.length > 0 && (
                  <span className="text-warn/80">
                    ยังไม่มีข้อมูล: {errors.map((e) => e.symbol).join(', ')}
                  </span>
                )}
              </div>
            )}

            <div className="mt-3 hidden overflow-hidden rounded-md border border-line md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-panel-alt">
                    <th className="col-head px-3 py-2 text-left">สัญลักษณ์</th>
                    <th className="col-head px-3 py-2 text-right">Open 20:30</th>
                    <th className="col-head px-3 py-2 text-right">ราคา 22:30</th>
                    <th className="col-head px-3 py-2 text-right">ราคา Live</th>
                    <th className="col-head px-3 py-2 text-right">High ช่วง</th>
                    <th className="col-head px-3 py-2 text-right">เปลี่ยนแปลง</th>
                    <th className="col-head px-3 py-2 text-right">%</th>
                    <th className="col-head w-28 px-3 py-2 text-left">ความแรง</th>
                    <th className="col-head px-3 py-2 text-center">ผล</th>
                    <th className="col-head px-3 py-2 text-right">บันทึก</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr
                      key={r.symbol}
                      className="group border-b border-line/60 last:border-0 hover:bg-hover/40"
                    >
                      <td className="px-3 py-2">
                        <div className="text-[13px] font-semibold text-ink-bright">{r.symbol}</div>
                        {r.name && (
                          <div className="mt-0.5 max-w-[240px] truncate text-[11px] text-ink-dim">
                            {r.name}
                          </div>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-right text-[13px]">{fmtPrice(r.open)}</td>
                      <td className="num px-3 py-2 text-right text-[13px]">
                        <span className="text-ink-bright">{fmtPrice(r.windowEnd ?? r.last)}</span>
                        {r.provisional && r.last != null && (
                          <span className="ml-1.5 align-middle text-[10px] text-ink-dim">LIVE</span>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-right text-[13px]">
                        <span className={isToday && r.last != null ? 'text-up' : 'text-ink-dim'}>
                          {fmtPrice(r.last)}
                        </span>
                        {isToday && r.last != null && (
                          <span className="ml-1.5 align-middle text-[10px] text-up">LIVE</span>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-right text-[13px]">
                        <span className="text-ink">{fmtPrice(r.windowHigh ?? null)}</span>
                        {r.highPct != null && (
                          <span className="ml-1.5 text-[11px] text-ink-dim">
                            {fmtSigned(r.highPct, 1)}%
                          </span>
                        )}
                      </td>
                      <td className={`num px-3 py-2 text-right text-[13px] ${toneClass(r.diff)}`}>
                        {fmtSigned(r.diff, priceDigits(r.open ?? r.diff ?? 1))}
                      </td>
                      <td
                        className={`num px-3 py-2 text-right text-[13px] font-semibold ${toneClass(r.pct)}`}
                      >
                        {r.pct == null ? '—' : `${fmtSigned(r.pct, 2)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <MagnitudeBar
                          pct={r.pct}
                          max={store.thresholds.max}
                          min={store.thresholds.min}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <DecisionPill decision={r.decision} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <JournalCell
                          entry={store.journal[journalKey(date, r.symbol)]}
                          active={editing === r.symbol}
                          onClick={() => setEditing(editing === r.symbol ? null : r.symbol)}
                        />
                      </td>
                      <td className="pr-3 text-right">
                        <button
                          onClick={() => removeSymbol(r.symbol)}
                          className="p-1 text-ink-dim opacity-0 transition group-hover:opacity-100 hover:text-down"
                          title={`ลบ ${r.symbol}`}
                          aria-label={`ลบ ${r.symbol}`}
                        >
                          <TrashIcon className="size-[15px]" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {sorted.map((r) =>
                    editing === r.symbol ? (
                      <tr key={`${r.symbol}-journal`}>
                        <td colSpan={11} className="p-0">
                          <JournalEditor
                            key={`${date}-${r.symbol}`}
                            symbol={r.symbol}
                            suggestedEntry={r.windowEnd ?? r.last}
                            value={store.journal[journalKey(date, r.symbol)]}
                            onSave={(e) => {
                              saveJournal(r.symbol, e);
                              setEditing(null);
                            }}
                            onClear={() => {
                              clearJournal(r.symbol);
                              setEditing(null);
                            }}
                            onClose={() => setEditing(null)}
                          />
                        </td>
                      </tr>
                    ) : null,
                  )}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-[13px] text-ink-dim">
                        {loading && isToday ? 'กำลังโหลดข้อมูล…' : 'ยังไม่มีข้อมูลของวันนี้'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 md:hidden">
              {sorted.map((r) => (
                <MobileRow
                  key={r.symbol}
                  row={r}
                  max={store.thresholds.max}
                  min={store.thresholds.min}
                  onRemove={() => removeSymbol(r.symbol)}
                />
              ))}
              {sorted.length === 0 && (
                <p className="py-10 text-center text-[13px] text-ink-dim">
                  {loading && isToday ? 'กำลังโหลดข้อมูล…' : 'ยังไม่มีข้อมูลของวันนี้'}
                </p>
              )}
            </div>

            <footer className="mt-6 space-y-1 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-dim">
              <p>
                ลิสต์หุ้นแยกตามวันซื้อขาย · ผลของวันที่ผ่านไปแล้วถูกบันทึกไว้ในเครื่อง เปลี่ยนเกณฑ์แล้วคำนวณใหม่ให้ทุกวัน
              </p>
              <p>
                ราคา 22:30 จะล็อกเพื่อคำนวณผลเมื่อพ้นเวลา · ราคา Live ยังอัปเดตต่อและไม่กระทบผลสูตร
              </p>
              <p>ข้อมูลราคาเพื่อการติดตามเท่านั้น ไม่ใช่คำแนะนำการลงทุน</p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function SyncBadge({
  storage,
  syncing,
}: {
  storage: 'local' | 'redis' | 'error';
  syncing: boolean;
}) {
  const map = {
    redis: [syncing ? 'กำลังบันทึก…' : 'sync แล้ว', 'text-up', 'bg-up'],
    local: ['เก็บในเครื่องนี้', 'text-ink-dim', 'bg-ink-dim'],
    error: ['sync ไม่ได้', 'text-warn', 'bg-warn'],
  } as const;
  const [label, text, dot] = map[storage];
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span className={`size-1.5 rounded-full ${dot} ${syncing ? 'animate-pulse' : ''}`} />
      <span className={`hidden text-[10px] lg:inline ${text}`}>{label}</span>
    </div>
  );
}

function JournalCell({
  entry,
  active,
  onClick,
}: {
  entry: JournalEntry | undefined;
  active: boolean;
  onClick(): void;
}) {
  const realized =
    entry?.entry != null && entry.entry !== 0 && entry.exit != null
      ? ((entry.exit - entry.entry) / entry.entry) * 100
      : null;

  const label =
    realized != null
      ? `${fmtSigned(realized, 1)}%`
      : entry?.bought
        ? 'ถือ'
        : entry
          ? 'ไม่ซื้อ'
          : '+';

  return (
    <button
      type="button"
      onClick={onClick}
      title="บันทึกผลจริง"
      className={`num rounded px-2 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'bg-accent text-white'
          : realized != null
            ? `bg-hover ${toneClass(realized)}`
            : entry
              ? 'bg-hover text-ink'
              : 'text-ink-dim hover:bg-hover hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

function MarketStatus({ state }: { state: 'before' | 'live' | 'after' | null }) {
  if (!state) return null;
  const map = {
    before: ['ยังไม่เปิดตลาด', 'bg-ink-dim', 'text-ink-dim'],
    live: ['อยู่ในช่วง 20:30–22:30', 'bg-up', 'text-up'],
    after: ['พ้นช่วงแล้ว', 'bg-accent', 'text-ink'],
  } as const;
  const [label, dot, text] = map[state];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${dot} ${state === 'live' ? 'animate-pulse' : ''}`} />
      <span className={`hidden text-[11px] font-medium sm:inline ${text}`}>{label}</span>
    </div>
  );
}

function DecisionPill({ decision }: { decision: Decision }) {
  if (decision === 'OK') return <Pill tone="up">ซื้อได้</Pill>;
  if (decision === 'NG') return <Pill tone="neutral">ไม่ซื้อ</Pill>;
  return <Pill tone="warn">รอข้อมูล</Pill>;
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(v: number): void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="col-head">{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num h-9 w-20 rounded border border-line-strong bg-bg px-2.5 text-[13px] text-ink-bright outline-none focus:border-accent"
      />
    </label>
  );
}

function MobileRow({
  row,
  max,
  min,
  onRemove,
}: {
  row: Row;
  max: number;
  min: number;
  onRemove(): void;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-ink-bright">{row.symbol}</span>
            <DecisionPill decision={row.decision} />
          </div>
          {row.name && <div className="truncate text-[11px] text-ink-dim">{row.name}</div>}
        </div>
        <div className="text-right">
          <div className={`num text-[15px] font-semibold leading-none ${toneClass(row.pct)}`}>
            {row.pct == null ? '—' : `${fmtSigned(row.pct, 2)}%`}
          </div>
          <div className={`num mt-1 text-[11px] leading-none ${toneClass(row.diff)}`}>
            {fmtSigned(row.diff, priceDigits(row.open ?? row.diff ?? 1))}
          </div>
        </div>
        <button
          onClick={onRemove}
          className="ml-1 shrink-0 p-1 text-ink-dim hover:text-down"
          aria-label={`ลบ ${row.symbol}`}
        >
          <TrashIcon className="size-4" />
        </button>
      </div>

      <div className="mt-2">
        <MagnitudeBar pct={row.pct} max={max} min={min} />
      </div>

      <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-dim">
        <span>
          Open <span className="num ml-1 text-ink">{fmtPrice(row.open)}</span>
        </span>
        <span>
          22:30{' '}
          <span className="num ml-1 text-ink-bright">{fmtPrice(row.windowEnd ?? row.last)}</span>
          {row.provisional && row.last != null && <span className="ml-1 text-[10px]">LIVE</span>}
        </span>
        {row.last != null && (
          <span>
            Live <span className="num ml-1 text-up">{fmtPrice(row.last)}</span>
          </span>
        )}
        {row.windowHigh != null && (
          <span>
            High <span className="num ml-1 text-ink">{fmtPrice(row.windowHigh)}</span>
            {row.highPct != null && (
              <span className="num ml-1 text-[10px]">{fmtSigned(row.highPct, 1)}%</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

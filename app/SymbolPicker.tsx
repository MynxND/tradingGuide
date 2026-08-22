'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SymbolHit = {
  symbol: string;
  name: string;
  exchange: string;
  otc: boolean;
};

type Props = {
  /** หุ้นที่อยู่ในลิสต์แล้ว — ใช้ซ่อนออกจากตัวเลือก */
  existing: string[];
  onAdd(symbols: string[]): void;
};

const DEBOUNCE_MS = 180;

export function SymbolPicker({ existing, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  /** ลิสต์ default เหมือนกันทุกครั้ง เก็บไว้ให้เปิดครั้งต่อไปขึ้นทันที */
  const defaultList = useRef<SymbolHit[] | null>(null);

  const taken = useMemo(() => new Set(existing.map((s) => s.toUpperCase())), [existing]);

  // ยังไม่พิมพ์ = ลิสต์เรียงตามตัวอักษรจาก server / พิมพ์แล้ว = ผลค้นหา
  const visible = useMemo(() => {
    const seen = new Set<string>();
    return hits.filter((h) => {
      const key = h.symbol.toUpperCase();
      if (taken.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [hits, taken]);

  // clamp ตอน render แทนการ setState ใน effect — ลิสต์หดแล้ว index ค้างเกินขอบได้
  const activeIndex = visible.length === 0 ? 0 : Math.min(active, visible.length - 1);

  // ปิด dropdown เมื่อคลิกที่อื่น
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();

    // ลิสต์ default ที่เคยโหลดแล้ว โชว์ทันทีไม่ต้องรอ
    if (q.length === 0 && defaultList.current) {
      setHits(defaultList.current);
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        const list: SymbolHit[] = json.hits ?? [];
        if (q.length === 0 && list.length > 0) defaultList.current = list;
        setHits(list);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setHits([]);
      } finally {
        setLoading(false);
      }
    };

    // หน่วงเฉพาะตอนพิมพ์ ไม่หน่วงตอนเปิดครั้งแรก
    if (q.length === 0) {
      void run();
      return;
    }
    const id = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, open]);

  const pick = useCallback(
    (hit: SymbolHit) => {
      onAdd([hit.symbol]);
      setQuery('');
      setHits([]);
      setOpen(true);
      inputRef.current?.focus();
    },
    [onAdd],
  );

  /** พิมพ์ชื่อย่อหลายตัวคั่นด้วยเว้นวรรค/จุลภาคแล้วกด Enter ก็ยังได้ */
  const addRaw = useCallback(() => {
    const parts = query
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    onAdd(parts);
    setQuery('');
    setHits([]);
  }, [query, onAdd]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive(Math.min(activeIndex + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && visible[activeIndex]) pick(visible[activeIndex]);
      else addRaw();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative flex min-w-[240px] flex-1 flex-col gap-1">
      <label htmlFor="symbol-search" className="col-head">
        ค้นหา / เพิ่มหุ้น
      </label>
      <div className="flex gap-1.5">
        <input
          id="symbol-search"
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="symbol-listbox"
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="สัญลักษณ์หรือชื่อบริษัท เช่น NVDA, rocket"
          className="h-9 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2.5 text-[13px] text-ink-bright outline-none placeholder:text-ink-dim focus:border-accent"
        />
        <button
          type="button"
          onClick={addRaw}
          className="h-9 shrink-0 rounded bg-accent px-3 text-[12px] font-semibold text-white hover:bg-[var(--tv-accent-hover)]"
        >
          เพิ่ม
        </button>
      </div>

      {open && (
        <ul
          id="symbol-listbox"
          role="listbox"
          className="absolute top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded border border-line-strong bg-panel shadow-2xl shadow-black/60"
        >
          {loading && visible.length === 0 && (
            <li className="px-3 py-3 text-[12px] text-ink-dim">กำลังค้นหา…</li>
          )}
          {!loading && visible.length === 0 && (
            <li className="px-3 py-3 text-[12px] text-ink-dim">
              {query.trim() ? `ไม่พบหุ้นที่ตรงกับ "${query.trim()}"` : 'กำลังโหลดรายชื่อหุ้น…'}
            </li>
          )}
          {visible.map((hit, i) => (
            <li key={`${hit.symbol}-${i}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(hit)}
                className={`flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left transition-colors ${
                  i === activeIndex ? 'border-accent bg-hover/60' : 'border-transparent'
                }`}
              >
                <span className="w-[68px] shrink-0 text-[13px] font-semibold text-ink-bright">
                  {hit.symbol}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">{hit.name}</span>
                {hit.otc ? (
                  <span className="shrink-0 rounded bg-[var(--tv-warn-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                    OTC
                  </span>
                ) : (
                  hit.exchange && (
                    <span className="shrink-0 text-[10px] text-ink-dim/70">{hit.exchange}</span>
                  )
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

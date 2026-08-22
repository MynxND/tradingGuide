'use client';

import { useState } from 'react';
import type { JournalEntry } from '@/lib/store';
import { fmtSigned, toneClass } from './ui';

type Props = {
  symbol: string;
  /** ราคา 22:30 ใช้เป็นค่าเริ่มต้นให้กรอกเร็วขึ้น */
  suggestedEntry: number | null;
  value: JournalEntry | undefined;
  onSave(entry: JournalEntry): void;
  onClear(): void;
  onClose(): void;
};

const blank: JournalEntry = { bought: true, entry: null, exit: null, note: '' };

/**
 * ตัวนี้ถือ draft ไว้ใน state ฝั่งตัวเอง
 * ผู้เรียกต้องส่ง key ที่ผูกกับ วัน+หุ้น เพื่อให้ React remount เมื่อสลับรายการ
 * (ดีกว่า sync ด้วย effect ซึ่งทำให้ render ซ้อน)
 */
export function JournalEditor({ symbol, suggestedEntry, value, onSave, onClear, onClose }: Props) {
  const [draft, setDraft] = useState<JournalEntry>(value ?? { ...blank, entry: suggestedEntry });

  const realized =
    draft.entry != null && draft.entry !== 0 && draft.exit != null
      ? ((draft.exit - draft.entry) / draft.entry) * 100
      : null;

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line bg-panel-alt px-3 py-3">
      <span className="col-head w-full sm:w-auto">บันทึกผลจริง · {symbol}</span>

      <label className="flex items-center gap-2 self-end text-[13px] text-ink">
        <input
          type="checkbox"
          checked={draft.bought}
          onChange={(e) => setDraft((d) => ({ ...d, bought: e.target.checked }))}
          className="size-[15px] accent-[var(--tv-accent)]"
        />
        ซื้อจริง
      </label>

      <Field
        label="ราคาเข้า"
        value={draft.entry}
        onChange={(v) => setDraft((d) => ({ ...d, entry: num(v) }))}
      />
      <Field
        label="ราคาออก"
        value={draft.exit}
        onChange={(v) => setDraft((d) => ({ ...d, exit: num(v) }))}
      />

      <div className="flex flex-col gap-1">
        <span className="col-head">ผล</span>
        <span className={`num h-9 leading-9 text-[14px] font-semibold ${toneClass(realized)}`}>
          {realized == null ? '—' : `${fmtSigned(realized, 2)}%`}
        </span>
      </div>

      <label className="flex min-w-[180px] flex-1 flex-col gap-1">
        <span className="col-head">โน้ต</span>
        <input
          value={draft.note ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          placeholder="เช่น ขายตอนเด้ง / ติดดอย"
          className="h-9 rounded border border-line-strong bg-bg px-2.5 text-[13px] text-ink-bright outline-none placeholder:text-ink-dim focus:border-accent"
        />
      </label>

      <div className="flex gap-2 self-end">
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="h-9 rounded bg-accent px-3 text-[12px] font-semibold text-white hover:bg-[var(--tv-accent-hover)]"
        >
          บันทึก
        </button>
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="h-9 rounded border border-line-strong px-3 text-[12px] text-ink-dim hover:text-down"
          >
            ลบบันทึก
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded border border-line-strong px-3 text-[12px] text-ink-dim hover:text-ink"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange(v: string): void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="col-head">{label}</span>
      <input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="num h-9 w-24 rounded border border-line-strong bg-bg px-2.5 text-[13px] text-ink-bright outline-none focus:border-accent"
      />
    </label>
  );
}

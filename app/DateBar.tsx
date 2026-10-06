'use client';

import { formatThaiDate, recentTradingDays } from '@/lib/session-date';

type Props = {
  date: string;
  today: string;
  /** วันที่ที่มีลิสต์หรือผลบันทึกไว้ */
  saved: string[];
  onChange(date: string): void;
};

export function DateBar({ date, today, saved, onChange }: Props) {
  // ปุ่มลัด: 5 วันทำการล่าสุด รวมกับวันที่เคยบันทึกไว้ก่อนหน้านั้น
  const quick = [...new Set([...recentTradingDays(5), ...saved])]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 8);

  return (
    <div className="mt-7 flex flex-wrap items-center gap-2 border-b border-line pb-4">
      <span className="col-head mr-2">วันซื้อขาย</span>

      <div className="flex flex-wrap gap-1">
        {quick.map((d) => {
          const active = d === date;
          const hasData = saved.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange(d)}
              title={d}
              className={`relative rounded border px-2.5 py-1 text-[12px] transition-colors ${
                active
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-transparent text-ink-dim hover:border-line-strong hover:text-ink'
              }`}
            >
              {d === today ? 'วันนี้' : formatThaiDate(d)}
              {hasData && !active && (
                <span className="absolute right-1 top-1 size-1 rounded-full bg-accent/70" />
              )}
            </button>
          );
        })}
      </div>

      <label className="ml-auto flex items-center gap-2">
        <span className="col-head">เลือกวัน</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="num h-8 rounded-lg border border-line bg-panel px-2 text-[12px] text-ink outline-none focus:border-accent"
        />
      </label>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { Thresholds } from '@/lib/strategy';

export type ExportRow = {
  symbol: string;
  name?: string | null;
  open: number | null;
  windowEnd: number | null;
  windowHigh?: number | null;
  diff: number | null;
  pct: number | null;
  decision: string;
};

type Props = {
  /** ฟังก์ชันสร้างข้อมูลตอนกด เพื่อไม่ต้องคำนวณทุกวันไว้ล่วงหน้า */
  buildDays(scope: 'current' | 'all'): Array<{ date: string; rows: ExportRow[] }>;
  thresholds: Thresholds;
  /** นาทีปลายช่วง (ET) ที่ใช้คำนวณ ส่งไปให้ไฟล์ตั้งหัวคอลัมน์ตามเวลานั้น */
  endMin: number;
};

export function ExportButton({ buildDays, thresholds, endMin }: Props) {
  const [busy, setBusy] = useState<'current' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (scope: 'current' | 'all') => {
    setBusy(scope);
    setError(null);
    try {
      const days = buildDays(scope).filter((d) => d.rows.length > 0);
      if (days.length === 0) {
        setError('ยังไม่มีข้อมูลให้ export');
        return;
      }

      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, thresholds, endMin }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'export ไม่สำเร็จ');

      const blob = await res.blob();
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'trading-guide.xlsx';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export ไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex overflow-hidden rounded border border-line-strong">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('current')}
          className="bg-bg px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
        >
          {busy === 'current' ? '…' : 'Export วันนี้'}
        </button>
        <span className="w-px bg-line-strong" />
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run('all')}
          className="bg-bg px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
        >
          {busy === 'all' ? '…' : 'ทุกวัน'}
        </button>
      </div>
      {error && <span className="text-[11px] text-warn">{error}</span>}
    </div>
  );
}

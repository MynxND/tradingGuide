'use client';

import type { ReactNode } from 'react';

/** ตัวเลขที่ระบายสีตามทิศทาง ขึ้นเขียวอมฟ้า ลงแดงอมชมพู แบบ TradingView */
export function toneClass(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return 'text-ink-dim';
  if (n > 0) return 'text-up';
  if (n < 0) return 'text-down';
  return 'text-ink';
}

/** หุ้นเพนนีต้องใช้ทศนิยมมากกว่า ไม่งั้น 0.0012 จะกลายเป็น 0.00 */
export function priceDigits(n: number) {
  const abs = Math.abs(n);
  if (abs === 0) return 2;
  if (abs < 0.1) return 6;
  if (abs < 1) return 4;
  return 2;
}

export function fmtPrice(n: number | null) {
  if (n == null) return '—';
  const d = priceDigits(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtSigned(n: number | null, digits?: number) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits ?? priceDigits(n))}`;
}

/** แถบสถิติด้านบนแบบ quote bar ของ TradingView: ป้ายเล็กบน ค่าตัวใหญ่ล่าง */
export function QuoteStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'accent';
}) {
  const color = tone === 'up' ? 'text-up' : tone === 'accent' ? 'text-ink-bright' : 'text-ink';
  return (
    <div className="flex min-w-0 flex-col justify-center py-2.5 sm:px-4 sm:first:pl-0">
      <span className="col-head truncate">{label}</span>
      <span className={`num mt-1 text-[17px] font-semibold leading-none ${color}`}>{value}</span>
    </div>
  );
}

/** ป้ายผลลัพธ์ — สี่เหลี่ยมมุมมนเล็ก ไม่ใช่แคปซูลกลม ให้ดูเป็นเครื่องมือ */
export function Pill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'up' | 'down' | 'neutral' | 'warn';
}) {
  const map = {
    up: 'bg-[var(--tv-up-soft)] text-up',
    down: 'bg-[var(--tv-down-soft)] text-down',
    warn: 'bg-[var(--tv-warn-soft)] text-warn',
    neutral: 'bg-hover text-ink-dim',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-[3px] text-[11px] font-semibold leading-none ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * แถบความแรงของ %
 *
 * ถ้าส่ง min มาด้วย แถบจะระบายสีตามเกณฑ์: เข้าช่วง = เขียว, ต่ำกว่าเกณฑ์ = เทา,
 * เกินเพดาน = ส้ม พร้อมขีดบอกตำแหน่งขอบล่างของช่วง
 * ไม่งั้นก็เป็นแถบเทียบขนาดธรรมดา (ใช้ในแท็บปิดบวกสูงสุด)
 */
export function MagnitudeBar({
  pct,
  max,
  min,
}: {
  pct: number | null;
  max: number;
  min?: number;
}) {
  if (pct == null || Number.isNaN(pct)) return <div className="h-1 w-full rounded bg-hover/50" />;

  const abs = Math.abs(pct);
  // เกินเพดานให้ยังเห็นว่าล้น จึงสเกลด้วยค่าที่ใหญ่กว่าระหว่างเพดานกับค่าจริง
  const scale = Math.max(max, abs);
  const ratio = Math.min(abs / scale, 1);

  let color = pct >= 0 ? 'bg-up' : 'bg-down';
  if (min != null) {
    // เกณฑ์นับเฉพาะขาขึ้น ค่าติดลบจึงไม่เข้าช่วงเสมอ
    if (pct > max) color = 'bg-warn';
    else if (pct < min) color = 'bg-[var(--tv-border-strong)]';
  }

  return (
    <div className="relative h-1 w-full overflow-hidden rounded bg-hover/50">
      <div className={`h-full rounded ${color}`} style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
      {min != null && (
        <span
          className="absolute top-0 h-full w-px bg-ink-dim/60"
          style={{ left: `${Math.min((min / scale) * 100, 100)}%` }}
        />
      )}
    </div>
  );
}

/** ไอคอนถังขยะ — stroke ตามสีตัวอักษรของปุ่ม จะได้เปลี่ยนสีตอน hover ได้ */
export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'size-4'}
    >
      <path d="M2.5 4.5h11" />
      <path d="M6.5 2.5h3" />
      <path d="M3.8 4.5l.6 8.2a1 1 0 0 0 1 .8h5.2a1 1 0 0 0 1-.8l.6-8.2" />
      <path d="M6.6 7v4M9.4 7v4" />
    </svg>
  );
}

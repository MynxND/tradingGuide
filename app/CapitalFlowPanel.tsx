'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CapitalFlow, FlowDay } from '@/lib/capital-flow';

const REFRESH_MS = 60_000;

/** สีตามแอป Webull — ฝั่งเข้าโทนเขียว ฝั่งออกโทนแดง เข้มสุดคือคำสั่งขนาดใหญ่ */
const COLORS = {
  inLarge: '#0b8a74',
  inMedium: '#00d1a0',
  inSmall: '#4cc95e',
  outLarge: '#b31b4a',
  outMedium: '#ff0b6a',
  outSmall: '#ff6b6b',
} as const;

type SegmentKey = keyof typeof COLORS;

const SIZES = [
  { key: 'large', label: 'ขนาดใหญ่' },
  { key: 'medium', label: 'ขนาดกลาง' },
  { key: 'small', label: 'ขนาดเล็ก' },
] as const;

/** หน่วยเลือกตามขนาดรวม หุ้นเล็กมูลค่าแค่หลักแสน ถ้าบังคับเป็นล้านจะเห็นแต่ 0.0x */
function pickUnit(total: number) {
  if (total >= 1e9 * 10) return { div: 1e9, label: 'Billion ดอลลาร์' };
  if (total >= 1e6) return { div: 1e6, label: 'Million ดอลลาร์' };
  return { div: 1e3, label: 'Thousand ดอลลาร์' };
}

const fmt = (v: number, div: number) =>
  (v / div).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CapitalFlowPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<CapitalFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/capital-flow?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `โหลดไม่สำเร็จ (${res.status})`);
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดตอนกางแผงและรีเฟรชเป็นระยะ
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const day = data?.latest;

  return (
    <div className="border-t border-line/60 bg-bg/60 px-4 py-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink-bright">การกระจายคำสั่งซื้อขาย</h3>
        {day && <span className="text-[11px] text-ink-dim">{day.date} · Webull</span>}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-ink-dim hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
        </button>
      </div>

      {error && !day && <p className="py-6 text-center text-[12px] text-warn">{error}</p>}
      {!error && !day && loading && <p className="py-6 text-center text-[12px] text-ink-dim">กำลังโหลด…</p>}
      {!error && !day && !loading && (
        <p className="py-6 text-center text-[12px] text-ink-dim">ไม่มีข้อมูลการกระจายคำสั่งของ {symbol}</p>
      )}

      {day && (
        <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Distribution day={day} />
          <LargeOrders days={[...(data?.history ?? []), day].slice(-5)} />
        </div>
      )}
    </div>
  );
}

function Distribution({ day }: { day: FlowDay }) {
  const segments: { key: SegmentKey; value: number }[] = [
    { key: 'outLarge', value: day.large.outflow },
    { key: 'outMedium', value: day.medium.outflow },
    { key: 'outSmall', value: day.small.outflow },
    { key: 'inSmall', value: day.small.inflow },
    { key: 'inMedium', value: day.medium.inflow },
    { key: 'inLarge', value: day.large.inflow },
  ];
  const total = segments.reduce((s, x) => s + x.value, 0);
  const totalIn = day.large.inflow + day.medium.inflow + day.small.inflow;
  const totalOut = day.large.outflow + day.medium.outflow + day.small.outflow;
  const unit = pickUnit(total);

  return (
    <div>
      <div className="text-[11px] text-ink-dim">{unit.label}</div>
      {total > 0 ? <Donut segments={segments} total={total} /> : (
        <p className="py-10 text-center text-[12px] text-ink-dim">ยังไม่มีการซื้อขายวันนี้</p>
      )}

      <div className="mt-2 flex items-baseline justify-between px-2 text-[12px] font-semibold">
        <span>
          <span className="text-up">กระแสเงินเข้า: </span>
          <span className="num text-ink-bright">{fmt(totalIn, unit.div)}</span>
        </span>
        <span>
          <span className="text-down">กระแสเงินออก: </span>
          <span className="num text-ink-bright">{fmt(totalOut, unit.div)}</span>
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {SIZES.map(({ key, label }) => {
          const inKey = `in${key[0].toUpperCase()}${key.slice(1)}` as SegmentKey;
          const outKey = `out${key[0].toUpperCase()}${key.slice(1)}` as SegmentKey;
          return (
            <div key={key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[12px]">
              <span
                className="num flex items-center justify-end gap-2 justify-self-end rounded-full px-3 py-1"
                style={{ background: `${COLORS[inKey]}22`, color: COLORS[inKey] }}
              >
                {fmt(day[key].inflow, unit.div)}
                <span className="size-2 rounded-full" style={{ background: COLORS[inKey] }} />
              </span>
              <span className="w-16 text-center text-ink">{label}</span>
              <span
                className="num flex items-center gap-2 justify-self-start rounded-full px-3 py-1"
                style={{ background: `${COLORS[outKey]}22`, color: COLORS[outKey] }}
              >
                <span className="size-2 rounded-full" style={{ background: COLORS[outKey] }} />
                {fmt(day[key].outflow, unit.div)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Donut({ segments, total }: { segments: { key: SegmentKey; value: number }[]; total: number }) {
  const W = 340;
  const H = 230;
  const cx = W / 2;
  const cy = H / 2;
  const R = 78;
  const r = 36;
  const point = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)] as const;

  const arcs = segments.reduce<(typeof segments[number] & { start: number; end: number; mid: number; pct: number })[]>(
    (acc, s) => {
      const start = acc.at(-1)?.end ?? 0;
      const end = start + (s.value / total) * Math.PI * 2;
      acc.push({ ...s, start, end, mid: (start + end) / 2, pct: (s.value / total) * 100 });
      return acc;
    },
    [],
  );

  const path = (a0: number, a1: number) => {
    // วงเต็มวงวาดด้วย arc เดียวไม่ได้ (จุดเริ่ม = จุดจบ) จึงตัดให้ขาดนิดเดียว
    const a1c = a1 - a0 >= Math.PI * 2 ? a0 + Math.PI * 2 - 1e-4 : a1;
    const large = a1c - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = point(R, a0);
    const [x1, y1] = point(R, a1c);
    const [x2, y2] = point(r, a1c);
    const [x3, y3] = point(r, a0);
    return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[360px]" role="img" aria-label="สัดส่วนกระแสเงินเข้าออกตามขนาดคำสั่ง">
      {arcs.map((a) =>
        a.value > 0 ? (
          <path key={a.key} d={path(a.start, a.end)} fill={COLORS[a.key]} stroke="var(--tv-bg)" strokeWidth={1.5} />
        ) : null,
      )}
      {arcs.map((a) => {
        if (a.pct < 0.5) return null;
        const right = Math.sin(a.mid) >= 0;
        const [x0, y0] = point(R - 2, a.mid);
        const [x1, y1] = point(R + 14, a.mid);
        const x2 = x1 + (right ? 18 : -18);
        return (
          <g key={`${a.key}-label`}>
            <polyline points={`${x0},${y0} ${x1},${y1} ${x2},${y1}`} fill="none" stroke={COLORS[a.key]} strokeWidth={1} />
            <text
              x={x2 + (right ? 4 : -4)}
              y={y1}
              dominantBaseline="middle"
              textAnchor={right ? 'start' : 'end'}
              className="num"
              fontSize={11}
              fill="var(--tv-text)"
            >
              {a.pct.toFixed(2)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** คำสั่งซื้อขนาดใหญ่สุทธิ (เข้า − ออก) รายวัน */
function LargeOrders({ days }: { days: FlowDay[] }) {
  const nets = days.map((d) => ({ date: d.date, net: d.large.inflow - d.large.outflow }));
  const maxAbs = Math.max(...nets.map((x) => Math.abs(x.net)), 1);
  const unit = pickUnit(maxAbs);
  const W = 340;
  const H = 200;
  const mid = H / 2;
  const half = mid - 26;
  const slot = W / Math.max(nets.length, 1);
  const barW = Math.min(36, slot * 0.5);

  return (
    <div>
      <h4 className="text-[13px] font-semibold text-ink-bright">คำสั่งซื้อขนาดใหญ่ใน {nets.length} วันที่ผ่านมา</h4>
      <div className="text-[11px] text-ink-dim">{unit.label} · สุทธิ (เข้า − ออก)</div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="mx-auto mt-2 block w-full max-w-[360px]" role="img" aria-label="กระแสเงินคำสั่งขนาดใหญ่สุทธิรายวัน">
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--tv-border-strong)" strokeWidth={1} />
        {nets.map((x, i) => {
          const h = (Math.abs(x.net) / maxAbs) * half;
          const cx = slot * i + slot / 2;
          const up = x.net >= 0;
          const color = up ? 'var(--tv-up)' : 'var(--tv-down)';
          return (
            <g key={x.date}>
              <rect x={cx - barW / 2} y={up ? mid - h : mid} width={barW} height={Math.max(h, 1)} fill={color} rx={2} />
              <text
                x={cx}
                y={up ? mid - h - 6 : mid + h + 12}
                textAnchor="middle"
                fontSize={10.5}
                className="num"
                fill={color}
              >
                {fmt(x.net, unit.div)}
              </text>
              <text x={cx} y={H + 12} textAnchor="middle" fontSize={10} className="num" fill="var(--tv-text-dim)">
                {x.date.slice(5).replace('-', '/')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { MagnitudeBar, fmtPrice } from './ui';

export type Gainer = {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number;
  marketCap: number | null;
};

type Props = {
  /** หุ้นที่อยู่ในลิสต์สูตรแล้ว */
  existing: string[];
  onAdd(symbols: string[]): void;
};

const LIMIT_OPTIONS = [20, 50, 100];

const fmtCap = (n: number | null) => {
  if (n == null || n === 0) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toLocaleString('en-US');
};

export function GainersTab({ existing, onAdd }: Props) {
  const [gainers, setGainers] = useState<Gainer[]>([]);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = useCallback(async (n: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gainers?limit=${n}`, { cache: 'no-store' });
      const json = await res.json();
      setGainers(json.gainers ?? []);
      setFetchedAt(json.fetchedAt ?? null);
      setError(json.error ?? null);
    } catch {
      setError('เชื่อมต่อไม่ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดครั้งแรกและเมื่อเปลี่ยนจำนวนที่แสดง
    void load(limit);
  }, [load, limit]);

  const taken = new Set(existing.map((s) => s.toUpperCase()));
  const topPct = gainers[0]?.changePct ?? 100;

  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-bright">หุ้นปิดบวก % สูงสุด</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
            ทั้งตลาด US จากราคาปิดล่าสุด · ตัด warrant / unit / right ออกแล้ว
            {fetchedAt &&
              ` · ดึงเมื่อ ${new Date(fetchedAt).toLocaleTimeString('th-TH', {
                timeZone: 'Asia/Bangkok',
                hour12: false,
              })}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded border border-line-strong">
            {LIMIT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setLimit(n)}
                className={`num px-2.5 py-1.5 text-[12px] transition-colors ${
                  limit === n ? 'bg-accent text-white' : 'bg-bg text-ink-dim hover:text-ink'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(limit)}
            className="rounded border border-line-strong bg-bg px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink"
          >
            รีเฟรช
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-[var(--tv-warn)]/30 bg-[var(--tv-warn-soft)] px-3 py-2 text-[12px] text-warn">
          {error}
        </p>
      )}

      {/* จอใหญ่: ตาราง */}
      <div className="mt-3 hidden overflow-hidden rounded-md border border-line md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-panel-alt">
              <th className="col-head w-10 px-3 py-2 text-right">#</th>
              <th className="col-head px-3 py-2 text-left">สัญลักษณ์</th>
              <th className="col-head px-3 py-2 text-right">ราคาปิด</th>
              <th className="col-head px-3 py-2 text-right">มูลค่าตลาด</th>
              <th className="col-head px-3 py-2 text-right">%</th>
              <th className="col-head w-32 px-3 py-2 text-left">ความแรง</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {gainers.map((g, i) => {
              const added = taken.has(g.symbol.toUpperCase());
              return (
                <tr key={g.symbol} className="border-b border-line/60 last:border-0 hover:bg-hover/40">
                  <td className="num px-3 py-2 text-right text-[12px] text-ink-dim">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="text-[13px] font-semibold text-ink-bright">{g.symbol}</div>
                    <div className="mt-0.5 max-w-[280px] truncate text-[11px] text-ink-dim">
                      {g.name}
                    </div>
                  </td>
                  <td className="num px-3 py-2 text-right text-[13px]">{fmtPrice(g.price)}</td>
                  <td className="num px-3 py-2 text-right text-[12px] text-ink-dim">
                    {fmtCap(g.marketCap)}
                  </td>
                  <td className="num px-3 py-2 text-right text-[13px] font-semibold text-up">
                    +{g.changePct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2">
                    <MagnitudeBar pct={g.changePct} max={topPct} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <AddButton added={added} onClick={() => onAdd([g.symbol])} />
                  </td>
                </tr>
              );
            })}
            {loading && gainers.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[13px] text-ink-dim">
                  กำลังโหลด…
                </td>
              </tr>
            )}
            {!loading && gainers.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[13px] text-ink-dim">
                  ไม่มีข้อมูล
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* มือถือ */}
      <div className="mt-3 grid grid-cols-1 gap-2 md:hidden">
        {gainers.map((g, i) => {
          const added = taken.has(g.symbol.toUpperCase());
          return (
            <div key={g.symbol} className="rounded-md border border-line bg-panel px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="num w-5 shrink-0 text-right text-[11px] text-ink-dim">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink-bright">{g.symbol}</div>
                  <div className="truncate text-[11px] text-ink-dim">{g.name}</div>
                </div>
                <div className="num shrink-0 text-[15px] font-semibold text-up">
                  +{g.changePct.toFixed(2)}%
                </div>
                <AddButton added={added} onClick={() => onAdd([g.symbol])} />
              </div>
              <div className="mt-2">
                <MagnitudeBar pct={g.changePct} max={topPct} />
              </div>
              <div className="mt-2 flex gap-4 text-[11px] text-ink-dim">
                <span>
                  ปิด <span className="num ml-1 text-ink">{fmtPrice(g.price)}</span>
                </span>
                <span>
                  มูลค่าตลาด <span className="num ml-1 text-ink">{fmtCap(g.marketCap)}</span>
                </span>
              </div>
            </div>
          );
        })}
        {loading && gainers.length === 0 && (
          <p className="py-10 text-center text-[13px] text-ink-dim">กำลังโหลด…</p>
        )}
      </div>
    </section>
  );
}

function AddButton({ added, onClick }: { added: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      disabled={added}
      onClick={onClick}
      className={`shrink-0 rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
        added
          ? 'cursor-default bg-hover text-ink-dim'
          : 'bg-accent text-white hover:bg-[var(--tv-accent-hover)]'
      }`}
    >
      {added ? 'มีแล้ว' : '+ เพิ่ม'}
    </button>
  );
}

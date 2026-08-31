'use client';

import type { Stats } from '@/lib/stats';
import { formatThaiDate } from '@/lib/session-date';
import { QuoteStat, fmtSigned, toneClass } from './ui';

type Props = { stats: Stats; endLabel: string; onOpenDate(date: string): void };

const pctText = (v: number | null, digits = 0) => (v == null ? '—' : `${v.toFixed(digits)}%`);

export function StatsTab({ stats, endLabel, onOpenDate }: Props) {
  if (stats.signals === 0) {
    return (
      <section className="mt-4 rounded-md border border-line bg-panel px-4 py-10 text-center">
        <p className="text-[13px] text-ink">ยังไม่มีสัญญาณ OK ที่บันทึกไว้</p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          สถิติจะเริ่มมีข้อมูลเมื่อผ่าน {endLabel} ไปแล้วและมีหุ้นเข้าเกณฑ์
          <br />
          กรอกราคาเข้า-ออกในแท็บ &ldquo;สูตรของฉัน&rdquo; แล้วกลับมาดูที่นี่
        </p>
      </section>
    );
  }

  return (
    <section className="mt-4">
      {stats.skippedDates.length > 0 && (
        <p className="mb-3 rounded-md border border-[var(--tv-warn)]/30 bg-[var(--tv-warn-soft)] px-3 py-2 text-[12px] text-warn">
          ข้าม {stats.skippedDates.length} วันที่บันทึกไว้ด้วยเวลาปลายช่วงอื่น — สถิติด้านล่างนับเฉพาะ
          {' '}{endLabel} เท่านั้น เปิดวันเหล่านั้นแล้วกด &ldquo;ดึงข้อมูลย้อนหลัง&rdquo; เพื่อคิดใหม่ตามเวลานี้
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-6 divide-line border-b border-line sm:grid-cols-5 sm:gap-x-0 sm:divide-x">
        <QuoteStat label="สัญญาณ OK ทั้งหมด" value={String(stats.signals)} tone="accent" />
        <QuoteStat label="ซื้อจริง" value={String(stats.taken)} />
        <QuoteStat label="ปิดจบแล้ว" value={String(stats.closed)} />
        <QuoteStat
          label="ชนะ / แพ้"
          value={`${stats.wins} / ${stats.losses}`}
          tone={stats.wins > stats.losses ? 'up' : undefined}
        />
        <QuoteStat
          label="ผลเฉลี่ย"
          value={stats.avgReturn == null ? '—' : `${fmtSigned(stats.avgReturn, 2)}%`}
          tone={(stats.avgReturn ?? 0) > 0 ? 'up' : undefined}
        />
      </div>

      {stats.closed === 0 && (
        <p className="mt-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-ink">
          มีสัญญาณ {stats.signals} ครั้งแล้ว แต่ยังไม่มีรายการที่กรอกทั้งราคาเข้าและออก
          — สถิติชนะ/แพ้จะขึ้นเมื่อมีข้อมูลจริง
        </p>
      )}

      <h3 className="mt-5 text-[13px] font-semibold text-ink-bright">แยกตามช่วง % ของสัญญาณ</h3>
      <div className="mt-2 overflow-hidden rounded-md border border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-panel-alt">
              <th className="col-head px-3 py-2 text-left">ช่วง %</th>
              <th className="col-head px-3 py-2 text-right">สัญญาณ</th>
              <th className="col-head px-3 py-2 text-right">ปิดจบ</th>
              <th className="col-head px-3 py-2 text-right">ชนะ</th>
              <th className="col-head px-3 py-2 text-right">ผลเฉลี่ย</th>
            </tr>
          </thead>
          <tbody>
            {stats.bands.map((b) => (
              <tr key={b.label} className="border-b border-line/60 last:border-0">
                <td className="num px-3 py-2 text-[13px] text-ink">{b.label}</td>
                <td className="num px-3 py-2 text-right text-[13px]">{b.signals}</td>
                <td className="num px-3 py-2 text-right text-[13px] text-ink-dim">{b.closed}</td>
                <td className="num px-3 py-2 text-right text-[13px]">{pctText(b.winRate)}</td>
                <td className={`num px-3 py-2 text-right text-[13px] ${toneClass(b.avgReturn)}`}>
                  {b.avgReturn == null ? '—' : `${fmtSigned(b.avgReturn, 2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-5 text-[13px] font-semibold text-ink-bright">สัญญาณทั้งหมด</h3>
      <div className="mt-2 overflow-hidden rounded-md border border-line">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-panel-alt">
              <th className="col-head px-3 py-2 text-left">วัน</th>
              <th className="col-head px-3 py-2 text-left">หุ้น</th>
              <th className="col-head px-3 py-2 text-right">% สัญญาณ</th>
              <th className="col-head px-3 py-2 text-center">ซื้อ</th>
              <th className="col-head px-3 py-2 text-right">เข้า</th>
              <th className="col-head px-3 py-2 text-right">ออก</th>
              <th className="col-head px-3 py-2 text-right">ผลจริง</th>
              <th className="col-head px-3 py-2 text-left">โน้ต</th>
            </tr>
          </thead>
          <tbody>
            {stats.rows.map((r) => (
              <tr
                key={`${r.date}-${r.symbol}`}
                className="border-b border-line/60 last:border-0 hover:bg-hover/40"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenDate(r.date)}
                    className="text-[12px] text-ink-dim underline-offset-2 hover:text-accent hover:underline"
                  >
                    {formatThaiDate(r.date)}
                  </button>
                </td>
                <td className="px-3 py-2 text-[13px] font-semibold text-ink-bright">{r.symbol}</td>
                <td className="num px-3 py-2 text-right text-[13px] text-up">
                  {fmtSigned(r.pct, 2)}%
                </td>
                <td className="px-3 py-2 text-center text-[12px]">
                  {r.journal?.bought ? '✓' : <span className="text-ink-dim">—</span>}
                </td>
                <td className="num px-3 py-2 text-right text-[13px] text-ink-dim">
                  {r.journal?.entry ?? '—'}
                </td>
                <td className="num px-3 py-2 text-right text-[13px] text-ink-dim">
                  {r.journal?.exit ?? '—'}
                </td>
                <td
                  className={`num px-3 py-2 text-right text-[13px] font-semibold ${toneClass(r.realized)}`}
                >
                  {r.realized == null ? '—' : `${fmtSigned(r.realized, 2)}%`}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-[12px] text-ink-dim">
                  {r.journal?.note || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-dim">
        ตัวเลขคำนวณจากบันทึกที่คุณกรอกเองเท่านั้น เป็นเครื่องมือสรุปผลย้อนหลัง
        ไม่ใช่การคาดการณ์หรือคำแนะนำการลงทุน
      </p>
    </section>
  );
}

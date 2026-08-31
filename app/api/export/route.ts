import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { DEFAULT_THRESHOLDS, SESSION_START_MIN, etMinuteToViewer, minuteLabel, toEndMin } from '@/lib/strategy';

export const dynamic = 'force-dynamic';

type ExportRow = {
  symbol: string;
  name?: string | null;
  open: number | null;
  windowEnd: number | null;
  windowHigh?: number | null;
  diff: number | null;
  pct: number | null;
  decision: string;
};

type ExportDay = { date: string; rows: ExportRow[] };

type Body = {
  days?: ExportDay[];
  thresholds?: { min: number; max: number };
  /** นาทีปลายช่วง (ET) ที่ใช้คำนวณ — ใส่ในหัวคอลัมน์ให้ไฟล์บอกตัวเองว่าเป็นของเวลาไหน */
  endMin?: number;
};

const headers = (endMin: number) => [
  { header: 'Name', key: 'symbol', width: 12 },
  { header: 'บริษัท', key: 'name', width: 34 },
  { header: `Open ${minuteLabel(etMinuteToViewer(SESSION_START_MIN))}`, key: 'open', width: 13 },
  { header: `ราคา ${minuteLabel(etMinuteToViewer(endMin))}`, key: 'end', width: 13 },
  { header: 'High ช่วง', key: 'high', width: 13 },
  { header: 'Diff', key: 'diff', width: 12 },
  { header: '%', key: 'pct', width: 10 },
  { header: 'Decision', key: 'decision', width: 11 },
];

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body ไม่ใช่ JSON' }, { status: 400 });
  }

  const days = (body.days ?? []).filter((d) => d?.date && Array.isArray(d.rows));
  if (days.length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลให้ export' }, { status: 400 });
  }

  const th = body.thresholds ?? { ...DEFAULT_THRESHOLDS };
  const HEADERS = headers(toEndMin(body.endMin));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Trading Guide';

  for (const day of days) {
    // ชื่อชีตห้ามมีอักขระพวก : \ / ? * [ ] และยาวไม่เกิน 31 ตัว
    const ws = wb.addWorksheet(day.date.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));

    ws.addRow([`เกณฑ์: ขึ้น ${th.min}% ถึง ${th.max}% = OK (นับเฉพาะขาขึ้น)`]);
    ws.getRow(1).font = { italic: true, size: 10, color: { argb: 'FF787B86' } };
    ws.addRow([]);

    const head = ws.addRow(HEADERS.map((h) => h.header));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A2E39' } };
      cell.alignment = { horizontal: 'center' };
    });
    HEADERS.forEach((h, i) => {
      ws.getColumn(i + 1).width = h.width;
    });

    for (const r of day.rows) {
      const row = ws.addRow([
        r.symbol,
        r.name ?? '',
        r.open,
        r.windowEnd,
        r.windowHigh ?? null,
        r.diff,
        r.pct == null ? null : r.pct / 100,
        r.decision,
      ]);

      for (const col of [3, 4, 5, 6]) row.getCell(col).numFmt = '#,##0.0000';
      row.getCell(7).numFmt = '0.00%';

      const up = (r.pct ?? 0) > 0;
      for (const col of [6, 7]) {
        row.getCell(col).font = { color: { argb: up ? 'FF26A69A' : 'FFEF5350' } };
      }

      const cell = row.getCell(8);
      cell.alignment = { horizontal: 'center' };
      if (r.decision === 'OK') {
        cell.font = { bold: true, color: { argb: 'FF26A69A' } };
      } else {
        cell.font = { color: { argb: 'FF787B86' } };
      }
    }

    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = days.length === 1 ? days[0].date : `${days[days.length - 1].date}_${days[0].date}`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="trading-guide-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

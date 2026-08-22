/**
 * กลยุทธ์จากไฟล์ "(01)-เล่นแล้วรวย USA-Pop.xlsx" ชีต Toppppppppppppppp
 *
 *   Open      = ราคาเปิด 20:30 น. (ไทย) = 09:30 ET  → คอลัมน์ H แถวคี่
 *   Close@end = ราคา ณ 22:30 น. (ไทย) = 11:30 ET    → คอลัมน์ H แถวคู่
 *   Diff      = Close@end - Open                     → I = +H4-H3
 *   Pct       = Diff / Open                           → J = +I3/H3
 *   Result    = Pct * 100                             → L = +J3*K3  (K = 100)
 *   Decision  = IF(AND(L>=5.5, L<=30), "OK", "NG")
 *
 * หมายเหตุ: สูตรต้นฉบับใน Excel ครอบด้วย ABS() ทำให้หุ้นที่ลง 10% ก็ขึ้น OK
 * ผู้ใช้ยืนยันว่าต้องการนับเฉพาะขาขึ้น จึงตัด ABS ออก ค่าติดลบเป็น NG ทั้งหมด
 */

export const SESSION = {
  /** ตลาด US เปิด 09:30 ET = 20:30 น. ไทย */
  startEt: { hour: 9, minute: 30 },
  /** จุดวัดผล 11:30 ET = 22:30 น. ไทย */
  endEt: { hour: 11, minute: 30 },
  timeZone: 'America/New_York',
} as const;

export const DEFAULT_THRESHOLDS = { min: 5.5, max: 30 } as const;

export type Thresholds = { min: number; max: number };
export type Decision = 'OK' | 'NG' | 'WAIT';

export type Evaluation = {
  open: number | null;
  end: number | null;
  /** true เมื่อ end ยังเป็นราคาล่าสุด (ยังไม่ถึง 11:30 ET) ไม่ใช่ราคาปิดหน้าต่างจริง */
  provisional: boolean;
  diff: number | null;
  pct: number | null;
  decision: Decision;
};

/** คำนวณ Diff / % / OK-NG ตรงตามสูตรใน Excel */
export function evaluate(
  open: number | null | undefined,
  end: number | null | undefined,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  provisional = false,
): Evaluation {
  if (open == null || end == null || open === 0) {
    return { open: open ?? null, end: end ?? null, provisional, diff: null, pct: null, decision: 'WAIT' };
  }
  const diff = end - open;
  const pct = (diff / open) * 100;
  // นับเฉพาะขาขึ้น — ราคาลงถือว่าไม่เข้าเงื่อนไขไม่ว่าจะลงแรงแค่ไหน
  const decision: Decision = pct >= thresholds.min && pct <= thresholds.max ? 'OK' : 'NG';
  return { open, end, provisional, diff, pct, decision };
}

/** เวลา ET แบบ {hour, minute} ของ epoch seconds */
export function etParts(epochSeconds: number) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(epochSeconds * 1000));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { hour: get('hour'), minute: get('minute') };
}

const asMinutes = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

export const SESSION_START_MIN = asMinutes(SESSION.startEt);
export const SESSION_END_MIN = asMinutes(SESSION.endEt);

/** นาทีของวันตามเวลา ET */
export function etMinuteOfDay(epochSeconds: number) {
  return asMinutes(etParts(epochSeconds));
}

export type WindowState = 'before' | 'live' | 'after';

export function windowState(epochSeconds: number): WindowState {
  const m = etMinuteOfDay(epochSeconds);
  if (m < SESSION_START_MIN) return 'before';
  if (m < SESSION_END_MIN) return 'live';
  return 'after';
}

/** วันที่ตามเวลา ET รูปแบบ YYYY-MM-DD — ใช้เป็นคีย์แคชรายวัน */
export function etDateString(epochSeconds: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SESSION.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}

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
  /** จุดวัดผลตั้งต้นตามไฟล์ Excel — 11:30 ET = 22:30 น. ไทย (ผู้ใช้เลือกเปลี่ยนได้) */
  endEt: { hour: 11, minute: 30 },
  timeZone: 'America/New_York',
} as const;

export const VIEWER_TIME_ZONE = 'Asia/Bangkok';

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
/**
 * จุดวัดผลตั้งต้น — ไม่ใช่ค่าคงที่ของระบบอีกแล้ว
 *
 * ผู้ใช้เลือกปลายช่วงได้ (21:00–03:00 น. ไทย) ทุกชั้นที่คิดผลจึงต้องรับ endMin เข้ามา
 * เก็บเป็น "นาทีของวันตามเวลา ET" ไม่ใช่เวลาไทย เพราะเดือน พ.ย. สหรัฐเปลี่ยนเป็น EST
 * ถ้าเก็บเป็นเวลาไทยจุดวัดผลจะเลื่อนไป 1 ชม.เทียบกับตลาดโดยที่สูตรไม่รู้ตัว
 */
export const DEFAULT_END_MIN = asMinutes(SESSION.endEt);
/** ตลาด US ปิด 16:00 ET — เลือกเกินนี้ไม่มีแท่งราคาให้คิด */
const MARKET_CLOSE_MIN = 16 * 60;

/** ตัวเลือกปลายช่วงทุกครึ่งชั่วโมง ตั้งแต่ 30 นาทีหลังเปิดจนถึงเวลาปิดตลาด */
export const END_MIN_OPTIONS: number[] = (() => {
  const out: number[] = [];
  for (let m = SESSION_START_MIN + 30; m <= MARKET_CLOSE_MIN; m += 30) out.push(m);
  return out;
})();

export function isEndMin(value: number | null | undefined): value is number {
  return typeof value === 'number' && END_MIN_OPTIONS.includes(value);
}

/** normalise ค่าที่มาจาก query string / ที่เก็บไว้ ให้ปลอดภัยก่อนใช้คำนวณ */
export function toEndMin(value: string | number | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return isEndMin(n) ? n : DEFAULT_END_MIN;
}

export const minuteLabel = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** offset ของ timezone ณ เวลานั้น (นาที) — ใช้แปลงเวลา ET ↔ ไทยให้ถูกทั้ง EDT และ EST */
function tzOffsetMinutes(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return (asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000;
}

/**
 * นาที ET → นาทีตามเวลาไทยของวันเดียวกัน (อาจเกิน 24:00 เมื่อข้ามเที่ยงคืน)
 * คิดจาก offset จริงของวันนั้น ป้ายเวลาจึงยังถูกหลังสหรัฐเปลี่ยน DST
 */
export function etMinuteToViewer(minute: number, at: Date = new Date()) {
  const diff = tzOffsetMinutes(VIEWER_TIME_ZONE, at) - tzOffsetMinutes(SESSION.timeZone, at);
  return minute + diff;
}

/** ป้ายเวลาแบบที่ผู้ใช้อ่าน เช่น "22:30 น. (11:30 ET)" */
export function endMinLabel(minute: number, at: Date = new Date()) {
  return `${minuteLabel(etMinuteToViewer(minute, at))} น. (${minuteLabel(minute)} ET)`;
}

/** นาทีของวันตามเวลา ET */
export function etMinuteOfDay(epochSeconds: number) {
  return asMinutes(etParts(epochSeconds));
}

export type WindowState = 'before' | 'live' | 'after';

export function windowState(epochSeconds: number, endMin = DEFAULT_END_MIN): WindowState {
  const m = etMinuteOfDay(epochSeconds);
  if (m < SESSION_START_MIN) return 'before';
  if (m < endMin) return 'live';
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

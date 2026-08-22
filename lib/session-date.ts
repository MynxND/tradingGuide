import { SESSION } from './strategy';

/** วันที่ของ session ตามเวลา ET รูปแบบ YYYY-MM-DD */
export function etDate(d: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SESSION.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** เสาร์-อาทิตย์ ตลาด US ปิด */
export function isWeekend(dateStr: string) {
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** ย้อนหลัง n วันทำการจากวันที่กำหนด (ไม่นับวันหยุดนักขัตฤกษ์) */
export function recentTradingDays(count: number, from: Date = new Date()) {
  const out: string[] = [];
  const cursor = new Date(from);
  while (out.length < count) {
    const s = etDate(cursor);
    if (!isWeekend(s)) out.push(s);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

export function formatThaiDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const weekdays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const wd = weekdays[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return `${wd} ${d} ${months[m - 1]} ${String(y + 543).slice(-2)}`;
}

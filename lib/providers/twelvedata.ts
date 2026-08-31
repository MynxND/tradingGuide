import { SESSION_START_MIN, minuteLabel } from '../strategy';
import type { LiveResult, LivePrice, Provider, WindowSnapshot } from './types';

const BASE = 'https://api.twelvedata.com';

/** แท่งแรกช้ากว่านาทีเปิดได้ไม่เกินเท่านี้ ก่อนจะถือว่า high ครอบช่วงไม่ครบ */
const COVERAGE_TOLERANCE_MIN = 2;

/**
 * free tier จำกัด 8 credits/นาที และ 1 หุ้น = 1 credit
 * จดไว้เองว่าใช้ไปเท่าไรในนาทีที่ผ่านมา จะได้ไม่ยิงเกินแล้วโดน 429 ทิ้งเปล่า
 */
const CREDITS_PER_MINUTE = 8;
const spent: number[] = [];

function allowance() {
  const cutoff = Date.now() - 60_000;
  while (spent.length > 0 && spent[0] < cutoff) spent.shift();
  return Math.max(0, CREDITS_PER_MINUTE - spent.length);
}

function charge(n: number) {
  const now = Date.now();
  for (let i = 0; i < n; i++) spent.push(now);
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Twelve Data — free tier: 800 req/วัน, 8 req/นาที, มี API key ถูกต้องตาม ToS
 * https://twelvedata.com/pricing
 */
export function twelveData(apiKey: string): Provider {
  return {
    name: 'twelvedata',
    // free tier: 8 credits/นาที และ 1 หุ้น = 1 credit ต่อการขอราคา
    // กันโควตาไว้ให้ time_series (ราคา ณ 11:30) ด้วย จึงดึงราคาสดรอบละ 6 ตัว
    maxPerCycle: 6,
    // 6 credits/รอบ × 1 รอบ/นาที = 6 credits/นาที ยังเหลือที่ให้ time_series
    minCycleMs: 60_000,
    capacity: 6, // 6 credits ต่อรอบ 60 วิ

    async fetchLive(requested): Promise<LiveResult> {
      const out = new Map<string, LivePrice>();
      // เผื่อ 1 credit ไว้ให้ time_series เสมอ
      const room = Math.max(0, allowance() - 1);
      const symbols = requested.slice(0, room);
      if (symbols.length === 0) return { prices: out, attempted: [] };

      charge(symbols.length);
      const url = `${BASE}/quote?symbol=${symbols.join(',')}&apikey=${apiKey}`;
      // แชร์ผลข้าม request/instance ต้นทางถูกเรียกครั้งเดียวต่อรอบ 60 วิ
      const res = await fetch(url, { next: { revalidate: 60 } });
      if (!res.ok) throw new Error(`Twelve Data ตอบ ${res.status}`);
      const json = await res.json();

      if (json?.status === 'error') throw new Error(json.message ?? 'Twelve Data error');

      // ขอ 1 ตัวจะได้ object เดี่ยว ขอหลายตัวจะได้ map ของ symbol
      const entries = symbols.length === 1 ? { [symbols[0]]: json } : json;
      for (const symbol of symbols) {
        const q = entries?.[symbol];
        if (!q || q.status === 'error') continue;
        out.set(symbol, {
          symbol,
          name: q.name ?? null,
          open: num(q.open),
          last: num(q.close),
          dayHigh: num(q.high),
        });
      }
      return { prices: out, attempted: symbols };
    },

    async fetchWindowSnapshot(symbol, endMin): Promise<WindowSnapshot | null> {
      if (allowance() < 1) throw new Error('โควตา Twelve Data เต็มในนาทีนี้ จะลองใหม่รอบหน้า');
      charge(1);
      // แท่ง 1 นาทีของช่วงที่สนใจ — ขอย้อน 3 ชม.พอ ไม่ต้องดึงทั้งวัน
      const url =
        `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}` +
        `&interval=1min&outputsize=400&timezone=America/New_York&apikey=${apiKey}`;
      // ราคา ณ 11:30 นิ่งแล้วหลังพ้นเวลา แคชได้นาน
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) throw new Error(`Twelve Data ตอบ ${res.status}`);
      const json = await res.json();
      if (json?.status === 'error') throw new Error(json.message ?? 'Twelve Data error');

      const values: Array<{ datetime: string; open: string; close: string; high: string }> =
        json?.values ?? [];
      if (values.length === 0) return null;

      // datetime อยู่ใน timezone ET แล้ว รูปแบบ "YYYY-MM-DD HH:MM:SS"
      // ชุดข้อมูลเรียงใหม่ก่อน จึงยึดวันของแท่งล่าสุดเป็นวันที่สนใจ
      const day = values[0].datetime.slice(0, 10);
      const inDay = values.filter((v) => v.datetime.startsWith(day));

      const startHhmm = minuteLabel(SESSION_START_MIN);
      const endHhmm = minuteLabel(endMin);
      const inWindow = (v: { datetime: string }) => {
        const hhmm = v.datetime.slice(11, 16);
        return hhmm >= startHhmm && hhmm <= endHhmm;
      };

      /**
       * หุ้นสภาพคล่องต่ำอาจไม่มีการซื้อขายในนาทีปลายช่วงเลย จึงไม่มีแท่งนั้น
       * ถ้าหาไม่เจอให้ถอยไปใช้แท่งล่าสุดที่ไม่เกินปลายช่วง (ราคาที่ยังยืนอยู่ตอนนั้น)
       * ไม่งั้นจะตกไปใช้ราคาล่าสุดของวันซึ่งเลยหน้าต่างไปแล้วและทำให้ % ผิด
       */
      const endBar =
        inDay.find((v) => v.datetime.slice(11, 16) === endHhmm) ??
        // ชุดข้อมูลเรียงใหม่ก่อน ตัวแรกคือแท่งที่ใกล้ปลายช่วงที่สุด
        inDay.filter(inWindow).at(0);
      const end = endBar ? num(endBar.open) ?? num(endBar.close) : null;

      // high เอาแค่ในหน้าต่าง ไม่เอา high ของทั้งวัน
      const barsInWindow = inDay.filter(inWindow);
      const highs = barsInWindow
        .map((v) => num(v.high))
        .filter((n): n is number => n != null);

      /**
       * แท่งแรกที่ได้มาต้องอยู่ที่นาทีเปิด ไม่งั้น high ขาดช่วงหัวไป
       * ยอมคลาดได้ไม่เกิน 2 นาที เผื่อหุ้นที่ไม่มีการซื้อขายทันทีตอนเปิด
       */
      const firstMinute = barsInWindow.at(-1)?.datetime.slice(11, 16);
      const highPartial =
        highs.length === 0 || firstMinute == null
          ? true
          : firstMinute > minuteLabel(SESSION_START_MIN + COVERAGE_TOLERANCE_MIN);

      return { end, high: highs.length > 0 ? Math.max(...highs) : null, highPartial };
    },
  };
}

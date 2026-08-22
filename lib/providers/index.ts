import { finnhub } from './finnhub';
import { mock } from './mock';
import { twelveData } from './twelvedata';
import type { Provider } from './types';
import { yahoo } from './yahoo';

export type { LivePrice, Provider } from './types';

export type Providers = {
  /** ใช้ poll ราคาสดถี่ ๆ */
  live: Provider;
  /** ใช้ดึงราคา ณ 11:30 ET (ครั้งเดียวต่อหุ้นต่อวัน) */
  windowEnd: Provider;
};

/**
 * แหล่งข้อมูลแยกหน้าที่กันตามโควตาของแต่ละเจ้า:
 *   FINNHUB_API_KEY     → poll ราคาสด (60 calls/นาที ดึงถี่ได้)
 *   TWELVEDATA_API_KEY  → ราคา ณ 11:30 ET (มี candle ย้อนหลังในแพ็กเกจฟรี)
 *   QUOTE_PROVIDER=mock → ตัวเลขชุดเดียวกับไฟล์ Excel
 *   ไม่มี key เลย         → Yahoo (ไม่เป็นทางการ ถูกบล็อกง่าย)
 */
export function resolveProviders(): Providers {
  if (process.env.QUOTE_PROVIDER === 'mock') return { live: mock, windowEnd: mock };

  const td = process.env.TWELVEDATA_API_KEY;
  const fh = process.env.FINNHUB_API_KEY;

  const twelve = td ? twelveData(td) : null;
  const finn = fh ? finnhub(fh) : null;

  const live = finn ?? twelve ?? yahoo;
  const windowEnd = twelve ?? yahoo;

  return { live, windowEnd };
}

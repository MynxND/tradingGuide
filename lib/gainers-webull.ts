/**
 * อันดับหุ้นบวกจาก Webull — แหล่งเดียวที่ให้ % ตามช่วงเวลาแบบเรียลไทม์
 *
 * ทำไมไม่ใช้ TradingView screener: คอลัมน์ `change|30` / `change|60` ของมันไม่ใช่
 * "ย้อนหลัง N นาที" แต่เป็น % ภายในแท่งเทียนที่กำลังก่อตัว (รีเซ็ตทุกแท่ง) ซ้ำร้าย
 * ฟีดฟรียังดีเลย์ 15 นาที และ prevClose ไม่ปรับ reverse split ทำให้หุ้นรวมพาร์
 * โชว์ +3000% (วัดจริง: HCWC โชว์ +3282% ทั้งที่จริงลง 3.97%)
 * ของ Webull ตรงกับที่ผู้ใช้เอาไปเทียบในแอปจริง และ preClose ปรับ split ถูกต้อง
 */

import type { Gainer } from './gainers';

const URL_BASE = 'https://quotes-gw.webullfintech.com/api/wlas/ranking/topGainers';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
/** regionId 6 = สหรัฐ */
const REGION_US = 6;
/** ต้นทางส่งได้สูงสุดหน้าละ 200 แถว */
const PAGE_SIZE = 200;

/** ชนิดอันดับที่ต้นทางรับจริง — ที่เหลือ (1min, 30min, 1h, 1M) ตอบ 417 กลับมา */
export const WEBULL_RANK_TYPE = {
  '3m': '3min',
  '5m': '5min',
  '1d': '1d',
  '5d': '5d',
  '1mo': '1m',
} as const;

export type WebullPeriod = keyof typeof WEBULL_RANK_TYPE;

type Ticker = {
  disSymbol?: string;
  symbol?: string;
  name?: string;
  close?: string | null;
  changeRatio?: string | null;
  marketValue?: string | null;
};

const num = (raw: string | null | undefined) => {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export async function fetchWebullGainers(period: WebullPeriod): Promise<Gainer[]> {
  const rankType = WEBULL_RANK_TYPE[period];
  const url = `${URL_BASE}?regionId=${REGION_US}&rankType=${rankType}&pageIndex=1&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ข้อมูลอันดับตอบ ${res.status}`);

  const json = await res.json();
  // ต้นทางตอบ 200 พร้อม code/msg เวลาพารามิเตอร์ผิด ไม่ได้ตอบ HTTP error
  if (json?.code) throw new Error(`ข้อมูลอันดับปฏิเสธคำขอ (${json.code})`);

  const rows: { ticker?: Ticker }[] = json?.data ?? [];
  const data = rows
    .map(({ ticker }) => {
      const symbol = ticker?.disSymbol ?? ticker?.symbol ?? '';
      const ratio = num(ticker?.changeRatio);
      return {
        symbol,
        name: ticker?.name ?? '',
        price: num(ticker?.close),
        // ต้นทางส่งเป็นสัดส่วน (0.0928) ไม่ใช่เปอร์เซ็นต์
        changePct: ratio == null ? Number.NaN : ratio * 100,
        marketCap: num(ticker?.marketValue),
      };
    })
    .filter((g) => g.symbol && Number.isFinite(g.changePct) && g.changePct > 0);

  if (data.length === 0) throw new Error('ไม่พบข้อมูลหุ้นบวกในช่วงนี้');
  // ต้นทางเรียงมาให้แล้ว แต่ยืนยันอีกชั้นเผื่อรูปแบบเปลี่ยน
  return data.sort((a, b) => b.changePct - a.changePct);
}

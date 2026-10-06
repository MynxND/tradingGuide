'use client';

import { useEffect, useRef } from 'react';

/**
 * กราฟแท่งเทียนจาก widget ทางการของ TradingView (Advanced Chart)
 *
 * ข้อมูลวิ่งตรงจาก TradingView ไปเบราว์เซอร์ผู้ใช้ server เราไม่ได้ดึงหรือเผยแพร่ข้อมูลตลาดเอง
 * เงื่อนไขการใช้ฟรีคือต้องคงลิงก์/โลโก้ TradingView ไว้ ห้ามซ่อน
 */
export function TradingViewChart({ symbol }: { symbol: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // widget อ่าน config จากเนื้อหาของ <script> ตอนโหลด จึงต้องสร้าง script ใหม่ทุกครั้งที่เปลี่ยนหุ้น
    // host นี้ React ไม่ได้วาดลูกเอง เพราะ widget แทนที่ลูกด้วย iframe และเขียน style ทับ container
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: '5',
      timezone: 'Asia/Bangkok',
      theme: 'dark',
      style: '1',
      locale: 'th_TH',
      backgroundColor: '#060709',
      gridColor: 'rgba(33, 38, 51, 0.6)',
      allow_symbol_change: false,
      hide_side_toolbar: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = '';
    };
  }, [symbol]);

  return (
    <div className="flex h-[420px] w-full flex-col">
      <div className="tradingview-widget-container min-h-0 flex-1" ref={host} />
      <div className="tradingview-widget-copyright h-6 text-[11px] leading-6 text-ink-dim">
        <a
          href={`https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/`}
          rel="noopener nofollow"
          target="_blank"
          className="text-accent hover:underline"
        >
          กราฟ {symbol}
        </a>{' '}
        โดย TradingView
      </div>
    </div>
  );
}

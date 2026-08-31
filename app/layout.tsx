import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trading Guide',
  description: 'คำนวณสูตร Open 20:30 → ปลายช่วงที่เลือก อัตโนมัติ ไม่ต้องคีย์ Excel เอง',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#131722',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-dvh bg-bg text-ink">{children}</body>
    </html>
  );
}

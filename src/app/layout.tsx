import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const pretendard = localFont({
  src: './fonts/PretendardVariable.woff2',
  display: 'swap',
  weight: '45 920',
  variable: '--font-pretendard',
});

export const metadata: Metadata = {
  title: {
    default: 'MediON 메디온',
    template: '%s | MediON',
  },
  description:
    '복용 중인 약을 등록하면, 함께 먹으면 안 되는 약과 겹치는 성분을 구매 전에 알려주는 온라인 약국',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans text-ink bg-product-bg">{children}</body>
    </html>
  );
}

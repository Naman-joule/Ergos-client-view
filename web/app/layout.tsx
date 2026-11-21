import 'ergos-harmony/tokens.css';
import 'ergos-harmony/harmony.css';
import './app.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: { default: 'ergOS client view', template: '%s · ergOS' },
  description: 'Energy supply and IEX savings for your plants',
  icons: { icon: '/vendor/ergos/logo/joulewise-mark.svg' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('ecv_theme')?.value === 'light' ? 'light' : 'dark';
  return (
    <html lang="en-IN" data-theme={theme}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Urbanist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body className="eg-stage">
        {children}
        <Script src="/vendor/ergos/harmony.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

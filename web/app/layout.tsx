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
        {/* Shared SVG pattern: surplus solar is drawn with diagonal blue stripes (app.css). */}
        <svg className="ecv-hatch-defs" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="ecv-hatch-surplus" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect className="ecv-hatch-bg" width="7" height="7" />
              <line className="ecv-hatch-line" x1="0" y1="0" x2="0" y2="7" />
            </pattern>
          </defs>
        </svg>
        {children}
        <Script src="/vendor/ergos/harmony.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

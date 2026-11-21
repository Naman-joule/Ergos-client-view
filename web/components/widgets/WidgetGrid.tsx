import type { ReactNode } from 'react';
import type { PaletteName, Span } from '@/lib/dashboard/schema';

/** 12-column widget grid; the palette class switches every chart, swatch and chip inside. */
export function WidgetGrid({ palette, children }: { palette: PaletteName; children: ReactNode }) {
  return <div className={`ecv-grid${palette !== 'harmony' ? ` eg-pal-${palette}` : ''}`}>{children}</div>;
}

export function WidgetCell({ span, type, children }: { span: Span; type: string; children: ReactNode }) {
  return <div className={`ecv-span-${span}`} data-widget={type}>{children}</div>;
}

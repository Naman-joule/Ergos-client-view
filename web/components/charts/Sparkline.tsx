'use client';
import type { SeriesKey } from '@/lib/ui/ergos';
import { useErgosDraw } from './useErgos';

export function Sparkline({ values, series, label, className }: { values: number[]; series: SeriesKey; label: string; className?: string }) {
  const ref = useErgosDraw((E, host) => { E.sparkline(host, values, { series, label }); }, JSON.stringify([values, series]));
  return <div ref={ref} className={className} data-series={series} />;
}

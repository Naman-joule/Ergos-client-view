'use client';
import type { AreaSeries } from '@/lib/ui/ergos';
import { useErgosDraw } from './useErgos';

export function TrendChart({ series, now, height = 300, unit = 'kW', label, slots = true }: {
  series: AreaSeries[]; now?: number | null; height?: number; unit?: string; label: string; slots?: boolean;
}) {
  const ref = useErgosDraw(
    (E, host) => E.trendChart(host, { series, now: now ?? null, height, unit, label, slots }),
    JSON.stringify([series, now, height, unit]),
  );
  return <div ref={ref} className="eg-chart" />;
}

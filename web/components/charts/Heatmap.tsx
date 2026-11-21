'use client';
import type { SeriesKey } from '@/lib/ui/ergos';
import { useErgosDraw } from './useErgos';

export function Heatmap({ rows, max, series = 'iex' }: { rows: { label: string; values: number[] }[]; max: number; series?: SeriesKey }) {
  const ref = useErgosDraw((E, host) => E.heatmap(host, { rows, max: max || 1, series }), JSON.stringify([rows, max, series]));
  return <div ref={ref} className="eg-chart" />;
}

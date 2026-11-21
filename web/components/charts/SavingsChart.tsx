'use client';
import { useErgosDraw } from './useErgos';

export function SavingsChart({ labels, savings, volume, height = 320 }: { labels: string[]; savings: number[]; volume: number[]; height?: number }) {
  const ref = useErgosDraw((E, host) => E.savingsChart(host, { labels, savings, volume, height }), JSON.stringify([labels, savings, volume, height]));
  return <div ref={ref} className="eg-chart" />;
}

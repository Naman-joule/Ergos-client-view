'use client';
import type { SeriesKey } from '@/lib/ui/ergos';
import { useErgosDraw } from './useErgos';

export function Ring({ parts, size = 150, stroke = 13, label }: { parts: { key: SeriesKey; value: number }[]; size?: number; stroke?: number; label: string }) {
  const ref = useErgosDraw((E, host) => E.ring(host, { parts, size, stroke, label }), JSON.stringify([parts, size, stroke]));
  return <div ref={ref} className="ecv-ring-host" />;
}

import type { CSSProperties } from 'react';
import type { SeriesKey } from '@/lib/ui/ergos';
import { Icon, type IconName } from './Icon';

/** eg-source tile: icon, name with share, value with unit, share bar. */
export function SourceBar({ series, icon, name, share, value, unit }: {
  series: SeriesKey; icon: IconName; name: string; share: number | null; value: string; unit: string;
}) {
  const pct = share === null || !Number.isFinite(share) ? 0 : Math.max(0, Math.min(1, share));
  return (
    <div className="eg-source" data-series={series} style={{ '--share': `${(pct * 100).toFixed(1)}%` } as CSSProperties}>
      <span className="eg-source__icon"><Icon name={icon} size={22} /></span>
      <span className="eg-source__name">{name}{share !== null ? ` · ${(pct * 100).toFixed(1)}%` : ''}</span>
      <span className="eg-source__value">{value}<small>{unit}</small></span>
      <span className="eg-source__bar"><span /></span>
    </div>
  );
}

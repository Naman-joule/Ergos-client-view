import type { ReactNode } from 'react';
import type { SeriesKey } from '@/lib/ui/ergos';
import { Icon, type IconName } from './Icon';
import { Sparkline } from '../charts/Sparkline';

export function StatTile({ series, label, icon, date, value, unit, spark, foot, footChip }: {
  series: SeriesKey; label: string; icon: IconName; date: string; value: string; unit?: string;
  spark?: number[] | null; foot?: ReactNode; footChip?: ReactNode;
}) {
  return (
    <div className="eg-stat" data-series={series}>
      <div className="eg-stat__top">
        <span className="eg-stat__label">{label}</span>
        <span className="eg-stat__icon"><Icon name={icon} size={16} /></span>
      </div>
      <div className="eg-stat__date">{date}</div>
      <div className="eg-stat__value">{value}{unit ? <span className="eg-stat__unit">{unit}</span> : null}</div>
      {spark && spark.length >= 2 ? <Sparkline className="eg-stat__spark" values={spark} series={series} label={`${label}, last ${spark.length} days`} /> : null}
      {foot || footChip ? <div className="eg-stat__foot"><span>{foot}</span>{footChip}</div> : null}
    </div>
  );
}

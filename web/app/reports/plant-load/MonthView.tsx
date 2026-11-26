import type React from 'react';
import Link from 'next/link';
import type { MonthLoad } from '@/lib/queries/plant-load';
import { blockEnd, blockStart, formatDate, formatDayMonth, formatWeekday } from '@/lib/time';
import { inr } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { Empty, Notice } from '@/components/ui/Empty';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const kw = (v: number | null | undefined) => (v == null ? '—' : inr(Math.round(v)));
const when = (p: { date: string; block: number } | null, withDate = true) =>
  p ? `${withDate ? `${formatDayMonth(p.date)} · ` : ''}${blockStart(p.block)}–${blockEnd(p.block)}` : '—';

/** A month of plant load: the month's maximum and minimum load, and each day's, from the meter readings. */
export function MonthView({ data, month, plantName, dayHref }: {
  data: MonthLoad; month: string; plantName: string; dayHref: (date: string) => string;
}) {
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const n = data.days.length;
  if (!data.daysWithData) {
    return (
      <Card title={`Plant load · ${label}`}>
        <Empty title={`No meter readings for ${label}`} icon="gauge">Pick another month, or a day that has readings.</Empty>
      </Card>
    );
  }
  const missing = n - data.daysWithData;
  return (
    <>
      {missing > 0 ? <Notice>{missing} of {n} days in {label} have no meter readings. The month’s figures cover the days that do.</Notice> : null}
      <div className="ecv-tiles-wrap">
        <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 5 } as React.CSSProperties}>
          <StatTile series="wind" label="Maximum load" icon="gauge" date={label} value={kw(data.max?.kw)} unit="kW" foot={when(data.max)} />
          <StatTile series="grid" label="Minimum load" icon="gauge" date={label} value={kw(data.min?.kw)} unit="kW" foot={when(data.min)} />
          <StatTile series="iex" label="Average load" icon="bars" date={label} value={kw(data.avgKw)} unit="kW"
            foot={data.loadFactor != null ? `Load factor ${(data.loadFactor * 100).toFixed(1)}%` : '—'} />
          <StatTile series="demand" label="Energy" icon="bolt" date={label} value={inr(Math.round(data.kwh))} unit="kWh"
            foot={`${inr(data.blocks)} blocks with readings`} />
          <StatTile series="solar" label="Days with readings" icon="calendar" date={label} value={`${data.daysWithData}`} unit={`/ ${n} days`}
            foot={missing ? `${missing} day${missing === 1 ? '' : 's'} without readings` : 'Every day has readings'} />
        </div>
      </div>

      <Card title={`Daily maximum and minimum load · ${label}`}
        sub={`${plantName} · load = a 15-minute block’s energy × 4 · highest and lowest of the month are marked · pick a date for its 96 blocks`}>
        <div className="ecv-table-wrap ecv-load__wrap">
          <table className="ecv-table ecv-load ecv-loadm">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Maximum load (kW)</th><th>At</th>
                <th className="num">Minimum load (kW)</th><th>At</th>
                <th className="num">Average (kW)</th><th className="num">Load factor</th>
                <th className="num">Energy (kWh)</th><th className="num">Blocks</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => {
                const isMax = !!data.max && d.max?.kw === data.max.kw && d.date === data.max.date;
                const isMin = !!data.min && d.min?.kw === data.min.kw && d.date === data.min.date;
                return (
                  <tr key={d.date} className={d.blocks ? undefined : 'is-missing'}>
                    <td className="nowrap"><Link href={dayHref(d.date)} title={`Open ${formatDate(d.date)}: all 96 blocks`}>{formatWeekday(d.date)}</Link></td>
                    {d.blocks ? (
                      <>
                        <td className={`num${isMax ? ' ecv-loadm__peak' : ''}`}>{kw(d.max?.kw)}{isMax ? <small>month’s highest</small> : null}</td>
                        <td className="nowrap">{when(d.max, false)}</td>
                        <td className={`num${isMin ? ' ecv-loadm__low' : ''}`}>{kw(d.min?.kw)}{isMin ? <small>month’s lowest</small> : null}</td>
                        <td className="nowrap">{when(d.min, false)}</td>
                        <td className="num">{kw(d.avgKw)}</td>
                        <td className="num">{d.loadFactor != null ? `${(d.loadFactor * 100).toFixed(1)}%` : '—'}</td>
                        <td className="num">{inr(d.kwh, 1)}</td>
                        <td className="num">{d.blocks}<small>of 96</small></td>
                      </>
                    ) : <td colSpan={8} className="eg-muted">No meter readings</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

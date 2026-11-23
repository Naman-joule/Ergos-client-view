'use client';
import { useState } from 'react';
import type { AreaHoverRow, AreaSeries, SeriesKey } from '@/lib/ui/ergos';
import { inr } from '@/lib/format';
import { blockEnd } from '@/lib/time';
import { useErgosDraw } from './useErgos';
import { TodView, type TodSourceInfo } from './TodView';

// Layers bottom-up: IEX settles first, then solar, then banking; the grid covers the rest and
// surplus solar sits above demand. Chart keys are design-system series slots; app.css maps colours:
// IEX purple, solar green, banking (battery) red, grid amber, surplus (hydro slot) striped blue.
type Src = 'iex' | 'solar' | 'bank' | 'grid' | 'surplus';
const ORDER: Src[] = ['iex', 'solar', 'bank', 'grid', 'surplus'];
const META: Record<Src, { key: SeriesKey; label: string; icon: string }> = {
  solar: { key: 'solar', label: 'Solar', icon: 'solar' },
  bank: { key: 'battery', label: 'Banking', icon: 'battery' },
  iex: { key: 'iex', label: 'Power exchange', icon: 'exchange' },
  grid: { key: 'grid', label: 'Grid', icon: 'grid' },
  surplus: { key: 'hydro', label: 'Surplus solar', icon: 'solar' },
};

export interface SupplyProps {
  demand: number[]; solarUsed: number[]; bank: number[]; iex: number[]; iexUsed: number[]; grid: number[]; surplus: number[];
  iexRate: (number | null)[]; now: number; dayLabel: string;
  tod: (string | null)[]; gridRate: (number | null)[]; solarRate: (number | null)[];
  todSource: TodSourceInfo | null; date: string; isToday: boolean;
  /** Pre-rendered icon SVG markup by name (server-generated), so the client bundle carries no icon map. */
  icons: Record<string, string>;
}

function Ico({ svg }: { svg: string }) {
  return <span className="ecv-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function SupplyChart({ demand, solarUsed, bank, iex, iexUsed, grid, surplus, iexRate, now, dayLabel, icons, tod, gridRate, solarRate, todSource, date, isToday }: SupplyProps) {
  const [view, setView] = useState<'timeline' | 'tod'>('timeline');
  // IEX is drawn in full (the whole purchase), so where it exceeds demand the purple rises above the
  // demand line. Solar, banking and grid fill whatever demand IEX left; surplus solar sits on top.
  const values: Record<Src, number[]> = { solar: solarUsed, bank, iex, grid, surplus };
  const hasIex = iex.some((v, i) => i <= now && v > 0.5);
  const has = (s: Src) => values[s].some((v, i) => i <= now && v > 0.5);
  const sources = ORDER.filter((s) => s === 'grid' || (s === 'iex' ? hasIex : has(s)));
  const [on, setOn] = useState<Record<Src, boolean>>({ solar: true, bank: true, iex: true, grid: true, surplus: true });
  const [row, setRow] = useState<AreaHoverRow | null>(null);

  const ref = useErgosDraw((E, host) => {
    if (view !== 'timeline') return;
    const upTo = (a: number[]) => a.map((v, i) => (i <= now ? v : null));
    const series: AreaSeries[] = sources.filter((s) => on[s]).map((s) => ({ key: META[s].key, label: META[s].label, values: upTo(values[s]) }));
    E.areaChart(host, {
      stacked: true, series, line: { label: 'Demand', values: demand }, now, cursorMax: now,
      height: 340, unit: 'kW', slots: true,
      label: `Energy supply by source on ${dayLabel}, 15-minute blocks. The full IEX purchase is shown; where it exceeds demand it rises above the demand line, as does surplus solar. Use arrow keys to move between blocks.`,
      onHover: setRow,
    });
  }, JSON.stringify([demand, solarUsed, bank, iex, grid, surplus, now, on, view]));

  const i = row ? row.index : now;
  const val = (s: Src) => values[s][i] ?? 0;
  const rate = iexRate[i];
  const note: Record<Src, string> = {
    solar: val('solar') > 0 ? 'Captive solar' : 'No generation',
    bank: val('bank') > 0 ? 'Drawn from bank' : 'Not drawn',
    iex: (iex[i] ?? 0) <= 0.5 ? 'Not purchased'
      : (iex[i] ?? 0) - (iexUsed[i] ?? 0) > 0.5 ? `${inr(Math.round((iex[i] ?? 0) - (iexUsed[i] ?? 0)))} kW above demand`
      : rate ? `@ ₹${rate.toFixed(2)} / kWh` : 'Cleared',
    grid: 'Derived',
    surplus: val('surplus') > 0 ? 'Beyond demand' : 'None',
  };
  const focus = row?.focus ? (Object.keys(META) as Src[]).find((s) => META[s].key === row.focus) : undefined;

  const seg = (
    <div className="eg-seg eg-seg--sm ecv-viewseg" role="group" aria-label="Chart view">
      <button type="button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button>
      <button type="button" aria-pressed={view === 'tod'} onClick={() => setView('tod')}>ToD</button>
    </div>
  );

  if (view === 'tod') {
    return (
      <>
        <div className="ecv-supply__bar">
          <div className="eg-legend">
            {sources.map((s) => (
              <span key={s}><span className={'eg-swatch' + (s === 'surplus' ? ' ecv-swatch-hatch' : '')} data-series={META[s].key} />{META[s].label}</span>
            ))}
            <span><span className="eg-swatch eg-swatch--line" />Demand</span>
          </div>
          {seg}
        </div>
        <TodView dayLabel={dayLabel} date={date} isToday={isToday} source={todSource} tod={tod} now={now} demand={demand}
          iexRate={iexRate} gridRate={gridRate} solarRate={solarRate}
          layers={ORDER.filter((s) => values[s]).map((s) => ({ key: s, slot: META[s].key, label: META[s].label, values: values[s], hatch: s === 'surplus' }))} />
      </>
    );
  }

  return (
    <>
      <div className="ecv-supply__bar">
      <div className="eg-row ecv-srcchips" role="group" aria-label="Sources shown">
        {sources.map((s) => (
          <button key={s} type="button" className={'eg-srcchip' + (s === 'surplus' ? ' ecv-srcchip--surplus' : '')} data-series={META[s].key} aria-pressed={on[s]}
            onClick={() => setOn((o) => ({ ...o, [s]: !o[s] }))}>
            <span className="eg-srcchip__ic"><Ico svg={icons[META[s].icon] ?? ''} /></span>{META[s].label}
          </button>
        ))}
      </div>
      {seg}
      </div>
      <div className="eg-readout">
        <div className="eg-readout__when">
          <b>{dayLabel} · {blockEnd(i + 1)}</b>
          <span>{!row || row.index === now ? 'Latest block in view' : `Block ${i + 1} of 96`}</span>
        </div>
        <div className="eg-readout__items">
          <div className="eg-readout__item" data-key="demand">
            <span className="eg-readout__label"><span className="eg-swatch eg-swatch--line" />Total demand</span>
            <span className="eg-readout__value">{inr(Math.round(demand[i] ?? 0))} kW</span>
          </div>
          {sources.map((s) => (
            <div key={s} className={'eg-readout__item' + (focus === s ? ' is-focus' : '')} data-key={s}>
              <span className="eg-readout__label">
                <span className={'eg-swatch' + (s === 'surplus' ? ' ecv-swatch-hatch' : '')} data-series={META[s].key} />
                <Ico svg={icons[META[s].icon] ?? ''} />{META[s].label}
              </span>
              <span className="eg-readout__value">{inr(Math.round(val(s)))} kW</span>
              <span className="eg-readout__note">{note[s]}</span>
            </div>
          ))}
        </div>
      </div>
      <div ref={ref} className="eg-chart ecv-chart-gap ecv-supply" />
    </>
  );
}

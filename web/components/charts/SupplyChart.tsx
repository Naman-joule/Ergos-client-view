'use client';
import { useState } from 'react';
import type { HoverRow, SeriesKey } from '@/lib/ui/ergos';
import { inr } from '@/lib/format';
import { blockEnd } from '@/lib/time';
import { useErgosDraw } from './useErgos';

type Src = 'solar' | 'iex' | 'grid';
const META: Record<Src, { label: string; icon: string }> = {
  solar: { label: 'Solar', icon: 'solar' },
  iex: { label: 'Power exchange', icon: 'exchange' },
  grid: { label: 'Grid', icon: 'grid' },
};

export interface SupplyProps {
  demand: number[]; solar: number[]; iex: number[]; iexRate: (number | null)[];
  now: number; hasSolar: boolean; dayLabel: string;
  /** Pre-rendered icon SVG markup by name (server-generated), so the client bundle carries no icon map. */
  icons: Record<string, string>;
}

function Ico({ svg }: { svg: string }) {
  return <span className="ecv-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function SupplyChart({ demand, solar, iex, iexRate, now, hasSolar, dayLabel, icons }: SupplyProps) {
  const sources: Src[] = hasSolar ? ['solar', 'iex', 'grid'] : ['iex', 'grid'];
  const [on, setOn] = useState<Record<Src, boolean>>({ solar: true, iex: true, grid: true });
  const [row, setRow] = useState<HoverRow | null>(null);

  const ref = useErgosDraw((E, host) => {
    const layers: { key: SeriesKey; label: string; values?: number[] }[] = [];
    if (hasSolar && on.solar) layers.push({ key: 'solar', label: 'Solar', values: solar });
    if (on.iex) layers.push({ key: 'iex', label: 'Power exchange', values: iex });
    if (on.grid) layers.push({ key: 'grid', label: 'Grid (derived)' });           // fills up to demand
    E.supplyChart(host, {
      demand, layers, now, height: 340,
      label: `Energy supply by source on ${dayLabel}, 15-minute blocks. Use arrow keys to move between blocks.`,
      onHover: setRow,
    });
  }, JSON.stringify([demand, solar, iex, now, on, hasSolar]));

  const block = row ? row.block : now + 1;
  const num = (k: string) => (row && typeof row[k] === 'number' ? (row[k] as number) : 0);
  const rate = iexRate[block - 1];
  const note: Record<Src, string> = {
    solar: num('solar') > 0 ? 'Captive solar' : 'No generation',
    iex: num('iex') > 0 ? (rate ? `@ ₹${rate.toFixed(2)} / kWh` : 'Cleared') : 'Not purchased',
    grid: 'Derived',
  };

  return (
    <>
      <div className="eg-row ecv-srcchips" role="group" aria-label="Sources shown">
        {sources.map((s) => (
          <button key={s} type="button" className="eg-srcchip" data-series={s} aria-pressed={on[s]}
            onClick={() => setOn((o) => ({ ...o, [s]: !o[s] }))}>
            <span className="eg-srcchip__ic"><Ico svg={icons[META[s].icon]} /></span>{META[s].label}
          </button>
        ))}
      </div>
      <div className="eg-readout">
        <div className="eg-readout__when">
          <b>{dayLabel} · {blockEnd(block)}</b>
          <span>{!row || row.slot === now ? 'Latest block in view' : `Block ${block} of 96`}</span>
        </div>
        <div className="eg-readout__items">
          <div className="eg-readout__item" data-key="demand">
            <span className="eg-readout__label"><span className="eg-swatch eg-swatch--line" />Total demand</span>
            <span className="eg-readout__value">{inr(Math.round(row ? row.demand : demand[now] ?? 0))} kW</span>
          </div>
          {sources.map((s) => (
            <div key={s} className={'eg-readout__item' + (row?.focus === s ? ' is-focus' : '')} data-key={s}>
              <span className="eg-readout__label"><span className="eg-swatch" data-series={s} /><Ico svg={icons[META[s].icon]} />{META[s].label}</span>
              <span className="eg-readout__value">{inr(Math.round(num(s)))} kW</span>
              <span className="eg-readout__note">{note[s]}</span>
            </div>
          ))}
        </div>
      </div>
      <div ref={ref} className="eg-chart ecv-chart-gap" />
    </>
  );
}

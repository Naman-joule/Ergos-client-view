'use client';
import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { inr } from '@/lib/format';
import { SUPPLY_LAYERS, type SupplyKey } from '@/lib/supply';
import type { RunStats } from '@/lib/tod';
import { TodView } from './TodView';

// History energy supply: a timeline over the range (every 15-minute block up to 7 days, one stacked bar
// per day beyond that) and the ToD view summed over the range. Same stacking and colours as Today:
// IEX (full purchase) at the bottom, then solar used, banking, grid, and striped surplus solar on top,
// with demand as a line. Hover (or arrow keys) reads a block or day; click a ToD bar to pin it.

export interface HistorySeriesProps {
  demand: (number | null)[]; iex: number[]; solar: number[]; bank: number[]; grid: number[]; surplus: number[]; days: string[];
}
export interface HistoryDayProps {
  date: string; blocks: number; demandKwh: number; iexKwh: number; solarUsedKwh: number; bankKwh: number; gridKwh: number; surplusKwh: number;
}

const W = 1000, H = 330, L = 58, R = 12, T = 22, B = 46;
const PW = W - L - R, PH = H - T - B;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayName = (d: string) => `${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))} ${MO[Number(d.slice(5, 7)) - 1]}`;
const hhmm = (block: number) => `${String(Math.floor(block / 4)).padStart(2, '0')}:${String((block % 4) * 15).padStart(2, '0')}`;
const energy = (kwh: number) => (Math.abs(kwh) >= 1000 ? `${inr(kwh / 1000, 2)} MWh` : `${inr(kwh)} kWh`);

function niceMax(v: number): { max: number; step: number } {
  const raw = Math.max(v, 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { max: step * Math.ceil((v * 1.08) / step || 1), step };
}

type Layer = { key: SupplyKey; slot: string; label: string; hatch?: boolean };
const LAYERS: Layer[] = SUPPLY_LAYERS.map((l) => ({ key: l.key, slot: l.slot, label: l.label, hatch: 'hatch' in l ? l.hatch : undefined }));

export function HistoryChart({ series, days, tod, todDays, rangeLabel, hidden = [] }: {
  series: HistorySeriesProps | null; days: HistoryDayProps[]; tod: RunStats[]; todDays: number; rangeLabel: string; hidden?: SupplyKey[];
}) {
  const [view, setView] = useState<'timeline' | 'tod'>('timeline');
  const layers = LAYERS.filter((l) => !hidden.includes(l.key));
  return (
    <div className="ecv-hist">
      <div className="ecv-hist__bar">
        <div className="eg-legend">
          {layers.map((l) => (
            <span key={l.key}><span className={'eg-swatch' + (l.hatch ? ' ecv-swatch-hatch' : '')} data-series={l.slot} />{l.label}</span>
          ))}
          <span><span className="eg-swatch eg-swatch--line" />Demand</span>
        </div>
        <div className="eg-seg eg-seg--sm ecv-viewseg" role="group" aria-label="Chart view">
          <button type="button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button>
          <button type="button" aria-pressed={view === 'tod'} onClick={() => setView('tod')}>ToD</button>
        </div>
      </div>
      {view === 'timeline'
        ? (series ? <BlockTimeline series={series} layers={layers} rangeLabel={rangeLabel} /> : <DayBars days={days} layers={layers} rangeLabel={rangeLabel} />)
        : tod.length
          ? <TodView runs={tod} days={todDays} dayLabel={rangeLabel} date={days[days.length - 1]?.date ?? ''} isToday={false} />
          : <div className="ecv-empty" role="status"><div><b>No ToD schedule for this plant</b>
              <p className="eg-muted">No DISCOM ToD tariff was found for these dates, so energy can’t be grouped by ToD period.</p></div></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------- every block (≤ 7 days)
function BlockTimeline({ series, layers, rangeLabel }: { series: HistorySeriesProps; layers: Layer[]; rangeLabel: string }) {
  const n = series.demand.length;
  const lastData = series.demand.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
  const vals = (k: SupplyKey) => series[k];
  const { stacks, max, step } = useMemo(() => {
    const stacks: { layer: Layer; lo: number[]; hi: number[] }[] = [];
    let base = new Array<number>(n).fill(0);
    for (const l of layers) {
      const v = vals(l.key);
      const hi = base.map((b, i) => b + (v[i] || 0));
      stacks.push({ layer: l, lo: base, hi });
      base = hi;
    }
    const top = Math.max(1, ...base, ...series.demand.map((d) => d ?? 0));
    return { stacks, ...niceMax(top) };
  }, [series, layers]); // eslint-disable-line react-hooks/exhaustive-deps
  const X = (i: number) => L + ((i + 0.5) / n) * PW;
  const Y = (kw: number) => T + PH - (kw / max) * PH;
  const end = Math.max(0, lastData);
  const area = (lo: number[], hi: number[]) => {
    if (lastData < 0) return '';
    let d = `M${X(0)},${Y(hi[0]!)}`;
    for (let i = 1; i <= end; i++) d += `L${X(i)},${Y(hi[i]!)}`;
    for (let i = end; i >= 0; i--) d += `L${X(i)},${Y(lo[i]!)}`;
    return d + 'Z';
  };
  const demandPath = series.demand.reduce((d, v, i) => (v == null ? d : d + `${d && series.demand[i - 1] != null ? 'L' : 'M'}${X(i)},${Y(v)}`), '');
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

  return (
    <Hover n={n} label={(i) => `${dayName(series.days[Math.floor(i / 96)]!)} · ${hhmm(i % 96)}–${hhmm((i % 96) + 1)}`}
      rows={(i) => i > lastData ? null : [
        { label: 'Demand', value: `${inr(series.demand[i] ?? 0)} kW`, line: true },
        ...layers.map((l) => ({ label: l.label, slot: l.slot, hatch: l.hatch, value: `${inr(vals(l.key)[i] || 0)} kW` })),
      ]}
      x={X} aria={`Energy supply by 15-minute block, ${rangeLabel}`}>
      <text x={L - 10} y={T - 8} className="eg-axis eg-axis--unit" textAnchor="end">kW</text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v ? 'eg-gridline' : 'eg-baseline'} />
          <text x={L - 10} y={Y(v) + 4} className="eg-axis" textAnchor="end">{inr(v)}</text>
        </g>
      ))}
      {stacks.map(({ layer, lo, hi }) => (
        <path key={layer.key} d={area(lo, hi)} className={layer.hatch ? 'ecv-tod__hatch' : `f-${layer.slot} ecv-hist__area`} />
      ))}
      <path d={demandPath} className="ecv-tod__demand ecv-hist__demand" fill="none" />
      {series.days.map((d, k) => (
        <g key={d}>
          {k ? <line x1={L + (k * 96 / n) * PW} x2={L + (k * 96 / n) * PW} y1={T} y2={T + PH} className="ecv-hist__daysep" /> : null}
          <text x={L + ((k + 0.5) * 96 / n) * PW} y={H - 14} className="eg-axis eg-axis--strong" textAnchor="middle">{dayName(d)}</text>
          {series.days.length <= 3 ? [24, 48, 72].map((b) => (
            <text key={b} x={L + ((k * 96 + b) / n) * PW} y={H - 30} className="eg-axis" textAnchor="middle">{hhmm(b)}</text>
          )) : null}
        </g>
      ))}
    </Hover>
  );
}

// ---------------------------------------------------------------------------- one bar per day (> 7 days)
function DayBars({ days, layers, rangeLabel }: { days: HistoryDayProps[]; layers: Layer[]; rangeLabel: string }) {
  const n = days.length;
  const kwhOf = (d: HistoryDayProps, k: SupplyKey) =>
    k === 'iex' ? d.iexKwh : k === 'solar' ? d.solarUsedKwh : k === 'bank' ? d.bankKwh : k === 'grid' ? d.gridKwh : d.surplusKwh;
  const top = Math.max(1, ...days.map((d) => Math.max(d.demandKwh, layers.reduce((s, l) => s + kwhOf(d, l.key), 0)))) / 1000;
  const { max, step } = niceMax(top);
  const slot = PW / n, bw = Math.max(2, Math.min(28, slot * 0.66));
  const X = (i: number) => L + slot * (i + 0.5);
  const Y = (mwh: number) => T + PH - (mwh / max) * PH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const every = Math.ceil(n / 16);

  return (
    <Hover n={n} label={(i) => dayName(days[i]!.date)}
      rows={(i) => !days[i]!.blocks ? null : [
        { label: 'Demand', value: energy(days[i]!.demandKwh), line: true },
        ...layers.map((l) => ({ label: l.label, slot: l.slot, hatch: l.hatch, value: energy(kwhOf(days[i]!, l.key)) })),
      ]}
      x={X} aria={`Daily energy supply, ${rangeLabel}`}>
      <text x={L - 10} y={T - 8} className="eg-axis eg-axis--unit" textAnchor="end">MWh</text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v ? 'eg-gridline' : 'eg-baseline'} />
          <text x={L - 10} y={Y(v) + 4} className="eg-axis" textAnchor="end">{inr(v, step < 1 ? 1 : 0)}</text>
        </g>
      ))}
      {days.map((d, i) => {
        let base = 0;
        return (
          <g key={d.date}>
            {layers.map((l) => {
              const v = kwhOf(d, l.key) / 1000;
              if (v <= 0) return null;
              const y0 = Y(base), y1 = Y(base + v); base += v;
              return <rect key={l.key} x={X(i) - bw / 2} y={y1} width={bw} height={Math.max(0.5, y0 - y1)}
                className={l.hatch ? 'ecv-tod__hatch' : `f-${l.slot} ecv-hist__area`} />;
            })}
            {d.blocks ? <line x1={X(i) - bw / 2 - 3} x2={X(i) + bw / 2 + 3} y1={Y(d.demandKwh / 1000)} y2={Y(d.demandKwh / 1000)} className="ecv-tod__demand" /> : null}
            {i % every === 0 || i === n - 1 ? (
              <text x={X(i)} y={H - 14} className="eg-axis" textAnchor="middle">{`${Number(d.date.slice(8))} ${MO[Number(d.date.slice(5, 7)) - 1]}`}</text>
            ) : null}
          </g>
        );
      })}
    </Hover>
  );
}

// ---------------------------------------------------------------------------- shared hover layer
type Row = { label: string; value: string; slot?: string; hatch?: boolean; line?: boolean };
function Hover({ n, x, label, rows, aria, children }: {
  n: number; x: (i: number) => number; label: (i: number) => string; rows: (i: number) => Row[] | null; aria: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState<number | null>(null);
  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((clientX - box.left) / box.width) * W;
    const k = Math.floor(((vx - L) / PW) * n);
    setI(k >= 0 && k < n ? k : null);
  };
  const r = i !== null ? rows(i) : null;
  const leftPct = i !== null ? (x(i) / W) * 100 : 0;
  return (
    <div className="ecv-hist__plot" ref={ref} tabIndex={0} aria-label={`${aria}. Use the left and right arrow keys to read values.`}
      onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setI(null)} onBlur={() => setI(null)}
      onTouchStart={(e) => pick(e.touches[0]!.clientX)} onTouchMove={(e) => pick(e.touches[0]!.clientX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setI((v) => Math.min(n - 1, (v ?? -1) + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setI((v) => Math.max(0, (v ?? n) - 1)); }
        if (e.key === 'Escape') setI(null);
      }}>
      <svg className="eg-svg ecv-hist__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        {children}
        {i !== null ? <line x1={x(i)} x2={x(i)} y1={T} y2={T + PH} className="ecv-hist__guide" /> : null}
      </svg>
      {i !== null ? (
        <div className={'ecv-sv__tip ecv-hist__tip' + (leftPct > 62 ? ' is-flip' : '')} role="status"
          style={leftPct > 62 ? { right: `${100 - leftPct + 1.5}%`, top: 8 } : { left: `${leftPct + 1.5}%`, top: 8 }}>
          <div className="ecv-sv__date">{label(i)}</div>
          {r ? (
            <dl className="ecv-sv__rows">
              {r.map((row) => (
                <div key={row.label}>
                  <dt>{row.line ? <span className="eg-swatch eg-swatch--line" /> : <span className={'eg-swatch' + (row.hatch ? ' ecv-swatch-hatch' : '')} data-series={row.slot} />}{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : <div className="eg-muted ecv-hist__nodata">No data yet</div>}
        </div>
      ) : null}
    </div>
  );
}

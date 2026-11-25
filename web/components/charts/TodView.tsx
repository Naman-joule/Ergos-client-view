'use client';
import { useMemo, useState } from 'react';
import { inr, rupees } from '@/lib/format';
import { runStats, type RunStats, type TodInput } from '@/lib/tod';
import type { SeriesKey } from '@/lib/ui/ergos';

// ToD view: one bar per contiguous ToD run (Off-peak 00:00–05:00, Normal 05:00–11:00, …), bar width
// proportional to its hours, height = average kW, stacked by source, with MWh labels in the
// segments, the run's demand as a line, and surplus solar striped on top. Hover a run to read it;
// click to pin. Drawn with design-system fill classes and tokens, so colours match the timeline.

import type { TodSource as TodSourceInfo } from '@/lib/queries/today';
export type { TodSourceInfo };

const energy = (mwh: number) => (mwh >= 1 ? `${inr(mwh, 1)} MWh` : `${inr(mwh * 1000)} kWh`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sourceNote(src: TodSourceInfo | null | undefined, date: string): string | null {
  if (!src) return null;
  const sameMonth = Number(date.slice(0, 4)) === src.year && Number(date.slice(5, 7)) === src.month;
  // exact matches need no note: the regulatory master for the plant's DISCOM + category, or the plant's own rows
  const where = src.kind === 'plant' || src.kind === 'master' ? null
    : src.kind === 'master_discom' ? 'the DISCOM’s schedule for another category'
    : src.kind === 'master_state' || src.kind === 'state' ? 'another DISCOM in the state'
    : 'the DISCOM schedule';
  const when = sameMonth ? null : `${MONTHS[src.month - 1]} ${src.year}`;
  if (!where && !when) return null;
  return `ToD periods from ${[where, when && `for ${when}`].filter(Boolean).join(' ')}${when ? ' (latest available)' : ''}.`;
}

function note(part: RunStats['parts'][number]): string {
  if (part.key === 'surplus') return part.mwh > 0 ? 'beyond demand' : 'none';
  if (part.key === 'bank') return part.mwh > 0 ? 'drawn from bank' : 'not drawn';
  if (part.mwh <= 0) return part.key === 'iex' ? 'not purchased' : part.key === 'solar' ? 'no generation' : '—';
  return part.rate != null ? `@ ₹${part.rate.toFixed(2)}/kWh` : part.key === 'solar' ? 'captive' : '—';
}

type TodViewProps = { dayLabel: string; date: string; isToday: boolean; source?: TodSourceInfo | null } & (
  | (TodInput & { runs?: undefined; days?: undefined })
  // History: stats already summed over `days` days (lib/tod rangeRunStats)
  | { runs: RunStats[]; days: number; now?: undefined }
);

export function TodView(input: TodViewProps) {
  const runs = useMemo(() => input.runs ?? runStats(input as TodInput), [input]);
  const days = input.days ?? 1;
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  if (!runs.length) {
    return (
      <div className="ecv-empty" role="status">
        <div><b>No ToD schedule for this plant</b>
          <p className="eg-muted">No DISCOM ToD tariff was found for this plant, its DISCOM or its state, so blocks can’t be grouped by ToD.</p></div>
      </div>
    );
  }

  // default: the run in progress today, else the run with the most demand
  const live = input.isToday && input.now != null ? runs.findIndex((r) => r.start <= input.now! && input.now! <= r.end) : -1;
  const biggest = runs.reduce((bi, r, i) => (r.demand > runs[bi]!.demand ? i : bi), 0);
  const activeIdx = hover ?? pinned ?? (live >= 0 ? live : biggest);
  const active = runs[activeIdx]!;

  // geometry (viewBox units; the SVG scales to the card width)
  const W = 1000, H = 340, L = 58, R = 12, T = 34, B = 58;
  const pw = W - L - R, ph = H - T - B;
  const X = (block: number) => L + (block / 96) * pw;
  const avgKw = (mwh: number, r: RunStats) => (r.blocksDone ? (mwh * 1000) / (r.blocksDone / 4) : 0);
  const peak = Math.max(1, ...runs.flatMap((r) => [avgKw(r.parts.reduce((s, p) => s + p.mwh, 0), r), avgKw(r.demand, r)]));
  const rawStep = peak / 3, mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rawStep) ?? rawStep;
  const yMax = step * Math.ceil((peak * 1.12) / step);
  const Y = (kw: number) => T + ph - (kw / yMax) * ph;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  // tick labels at run boundaries, dropping any that would collide (keep 00:00 and 24:00)
  const bounds = [...new Set(runs.flatMap((r) => [r.start, r.end + 1]))].sort((a, b) => a - b)
    .filter((b, i, all) => b === 0 || b === 96 || ((b - (all[i - 1] ?? -99)) * pw / 96 >= 52 && ((96 - b) * pw / 96 >= 52)));

  const srcNote = sourceNote(input.source, input.date);

  return (
    <div className="ecv-tod">
      {/* readout for the hovered / pinned run */}
      <div className="eg-readout ecv-tod__readout" aria-live="polite">
        <div className="eg-readout__when">
          <b>{active.label} · {active.from}–{active.to}</b>
          <span>{inr(active.hours, active.hours % 1 ? 2 : 0)} h · {active.blocks} blocks{days > 1 ? ` · ${days} days` : ''}{days === 1 && active.blocksDone < active.blocks && !active.future ? ` · ${active.blocksDone} so far` : ''}{active.future ? ' · not started' : ''}{pinned === activeIdx ? ' · pinned' : ''}</span>
          {pinned !== null ? <button type="button" className="ecv-tod__unpin" onClick={() => setPinned(null)} aria-label="Unpin period">×</button> : null}
        </div>
        <div className="eg-readout__items">
          <div className="eg-readout__item">
            <span className="eg-readout__label"><span className="eg-swatch eg-swatch--line" />Demand</span>
            <span className="eg-readout__value">{energy(active.demand)}</span>
          </div>
          {active.parts.map((p) => (
            <div key={p.key} className="eg-readout__item">
              <span className="eg-readout__label"><span className={'eg-swatch' + (p.hatch ? ' ecv-swatch-hatch' : '')} data-series={p.slot} />{p.label}</span>
              <span className="eg-readout__value">{energy(p.mwh)}</span>
              <span className="eg-readout__note">{note(p)}</span>
            </div>
          ))}
        </div>
        <div className="ecv-tod__summary">
          <div><span>Supply</span><b>{energy(active.supply)}</b></div>
          <div><span>Avg price</span><b>{active.avgPrice != null ? `₹${active.avgPrice.toFixed(2)}/kWh` : '—'}</b></div>
          <div><span>Cost</span><b>{active.cost ? rupees(active.cost) : '—'}</b></div>
          <div><span>Balance</span><b className={active.balance.kind === 'short' ? 'ecv-neg' : ''}>
            {active.balance.kind === 'balanced' ? 'Balanced' : active.balance.kind === 'excess' ? `+${energy(active.balance.mwh)} over`
              : active.balance.kind === 'short' ? `${energy(active.balance.mwh)} short` : '—'}</b></div>
        </div>
      </div>

      <svg className="eg-svg ecv-tod__svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Energy by ToD period on ${input.dayLabel}: average kW per period, stacked by source`}
        onMouseLeave={() => setHover(null)}>
        <text x={L - 10} y={T - 14} className="eg-axis eg-axis--unit" textAnchor="end">avg kW</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v ? 'eg-gridline' : 'eg-baseline'} />
            <text x={L - 10} y={Y(v) + 4} className="eg-axis" textAnchor="end">{inr(v)}</text>
          </g>
        ))}

        {runs.map((r, ri) => {
          const x0 = X(r.start) + 1.5, x1 = X(r.end + 1) - 1.5, w = Math.max(1, x1 - x0);
          const dim = activeIdx !== ri ? ' is-dim' : '';
          let base = 0;
          const demandKw = avgKw(r.demand, r);
          return (
            <g key={`${r.key}-${r.start}`} className={'ecv-tod__run' + dim}>
              {r.future ? <rect x={x0} y={T} width={w} height={ph} className="ecv-tod__future" /> : null}
              {r.parts.map((p) => {
                const h = avgKw(p.mwh, r);
                if (h <= 0) return null;
                const y0 = Y(base), y1 = Y(base + h);
                base += h;
                const tall = y0 - y1 >= 16 && w >= 46;
                return (
                  <g key={p.key}>
                    <rect x={x0} y={y1} width={w} height={Math.max(0.5, y0 - y1)}
                      className={p.hatch ? 'ecv-tod__hatch' : `f-${p.slot as SeriesKey} ecv-tod__seg`} />
                    {tall ? <text x={x0 + 6} y={y0 - 6} className="ecv-tod__seglabel">{energy(p.mwh)}</text> : null}
                  </g>
                );
              })}
              {r.demand > 0 ? (
                <>
                  <line x1={x0} x2={x1} y1={Y(demandKw)} y2={Y(demandKw)} className="ecv-tod__demand" />
                  {w >= 24 ? <text x={(x0 + x1) / 2} y={Y(Math.max(demandKw, base)) - 7} className="eg-axis eg-axis--strong" textAnchor="middle">{energy(r.demand)}</text> : null}
                </>
              ) : null}
              {/* period label under every bar; narrow bars at the edges are anchored inward so they don't clip */}
              <text x={r.end >= 95 && w < 90 ? x1 + 4 : r.start === 0 && w < 90 ? x0 : (x0 + x1) / 2} y={H - 14}
                className={'eg-axis eg-axis--strong' + (w < 90 ? ' ecv-tod__label--sm' : '')}
                textAnchor={r.end >= 95 && w < 90 ? 'end' : r.start === 0 && w < 90 ? 'start' : 'middle'}>
                {w >= 12 ? `${r.label} · ${inr(r.hours, r.hours % 1 ? 2 : 0)} h` : ''}
              </text>
              {/* hit area: hover to read, click to pin */}
              <rect x={x0} y={T} width={w} height={ph + 26} className="ecv-tod__hit" tabIndex={0}
                aria-label={`${r.label} ${r.from}–${r.to}: demand ${energy(r.demand)}`}
                onMouseEnter={() => setHover(ri)} onFocus={() => setHover(ri)} onBlur={() => setHover(null)}
                onClick={() => setPinned(pinned === ri ? null : ri)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(pinned === ri ? null : ri); } }} />
            </g>
          );
        })}

        {bounds.map((b) => (
          <text key={b} x={X(b)} y={H - 34} className="eg-axis" textAnchor={b === 0 ? 'start' : b === 96 ? 'end' : 'middle'}>
            {b === 96 ? '24:00' : `${String(Math.floor(b / 4)).padStart(2, '0')}:${String((b % 4) * 15).padStart(2, '0')}`}
          </text>
        ))}
      </svg>
      <p className="eg-card__sub ecv-footnote">
        Bar width is the period’s duration; height is average kW; labels are energy. Costs use the IEX landed rate, the DISCOM ToD rate for the plant’s voltage level plus FPPCA, and the solar tariff where known.{srcNote ? ` ${srcNote}` : ''}
      </p>
    </div>
  );
}

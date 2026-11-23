'use client';
import { useRef, useState } from 'react';
import { inr, rupees } from '@/lib/format';
import { useErgosDraw } from './useErgos';

// Daily savings bars + volume line (drawn by the design-system runtime), with a hover layer on top:
// a highlight on the hovered day and a card with the day's numbers. Works with mouse, touch and keyboard.

export interface SavingsDay {
  label: string;            // full date, e.g. "Thu, 22 Oct 2026"
  savings: number;          // actual net savings (may be negative; the bar is drawn at 0)
  volume: number;           // kWh
  landed: number | null;    // ₹/kWh
  grid: number | null;      // ₹/kWh benchmark
  pct: number | null;       // % below grid
  locked: boolean;
}

// must match savingsChart() in the runtime
const L = 56, R = 52, T = 28, B = 30;

export function SavingsChart({ labels, savings, volume, days, height = 320 }: {
  labels: string[]; savings: number[]; volume: number[]; days?: SavingsDay[]; height?: number;
}) {
  const ref = useErgosDraw((E, host) => E.savingsChart(host, { labels, savings, volume, height }), JSON.stringify([labels, savings, volume, height]));
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = savings.length;

  const geometry = () => {
    const w = wrap.current?.clientWidth ?? 0;
    return { w, slot: (w - L - R) / Math.max(1, n) };
  };
  const pick = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || !n) return;
    const { slot } = geometry();
    const i = Math.floor((clientX - box.left - L) / slot);
    setHover(i >= 0 && i < n ? i : null);
  };

  const { w, slot } = geometry();
  const d = hover !== null && days ? days[hover] : null;
  const cx = hover !== null ? L + slot * (hover + 0.5) : 0;
  const flip = cx > w * 0.62;                 // keep the card inside the chart

  return (
    <div className="ecv-sv" ref={wrap}
      onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHover(null)}
      onTouchStart={(e) => pick(e.touches[0]!.clientX)} onTouchMove={(e) => pick(e.touches[0]!.clientX)}
      tabIndex={days ? 0 : -1} aria-label="Daily savings chart. Use the left and right arrow keys to read each day."
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((h) => Math.max(0, (h ?? n) - 1)); }
        if (e.key === 'Escape') setHover(null);
      }}
      onBlur={() => setHover(null)}>
      <div ref={ref} className="eg-chart" />
      {hover !== null ? (
        <div className="ecv-sv__band" style={{ left: L + slot * hover, width: slot, top: T - 8, height: height - T - B + 8 }} aria-hidden="true" />
      ) : null}
      {d ? (
        <div className={'ecv-sv__tip' + (flip ? ' is-flip' : '')} role="status"
          style={{ left: flip ? undefined : cx + slot / 2 + 8, right: flip ? w - (cx - slot / 2 - 8) : undefined, top: T }}>
          <div className="ecv-sv__date">{d.label}{d.locked ? null : <span className="eg-chip eg-chip--warning">Not locked</span>}</div>
          <div className="ecv-sv__big">
            <span className={d.savings < 0 ? 'ecv-neg' : ''}>{d.savings < 0 ? '−' : ''}{rupees(Math.abs(d.savings))}</span>
            <small>{d.savings < 0 ? 'above grid' : 'net saved'}</small>
          </div>
          <dl className="ecv-sv__rows">
            <div><dt><span className="eg-swatch ecv-swatch-line" data-series="grid" />Volume cleared</dt><dd>{inr(d.volume)} kWh</dd></div>
            <div><dt>IEX landed</dt><dd>{d.landed != null ? `₹${d.landed.toFixed(4)}/kWh` : '—'}</dd></div>
            <div><dt>Grid benchmark</dt><dd>{d.grid ? `₹${d.grid.toFixed(4)}/kWh` : '—'}</dd></div>
            <div><dt>Below grid</dt><dd>{d.pct != null && d.grid ? `${d.pct.toFixed(1)}%` : '—'}</dd></div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

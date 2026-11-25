'use client';
import { useRef, useState } from 'react';

// Multi-line chart (one line per series) on design-system tokens, with a hover / touch / keyboard readout.
// Used by IEX prices: 96 blocks of clearing price per market, and the 30-day daily averages.

export interface LineSeries { key: string; label: string; slot: string; values: (number | null)[]; dashed?: boolean }
export interface TipRow { label: string; value: string; slot?: string }

const W = 1000, H = 310, L = 58, R = 14, T = 32, B = 40;
const PW = W - L - R, PH = H - T - B;

function niceRange(lo: number, hi: number): { min: number; max: number; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 0.25 };
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const min = Math.max(0, Math.floor(lo / step) * step);
  return { min, max: Math.ceil(hi / step) * step, step };
}

export function LineChart({ series, xLabel, ticks, unit, fmt, title, extra, aria }: {
  series: LineSeries[]; xLabel: (i: number) => string; ticks: { i: number; label: string }[];
  unit: string; fmt: (v: number) => string; title?: (i: number) => string; extra?: (i: number) => TipRow[]; aria: string;
}) {
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const { min, max, step } = niceRange(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1);
  const X = (i: number) => L + (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const Y = (v: number) => T + PH - ((v - min) / (max - min || 1)) * PH;
  const yTicks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, k) => min + k * step);
  const path = (vals: (number | null)[]) => vals.reduce<string>((d, v, i) => (v == null ? d : d + `${d && vals[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`), '');

  const ref = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((clientX - box.left) / box.width) * W;
    const k = Math.round(((vx - L) / PW) * (n - 1));
    setHi(k >= 0 && k < n ? k : null);
  };
  const leftPct = hi != null ? (X(hi) / W) * 100 : 0;

  return (
    <div className="ecv-hist__plot" ref={ref} tabIndex={0} aria-label={`${aria}. Use the left and right arrow keys to read values.`}
      onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHi(null)} onBlur={() => setHi(null)}
      onTouchStart={(e) => pick(e.touches[0]!.clientX)} onTouchMove={(e) => pick(e.touches[0]!.clientX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setHi((v) => Math.min(n - 1, (v ?? -1) + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setHi((v) => Math.max(0, (v ?? n) - 1)); }
        if (e.key === 'Escape') setHi(null);
      }}>
      <svg className="eg-svg ecv-hist__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        <text x={L - 10} y={T - 16} className="eg-axis eg-axis--unit" textAnchor="end">{unit}</text>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v === min ? 'eg-baseline' : 'eg-gridline'} />
            <text x={L - 10} y={Y(v) + 4} className="eg-axis" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {ticks.map((t) => <text key={t.i} x={X(t.i)} y={H - 12} className="eg-axis" textAnchor="middle">{t.label}</text>)}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} className={`s-${s.slot} ecv-line${s.dashed ? ' ecv-line--dashed' : ''}`} fill="none" />
        ))}
        {hi != null ? (
          <g>
            <line x1={X(hi)} x2={X(hi)} y1={T} y2={T + PH} className="ecv-hist__guide" />
            {series.map((s) => (s.values[hi] != null ? <circle key={s.key} cx={X(hi)} cy={Y(s.values[hi]!)} r={4} className={`f-${s.slot} ecv-line__dot`} /> : null))}
          </g>
        ) : null}
      </svg>
      {hi != null ? (
        <div className={'ecv-sv__tip ecv-hist__tip' + (leftPct > 60 ? ' is-flip' : '')} role="status"
          style={leftPct > 60 ? { right: `${100 - leftPct + 1.5}%`, top: 6 } : { left: `${leftPct + 1.5}%`, top: 6 }}>
          <div className="ecv-sv__date">{title ? title(hi) : xLabel(hi)}</div>
          <dl className="ecv-sv__rows">
            {series.map((s) => (
              <div key={s.key}><dt><span className="eg-swatch" data-series={s.slot} />{s.label}</dt><dd>{s.values[hi] != null ? fmt(s.values[hi]!) : '—'}</dd></div>
            ))}
            {(extra?.(hi) ?? []).map((r) => (
              <div key={r.label} className="ecv-line__extra"><dt>{r.slot ? <span className="eg-swatch" data-series={r.slot} /> : null}{r.label}</dt><dd>{r.value}</dd></div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

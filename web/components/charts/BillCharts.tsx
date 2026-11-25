'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@/lib/format';

// Billing charts: stacked cost columns by source (₹, left axis) with the average ₹/kWh as a line (right axis).
// Months: one column per month; click opens that month's breakdown. Days: one column per day of a month.

export interface CostPart { key: string; label: string; slot: string; value: number; kwh: number }
export interface CostColumn { id: string; label: string; title: string; parts: CostPart[]; rate: number | null; demandKwh: number; href?: string; empty?: boolean }

const W = 1000, H = 320, L = 74, R = 60, T = 34, B = 40;
const PW = W - L - R, PH = H - T - B;

function nice(v: number): { max: number; step: number } {
  const raw = Math.max(v, 1e-6) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { max: step * Math.max(1, Math.ceil((v * 1.06) / step)), step };
}
/** ₹ in Indian short form for axes: 85 L, 1.2 Cr */
export function shortRs(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)} L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return `₹${Math.round(v)}`;
}

export function CostColumns({ columns, selected, aria, lineLabel = 'Average ₹/kWh', clickHint }: {
  columns: CostColumn[]; selected?: string; aria: string; lineLabel?: string; clickHint?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [hi, setHi] = useState<number | null>(null);
  const n = Math.max(columns.length, 1);
  const total = (c: CostColumn) => c.parts.reduce((s, p) => s + p.value, 0);
  const { max, step } = nice(Math.max(...columns.map(total), 1));
  const rates = columns.map((c) => c.rate).filter((r): r is number => r != null);
  const rTop = rates.length ? Math.max(...rates) * 1.15 : 10;
  const { max: rMax, step: rStep } = nice(rTop);
  const rTicks = Array.from({ length: Math.round(rMax / rStep) + 1 }, (_, k) => k * rStep);
  const slot = PW / n, bw = Math.max(4, Math.min(64, slot * 0.58));
  const X = (i: number) => L + slot * (i + 0.5);
  const Y = (v: number) => T + PH - (v / max) * PH;
  const YR = (r: number) => T + PH - (r / rMax) * PH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step);
  const line = columns.reduce<string>((d, c, i) => (c.rate == null ? d : d + `${d && columns[i - 1]?.rate != null ? 'L' : 'M'}${X(i)},${YR(c.rate)}`), '');
  const every = Math.ceil(n / 16);

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const k = Math.floor((((clientX - box.left) / box.width) * W - L) / slot);
    setHi(k >= 0 && k < n ? k : null);
  };
  const c = hi != null ? columns[hi] : null;
  const leftPct = hi != null ? (X(hi) / W) * 100 : 0;

  return (
    <div className={'ecv-hist__plot' + (columns.some((x) => x.href) ? ' ecv-bill__clickable' : '')} ref={ref} tabIndex={0}
      aria-label={`${aria}. Use the left and right arrow keys to read values${clickHint ? `; Enter ${clickHint}` : ''}.`}
      onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHi(null)} onBlur={() => setHi(null)}
      onTouchStart={(e) => pick(e.touches[0]!.clientX)}
      onClick={() => { if (c?.href) router.push(c.href, { scroll: false }); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setHi((v) => Math.min(n - 1, (v ?? -1) + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setHi((v) => Math.max(0, (v ?? n) - 1)); }
        if (e.key === 'Enter' && c?.href) router.push(c.href, { scroll: false });
        if (e.key === 'Escape') setHi(null);
      }}>
      <svg className="eg-svg ecv-hist__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        <text x={L - 10} y={T - 16} className="eg-axis eg-axis--unit" textAnchor="end">Cost</text>
        <text x={W - R + 10} y={T - 16} className="eg-axis eg-axis--unit" textAnchor="start">₹/kWh</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v ? 'eg-gridline' : 'eg-baseline'} />
            <text x={L - 10} y={Y(v) + 4} className="eg-axis" textAnchor="end">{shortRs(v)}</text>
          </g>
        ))}
        {rTicks.map((r) => <text key={r} x={W - R + 10} y={YR(r) + 4} className="eg-axis" textAnchor="start">{r.toFixed(rStep % 1 ? 1 : 0)}</text>)}
        {columns.map((col, i) => {
          let base = 0;
          const isSel = selected === col.id;
          return (
            <g key={col.id} className={'ecv-bill__col' + (selected && !isSel ? ' is-dim' : '') + (hi === i ? ' is-hi' : '')}>
              {isSel ? <rect x={X(i) - slot / 2 + 2} y={T - 6} width={slot - 4} height={PH + 6} rx={8} className="ecv-bill__sel" /> : null}
              {col.parts.map((p) => {
                if (p.value <= 0) return null;
                const y0 = Y(base), y1 = Y(base + p.value); base += p.value;
                return <rect key={p.key} x={X(i) - bw / 2} y={y1} width={bw} height={Math.max(0.6, y0 - y1)} className={`f-${p.slot} ecv-hist__area`} />;
              })}
              {n <= 14 && total(col) > 0 ? <text x={X(i)} y={Y(total(col)) - 6} className="eg-axis eg-axis--strong" textAnchor="middle">{shortRs(total(col))}</text> : null}
              {i % every === 0 || i === n - 1 ? <text x={X(i)} y={H - 14} className={'eg-axis' + (isSel ? ' eg-axis--strong' : '')} textAnchor="middle">{col.label}</text> : null}
            </g>
          );
        })}
        <path d={line} className="ecv-bill__rateline" fill="none" />
        {columns.map((col, i) => (col.rate != null ? <circle key={col.id} cx={X(i)} cy={YR(col.rate)} r={3.5} className="ecv-bill__ratedot" /> : null))}
      </svg>
      {c ? (
        <div className={'ecv-sv__tip ecv-hist__tip' + (leftPct > 58 ? ' is-flip' : '')} role="status"
          style={leftPct > 58 ? { right: `${100 - leftPct + 2}%`, top: 6 } : { left: `${leftPct + 2}%`, top: 6 }}>
          <div className="ecv-sv__date">{c.title}</div>
          {c.empty ? <div className="eg-muted ecv-hist__nodata">No meter data</div> : (
            <>
              <div className="ecv-sv__big"><span>₹{inr(Math.round(total(c)))}</span><small>{c.rate != null ? `₹${c.rate.toFixed(2)}/kWh` : ''}</small></div>
              <dl className="ecv-sv__rows">
                {c.parts.map((p) => (
                  <div key={p.key}>
                    <dt><span className="eg-swatch" data-series={p.slot} />{p.label}</dt>
                    <dd>₹{inr(Math.round(p.value))} <small className="ecv-bill__tipkwh">{inr(Math.round(p.kwh / 1000))} MWh</small></dd>
                  </div>
                ))}
                <div><dt><span className="eg-swatch ecv-bill__rateswatch" />{lineLabel}</dt><dd>{c.rate != null ? `₹${c.rate.toFixed(4)}` : '—'}</dd></div>
              </dl>
              {c.href && selected !== c.id ? <div className="ecv-bill__tiphint">Click to see how this month is calculated</div> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

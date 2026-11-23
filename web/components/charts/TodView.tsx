'use client';
import { inr } from '@/lib/format';
import type { SeriesKey } from '@/lib/ui/ergos';
import { todPeriods, type TodInput } from '@/lib/tod';

// Energy per DISCOM ToD period (Off-peak / Normal / Peak) as stacked bars, built from the same
// per-block series as the timeline. Drawn with design-system fill classes (f-<slot>), axis styles
// and the shared surplus stripe pattern, so the colours match the timeline.

export function TodView(input: TodInput & { dayLabel: string }) {
  const periods = todPeriods(input);
  if (!periods.length) {
    return (
      <div className="ecv-empty" role="status">
        <div><b>No ToD schedule for this plant and month</b>
          <p className="eg-muted">The DISCOM ToD tariff (state_grid_discom_tariff) has no rows for this month, so blocks can't be grouped by ToD.</p></div>
      </div>
    );
  }

  // geometry
  const W = 900, H = 300, L = 56, R = 16, T = 30, B = 56;
  const pw = W - L - R, ph = H - T - B;
  const top = Math.max(...periods.map((p) => p.parts.reduce((s, x) => s + x.mwh, 0)), 0.001);
  const stepRaw = top / 4, mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= stepRaw) ?? stepRaw;
  const yMax = step * Math.ceil((top * 1.08) / step);
  const Y = (v: number) => T + ph - (v / yMax) * ph;
  const slot = pw / periods.length, bw = Math.min(120, slot * 0.46);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const fmt = (v: number) => (v >= 10 ? inr(v, 1) : inr(v, 2));

  return (
    <div className="ecv-tod">
      <svg className="eg-svg ecv-tod__svg" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Energy by ToD period on ${input.dayLabel}, MWh by source`}>
        <text x={L - 10} y={T - 14} className="eg-axis eg-axis--unit" textAnchor="end">MWh</text>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v ? 'eg-gridline' : 'eg-baseline'} />
            <text x={L - 10} y={Y(v) + 4} className="eg-axis" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {periods.map((p, pi) => {
          const cx = L + slot * (pi + 0.5), x = cx - bw / 2;
          let base = 0;
          const total = p.parts.reduce((s, x2) => s + x2.mwh, 0);
          return (
            <g key={p.key}>
              {p.parts.map((part) => {
                if (part.mwh <= 0) return null;
                const y0 = Y(base), y1 = Y(base + part.mwh);
                base += part.mwh;
                return (
                  <rect key={part.key} x={x} y={y1} width={bw} height={Math.max(0.5, y0 - y1)} rx={3}
                    className={part.hatch ? 'ecv-tod__hatch' : `f-${part.slot as SeriesKey} ecv-tod__seg`}>
                    <title>{`${p.label} · ${part.label}: ${inr(part.mwh, 2)} MWh`}</title>
                  </rect>
                );
              })}
              {/* demand marker: dotted line across the bar at total demand */}
              {p.demand > 0 ? <line x1={x - 8} x2={x + bw + 8} y1={Y(p.demand)} y2={Y(p.demand)} className="ecv-tod__demand" /> : null}
              <text x={cx} y={Y(total) - 8} className="eg-axis eg-axis--strong" textAnchor="middle">{fmt(p.demand)} MWh</text>
              <text x={cx} y={H - 32} className="eg-axis eg-axis--strong" textAnchor="middle">{p.label}</text>
              <text x={cx} y={H - 16} className="eg-axis" textAnchor="middle">{p.hours}</text>
            </g>
          );
        })}
      </svg>

      <div className="ecv-table-wrap">
        <table className="ecv-table">
          <thead>
            <tr>
              <th>ToD period</th><th className="num">Demand</th>
              {periods[0]!.parts.map((x) => <th key={x.key} className="num">{x.key === 'iex' ? 'IEX' : x.label}</th>)}
              <th className="num">IEX landed</th><th className="num">DISCOM rate</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.key}>
                <td className="ecv-tod__period"><b>{p.label}</b><small className="ecv-tod__hours">{p.hours}</small>
                  <small className="ecv-tod__hours">{p.blocksDone === p.blocks ? `${p.blocks} blocks` : `${p.blocksDone} of ${p.blocks} blocks so far`}</small></td>
                <td className="num">{inr(p.demand, 2)}</td>
                {p.parts.map((x) => <td key={x.key} className="num">{inr(x.mwh, 2)}</td>)}
                <td className="num">{p.iexRate !== null ? p.iexRate.toFixed(2) : '—'}</td>
                <td className="num">{p.gridRate !== null ? p.gridRate.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="eg-card__sub ecv-footnote">Energy in MWh, up to the latest block. Rates in ₹/kWh: IEX landed is volume-weighted; DISCOM rate is the ToD tariff for the plant's voltage level plus FPPCA, averaged over the period's blocks.</p>
    </div>
  );
}

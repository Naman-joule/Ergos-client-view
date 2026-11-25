import { inr } from '@/lib/format';
import { todName } from '@/lib/tod';
import type { RunStats } from '@/lib/tod';
import type { BillMonth } from '@/lib/queries/billing';

// "How this month's bill is calculated", as a visual sum: one row per source (energy x rate = cost, bar sized by
// cost), the total and the average ₹/kWh; energy share vs cost share; and the grid cost split by ToD period.

const rs = (v: number) => `₹${inr(Math.round(v))}`;
const mwh = (kwh: number) => `${inr(kwh / 1000, kwh >= 100_000 ? 0 : 1)} MWh`;
const rate = (v: number | null) => (v != null ? `₹${v.toFixed(2)}/kWh` : '—');

export function BillBreakdown({ m, runs, monthLabel }: { m: BillMonth; runs: RunStats[] | undefined; monthLabel: string }) {
  const solarRate = m.solarUsedKwh > 0 && m.solarCostRs > 0 ? m.solarCostRs / m.solarUsedKwh : null;
  const rows = [
    { key: 'iex', slot: 'iex', label: 'Power exchange', kwh: m.iexKwh, rate: m.iexRate, cost: m.iexCostRs, note: 'Landed cost incl. open access charges, whole purchase' },
    { key: 'grid', slot: 'grid', label: 'Grid', kwh: m.gridKwh, rate: m.gridRate, cost: m.gridCostRs, note: 'DISCOM ToD rate for the voltage level + FPPCA, block by block' },
    { key: 'solar', slot: 'solar', label: 'Solar', kwh: m.solarUsedKwh, rate: solarRate, cost: m.solarCostRs, note: solarRate ? 'Solar used × solar tariff' : 'Captive solar, no tariff on record' },
    { key: 'bank', slot: 'battery', label: 'Banking', kwh: m.bankKwh, rate: m.bankKwh ? 0 : null, cost: 0, note: 'Energy drawn from the bank; banking charges aren’t in the synced data' },
  ].filter((r) => r.kwh > 0.5 || r.cost > 0.5);
  const max = Math.max(...rows.map((r) => r.cost), 1);

  // energy met vs cost, as shares of the month
  const energy = [
    { key: 'iex', slot: 'iex', label: 'Power exchange', v: m.iexUsedKwh },
    { key: 'solar', slot: 'solar', label: 'Solar', v: m.solarUsedKwh },
    { key: 'bank', slot: 'battery', label: 'Banking', v: m.bankKwh },
    { key: 'grid', slot: 'grid', label: 'Grid', v: m.gridKwh },
  ];
  const eTot = energy.reduce((s, e) => s + e.v, 0) || 1;
  const cost = rows.map((r) => ({ key: r.key, slot: r.slot, label: r.label, v: r.cost }));
  const cTot = m.totalCostRs || 1;

  // grid (and IEX) by ToD period: Peak / Normal / Off-peak summed over the month's runs
  const byPeriod = new Map<string, { label: string; hours: number; grid: number; gridCost: number; iex: number; iexCost: number }>();
  for (const r of runs ?? []) {
    const key = r.key.replace(/\d+$/, '');
    const g = r.parts.find((p) => p.key === 'grid'), x = r.parts.find((p) => p.key === 'iex');
    const cur = byPeriod.get(key) ?? { label: todName(key), hours: 0, grid: 0, gridCost: 0, iex: 0, iexCost: 0 };
    cur.hours += r.hours; cur.grid += (g?.mwh ?? 0) * 1000; cur.gridCost += g?.cost ?? 0; cur.iex += (x?.mwh ?? 0) * 1000; cur.iexCost += x?.cost ?? 0;
    byPeriod.set(key, cur);
  }
  const order = ['PEAK', 'NORMAL', 'OFFPEAK'];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : 9);
  const periods = [...byPeriod.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, v]) => v);
  const pMax = Math.max(...periods.map((p) => p.gridCost), 1);

  return (
    <div className="ecv-bill">
      <div className="ecv-bill__sum" role="table" aria-label={`How the ${monthLabel} bill is calculated`}>
        <div className="ecv-bill__row ecv-bill__row--head" role="row">
          <span role="columnheader">Source</span><span role="columnheader" className="num">Energy</span><span role="columnheader" />
          <span role="columnheader" className="num">Rate</span><span role="columnheader" />
          <span role="columnheader" className="num">Cost</span><span role="columnheader">Share of the bill</span>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="ecv-bill__row" role="row" title={r.note}>
            <span role="cell" className="ecv-bill__src"><span className="eg-swatch" data-series={r.slot} />{r.label}</span>
            <span role="cell" className="num">{mwh(r.kwh)}</span><span role="cell" className="ecv-bill__op">×</span>
            <span role="cell" className="num">{rate(r.rate)}</span><span role="cell" className="ecv-bill__op">=</span>
            <span role="cell" className="num"><b>{rs(r.cost)}</b></span>
            <span role="cell" className="ecv-bill__barcell">
              <span className="ecv-bill__bar"><span className="ecv-bill__fill" style={{ width: `${(r.cost / max) * 100}%`, background: `var(--c-${r.slot})` }} /></span>
              <small>{m.totalCostRs ? `${Math.round((r.cost / m.totalCostRs) * 100)}%` : '—'}</small>
            </span>
          </div>
        ))}
        <div className="ecv-bill__row ecv-bill__row--total" role="row">
          <span role="cell">Energy bill</span><span role="cell" className="num">{mwh(m.demandKwh)}</span><span role="cell" className="ecv-bill__op">×</span>
          <span role="cell" className="num">{rate(m.avgRate)}</span><span role="cell" className="ecv-bill__op">=</span>
          <span role="cell" className="num"><b>{rs(m.totalCostRs)}</b></span>
          <span role="cell" className="eg-muted ecv-bill__totnote">Demand × average rate. IEX bought beyond demand is still paid for, so source energy can add up to more than demand.</span>
        </div>
      </div>

      <div className="ecv-bill__split">
        <ShareBar title="Where the energy came from" parts={energy.map((e) => ({ ...e, pct: (e.v / eTot) * 100, text: mwh(e.v) }))} />
        <ShareBar title="Where the money went" parts={cost.map((c) => ({ ...c, pct: (c.v / cTot) * 100, text: rs(c.v) }))} />
      </div>

      {periods.length ? (
        <div className="ecv-bill__tod">
          <div className="ecv-bill__subhead">Grid cost by ToD period <span className="eg-muted">· kWh drawn from the grid in each period × that period’s DISCOM rate</span></div>
          {periods.map((p) => (
            <div key={p.label} className="ecv-bill__todrow">
              <span className="ecv-bill__todname">{p.label}<small>{inr(p.hours, p.hours % 1 ? 2 : 0)} h a day</small></span>
              <span className="num">{mwh(p.grid)}</span><span className="ecv-bill__op">×</span>
              <span className="num">{p.grid ? rate(p.gridCost / p.grid) : '—'}</span><span className="ecv-bill__op">=</span>
              <span className="num"><b>{rs(p.gridCost)}</b></span>
              <span className="ecv-bill__bar"><span className="ecv-bill__fill" style={{ width: `${(p.gridCost / pMax) * 100}%`, background: 'var(--c-grid)' }} /></span>
              <span className="eg-muted ecv-bill__todiex">{p.iex > 0.5 ? `IEX in this period: ${mwh(p.iex)} at ${rate(p.iexCost / p.iex)}` : 'No IEX in this period'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShareBar({ title, parts }: { title: string; parts: { key: string; slot: string; label: string; pct: number; text: string }[] }) {
  const shown = parts.filter((p) => p.pct > 0.05);
  return (
    <div className="ecv-share">
      <div className="ecv-bill__subhead">{title}</div>
      <div className="ecv-share__bar" role="img" aria-label={`${title}: ${shown.map((p) => `${p.label} ${Math.round(p.pct)}%`).join(', ')}`}>
        {shown.map((p) => <span key={p.key} style={{ width: `${p.pct}%`, background: `var(--c-${p.slot})` }} title={`${p.label} ${p.text}`} />)}
      </div>
      <div className="ecv-share__legend">
        {shown.map((p) => <span key={p.key}><span className="eg-swatch" data-series={p.slot} />{p.label} <b>{Math.round(p.pct)}%</b> <small>{p.text}</small></span>)}
      </div>
    </div>
  );
}

import { inr } from '@/lib/format';
import { todName } from '@/lib/tod';
import { blockEnd, blockStart } from '@/lib/time';
import { billTotal } from '@/lib/bill';
import type { BillMonth } from '@/lib/queries/billing';

// "How this month's bill is calculated", following ergOS's billing: energy × rate = cost for grid, solar and
// exchange (bars sized by cost), the bill and its average ₹/kWh, what banking saved and what an all-grid supply
// would have cost, energy vs cost shares, and the bill by ToD segment (ergOS tod_bill_breakdown).

const rs = (v: number) => `₹${inr(Math.round(v))}`;
const mwh = (kwh: number) => `${inr(kwh / 1000, kwh >= 100_000 ? 0 : 1)} MWh`;
const rate = (v: number | null) => (v != null ? `₹${v.toFixed(2)}/kWh` : '—');
const segLabel = (todType: string, key: string) => {
  const base = todName(todType.toUpperCase().replace(/[^A-Z]/g, '') || todType);
  const n = key.match(/_(\d+)$/)?.[1];
  return n ? `${base} ${n}` : base;
};
const segTime = (blocks: string) => {
  const [a, b] = blocks.split('-').map(Number);
  return a && b ? `${blockStart(a)}–${blockEnd(b)}` : blocks;
};

export function BillBreakdown({ m, monthLabel }: { m: BillMonth; monthLabel: string }) {
  const rows = [
    { key: 'grid', slot: 'grid', label: 'Grid', kwh: m.gridKwh, rate: m.gridRate, cost: m.gridCostRs,
      note: 'Grid kWh = demand − solar − banking − exchange, per block; priced at the DISCOM tariff × (1 + FPPCA%) × (1 + duty%)' },
    { key: 'iex', slot: 'iex', label: 'Power exchange', kwh: m.exchangeKwh, rate: m.exchangeRate, cost: m.exchangeCostRs,
      note: 'Cleared quantity × landed ₹/kWh, in blocks with a meter reading' },
    { key: 'solar', slot: 'solar', label: 'Solar', kwh: m.solarKwh, rate: m.solarRate, cost: m.solarCostRs,
      note: m.solarRate ? 'All solar from the mapped plant × solar tariff' : 'No solar tariff on record' },
  ].filter((r) => r.kwh > 0.5 || r.cost > 0.5);
  const max = Math.max(...rows.map((r) => r.cost), 1);
  const bill = m.totalCostRs;

  const energy = [
    { key: 'iex', slot: 'iex', label: 'Power exchange', v: m.exchangeKwh },
    { key: 'solar', slot: 'solar', label: 'Solar', v: m.solarKwh },
    { key: 'bank', slot: 'battery', label: 'Banking', v: m.bankKwh },
    { key: 'grid', slot: 'grid', label: 'Grid', v: m.gridKwh },
  ];
  const eTot = energy.reduce((s, e) => s + e.v, 0) || 1;
  const cost = rows.map((r) => ({ key: r.key, slot: r.slot, label: r.label, v: r.cost }));
  const segMax = Math.max(...m.segments.map((s) => billTotal(s)), 1);
  const vsGrid = m.allGridCostRs - bill;

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
              <small>{bill ? `${Math.round((r.cost / bill) * 100)}%` : '—'}</small>
            </span>
          </div>
        ))}
        <div className="ecv-bill__row ecv-bill__row--total" role="row">
          <span role="cell">Total bill</span><span role="cell" className="num">{mwh(m.demandKwh)}</span><span role="cell" className="ecv-bill__op">×</span>
          <span role="cell" className="num">{rate(m.avgRate)}</span><span role="cell" className="ecv-bill__op">=</span>
          <span role="cell" className="num"><b>{rs(bill)}</b></span>
          <span role="cell" className="eg-muted ecv-bill__totnote">Grid + power exchange + solar. Average power purchase price = bill ÷ demand.</span>
        </div>
      </div>

      <div className="ecv-bill__facts">
        <div><span>Cost saved by banking</span><b>{rs(m.bankSavedRs)}</b><small>{mwh(m.bankKwh)} drawn back × solar rate · not part of the bill</small></div>
        <div><span>Cost if all from grid</span><b>{rs(m.allGridCostRs)}</b><small>demand × grid rate in every block</small></div>
        <div><span>Saved vs all grid</span><b className={vsGrid < 0 ? 'ecv-neg' : 'ecv-pos'}>{vsGrid < 0 ? '−' : ''}{rs(Math.abs(vsGrid))}</b>
          <small>{m.allGridCostRs ? `${((vsGrid / m.allGridCostRs) * 100).toFixed(1)}% below an all-grid bill` : '—'}</small></div>
      </div>

      <div className="ecv-bill__split">
        <ShareBar title="Energy by source" parts={energy.map((e) => ({ ...e, pct: (e.v / eTot) * 100, text: mwh(e.v) }))} />
        <ShareBar title="Where the money went" parts={cost.map((c) => ({ ...c, pct: (c.v / (bill || 1)) * 100, text: rs(c.v) }))} />
      </div>

      {m.segments.length ? (
        <div className="ecv-bill__tod">
          <div className="ecv-bill__subhead">The bill by ToD segment <span className="eg-muted">· each contiguous ToD period of the day, summed over the month</span></div>
          <div className="ecv-seg__head"><span>Segment</span><span className="num">Demand</span><span className="num">Grid</span><span className="num">Exchange</span><span className="num">Solar</span><span className="num">Segment bill</span><span /></div>
          {m.segments.map((s) => {
            const tot = billTotal(s);
            const gridRate = s.gridKwh - s.gridUnpricedKwh > 0 ? s.gridCostRs / (s.gridKwh - s.gridUnpricedKwh) : null;
            return (
              <div key={s.key} className="ecv-seg__row">
                <span className="ecv-bill__todname">{segLabel(s.todType, s.key)}<small>{segTime(s.blocks)} · blocks {s.blocks}</small></span>
                <span className="num">{mwh(s.demandKwh)}</span>
                <span className="num">{rs(s.gridCostRs)}<small>{mwh(s.gridKwh)} @ {rate(gridRate)}</small></span>
                <span className="num">{rs(s.exchangeCostRs)}<small>{s.exchangeKwh > 0.5 ? `${mwh(s.exchangeKwh)} @ ${rate(s.exchangeCostRs / s.exchangeKwh)}` : 'none'}</small></span>
                <span className="num">{rs(s.solarCostRs)}<small>{mwh(s.solarKwh)}</small></span>
                <span className="num"><b>{rs(tot)}</b><small>{s.demandKwh ? rate(tot / s.demandKwh) : '—'}</small></span>
                <span className="ecv-bill__bar ecv-seg__bar">
                  {tot > 0 ? (['grid', 'iex', 'solar'] as const).map((k) => {
                    const v = k === 'grid' ? s.gridCostRs : k === 'iex' ? s.exchangeCostRs : s.solarCostRs;
                    return v > 0 ? <span key={k} style={{ width: `${(v / segMax) * 100}%`, background: `var(--c-${k})` }} /> : null;
                  }) : null}
                </span>
              </div>
            );
          })}
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

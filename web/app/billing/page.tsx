import type React from 'react';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { rememberedScope } from '@/lib/remembered';
import { lastReading } from '@/lib/queries/plant-load';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { BILLING_MONTH_CHOICES, loadBilling, resolveBillingMonths, type BillMonth } from '@/lib/queries/billing';
import { loadSpec } from '@/lib/dashboard/load';
import { istToday, currentBlock, formatDate, formatRange } from '@/lib/time';
import { inr, mwhValue, rupees } from '@/lib/format';
import { href, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Empty, Notice } from '@/components/ui/Empty';
import { isInternal } from '@/lib/audience';
import { Icon } from '@/components/ui/Icon';
import { StatTile } from '@/components/ui/StatTile';
import { CostColumns, type CostColumn } from '@/components/charts/BillCharts';
import { BillBreakdown } from '@/components/widgets/billing/BillBreakdown';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing & costing' };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const r4 = (v: number | null) => (v != null ? `₹${v.toFixed(2)}` : '—');

export default async function BillingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_billing');
  const sp = await searchParams;
  const months = resolveBillingMonths(sp.months);

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant }, await rememberedScope());
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    const [loaded, data] = await Promise.all([loadSpec(q, sel.client.client_id), loadBilling(q, sel.plant.plant_id, months)]);
    const dataTo = await lastReading(q, sel.plant.plant_id);
    return { scope, sel, lag, loaded, data, dataTo } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="billing" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, loaded, data } = view;
  const t = data.total;
  const range = formatRange(data.from, data.to);
  const unpriced = data.months.reduce((s, m) => s + m.gridUnpricedKwh, 0);

  // selected month: ?month=YYYY-MM, else the newest month with data
  const withData = data.months.filter((m) => m.daysWithData > 0);
  // months before the plant's first metered month are just empty columns: leave them out
  const firstMonth = withData.length ? withData[withData.length - 1]!.month : null;
  const shownMonths = firstMonth ? data.months.filter((m) => m.month >= firstMonth) : data.months;
  const trimmed = data.months.length - shownMonths.length;
  const sel_m = withData.find((m) => m.month === sp.month) ?? withData[0] ?? null;
  const monthHref = (month: string) => href('/billing', { client: sel.client.client_id, plant: sel.plant.plant_id, months, month }) + '#bill-month';
  const parts = (iex: number, iexKwh: number, grid: number, gridKwh: number, solar: number, solarKwh: number) => [
    { key: 'iex', label: 'Power exchange', slot: 'iex', value: iex, kwh: iexKwh },
    { key: 'grid', label: 'Grid', slot: 'grid', value: grid, kwh: gridKwh },
    { key: 'solar', label: 'Solar', slot: 'solar', value: solar, kwh: solarKwh },
  ];
  const monthCols: CostColumn[] = [...shownMonths].reverse().map((m) => ({
    id: m.month, label: monthLabel(m.month).replace(/ (\d{2})(\d{2})$/, " '$2"), title: `${monthLabel(m.month)}${m.partial ? ` · ${m.daysWithData} days so far` : ''}`,
    parts: parts(m.exchangeCostRs, m.exchangeKwh, m.gridCostRs, m.gridKwh, m.solarCostRs, m.solarKwh),
    rate: m.avgRate, demandKwh: m.demandKwh, href: m.daysWithData ? monthHref(m.month) : undefined, empty: !m.daysWithData,
  }));
  const today = istToday();
  const dayCols: CostColumn[] = sel_m ? data.days.filter((d) => d.date.startsWith(sel_m.month)).map((d) => ({
    id: d.date, label: String(Number(d.date.slice(8))), title: formatDate(d.date),
    parts: parts(d.exchangeCostRs, d.bill.exchangeKwh, d.gridCostRs, d.bill.gridKwh, d.solarCostRs, d.bill.solarKwh),
    rate: d.demandKwh ? d.totalCostRs / d.demandKwh : null, demandKwh: d.demandKwh, empty: !d.blocks,
    // a past day with under 90% of its 96 blocks metered: its bill is low because readings are missing
    note: d.blocks > 0 && d.blocks < 87 && d.date < today ? `Meter data incomplete: ${d.blocks} of 96 blocks` : undefined,
  })) : [];

  const internal = isInternal(user);
  return (
    <Shell user={user} page="billing" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode} dataTo={view.dataTo}>
      {!t.daysWithData ? <Notice>No meter data for {sel.plant.name} in the last {months} months{internal ? '. Check that the sync is running.' : ' yet.'}</Notice> : null}
      <details className="ecv-howcalc">
        <summary>Calculated from your meter readings, IEX trades and DISCOM tariffs. Your DISCOM and IEX invoices remain the official bills. <span>How is this calculated?</span></summary>
        <p>The same method as ergOS’s dashboard and bill, for every 15-minute block with a meter reading: IEX energy delivered = cleared energy less
          transmission losses; IEX cost = the trade’s landed cost plus cross-subsidy surcharge on the delivered energy. Grid energy = demand − solar − banked
          energy drawn − IEX energy delivered; grid cost = grid energy × DISCOM ToD rate × (1 + FPPCA). Solar cost = solar energy × solar tariff.
          Electricity duty, fixed and demand charges aren’t included. The Savings page uses ergOS’s daily savings statements instead, so its IEX cost can differ slightly.</p>
      </details>
      {internal && t.fallbackDays > 0 ? <Notice>ergOS has no tariff rows for {sel.plant.name} on {t.fallbackDays} day{t.fallbackDays === 1 ? '' : 's'}; those are priced with the regulatory ToD schedule instead.</Notice> : null}
      {unpriced > 0.5 ? <Notice>{inr(unpriced)} kWh from the grid fall in blocks with no DISCOM ToD rate, so they aren’t costed. The grid cost for those months is understated.</Notice> : null}
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant} denied={sel.denied}
        clientHref={(c) => href('/billing', { client: c.client_id, months })}
        plantHref={(p) => href('/billing', { client: sel.client.client_id, plant: p.plant_id, months })}
        controls={
          <form method="get" action="/billing" className="ecv-period">
            <input type="hidden" name="client" value={sel.client.client_id} />
            <input type="hidden" name="plant" value={sel.plant.plant_id} />
            <div className="eg-seg eg-seg--glass" role="group" aria-label="Months">
              {BILLING_MONTH_CHOICES.map((n) => (
                <button key={n} type="submit" name="months" value={n} aria-pressed={months === n}>Last {n} months</button>
              ))}
            </div>
            <a className="ecv-sheet ecv-sheet--excel ecv-export" download href={`/api/export/billing?plant=${sel.plant.plant_id}&months=${months}`}
              title="Excel: one row per month, and every day">
              <Icon name="download" size={14} />Download Excel
            </a>
          </form>
        } />

      <WidgetGrid palette={loaded.spec.theme.palette}>
        <WidgetCell span="full" type="billing.tiles">
          <div className="ecv-tiles-wrap">
            <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 4, '--n-md': 2 } as React.CSSProperties}>
              <StatTile series="demand" label="Total bill" icon="rupee" date={range} value={rupees(t.totalCostRs)} unit=""
                foot={`${t.daysWithData} days · banking saved ${rupees(t.bankSavedRs)}`} />
              <StatTile series="wind" label="Average cost" icon="calc" date={range} value={r4(t.avgRate)} unit="/ kWh"
                foot={`Over ${mwhValue(t.demandKwh)} MWh of demand`} />
              <StatTile series="iex" label="Power exchange" icon="exchange" date={range} value={rupees(t.exchangeCostRs)} unit=""
                foot={`${mwhValue(t.exchangeKwh)} MWh at ${r4(t.exchangeRate)}/kWh`} />
              <StatTile series="grid" label="Grid" icon="grid" date={range} value={rupees(t.gridCostRs)} unit=""
                foot={`${mwhValue(t.gridKwh)} MWh at ${r4(t.gridRate)}/kWh`} />
            </div>
          </div>
        </WidgetCell>

        <WidgetCell span="full" type="billing.timeline">
          <Card title="Bill over time" sub={`${sel.plant.name} · energy cost per month by source, with the average ₹/kWh · click a month to see how it’s calculated`}
            actions={<div className="eg-legend">
              <span><span className="eg-swatch" data-series="iex" />Power exchange</span><span><span className="eg-swatch" data-series="grid" />Grid</span>
              <span><span className="eg-swatch" data-series="solar" />Solar</span><span><span className="eg-swatch ecv-bill__rateswatch" />Average ₹/kWh</span>
            </div>}>
            <CostColumns columns={monthCols} selected={sel_m?.month} aria={`Monthly energy cost by source, ${range}`} clickHint="opens the month" />
          </Card>
        </WidgetCell>

        {sel_m ? (
          <WidgetCell span="full" type="billing.breakdown">
            <div id="bill-month" />
            <Card title={`How the ${monthLabel(sel_m.month)} bill is calculated`}
              sub={`${sel.plant.name} · ${sel_m.daysWithData} day${sel_m.daysWithData === 1 ? '' : 's'} with data${sel_m.partial ? ' (month to date)' : ''} · energy × rate = cost, for each source`}
              actions={withData.length > 1 ? (
                <form method="get" action="/billing" className="eg-seg eg-seg--sm" role="group" aria-label="Month">
                  <input type="hidden" name="client" value={sel.client.client_id} /><input type="hidden" name="plant" value={sel.plant.plant_id} />
                  <input type="hidden" name="months" value={months} />
                  {[...withData].reverse().slice(-6).map((m) => <button key={m.month} type="submit" name="month" value={m.month} aria-pressed={m.month === sel_m.month}>{monthLabel(m.month)}</button>)}
                </form>) : undefined}>
              <BillBreakdown m={sel_m} monthLabel={monthLabel(sel_m.month)} />
            </Card>
          </WidgetCell>
        ) : null}

        {sel_m && dayCols.length ? (
          <WidgetCell span="full" type="billing.days">
            <Card title={`${monthLabel(sel_m.month)} day by day`} sub="Energy cost per day by source, with the day’s average ₹/kWh · hover a day for its numbers">
              <CostColumns columns={dayCols} aria={`Daily energy cost, ${monthLabel(sel_m.month)}`} lineLabel="Day’s average ₹/kWh" />
            </Card>
          </WidgetCell>
        ) : null}

        <WidgetCell span="full" type="billing.months">
          <Card title="Monthly bill summary"
            sub={`${sel.plant.name} · ${range} · bill = grid + IEX + solar`}>
            <div className="ecv-table-wrap">
              <table className="ecv-table">
                <thead>
                  <tr>
                    <th>Month</th><th className="num">Demand MWh</th><th className="num">Grid cost</th><th className="num">IEX cost</th>
                    <th className="num">Solar cost</th><th className="num ecv-sticky-end">Total · ₹/kWh</th>
                  </tr>
                </thead>
                <tbody>{shownMonths.map((m) => <MonthRow key={m.month} m={m} />)}</tbody>
                <tfoot>
                  <tr>
                    <td>Total · {shownMonths.length} month{shownMonths.length === 1 ? '' : 's'}</td>
                    <td className="num">{mwhValue(t.demandKwh)}</td>
                    <td className="num">{rupees(t.gridCostRs)}</td><td className="num">{rupees(t.exchangeCostRs)}</td><td className="num">{rupees(t.solarCostRs)}</td>
                    <td className="num ecv-sticky-end">{rupees(t.totalCostRs)}<small className="ecv-sub">{r4(t.avgRate)}/kWh</small></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="eg-card__sub ecv-footnote">Energy cost from your meter readings. Fixed and demand charges aren’t included. Your DISCOM and IEX invoices remain the official bills.
              {trimmed > 0 && firstMonth ? <> Starts at {monthLabel(firstMonth)}, the first month with meter data.</> : null} Energy by source, banking and every day are in the Excel download.</p>
          </Card>
        </WidgetCell>
      </WidgetGrid>
    </Shell>
  );
}

function MonthRow({ m }: { m: BillMonth }) {
  if (!m.daysWithData) {
    return <tr className="ecv-row--empty"><td className="nowrap">{monthLabel(m.month)}</td><td colSpan={4} className="eg-muted">No meter data</td><td className="ecv-sticky-end" /></tr>;
  }
  return (
    <tr>
      <td className="nowrap">{monthLabel(m.month)}{m.partial ? <> <Chip tone="accent">{m.daysWithData} days</Chip></> : null}</td>
      <td className="num">{mwhValue(m.demandKwh)}</td>
      <td className="num">{rupees(m.gridCostRs)}<small className="ecv-sub">{mwhValue(m.gridKwh)} MWh</small></td>
      <td className="num">{rupees(m.exchangeCostRs)}<small className="ecv-sub">{mwhValue(m.exchangeKwh)} MWh</small></td>
      <td className="num">{rupees(m.solarCostRs)}<small className="ecv-sub">{mwhValue(m.solarKwh)} MWh</small></td>
      <td className="num ecv-sticky-end"><b>{rupees(m.totalCostRs)}</b><small className="ecv-sub">{r4(m.avgRate)}/kWh</small></td>
    </tr>
  );
}

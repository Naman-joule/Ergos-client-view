import type React from 'react';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { BILLING_MONTH_CHOICES, loadBilling, resolveBillingMonths, type BillMonth } from '@/lib/queries/billing';
import { loadSpec } from '@/lib/dashboard/load';
import { currentBlock, formatRange } from '@/lib/time';
import { inr, mwhValue, rupees } from '@/lib/format';
import { href, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Empty, Notice } from '@/components/ui/Empty';
import { Icon } from '@/components/ui/Icon';
import { StatTile } from '@/components/ui/StatTile';

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
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    const [loaded, data] = await Promise.all([loadSpec(q, sel.client.client_id), loadBilling(q, sel.plant.plant_id, months)]);
    return { scope, sel, lag, loaded, data } as const;
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

  return (
    <Shell user={user} page="billing" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode}>
      {!t.daysWithData ? <Notice>No meter data for {sel.plant.name} in the last {months} months. Check that the sync is running.</Notice> : null}
      {unpriced > 0.5 ? <Notice>{inr(unpriced)} kWh from the grid fall in blocks with no DISCOM ToD rate, so they aren’t costed. The grid cost for those months is understated.</Notice> : null}
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
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
            <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 4 } as React.CSSProperties}>
              <StatTile series="demand" label="Energy cost" icon="rupee" date={range} value={rupees(t.totalCostRs)} unit=""
                foot={`${t.daysWithData} days with data`} />
              <StatTile series="wind" label="Average cost" icon="calc" date={range} value={r4(t.avgRate)} unit="/ kWh"
                foot={`Over ${mwhValue(t.demandKwh)} MWh of demand`} />
              <StatTile series="iex" label="Power exchange" icon="exchange" date={range} value={rupees(t.iexCostRs)} unit=""
                foot={`${mwhValue(t.iexKwh)} MWh at ${r4(t.iexRate)}/kWh`} />
              <StatTile series="grid" label="Grid" icon="grid" date={range} value={rupees(t.gridCostRs)} unit=""
                foot={`${mwhValue(t.gridKwh)} MWh at ${r4(t.gridRate)}/kWh`} />
            </div>
          </div>
        </WidgetCell>

        <WidgetCell span="full" type="billing.months">
          <Card title="Monthly bill summary"
            sub={`${sel.plant.name} · ${range} · energy charges: IEX at landed cost, grid at the DISCOM ToD rate + FPPCA, solar at its tariff`}>
            <div className="ecv-table-wrap">
              <table className="ecv-table">
                <thead>
                  <tr>
                    <th>Month</th><th className="num">Demand MWh</th><th className="num">IEX MWh</th><th className="num">Solar MWh</th>
                    <th className="num">Banking MWh</th><th className="num">Grid MWh</th><th className="num">IEX cost</th><th className="num">Grid cost</th>
                    <th className="num">Solar cost</th><th className="num ecv-sticky-end">Total · ₹/kWh</th>
                  </tr>
                </thead>
                <tbody>{data.months.map((m) => <MonthRow key={m.month} m={m} />)}</tbody>
                <tfoot>
                  <tr>
                    <td>Total · {t.months} month{t.months === 1 ? '' : 's'}</td>
                    <td className="num">{mwhValue(t.demandKwh)}</td><td className="num">{mwhValue(t.iexKwh)}</td><td className="num">{mwhValue(t.solarUsedKwh)}</td>
                    <td className="num">{mwhValue(t.bankKwh)}</td><td className="num">{mwhValue(t.gridKwh)}</td>
                    <td className="num">{rupees(t.iexCostRs)}</td><td className="num">{rupees(t.gridCostRs)}</td><td className="num">{rupees(t.solarCostRs)}</td>
                    <td className="num ecv-sticky-end">{rupees(t.totalCostRs)}<small className="ecv-sub">{r4(t.avgRate)}/kWh</small></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="eg-card__sub ecv-footnote">Fixed/demand charges and electricity duty aren’t in the data the client view receives, so they aren’t included. Your DISCOM and IEX invoices remain the official bills.</p>
          </Card>
        </WidgetCell>
      </WidgetGrid>
    </Shell>
  );
}

function MonthRow({ m }: { m: BillMonth }) {
  if (!m.daysWithData) {
    return <tr className="ecv-row--empty"><td className="nowrap">{monthLabel(m.month)}</td><td colSpan={9} className="eg-muted">No meter data</td><td className="ecv-sticky-end" /></tr>;
  }
  return (
    <tr>
      <td className="nowrap">{monthLabel(m.month)}{m.partial ? <> <Chip tone="accent">{m.daysWithData} days</Chip></> : null}</td>
      <td className="num">{mwhValue(m.demandKwh)}</td><td className="num">{mwhValue(m.iexKwh)}</td><td className="num">{mwhValue(m.solarUsedKwh)}</td>
      <td className="num">{mwhValue(m.bankKwh)}</td><td className="num">{mwhValue(m.gridKwh)}</td>
      <td className="num">{rupees(m.iexCostRs)}</td><td className="num">{rupees(m.gridCostRs)}</td><td className="num">{rupees(m.solarCostRs)}</td>
      <td className="num ecv-sticky-end"><b>{rupees(m.totalCostRs)}</b><small className="ecv-sub">{r4(m.avgRate)}/kWh</small></td>
    </tr>
  );
}

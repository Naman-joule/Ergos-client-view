import type React from 'react';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { HISTORY_MAX_DAYS, daysBetween, loadHistory, resolveHistoryPeriod, type HistoryDay } from '@/lib/queries/history';
import { loadSpec } from '@/lib/dashboard/load';
import { blockEnd, currentBlock, formatDate, formatDayMonth, formatRange, formatWeekday, istToday } from '@/lib/time';
import { inr, mwhValue } from '@/lib/format';
import { href, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { EnergyModes } from '@/components/shell/EnergyTime';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Empty, Notice } from '@/components/ui/Empty';
import { Icon } from '@/components/ui/Icon';
import { StatTile } from '@/components/ui/StatTile';
import { HistoryChart } from '@/components/charts/HistoryChart';

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export async function RangeView({ sp }: { sp: SP }) {
  const user = await requireUser('view_today');
  const today = istToday();
  const period = resolveHistoryPeriod(sp, today);

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    const [loaded, data] = await Promise.all([loadSpec(q, sel.client.client_id), loadHistory(q, sel.plant.plant_id, period)]);
    return { scope, sel, lag, loaded, data } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="energy" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, loaded, data } = view;
  const t = data.totals;
  const range = formatRange(period.from, period.to);
  const keep: Record<string, string> = period.preset ? { preset: period.preset } : { from: period.from, to: period.to };
  const nDays = daysBetween(period.from, period.to);

  // daily table, newest first
  const rows = [...data.days].reverse();
  const hidden = [...(data.hasSolar ? [] : ['solar', 'surplus'] as const), ...(data.hasBank ? [] : ['bank'] as const)];

  return (
    <Shell user={user} page="energy" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode}>
      {period.clamped ? <Notice>Ranges are limited to {HISTORY_MAX_DAYS} days. Showing {range}.</Notice> : null}
      {!t.daysWithData ? <Notice>No meter data for {sel.plant.name} between {range}. Pick another range, or check that the sync is running.</Notice> : null}
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
        clientHref={(c) => href('/energy', { client: c.client_id, ...keep })}
        plantHref={(p) => href('/energy', { client: sel.client.client_id, plant: p.plant_id, ...keep })}
        controls={
          <form method="get" action="/energy" className="ecv-period">
            <input type="hidden" name="client" value={sel.client.client_id} />
            <input type="hidden" name="plant" value={sel.plant.plant_id} />
            <EnergyModes client={sel.client.client_id} plant={sel.plant.plant_id}
              mode={period.preset === 'mtd' ? 'mtd' : period.preset === 'last7' ? 'last7' : 'custom'} date={period.to} today={today} />
            <div className="eg-row">
              <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
                <input type="date" name="from" defaultValue={period.from} max={today} aria-label="From" /></label>
              <Icon name="arrow-right" size={15} />
              <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
                <input type="date" name="to" defaultValue={period.to} max={today} aria-label="To" /></label>
              <button className="eg-btn eg-btn--primary" type="submit"><Icon name="bars" size={16} />Show range</button>
            </div>
          </form>
        } />

      <WidgetGrid palette={loaded.spec.theme.palette}>
        <WidgetCell span="full" type="history.tiles">
          <div className="ecv-tiles-wrap">
            <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 6 } as React.CSSProperties}>
              <StatTile series="demand" label="Demand" icon="bolt" date={range} value={mwhValue(t.demandKwh)} unit="MWh"
                foot={`${t.daysWithData} of ${nDays} day${nDays === 1 ? '' : 's'} with data`} />
              <StatTile series="grid" label="Grid" icon="grid" date={range} value={mwhValue(t.gridKwh)} unit="MWh"
                foot="Residual demand" footChip={<Chip>{share(t.gridKwh, t.demandKwh)}</Chip>} />
              <StatTile series="iex" label="Power exchange" icon="exchange" date={range} value={mwhValue(t.iexKwh)} unit="MWh"
                foot="Share of demand" footChip={<Chip tone="accent">{share(t.iexKwh, t.demandKwh)}</Chip>} />
              <StatTile series="solar" label="Solar" icon="solar" date={range} value={mwhValue(t.solarKwh)} unit="MWh"
                foot={data.hasSolar ? (t.surplusKwh > 0.5 ? `${mwhValue(t.surplusKwh)} MWh beyond demand` : 'Captive, through mapping') : 'No solar mapped'} />
              <StatTile series="wind" label="Peak demand" icon="gauge" date={range} value={t.peakKw ? inr(Math.round(t.peakKw)) : '—'} unit="kW"
                foot={t.peakDate && t.peakBlock ? `${formatDayMonth(t.peakDate)} · ${blockEnd(t.peakBlock)}` : 'No readings'} />
              <StatTile series="iex" label="IEX landed price" icon="rupee" date={range}
                value={t.landedRate != null ? `₹${t.landedRate.toFixed(2)}` : '—'} unit="/ kWh" foot="Volume-weighted, incl. OA charges" />
            </div>
          </div>
        </WidgetCell>

        <WidgetCell span="full" type="history.supply">
          <Card title="Energy supply"
            sub={`${sel.plant.name} · ${range} · ${data.series ? 'every 15-minute block' : 'one bar per day'} · IEX settles first, then solar and banking; grid is derived`}>
            <HistoryChart series={data.series} tod={data.tod} todDays={data.todDays} rangeLabel={range} hidden={hidden}
              days={data.days.map(({ date, blocks, demandKwh, iexKwh, solarUsedKwh, bankKwh, gridKwh, surplusKwh }) =>
                ({ date, blocks, demandKwh, iexKwh, solarUsedKwh, bankKwh, gridKwh, surplusKwh }))} />
          </Card>
        </WidgetCell>

        <WidgetCell span="full" type="history.table">
          <Card title="Daily" sub={`${sel.plant.name} · ${range} · energy in kWh`}
            actions={
              <a className="ecv-sheet ecv-sheet--excel ecv-export" download
                href={`/api/export/energy?plant=${sel.plant.plant_id}&from=${period.from}&to=${period.to}`}
                title="Excel workbook: Block-wise, Day-wise and ToD-wise sheets">
                <Icon name="download" size={14} />Download Excel
              </a>}>
            <div className="ecv-table-wrap">
              <table className="ecv-table">
                <thead>
                  <tr>
                    <th>Date</th><th className="num">Demand</th><th className="num">Power exchange</th><th className="num">Solar used</th>
                    {data.hasBank ? <th className="num">Banking</th> : null}<th className="num">Grid</th>
                    {data.hasSolar ? <th className="num">Surplus solar</th> : null}
                    <th className="num">Peak kW</th><th className="num">IEX landed ₹/kWh</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => <DayRow key={d.date} d={d} bank={data.hasBank} solar={data.hasSolar} today={today} />)}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total · {t.daysWithData} day{t.daysWithData === 1 ? '' : 's'}</td>
                    <td className="num">{inr(t.demandKwh)}</td><td className="num">{inr(t.iexKwh)}</td><td className="num">{inr(t.solarUsedKwh)}</td>
                    {data.hasBank ? <td className="num">{inr(t.bankKwh)}</td> : null}<td className="num">{inr(t.gridKwh)}</td>
                    {data.hasSolar ? <td className="num">{inr(t.surplusKwh)}</td> : null}
                    <td className="num">{t.peakKw ? inr(Math.round(t.peakKw)) : '—'}</td>
                    <td className="num">{t.landedRate != null ? t.landedRate.toFixed(4) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </WidgetCell>
      </WidgetGrid>
    </Shell>
  );
}

function DayRow({ d, bank, solar, today }: { d: HistoryDay; bank: boolean; solar: boolean; today: string }) {
  if (!d.blocks) {
    return (
      <tr className="ecv-row--empty">
        <td className="nowrap">{formatDate(d.date)}</td>
        <td colSpan={6 + (bank ? 1 : 0) + (solar ? 1 : 0)} className="eg-muted">No meter data</td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="nowrap" title={formatWeekday(d.date)}>{formatDate(d.date)}{d.date === today ? <> <Chip tone="accent">So far</Chip></> : null}</td>
      <td className="num">{inr(d.demandKwh)}</td>
      <td className="num">{inr(d.iexKwh)}</td>
      <td className="num">{inr(d.solarUsedKwh)}</td>
      {bank ? <td className="num">{inr(d.bankKwh)}</td> : null}
      <td className="num">{inr(d.gridKwh)}</td>
      {solar ? <td className="num">{inr(d.surplusKwh)}</td> : null}
      <td className="num" title={d.peakBlock ? `at ${blockEnd(d.peakBlock)}` : undefined}>{inr(Math.round(d.peakKw))}</td>
      <td className="num">{d.landedRate != null ? d.landedRate.toFixed(4) : '—'}</td>
    </tr>
  );
}


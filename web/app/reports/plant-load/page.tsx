import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { latestMeterDate } from '@/lib/queries/today';
import { lastReading, loadPlantLoad, loadPlantLoadMonth, type LoadBlock, type LoadFlag } from '@/lib/queries/plant-load';
import { MonthView } from './MonthView';
import { MonthSelect } from '@/components/ui/MonthSelect';
import { Icon } from '@/components/ui/Icon';
import { blockEnd, blockStart, currentBlock, formatDateLong, isYmd, istToday } from '@/lib/time';
import { inr } from '@/lib/format';
import { href, one, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { DayPager } from '@/components/shell/DayPager';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { Empty, Notice } from '@/components/ui/Empty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plant load report' };

const FLAG: Record<LoadFlag, { label: string; tone: string; title: string }> = {
  real: { label: 'Logged', tone: 'real', title: 'Read by the data logger' },
  interpolated: { label: 'Filled', tone: 'filled', title: 'No logger reading: ergOS filled this block in from the readings around it' },
  missing: { label: 'Missing', tone: 'missing', title: 'ergOS marked this reading missing; it carries no value' },
  other: { label: 'Other', tone: 'filled', title: 'Flag not recognised' },
  none: { label: 'No reading', tone: 'missing', title: 'No meter reading in this block' },
};
const n = (v: number | null, dp: number) => (v == null ? '—' : inr(v, dp));
const hm = (ts: string | null) => (ts ? ts.slice(11) : '—');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const formatMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function PlantLoadPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_today');
  const sp = await searchParams;
  const today = istToday();
  const asked = one(sp.date);
  const explicit = isYmd(asked) && asked <= today ? asked : null;
  // ?view=month&month=YYYY-MM: the month's daily maximum and minimum load; otherwise one day
  const monthMode = one(sp.view) === 'month';
  const askedMonth = one(sp.month);
  const explicitMonth = typeof askedMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(askedMonth) && askedMonth <= today.slice(0, 7) ? askedMonth : null;

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    // No date asked: the latest day with readings (a logger that uploads daily has nothing for today yet)
    const [latest, last] = await Promise.all([latestMeterDate(q, sel.plant.plant_id), lastReading(q, sel.plant.plant_id)]);
    const date = explicit ?? (latest && latest < today ? latest : today);
    const month = explicitMonth ?? (explicit ?? latest ?? today).slice(0, 7);
    const monthTo = (() => { const [y, m] = month.split('-').map(Number) as [number, number];
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return end < today ? end : today; })();
    const [report, monthData] = await Promise.all([
      monthMode ? Promise.resolve(null) : loadPlantLoad(q, sel.plant.plant_id, date),
      monthMode ? loadPlantLoadMonth(q, sel.plant.plant_id, `${month}-01`, monthTo) : Promise.resolve(null),
    ]);
    return { scope, sel, lag, date, month, last, report, monthData } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="load" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, date, month, last, report, monthData } = view;
  const base = { client: sel.client.client_id };
  const link = (o: { plant?: number; date?: string | null }) =>
    href('/reports/plant-load', { ...base, plant: o.plant ?? sel.plant.plant_id, date: o.date === undefined ? explicit : o.date });
  const monthLink = (o: { plant?: number; month?: string }) =>
    href('/reports/plant-load', { ...base, plant: o.plant ?? sel.plant.plant_id, view: 'month', month: o.month ?? month });
  const shiftMonth = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
  const thisMonth = today.slice(0, 7);
  const controls = <>
    <nav className="eg-seg eg-seg--glass ecv-modes" aria-label="Period">
      <a href={link({ date: monthMode ? (month === thisMonth ? null : `${month}-01`) : undefined })} aria-current={!monthMode ? 'true' : undefined} aria-pressed={!monthMode}>Day</a>
      <a href={monthLink({ month: monthMode ? month : date.slice(0, 7) })} aria-current={monthMode ? 'true' : undefined} aria-pressed={monthMode}>Month</a>
    </nav>
    {monthMode ? (
      <>
        <div className="eg-row ecv-pager">
          <a className="eg-icon-btn eg-icon-btn--sm" href={monthLink({ month: shiftMonth(month, -1) })} aria-label="Previous month"><Icon name="chevron-left" size={18} /></a>
          <span className="eg-chip eg-chip--lg"><Icon name="calendar" size={14} />{formatMonth(month)}</span>
          {month >= thisMonth
            ? <span className="eg-icon-btn eg-icon-btn--sm ecv-disabled" aria-disabled="true" aria-label="Next month"><Icon name="chevron-right" size={18} /></span>
            : <a className="eg-icon-btn eg-icon-btn--sm" href={monthLink({ month: shiftMonth(month, 1) })} aria-label="Next month"><Icon name="chevron-right" size={18} /></a>}
        </div>
        <form method="get" action="/reports/plant-load" className="eg-row ecv-pickform" aria-label="Pick a month">
          <input type="hidden" name="client" value={sel.client.client_id} />
          <input type="hidden" name="plant" value={sel.plant.plant_id} />
          <input type="hidden" name="view" value="month" />
          <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
            <MonthSelect name="month" value={month} max={thisMonth} label="Month" /></label>
          <button className="eg-btn eg-btn--primary eg-btn--sm" type="submit">Show month</button>
        </form>
      </>
    ) : (
      <>
        <DayPager date={date} today={today} hrefFor={(d) => link({ date: d === today ? null : d })} />
        <form method="get" action="/reports/plant-load" className="eg-row ecv-pickform" aria-label="Pick a date">
          <input type="hidden" name="client" value={sel.client.client_id} />
          <input type="hidden" name="plant" value={sel.plant.plant_id} />
          <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
            <input type="date" name="date" defaultValue={date} max={today} aria-label="Date" required /></label>
          <button className="eg-btn eg-btn--primary eg-btn--sm" type="submit">Show day</button>
        </form>
      </>
    )}
  </>;
  const clientPlants = view.scope.plants.filter((pl) => pl.client_id === sel.client.client_id).length;
  const exportTo = monthMode ? month : date.slice(0, 7);
  const exportBar = (
    <form method="get" action="/api/export/plant-load" className="eg-glass ecv-loadexport" aria-label="Export monthly load report">
      <input type="hidden" name="client" value={sel.client.client_id} />
      <span className="ecv-loadexport__title"><Icon name="download" size={16} />
        <span><b>Monthly load report</b><small>Excel · maximum, minimum load and consumption for {clientPlants === 1 ? 'the plant' : `all ${clientPlants} plants`} of {sel.client.alias_name || sel.client.name}</small></span>
      </span>
      <span className="eg-row ecv-loadexport__pick">
        <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
          <MonthSelect name="from" value={shiftMonth(exportTo, -6)} max={thisMonth} label="From month" /></label>
        <Icon name="arrow-right" size={15} />
        <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
          <MonthSelect name="to" value={exportTo} max={thisMonth} label="To month" /></label>
        <button className="ecv-sheet ecv-sheet--excel ecv-export" type="submit"><Icon name="download" size={14} />Export</button>
      </span>
    </form>
  );
  const source = (
    <p className="ecv-load__source">
      Captured by the plant’s data logger meter. Latest reading received: <b>{last ? `${formatDateLong(last.slice(0, 10))}, ${last.slice(11)} IST` : 'none yet'}</b>.
      {last && last.slice(0, 10) < today ? ' Nothing has arrived for today yet; it appears here once the logger’s data reaches ergOS.' : ''}
    </p>
  );
  if (monthMode && monthData) {
    return (
      <Shell user={user} page="load" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
          clientHref={(c) => href('/reports/plant-load', { client: c.client_id, view: 'month', month })}
          plantHref={(p) => monthLink({ plant: p.plant_id })} controls={controls} />
        <div className="ecv-stack">
          {source}
          {exportBar}
          <MonthView data={monthData} month={month} plantName={sel.plant.name} dayHref={(d) => link({ date: d })} />
        </div>
      </Shell>
    );
  }
  const s = report!.summary;
  const day = formatDateLong(date);
  const logged = s.real + s.interpolated + s.other;
  const hasData = logged > 0;
  const shown = report!.blocks.filter((b) => b.readings > 0 || b.block <= (date === today ? currentBlock() - 1 : 96));

  return (
    <Shell user={user} page="load" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
        clientHref={(c) => href('/reports/plant-load', { client: c.client_id })}
        plantHref={(p) => link({ plant: p.plant_id })}
        controls={controls} />

      <div className="ecv-stack">
        {source}
        {exportBar}

        {!hasData ? (
          <Card title={`Plant load · ${day}`}>
            <Empty title={`No meter readings for ${day}`} icon="gauge">
              {last ? 'The data logger hasn’t uploaded readings for this day yet. Pick another day.' : 'No readings have been received from this plant’s meter yet.'}
            </Empty>
          </Card>
        ) : (
          <>
            {s.none + s.missing > 0 && date !== today
              ? <Notice>{s.none + s.missing} of 96 blocks have no reading for {day}. Totals cover the blocks that do.</Notice> : null}
            {s.registerGapKwh != null && Math.abs(s.registerGapKwh) > Math.max(1, s.totalKwh * 0.005)
              ? <Notice>The meter register moved {n(s.closingKwh! - s.openingKwh!, 1)} kWh, but the block readings add up to {n(s.totalKwh, 1)} kWh ({n(s.registerGapKwh, 1)} kWh apart). Check the logger for a reset or a gap.</Notice> : null}
            <div className="ecv-tiles-wrap">
              <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 5 } as React.CSSProperties}>
                <StatTile series="demand" label="Energy" icon="bolt" date={day} value={n(s.totalKwh, 0)} unit="kWh"
                  foot={s.totalKvah != null ? `${n(s.totalKvah, 0)} kVAh` : 'kVAh not recorded'} />
                <StatTile series="wind" label="Maximum load" icon="gauge" date={day} value={n(s.maxKw, 0)} unit="kW"
                  foot={s.maxBlock ? `Block ${s.maxBlock} · ${blockStart(s.maxBlock)}–${blockEnd(s.maxBlock)}` : '—'} />
                <StatTile series="grid" label="Minimum load" icon="gauge" date={day} value={n(s.minKw, 0)} unit="kW"
                  foot={s.minBlock ? `Block ${s.minBlock} · ${blockStart(s.minBlock)}–${blockEnd(s.minBlock)}` : '—'} />
                <StatTile series="iex" label="Average load" icon="bars" date={day} value={n(s.avgKw, 0)} unit="kW"
                  foot={s.loadFactor != null ? `Load factor ${(s.loadFactor * 100).toFixed(1)}%` : '—'} />
                <StatTile series="solar" label="Data captured" icon="check" date={day} value={`${s.real}`} unit="/ 96 logged"
                  foot={[s.interpolated ? `${s.interpolated} filled` : null, s.none + s.missing ? `${s.none + s.missing} no reading` : null, s.pf != null ? `PF ${s.pf.toFixed(3)}` : null].filter(Boolean).join(' · ') || 'Every block logged'} />
              </div>
            </div>

            <Card title={`Block-wise load · ${day}`}
              sub={`${sel.plant.name} · 15-minute blocks, IST · register ${n(s.openingKwh, 1)} → ${n(s.closingKwh, 1)} kWh · readings ${hm(s.firstReadAt)} to ${hm(s.lastReadAt)}`}>
              <div className="ecv-table-wrap ecv-load__wrap">
                <table className="ecv-table ecv-load">
                  <thead>
                    <tr>
                      <th>Block</th><th>Time (IST)</th>
                      <th className="num" title="Cumulative kWh register at the block's last reading">Meter reading (kWh)</th>
                      <th className="num">Energy (kWh)</th><th className="num" title="Average load in the block: kWh × 4">Load (kW)</th>
                      <th className="num" title="Change in the kVAh register">kVAh</th><th className="num" title="kWh ÷ kVAh for the block">PF</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((b: LoadBlock) => {
                      const f = FLAG[b.flag];
                      return (
                        <tr key={b.block} className={`is-${f.tone}${b.block === s.maxBlock ? ' is-max' : ''}`}>
                          <td>{b.block}</td>
                          <td>{blockStart(b.block)}–{blockEnd(b.block)}</td>
                          <td className="num">{n(b.registerKwh, 2)}</td>
                          <td className="num">{n(b.kwh, 2)}</td>
                          <td className="num">{n(b.kw, 1)}</td>
                          <td className="num">{n(b.kvah, 2)}</td>
                          <td className="num">{b.pf != null ? b.pf.toFixed(3) : '—'}</td>
                          <td><span className={`ecv-load__flag ecv-load__flag--${f.tone}`} title={b.rawFlag ? `${f.title}: “${b.rawFlag}”` : f.title}>{f.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3}>Day total · {logged} block{logged === 1 ? '' : 's'} with readings</th>
                      <th className="num">{n(s.totalKwh, 2)}</th>
                      <th className="num">{n(s.avgKw, 1)} avg</th>
                      <th className="num">{n(s.totalKvah, 2)}</th>
                      <th className="num">{s.pf != null ? s.pf.toFixed(3) : '—'}</th>
                      <th />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </Shell>
  );
}

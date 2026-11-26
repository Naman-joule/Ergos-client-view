import type React from 'react';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { syncLagMinutes } from '@/lib/queries/sync';
import { MARKETS, countIexRows, iexDateRange, loadIex, loadIexRange, loadIexRows } from '@/lib/queries/iex';
import { IEX_MAX_DAYS, resolveIexView, resolvePage, type IexView } from '@/lib/iex-period';
import { addDays, blockEnd, blockStart, currentBlock, formatDate, formatDateLong, formatRange, istToday } from '@/lib/time';
import { inr } from '@/lib/format';
import { href, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { DayPager } from '@/components/shell/DayPager';
import { StickyBar } from '@/components/shell/StickyBar';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/Empty';
import { Icon } from '@/components/ui/Icon';
import { StatTile } from '@/components/ui/StatTile';
import { Pagination } from '@/components/ui/Pagination';
import { IexDayChart, IexProfileChart, IexTrendChart } from '@/components/charts/IexCharts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'IEX prices' };

const fmt = (v: number | null | undefined) => (v != null ? `₹${v.toFixed(2)}` : '—');
const at = (b: number | undefined) => (b ? `${blockStart(b)}–${blockEnd(b)}` : '');

/** URL parameters that describe the view (kept when paging, dropped when switching view). */
function viewParams(v: IexView, defaultDay: string): Record<string, string | null> {
  if (v.mode === 'day') return { date: v.from !== defaultDay ? v.from : null };
  return v.preset ? { preset: v.preset } : { from: v.from, to: v.to };
}

// Market-wide: no client or plant. Same page for every signed-in user with view_iex.
export default async function IexPricesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_iex');
  const sp = await searchParams;
  const today = istToday();

  const r = await withUser(user.id, async (q) => {
    const range = await iexDateRange(q);
    // default day: today; with no prices today yet, the latest day that has them. Tomorrow's DAM is selectable.
    const max = range.latest && range.latest > today ? range.latest : today;
    const defaultDay = range.latest && range.latest < today ? range.latest : today;
    const view = resolveIexView(sp, defaultDay, max);
    const [day, span, total, lag] = await Promise.all([
      view.mode === 'day' ? loadIex(q, view.from, range) : Promise.resolve(null),
      view.mode === 'range' ? loadIexRange(q, view.from, view.to) : Promise.resolve(null),
      countIexRows(q, view.from, view.to),
      syncLagMinutes(q),
    ]);
    const pg = resolvePage(sp, total);
    const rows = await loadIexRows(q, view.from, view.to, pg.offset, pg.size);
    return { range, max, defaultDay, view, day, span, pg, rows, lag };
  });
  const { range, max, defaultDay, view, day, span, pg, rows } = r;
  const keep = viewParams(view, defaultDay);
  const pageHref = (o: { page?: number; size?: number }) =>
    href('/market/prices', { ...keep, page: (o.page ?? pg.page) > 1 ? o.page ?? pg.page : null, size: (o.size ?? pg.size) !== 96 ? o.size ?? pg.size : null }) + '#blocks';
  const label = view.mode === 'day' ? formatDateLong(view.from) : formatRange(view.from, view.to);
  const hasData = view.mode === 'day' ? day!.hasData : span!.hasData;
  const exportHref = view.mode === 'day' ? `/api/export/iex?date=${view.from}` : `/api/export/iex?from=${view.from}&to=${view.to}`;
  const modes = [
    { key: 'day', label: 'Day', to: href('/market/prices', { date: view.to !== defaultDay ? view.to : null }) },
    { key: 'last7', label: '7 days', to: href('/market/prices', { preset: 'last7' }) },
    { key: 'last30', label: '30 days', to: href('/market/prices', { preset: 'last30' }) },
    { key: 'mtd', label: 'Month to date', to: href('/market/prices', { preset: 'mtd' }) },
  ];
  const current = view.mode === 'day' ? 'day' : view.preset ?? 'custom';
  const dayPager = view.mode === 'day'
    ? <DayPager date={view.from} today={today} max={max} hrefFor={(d) => href('/market/prices', { date: d !== defaultDay ? d : null })} /> : null;

  return (
    <Shell user={user} page="prices" liveBlock={currentBlock()} syncLag={r.lag} themeMode="dark">
      {!range.latest ? <Notice>IEX market prices haven’t been synced yet. They appear once the sync has IEX_DATABASE_URL and has run.</Notice> : null}
      {range.latest && !hasData ? <Notice>No IEX prices for {label}. Prices are available from {formatDate(range.earliest!)} to {formatDate(range.latest)}.</Notice> : null}
      {view.mode === 'range' && view.clamped ? <Notice>Ranges are limited to {IEX_MAX_DAYS} days. Showing {label}.</Notice> : null}

      <section className="eg-glass ecv-scope" aria-label="Period">
        <div className="ecv-iexbar">
          <div className="ecv-iexbar__title"><b>Indian Energy Exchange · market clearing prices</b><span>Same for every client · DAM, RTM and GDAM · ₹/kWh per 15-minute block</span></div>
          <div className="ecv-scope__controls">
            <nav className="eg-seg eg-seg--glass ecv-modes" aria-label="Period">
              {modes.map((m) => <a key={m.key} href={m.to} aria-current={current === m.key ? 'true' : undefined} aria-pressed={current === m.key}>{m.label}</a>)}
            </nav>
            {dayPager}
            {view.mode === 'day' && range.latest && range.latest > today && view.from !== range.latest
              ? <a className="eg-btn eg-btn--sm eg-btn--ghost" href={href('/market/prices', { date: range.latest })}>Tomorrow’s DAM</a> : null}
            <form method="get" action="/market/prices" className="eg-row ecv-iexrange" aria-label="Custom date range">
              <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
                <input type="date" name="from" defaultValue={view.from} min={range.earliest ?? undefined} max={max} aria-label="From" required /></label>
              <Icon name="arrow-right" size={15} />
              <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
                <input type="date" name="to" defaultValue={view.to} min={range.earliest ?? undefined} max={max} aria-label="To" required /></label>
              <button className="eg-btn eg-btn--primary eg-btn--sm" type="submit" aria-current={current === 'custom' ? 'true' : undefined}>Apply</button>
            </form>
            <a className="ecv-sheet ecv-sheet--excel ecv-export" download href={exportHref}
              title={view.mode === 'day' ? 'Excel: every block of the day, and 30 days of daily averages' : 'Excel: every block in the range, and the daily averages'}>
              <Icon name="download" size={14} />Export
            </a>
          </div>
        </div>
      </section>
      <StickyBar title={`IEX prices · ${label}`}>
        {dayPager ?? <a className="eg-btn eg-btn--sm eg-btn--ghost" href="#main">Change period</a>}
      </StickyBar>

      <WidgetGrid palette="harmony">
        <WidgetCell span="full" type="iex.tiles">
          <div className="ecv-tiles-wrap">
            <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 4, '--n-md': 2 } as React.CSSProperties}>
              {view.mode === 'day'
                ? day!.markets.map((m, i) => (
                  <StatTile key={m.key} series={MARKETS[i]!.slot} label={MARKETS[i]!.label} icon="exchange" date={label}
                    value={fmt(m.avg)} unit="/ kWh"
                    foot={m.blocks ? `Low ${fmt(m.min?.rate)} ${at(m.min?.block)} · High ${fmt(m.max?.rate)} ${at(m.max?.block)}` : 'No prices for this day'} />))
                : span!.markets.map((m, i) => (
                  <StatTile key={m.key} series={MARKETS[i]!.slot} label={MARKETS[i]!.label} icon="exchange" date={label}
                    value={fmt(m.avg)} unit="/ kWh"
                    foot={m.blocks
                      ? `Low ${fmt(m.min?.rate)} ${m.min ? `${formatDate(m.min.date).replace(/ \d{4}$/, '')} ${blockStart(m.min.block)}` : ''} · High ${fmt(m.max?.rate)} ${m.max ? `${formatDate(m.max.date).replace(/ \d{4}$/, '')} ${blockStart(m.max.block)}` : ''} · ${m.days} day${m.days === 1 ? '' : 's'}`
                      : 'No prices in this range'} />))}
              <StatTile series="demand" label="Cleared volume" icon="bolt" date={label}
                value={inr(Math.round((view.mode === 'day' ? day!.markets : span!.markets).reduce((s, m) => s + m.mwh, 0)))} unit="MWh"
                foot={(view.mode === 'day' ? day!.markets : span!.markets).map((m) => `${m.key} ${inr(Math.round(m.mwh))}`).join(' · ')} />
            </div>
          </div>
        </WidgetCell>

        <WidgetCell span="full" type="iex.day">
          {view.mode === 'day' ? (
            <Card title="Market clearing price" sub={`${label} · volume-weighted averages in the tiles · hover a block for prices and cleared MW`}
              actions={<div className="eg-legend">{MARKETS.map((m) => <span key={m.key}><span className="eg-swatch" data-series={m.slot} />{m.short}</span>)}</div>}>
              {day!.hasData
                ? <IexDayChart dayLabel={label} markets={day!.markets.map((m, i) => ({ key: m.key, label: MARKETS[i]!.short, slot: MARKETS[i]!.slot, mcp: m.mcp, mcv: m.mcv }))} />
                : <div className="ecv-empty" role="status"><div><b>No prices for this day</b></div></div>}
            </Card>
          ) : (
            <Card title="Average price by time of day" sub={`${label} · each block’s clearing price averaged over the days in the range`}
              actions={<div className="eg-legend">{MARKETS.map((m) => <span key={m.key}><span className="eg-swatch" data-series={m.slot} />{m.short}</span>)}</div>}>
              {span!.hasData
                ? <IexProfileChart rangeLabel={label} markets={span!.markets.map((m, i) => ({ key: m.key, label: MARKETS[i]!.short, slot: MARKETS[i]!.slot, values: m.profile }))} />
                : <div className="ecv-empty" role="status"><div><b>No prices in this range</b></div></div>}
            </Card>
          )}
        </WidgetCell>

        <WidgetCell span="full" type="iex.trend">
          {view.mode === 'day' ? (
            <Card title="Last 30 days" sub={`Daily volume-weighted clearing price, ${formatDateLong(addDays(view.from, -29))} to ${label}`}>
              <IexTrendChart trend={day!.trend} markets={MARKETS.map((m) => ({ key: m.key, label: m.short, slot: m.slot }))} />
            </Card>
          ) : (
            <Card title="Daily average" sub={`Daily volume-weighted clearing price, ${label}`}>
              {span!.trend.length > 1
                ? <IexTrendChart trend={span!.trend} aria={`Daily volume-weighted clearing price, ${label}`} markets={MARKETS.map((m) => ({ key: m.key, label: m.short, slot: m.slot }))} />
                : <div className="ecv-empty" role="status"><div><b>Pick two or more days to see the daily trend</b></div></div>}
            </Card>
          )}
        </WidgetCell>

        <WidgetCell span="full" type="iex.table">
          <section id="blocks">
            <Card title="Blocks" sub={`${label} · clearing price ₹/kWh and cleared volume MW${view.mode === 'range' ? ' · oldest first' : ''}`}>
              <Pagination page={pg.page} pages={pg.pages} size={pg.size} total={pg.total} hrefFor={pageHref} unit="blocks" />
              {rows.length ? (
                <div className="ecv-table-wrap">
                  <table className="ecv-table">
                    <thead>
                      <tr>{view.mode === 'range' ? <th>Date</th> : null}<th>Block</th><th>Time</th>
                        {MARKETS.map((m) => <th key={m.key} className="num">{m.short} ₹/kWh</th>)}{MARKETS.map((m) => <th key={m.key} className="num">{m.short} MW</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.date}-${row.block}`} className={row.block === 1 && view.mode === 'range' ? 'ecv-dayrow' : undefined}>
                          {view.mode === 'range' ? <td className="nowrap">{formatDate(row.date)}</td> : null}
                          <td>{row.block}</td><td className="nowrap">{blockStart(row.block)}–{blockEnd(row.block)}</td>
                          {MARKETS.map((m) => <td key={m.key} className="num">{row.mcp[m.key] != null ? row.mcp[m.key]!.toFixed(4) : '—'}</td>)}
                          {MARKETS.map((m) => <td key={m.key} className="num">{row.mcv[m.key] != null ? inr(Math.round(row.mcv[m.key]!)) : '—'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="ecv-empty" role="status"><div><b>No blocks to show for {label}</b></div></div>}
              {pg.pages > 1 ? <Pagination page={pg.page} pages={pg.pages} size={pg.size} total={pg.total} hrefFor={pageHref} unit="blocks" /> : null}
            </Card>
          </section>
        </WidgetCell>
      </WidgetGrid>
    </Shell>
  );
}

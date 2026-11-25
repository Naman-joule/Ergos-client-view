import type React from 'react';
import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { syncLagMinutes } from '@/lib/queries/sync';
import { MARKETS, iexDateRange, loadIex } from '@/lib/queries/iex';
import { addDays, blockEnd, blockStart, currentBlock, formatDateLong, istToday } from '@/lib/time';
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
import { IexDayChart, IexTrendChart } from '@/components/charts/IexCharts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'IEX prices' };

// Market-wide: no client or plant. Same page for every signed-in user with view_iex.
export default async function IexPricesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_iex');
  const sp = await searchParams;
  const today = istToday();
  const asked = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;

  const { data, lag, range } = await withUser(user.id, async (q) => {
    const range = await iexDateRange(q);
    // default: today; before today's prices exist (or with no data today), the latest day that has them
    const max = range.latest && range.latest > today ? range.latest : today;
    let date = asked && asked <= max ? asked : today;
    if (!asked && range.latest && range.latest < today) date = range.latest;
    const [data, lag] = await Promise.all([loadIex(q, date, range), syncLagMinutes(q)]);
    return { data, lag, range };
  });
  const max = range.latest && range.latest > today ? range.latest : today;
  const dayLabel = formatDateLong(data.date);
  const fmt = (v: number | null | undefined) => (v != null ? `₹${v.toFixed(2)}` : '—');
  const at = (b: number | undefined) => (b ? `${blockStart(b)}–${blockEnd(b)}` : '');

  return (
    <Shell user={user} page="prices" liveBlock={currentBlock()} syncLag={lag} themeMode="dark">
      {!range.latest ? <Notice>IEX market prices haven’t been synced yet. They appear once the sync has IEX_DATABASE_URL and has run.</Notice> : null}
      {range.latest && !data.hasData ? <Notice>No IEX prices for {dayLabel}. Prices are available from {range.earliest} to {range.latest}.</Notice> : null}

      <section className="eg-glass ecv-scope" aria-label="Day">
        <div className="ecv-iexbar">
          <div className="ecv-iexbar__title"><b>Indian Energy Exchange · market clearing prices</b><span>Same for every client · DAM, RTM and GDAM · ₹/kWh per 15-minute block</span></div>
          <div className="ecv-scope__controls">
            <DayPager date={data.date} today={today} max={max} hrefFor={(d) => href('/market/prices', { date: d })} />
            {range.latest && range.latest > today && data.date !== range.latest
              ? <a className="eg-btn eg-btn--sm eg-btn--ghost" href={href('/market/prices', { date: range.latest })}>Tomorrow’s DAM</a> : null}
            <a className="ecv-sheet ecv-sheet--excel ecv-export" download href={`/api/export/iex?date=${data.date}`} title="Excel: every block of the day, and 30 days of daily averages">
              <Icon name="download" size={14} />Export
            </a>
          </div>
        </div>
      </section>
      <StickyBar title="IEX prices">
        <DayPager date={data.date} today={today} max={max} hrefFor={(d) => href('/market/prices', { date: d })} />
      </StickyBar>

      <WidgetGrid palette="harmony">
        <WidgetCell span="full" type="iex.tiles">
          <div className="ecv-tiles-wrap">
            <div className="ecv-tiles ecv-tiles--row" style={{ '--n': 4, '--n-md': 2 } as React.CSSProperties}>
              {data.markets.map((m, i) => (
                <StatTile key={m.key} series={MARKETS[i]!.slot} label={MARKETS[i]!.label} icon="exchange" date={dayLabel}
                  value={fmt(m.avg)} unit="/ kWh"
                  foot={m.blocks ? `Low ${fmt(m.min?.rate)} ${at(m.min?.block)} · High ${fmt(m.max?.rate)} ${at(m.max?.block)}` : 'No prices for this day'} />
              ))}
              <StatTile series="demand" label="Cleared volume" icon="bolt" date={dayLabel}
                value={inr(Math.round(data.markets.reduce((s, m) => s + m.mwh, 0)))} unit="MWh"
                foot={data.markets.map((m) => `${m.key} ${inr(Math.round(m.mwh))}`).join(' · ')} />
            </div>
          </div>
        </WidgetCell>

        <WidgetCell span="full" type="iex.day">
          <Card title="Market clearing price" sub={`${dayLabel} · volume-weighted averages in the tiles · hover a block for prices and cleared MW`}
            actions={<div className="eg-legend">{MARKETS.map((m) => <span key={m.key}><span className="eg-swatch" data-series={m.slot} />{m.short}</span>)}</div>}>
            {data.hasData
              ? <IexDayChart dayLabel={dayLabel} markets={data.markets.map((m, i) => ({ key: m.key, label: MARKETS[i]!.short, slot: MARKETS[i]!.slot, mcp: m.mcp, mcv: m.mcv }))} />
              : <div className="ecv-empty" role="status"><div><b>No prices for this day</b></div></div>}
          </Card>
        </WidgetCell>

        <WidgetCell span="full" type="iex.trend">
          <Card title="Last 30 days" sub={`Daily volume-weighted clearing price, ${formatDateLong(addDays(data.date, -29))} to ${dayLabel}`}>
            <IexTrendChart trend={data.trend} markets={MARKETS.map((m) => ({ key: m.key, label: m.short, slot: m.slot }))} />
          </Card>
        </WidgetCell>

        <WidgetCell span="full" type="iex.table">
          <Card title="Blocks" sub={`${dayLabel} · clearing price ₹/kWh and cleared volume MW`}>
            <div className="ecv-table-wrap">
              <table className="ecv-table">
                <thead>
                  <tr><th>Block</th><th>Time</th>{MARKETS.map((m) => <th key={m.key} className="num">{m.short} ₹/kWh</th>)}{MARKETS.map((m) => <th key={m.key} className="num">{m.short} MW</th>)}</tr>
                </thead>
                <tbody>
                  {Array.from({ length: 96 }, (_, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td><td className="nowrap">{blockStart(i + 1)}–{blockEnd(i + 1)}</td>
                      {data.markets.map((m) => <td key={m.key} className="num">{m.mcp[i] != null ? m.mcp[i]!.toFixed(4) : '—'}</td>)}
                      {data.markets.map((m) => <td key={m.key} className="num">{m.mcv[i] != null ? inr(Math.round(m.mcv[i]!)) : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </WidgetCell>
      </WidgetGrid>
    </Shell>
  );
}

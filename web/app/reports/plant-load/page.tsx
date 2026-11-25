import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { latestMeterDate } from '@/lib/queries/today';
import { lastReading, loadPlantLoad, type LoadBlock, type LoadFlag } from '@/lib/queries/plant-load';
import { blockEnd, blockStart, currentBlock, formatDateLong, isYmd, istToday } from '@/lib/time';
import { inr } from '@/lib/format';
import { href, one, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { DayPager } from '@/components/shell/DayPager';
import { ReportTabs } from '@/components/shell/ReportTabs';
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

export default async function PlantLoadPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_today');
  const sp = await searchParams;
  const today = istToday();
  const asked = one(sp.date);
  const explicit = isYmd(asked) && asked <= today ? asked : null;

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    // No date asked: the latest day with readings (a logger that uploads daily has nothing for today yet)
    const [latest, last] = await Promise.all([latestMeterDate(q, sel.plant.plant_id), lastReading(q, sel.plant.plant_id)]);
    const date = explicit ?? (latest && latest < today ? latest : today);
    const report = await loadPlantLoad(q, sel.plant.plant_id, date);
    return { scope, sel, lag, date, last, report } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="load" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, date, last, report } = view;
  const s = report.summary;
  const link = (o: { plant?: number; date?: string | null }) =>
    href('/reports/plant-load', { client: sel.client.client_id, plant: o.plant ?? sel.plant.plant_id, date: o.date === undefined ? explicit : o.date });
  const day = formatDateLong(date);
  const logged = s.real + s.interpolated + s.other;
  const hasData = logged > 0;
  const shown = report.blocks.filter((b) => b.readings > 0 || b.block <= (date === today ? currentBlock() - 1 : 96));

  return (
    <Shell user={user} page="load" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
        clientHref={(c) => href('/reports/plant-load', { client: c.client_id })}
        plantHref={(p) => link({ plant: p.plant_id })}
        controls={<>
          <ReportTabs user={user} current="load" client={sel.client.client_id} plant={sel.plant.plant_id} />
          <DayPager date={date} today={today} hrefFor={(d) => link({ date: d === today ? null : d })} />
        </>} />

      <div className="ecv-stack">
        <p className="ecv-load__source">
          Captured by the plant’s data logger meter. Latest reading received: <b>{last ? `${formatDateLong(last.slice(0, 10))}, ${last.slice(11)} IST` : 'none yet'}</b>.
          {last && last.slice(0, 10) < today ? ' Nothing has arrived for today yet; it appears here once the logger’s data reaches ergOS.' : ''}
        </p>

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

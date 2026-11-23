import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { latestMeterDate, loadToday } from '@/lib/queries/today';
import { syncLagMinutes } from '@/lib/queries/sync';
import { loadSpec } from '@/lib/dashboard/load';
import { visibleToday } from '@/lib/dashboard/registry';
import { currentBlock, formatDateLong, isYmd, istToday } from '@/lib/time';
import { href, one, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { DayPager } from '@/components/shell/DayPager';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { TodayWidgetView } from '@/components/widgets/today/TodayWidgets';
import { Empty, Notice } from '@/components/ui/Empty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Today' };

export default async function TodayPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_today');
  const sp = await searchParams;
  const today = istToday();
  const asked = one(sp.date);
  const explicit = isYmd(asked) && asked <= today ? asked : null;   // no future dates

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    // Without a date in the URL, open on today, or on the plant's latest day with readings if today has none yet.
    let date = explicit ?? today;
    let fellBack = false;
    if (!explicit) {
      const latest = await latestMeterDate(q, sel.plant.plant_id);
      if (latest && latest < today) { date = latest; fellBack = true; }
    }
    const [loaded, data] = await Promise.all([loadSpec(q, sel.client.client_id), loadToday(q, sel.plant.plant_id, date)]);
    return { scope, sel, lag, loaded, data, date, fellBack } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="today" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, loaded, data, date, fellBack } = view;
  const widgets = visibleToday(loaded.spec, user.permissions);
  const link = (o: { plant?: number; date?: string }) => {
    const d = o.date ?? explicit;          // switching plant keeps only a date the user picked
    return href('/today', { client: sel.client.client_id, plant: o.plant ?? sel.plant.plant_id, date: d && d !== today ? d : null });
  };

  return (
    <Shell user={user} page="today" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode}>
      {loaded.error && user.permissions.has('manage_dashboards') ? <Notice>{loaded.error}</Notice> : null}
      {fellBack ? <Notice>No readings for today yet for {sel.plant.name}. Showing the latest day with data, {formatDateLong(date)}.</Notice> : null}
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
        clientHref={(c) => href('/today', { client: c.client_id, date: explicit && explicit !== today ? explicit : null })}
        plantHref={(p) => link({ plant: p.plant_id })}
        controls={<DayPager date={date} today={today} hrefFor={(d) => link({ date: d })} />} />
      {widgets.length ? (
        <WidgetGrid palette={loaded.spec.theme.palette}>
          {widgets.map((w) => (
            <WidgetCell key={w.type} span={w.span} type={w.type}>
              <TodayWidgetView w={w} ctx={{ data, plant: sel.plant }} />
            </WidgetCell>
          ))}
        </WidgetGrid>
      ) : <Empty title="No widgets to show" icon="apps">This layout has no widgets your role can see.</Empty>}
    </Shell>
  );
}

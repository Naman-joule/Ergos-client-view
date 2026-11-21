import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { loadToday } from '@/lib/queries/today';
import { syncLagMinutes } from '@/lib/queries/sync';
import { loadSpec } from '@/lib/dashboard/load';
import { visibleToday } from '@/lib/dashboard/registry';
import { currentBlock, isYmd, istToday } from '@/lib/time';
import { href, one, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { PlantStrip } from '@/components/shell/PlantStrip';
import { DayPager } from '@/components/shell/DayPager';
import { ClientSelect } from '@/components/shell/ClientSelect';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { TodayWidgetView } from '@/components/widgets/today/TodayWidgets';
import { Empty, Notice } from '@/components/ui/Empty';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Today' };

export default async function TodayPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_today');
  const sp = await searchParams;
  const today = istToday();
  const asked = one(sp.date);
  const date = isYmd(asked) && asked <= today ? asked : today;   // no future dates

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    const [loaded, data] = await Promise.all([loadSpec(q, sel.client.client_id), loadToday(q, sel.plant.plant_id, date)]);
    return { scope, sel, lag, loaded, data } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="today" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, loaded, data } = view;
  const widgets = visibleToday(loaded.spec, user.permissions);
  const link = (o: { plant?: number; date?: string }) =>
    href('/today', { client: sel.client.client_id, plant: o.plant ?? sel.plant.plant_id, date: (o.date ?? date) === today ? null : o.date ?? date });

  return (
    <Shell user={user} page="today" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode}>
      {loaded.error && user.permissions.has('manage_dashboards') ? <Notice>{loaded.error}</Notice> : null}
      <div className="ecv-frame">
        <div className="ecv-section-head">
          <h3><Icon name="factory" size={18} />{sel.client.name} <span className="eg-chip eg-chip--solid">{sel.plants.length} plant{sel.plants.length === 1 ? '' : 's'}</span></h3>
          <div className="eg-row">
            {view.scope.clients.length > 1 ? (
              <ClientSelect clients={view.scope.clients} current={sel.client.client_id} path="/today" keep={date === today ? {} : { date }} />
            ) : null}
            <DayPager date={date} today={today} hrefFor={(d) => link({ date: d })} />
          </div>
        </div>
        <PlantStrip plants={sel.plants} selected={sel.plant.plant_id} hrefFor={(p) => link({ plant: p.plant_id })} />
      </div>
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

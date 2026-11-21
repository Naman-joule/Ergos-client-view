import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { loadSavings, resolvePeriod } from '@/lib/queries/savings';
import { syncLagMinutes } from '@/lib/queries/sync';
import { loadSpec } from '@/lib/dashboard/load';
import { visibleSavings } from '@/lib/dashboard/registry';
import { currentBlock, istToday } from '@/lib/time';
import { href, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { PlantStrip } from '@/components/shell/PlantStrip';
import { ClientSelect } from '@/components/shell/ClientSelect';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { SavingsWidgetView } from '@/components/widgets/savings/SavingsWidgets';
import { Empty, Notice } from '@/components/ui/Empty';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Savings' };

export default async function SavingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_savings');
  const sp = await searchParams;
  const today = istToday();
  const period = resolvePeriod(sp, today);

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    const loaded = await loadSpec(q, sel.client.client_id);
    const profile = loaded.spec.pages.savings.widgets.find((w) => w.type === 'savings.profile');
    const data = await loadSavings(q, sel.plant.plant_id, period, profile && 'days' in profile ? profile.days : null);
    return { scope, sel, lag, loaded, data } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="savings" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, loaded, data } = view;
  const widgets = visibleSavings(loaded.spec, user.permissions);
  const link = (plant: number) => href('/savings', { client: sel.client.client_id, plant, from: period.from, to: period.to });

  return (
    <Shell user={user} page="savings" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode}>
      {loaded.error && user.permissions.has('manage_dashboards') ? <Notice>{loaded.error}</Notice> : null}
      <div className="ecv-frame">
        <div className="ecv-section-head">
          <h3><Icon name="factory" size={18} />{sel.client.name} <span className="eg-chip eg-chip--solid">{sel.plants.length} plant{sel.plants.length === 1 ? '' : 's'}</span></h3>
          {view.scope.clients.length > 1 ? (
            <ClientSelect clients={view.scope.clients} current={sel.client.client_id} path="/savings" keep={{ from: period.from, to: period.to }} />
          ) : null}
        </div>
        <PlantStrip plants={sel.plants} selected={sel.plant.plant_id} hrefFor={(p) => link(p.plant_id)} />
        <form method="get" action="/savings" className="ecv-period">
          <input type="hidden" name="client" value={sel.client.client_id} />
          <input type="hidden" name="plant" value={sel.plant.plant_id} />
          <div className="eg-seg eg-seg--glass" role="group" aria-label="Period presets">
            <button type="submit" name="preset" value="this_month" aria-pressed={period.preset === 'this_month'}>This month</button>
            <button type="submit" name="preset" value="last_month" aria-pressed={period.preset === 'last_month'}>Last month</button>
            <button type="submit" name="preset" value="last_30" aria-pressed={period.preset === 'last_30'}>Last 30 days</button>
          </div>
          <div className="eg-row">
            <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
              <input type="date" name="from" defaultValue={period.from} max={today} aria-label="From" /></label>
            <Icon name="arrow-right" size={15} />
            <label className="eg-input ecv-date"><Icon name="calendar" size={16} />
              <input type="date" name="to" defaultValue={period.to} max={today} aria-label="To" /></label>
            <button className="eg-btn eg-btn--primary" type="submit"><Icon name="bolt" size={16} />Show savings</button>
          </div>
          {period.clamped ? <span className="eg-chip eg-chip--warning">Range limited to 366 days</span> : null}
          {period.to >= today ? <span className="eg-chip eg-chip--warning">Today has no statement until it is locked</span> : null}
        </form>
      </div>
      {widgets.length ? (
        <WidgetGrid palette={loaded.spec.theme.palette}>
          {widgets.map((w) => (
            <WidgetCell key={w.type} span={w.span} type={w.type}>
              <SavingsWidgetView w={w} ctx={{ data, plant: sel.plant, period }} />
            </WidgetCell>
          ))}
        </WidgetGrid>
      ) : <Empty title="No widgets to show" icon="apps">This layout has no widgets your role can see.</Empty>}
    </Shell>
  );
}

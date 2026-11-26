import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { rememberedScope } from '@/lib/remembered';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { latestStatementDate, loadSavings, periodEndingAt, resolvePeriod } from '@/lib/queries/savings';
import { syncLagMinutes } from '@/lib/queries/sync';
import { loadSpec } from '@/lib/dashboard/load';
import { visibleSavings } from '@/lib/dashboard/registry';
import { currentBlock, formatDate, formatRange, istToday } from '@/lib/time';
import { href, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { WidgetCell, WidgetGrid } from '@/components/widgets/WidgetGrid';
import { SavingsWidgetView } from '@/components/widgets/savings/SavingsWidgets';
import { Empty, Notice } from '@/components/ui/Empty';
import { isInternal } from '@/lib/audience';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Savings' };

export default async function SavingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_savings');
  const sp = await searchParams;
  const today = istToday();
  const asked = resolvePeriod(sp, today);

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant }, await rememberedScope());
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    const loaded = await loadSpec(q, sel.client.client_id);
    const profile = loaded.spec.pages.savings.widgets.find((w) => w.type === 'savings.profile');
    const days = profile && 'days' in profile ? profile.days : null;
    const { plant_id: plantId, name: plantName } = sel.plant;
    let period = asked;
    let data = await loadSavings(q, plantId, plantName, period, days);
    // Nothing in the period: find the plant's latest statement. Without a range in the URL, show
    // that month instead of an empty page; with one, say where the data is.
    const latest = data.rows.length ? null : await latestStatementDate(q, plantId, plantName);
    let fellBack = false;
    if (latest && !asked.explicit) {
      period = periodEndingAt(latest);
      data = await loadSavings(q, plantId, plantName, period, days);
      fellBack = true;
    }
    return { scope, sel, lag, loaded, data, period, latest, fellBack } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="savings" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  const { sel, loaded, data, period, latest, fellBack } = view;
  const widgets = visibleSavings(loaded.spec, user.permissions);
  // Switching plant or client keeps only a range the user picked, so each plant opens on its own latest data.
  const keepRange: Record<string, string> = asked.preset ? { preset: asked.preset } : asked.explicit ? { from: asked.from, to: asked.to } : {};
  const internal = isInternal(user);
  const link = (plant: number) => href('/savings', { client: sel.client.client_id, plant, ...keepRange });

  return (
    <Shell user={user} page="savings" liveBlock={currentBlock()} syncLag={view.lag} themeMode={loaded.spec.theme.mode}>
      {loaded.error && user.permissions.has('manage_dashboards') ? <Notice>{loaded.error}</Notice> : null}
      {fellBack ? <Notice>No statements for {sel.plant.name} so far this month. Showing {formatRange(period.from, period.to)}, up to its latest statement.</Notice> : null}
      {!data.rows.length && latest && !fellBack ? (
        <Notice>No statements for {sel.plant.name} between {formatRange(period.from, period.to)}. Its latest statement is for {formatDate(latest)}. <a className="ecv-link" href={href('/savings', { client: sel.client.client_id, plant: sel.plant.plant_id, from: periodEndingAt(latest).from, to: latest })}>Show that month</a></Notice>
      ) : null}
      {/* data-quality detail for Joulewise staff; clients get one plain line */}
      {internal && data.totals.impliedDays > 0 ? (
        <Notice>ergOS stores no grid cost for {data.totals.impliedDays} day{data.totals.impliedDays === 1 ? '' : 's'} in this period. Savings are ergOS’s own figures;
          the grid cost and benchmark for {data.totals.impliedDays === 1 ? 'that day' : 'those days'} are worked back from them (IEX cost + savings) and marked ≈.</Notice>
      ) : null}
      {internal && data.totals.estimatedDays > 0 ? (
        <Notice>ergOS has no savings figure for {data.totals.estimatedDays} day{data.totals.estimatedDays === 1 ? '' : 's'} in this period.
          For {data.totals.estimatedDays === 1 ? 'it' : 'those days'}, the benchmark, grid cost and savings are estimated from the plant’s DISCOM ToD tariff
          (its voltage level plus FPPCA, per cleared 15-minute block) and marked ≈. They will be replaced by ergOS’s figures once ergOS prices {data.totals.estimatedDays === 1 ? 'that day' : 'those days'}.</Notice>
      ) : null}
      {!internal && data.totals.impliedDays + data.totals.estimatedDays > 0 ? (
        <p className="ecv-clientnote">Figures marked ≈ ({data.totals.impliedDays + data.totals.estimatedDays} day{data.totals.impliedDays + data.totals.estimatedDays === 1 ? '' : 's'}) are provisional and will update once the day’s statement is final.</p>
      ) : null}
      {!data.rows.length && !latest ? <Notice>No daily savings statements for {sel.plant.name} yet. They appear once they’re final, usually the day after trading.</Notice> : null}
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant} denied={sel.denied}
        clientHref={(c) => href('/savings', { client: c.client_id, ...keepRange })}
        plantHref={(p) => link(p.plant_id)}
        controls={
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
        } />
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

import type { DashboardSpec, SavingsWidget, TodayWidget, WidgetType } from './schema.ts';

export type Permission =
  | 'view_today' | 'view_savings' | 'view_iex' | 'view_banking' | 'view_billing' | 'manage_dashboards' | 'admin_access';

/** The permission each widget needs. Whatever the config says, widgets the user can't see are dropped. */
export const WIDGET_PERMISSION: Record<WidgetType, Permission> = {
  'today.folder': 'view_today',
  'today.tiles': 'view_today',
  'today.supply': 'view_today',
  'today.prebid': 'view_iex',
  'today.banking': 'view_banking',
  'savings.folder': 'view_savings',
  'savings.tiles': 'view_savings',
  'savings.daily': 'view_savings',
  'savings.charges': 'view_savings',
  'savings.tod': 'view_savings',
  'savings.profile': 'view_savings',
  'savings.table': 'view_savings',
};

/** Widgets retired from the Energy page. Saved client configs may still list them; they're skipped, not errors. */
const RETIRED: ReadonlySet<string> = new Set(['today.prebid', 'today.banking']);

export function visibleToday(spec: DashboardSpec, perms: ReadonlySet<string>): TodayWidget[] {
  return spec.pages.today.widgets.filter((w) => !RETIRED.has(w.type) && perms.has(WIDGET_PERMISSION[w.type]));
}
export function visibleSavings(spec: DashboardSpec, perms: ReadonlySet<string>): SavingsWidget[] {
  return spec.pages.savings.widgets.filter((w) => perms.has(WIDGET_PERMISSION[w.type]));
}

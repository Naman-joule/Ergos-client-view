// The per-client dashboard contract. A stored dashboard_config.spec must validate against
// DashboardSpecSchema; unknown fields, unknown widget types and duplicate widgets are rejected.
import { z } from 'zod';

export const PALETTES = ['harmony', 'volt', 'verdant', 'aurora'] as const;
export const SPANS = ['full', 'wide', 'narrow', 'half', 'third'] as const;
export const TODAY_TILES = ['grid', 'iex', 'solar', 'peak', 'demand', 'iex_price'] as const;
export const SAVINGS_TILES = ['volume', 'landed', 'benchmark', 'savings', 'percent_below'] as const;

const base = {
  span: z.enum(SPANS).default('full'),
  title: z.string().trim().min(1).max(60).optional(),
};

const uniqueList = <T extends string>(values: readonly [T, ...T[]], min: number, max: number) =>
  z.array(z.enum(values)).min(min).max(max).refine((a) => new Set(a).size === a.length, 'tiles must not repeat');

const w = <T extends string, S extends z.ZodRawShape>(type: T, extra: S) =>
  z.strictObject({ type: z.literal(type), ...base, ...extra });

export const TodayWidgetSchema = z.discriminatedUnion('type', [
  w('today.folder', {}),
  w('today.tiles', { tiles: uniqueList(TODAY_TILES, 1, 6) }),
  w('today.supply', {}),
  w('today.prebid', {}),
  w('today.banking', {}),
]);

export const SavingsWidgetSchema = z.discriminatedUnion('type', [
  w('savings.folder', {}),
  w('savings.tiles', { tiles: uniqueList(SAVINGS_TILES, 1, 4) }),
  w('savings.daily', {}),
  w('savings.charges', {}),
  w('savings.tod', {}),
  w('savings.profile', { days: z.number().int().min(3).max(14).default(7) }),
  w('savings.table', {}),
]);

const onePerType = <T extends { type: string }>(widgets: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  widgets.forEach((wd, i) => {
    if (seen.has(wd.type)) ctx.addIssue({ code: 'custom', message: `${wd.type} appears more than once`, path: [i, 'type'] });
    seen.add(wd.type);
  });
};

export const DashboardSpecSchema = z.strictObject({
  version: z.literal(1),
  theme: z.strictObject({
    palette: z.enum(PALETTES).default('harmony'),
    mode: z.enum(['dark', 'light']).default('dark'),
  }),
  pages: z.strictObject({
    today: z.strictObject({ widgets: z.array(TodayWidgetSchema).max(10).superRefine(onePerType) }),
    savings: z.strictObject({ widgets: z.array(SavingsWidgetSchema).max(10).superRefine(onePerType) }),
  }),
});

export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;
export type TodayWidget = z.infer<typeof TodayWidgetSchema>;
export type SavingsWidget = z.infer<typeof SavingsWidgetSchema>;
export type Widget = TodayWidget | SavingsWidget;
export type WidgetType = Widget['type'];
export type Span = (typeof SPANS)[number];
export type PaletteName = (typeof PALETTES)[number];

export function validateSpec(input: unknown):
  | { ok: true; spec: DashboardSpec }
  | { ok: false; error: string } {
  const r = DashboardSpecSchema.safeParse(input);
  if (r.success) return { ok: true, spec: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}

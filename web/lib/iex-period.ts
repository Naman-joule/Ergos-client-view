// IEX prices page: which days to show and which page of the block table. Pure, so node:test can cover it.
// No imports, so the node:test suite can load it directly.
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const IEX_MAX_DAYS = 366;
export const PAGE_SIZES = [24, 48, 96, 200] as const;
export type IexPreset = 'last7' | 'last30' | 'mtd';
export type IexView =
  | { mode: 'day'; from: string; to: string; preset: null; clamped: false }
  | { mode: 'range'; from: string; to: string; preset: IexPreset | null; clamped: boolean };

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * ?preset=last7|last30|mtd, or ?from=&to= → a range; otherwise ?date= (or the default day) → one day.
 * `max` is the last selectable day (today, or tomorrow once its DAM is published). A range ends no later than
 * max, starts no later than it ends, and spans at most IEX_MAX_DAYS days.
 */
export function resolveIexView(sp: { date?: unknown; from?: unknown; to?: unknown; preset?: unknown },
  defaultDay: string, max: string): IexView {
  const preset = one(sp.preset);
  const end = defaultDay;            // presets end on the default day (today, or the latest day with prices)
  if (preset === 'last7') return { mode: 'range', from: addDays(end, -6), to: end, preset, clamped: false };
  if (preset === 'last30') return { mode: 'range', from: addDays(end, -29), to: end, preset, clamped: false };
  if (preset === 'mtd') return { mode: 'range', from: `${end.slice(0, 8)}01`, to: end, preset, clamped: false };
  const f = one(sp.from), t = one(sp.to);
  if (isYmd(f) || isYmd(t)) {
    let to = isYmd(t) ? t : end;
    if (to > max) to = max;
    let from = isYmd(f) ? f : addDays(to, -6);
    if (from > to) [from, to] = [to, from];
    let clamped = false;
    if (days(from, to) > IEX_MAX_DAYS) { from = addDays(to, -(IEX_MAX_DAYS - 1)); clamped = true; }
    return { mode: 'range', from, to, preset: null, clamped };
  }
  const d = one(sp.date);
  const date = isYmd(d) && d <= max ? d : defaultDay;
  return { mode: 'day', from: date, to: date, preset: null, clamped: false };
}

/** ?page= (1-based) and ?size= (one of PAGE_SIZES, default 96), with the page kept inside 1…pages. */
export function resolvePage(sp: { page?: unknown; size?: unknown }, total: number) {
  const s = Number(one(sp.size));
  const size = (PAGE_SIZES as readonly number[]).includes(s) ? s : 96;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.floor(Number(one(sp.page)));
  const page = Number.isFinite(p) && p >= 1 ? Math.min(p, pages) : 1;
  return { page, size, pages, offset: (page - 1) * size, total };
}

/** Page numbers to link: first, last, and a window around the current page; null marks a gap. */
export function pageWindow(page: number, pages: number, around = 1): (number | null)[] {
  const keep = new Set([1, pages]);
  for (let i = page - around; i <= page + around; i++) if (i >= 1 && i <= pages) keep.add(i);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of [...keep].sort((a, b) => a - b)) { if (n - prev > 1) out.push(null); out.push(n); prev = n; }
  return out;
}

// IST calendar and 15-minute block helpers. IST is UTC+05:30 with no daylight saving.
// Dates are 'YYYY-MM-DD' strings throughout, so a calendar day never shifts time zone.

export const IST_OFFSET_MIN = 330;
export const BLOCKS_PER_DAY = 96;

const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** Wall-clock IST parts for an instant. */
export function istParts(at: Date = new Date()) {
  const t = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

export function istToday(at: Date = new Date()): string {
  return istParts(at).date;
}

/** The block in progress, 1..96. Block 1 is 00:00–00:15. */
export function currentBlock(at: Date = new Date()): number {
  const { hour, minute } = istParts(at);
  return hour * 4 + Math.floor(minute / 15) + 1;
}

export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
}

export function monthStart(ymd: string): string {
  return ymd.slice(0, 8) + '01';
}

/** "HH:MM" at the start of a block: blockStart(37) === "09:00". */
export function blockStart(block: number): string {
  const m = (block - 1) * 15;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "HH:MM" at the end of a block: blockEnd(89) === "22:15", blockEnd(96) === "24:00". */
export function blockEnd(block: number): string {
  const m = block * 15;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "Block 89 · 22:15" (end time, as readouts show it). */
export function blockLabel(block: number): string {
  return `Block ${block} · ${blockEnd(block)}`;
}

/** "Block 37–64" style range label. */
export function blockRange(from: number, to: number): string {
  return from === to ? `Block ${from}` : `Blocks ${from}–${to}`;
}

const fmtLong = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtWeekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// en-IN inserts a comma before the year ("Tue, 13 Oct, 2026"); the design uses "Tue, 13 Oct 2026".
const stripYearComma = (s: string) => s.replace(/,\s(\d{4})$/, ' $1');

/** "Tue, 13 Oct 2026" */
export function formatDateLong(ymd: string): string {
  return stripYearComma(fmtLong.format(new Date(ymd + 'T00:00:00Z')));
}
/** "13 Oct 2026" */
export function formatDate(ymd: string): string {
  return stripYearComma(fmtShort.format(new Date(ymd + 'T00:00:00Z')));
}
/** "13 Oct" */
export function formatDayMonth(ymd: string): string {
  return fmtDayMonth.format(new Date(ymd + 'T00:00:00Z'));
}
/** "Tue, 13 Oct" */
export function formatWeekday(ymd: string): string {
  return fmtWeekday.format(new Date(ymd + 'T00:00:00Z'));
}
/** "1–13 Oct 2026" or "28 Sept – 3 Oct 2026" */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDate(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${formatDate(to)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatDayMonth(from)} – ${formatDate(to)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

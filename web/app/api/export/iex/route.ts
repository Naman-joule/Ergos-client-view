import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { iexRangeWorkbook, iexWorkbook } from '@/lib/export';
import { iexDateRange, loadIex, loadIexRange, loadIexRows } from '@/lib/queries/iex';
import { IEX_MAX_DAYS } from '@/lib/iex-period';
import { istToday } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/** GET /api/export/iex?date=<YYYY-MM-DD> : the day's blocks for DAM, RTM, GDAM, and 30 days of daily averages.
 *  GET /api/export/iex?from=&to= : every block in the range (up to IEX_MAX_DAYS days) and its daily averages. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to export data.');
  if (!user.permissions.has('view_iex')) return text(403, 'You do not have access to IEX prices.');
  const params = new URL(req.url).searchParams;
  const from = params.get('from'), to = params.get('to');
  const ymd = (v: string | null): v is string => v != null && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (from != null || to != null) {
    if (!ymd(from) || !ymd(to) || from > to) return text(400, 'Bad request.');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > IEX_MAX_DAYS) return text(400, `Ranges are limited to ${IEX_MAX_DAYS} days.`);
    const [span, rows] = await withUser(user.id, async (q) =>
      Promise.all([loadIexRange(q, from, to), loadIexRows(q, from, to, 0, IEX_MAX_DAYS * 96)]));
    const stamp = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
    return new Response(new Uint8Array(await iexRangeWorkbook(span, rows, stamp)), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="IEX_prices_${from}_to_${to}.xlsx"`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  const date = params.get('date') ?? istToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return text(400, 'Bad request.');
  const data = await withUser(user.id, async (q) => loadIex(q, date, await iexDateRange(q)));
  const now = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
  return new Response(new Uint8Array(await iexWorkbook(data, now)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="IEX_prices_${date}.xlsx"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    },
  });
}

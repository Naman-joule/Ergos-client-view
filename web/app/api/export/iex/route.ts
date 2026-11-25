import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { iexWorkbook } from '@/lib/export';
import { iexDateRange, loadIex } from '@/lib/queries/iex';
import { istToday } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/** GET /api/export/iex?date=<YYYY-MM-DD> : the day's blocks for DAM, RTM, GDAM, and 30 days of daily averages. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to export data.');
  if (!user.permissions.has('view_iex')) return text(403, 'You do not have access to IEX prices.');
  const date = new URL(req.url).searchParams.get('date') ?? istToday();
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

import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { historyWorkbook } from '@/lib/export';
import { HISTORY_MAX_DAYS, loadHistory, resolveHistoryPeriod } from '@/lib/queries/history';
import { istToday } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const slug = (s: string) => s.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');

/**
 * GET /api/export/energy?plant=<id>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>   (or &preset=mtd|last7)
 * Excel workbook with Block-wise, Day-wise and ToD-wise sheets. Today exports one day (from = to).
 * Access is decided by the database: the plant must be visible to the signed-in user (RLS).
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to export data.');
  if (!user.permissions.has('view_today')) return text(403, 'You do not have access to energy data.');

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const plantId = Number(sp.plant);
  if (!Number.isInteger(plantId) || plantId <= 0) return text(400, 'Bad request.');
  const period = resolveHistoryPeriod(sp, istToday());        // clamps to HISTORY_MAX_DAYS and to today

  const out = await withUser(user.id, async (q) => {
    const [plant] = await q<{ name: string; client: string | null }>(
      `SELECT p.name, c.name AS client FROM plant p LEFT JOIN client c ON c.client_id = p.client_id WHERE p.plant_id = $1`, [plantId]);
    if (!plant) return null;                                   // not visible: same answer as missing
    return { plant, data: await loadHistory(q, plantId, period, { detail: true }) };
  });
  if (!out) return text(404, 'Not found.');

  const now = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
  const buf = await historyWorkbook(out.data, { plant: out.plant.name, client: out.plant.client ?? '', from: period.from, to: period.to, generatedAt: now });
  const name = `${slug(out.plant.name)}_${period.from === period.to ? period.from : `${period.from}_to_${period.to}`}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(period.clamped ? { 'X-Range-Clamped': `max ${HISTORY_MAX_DAYS} days` } : {}),
    },
  });
}

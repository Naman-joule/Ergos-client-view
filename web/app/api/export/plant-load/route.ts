import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { plantLoadWorkbook } from '@/lib/export';
import { loadScope } from '@/lib/queries/scope';
import { loadMonthlyLoadReport } from '@/lib/queries/plant-load';
import { istToday } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOAD_REPORT_MAX_MONTHS = 24;

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const slug = (s: string) => s.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
const isMonth = (v: string | null): v is string => v != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const addMonths = (m: string, n: number) => {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7);
};

/**
 * GET /api/export/plant-load?client=<id>&from=<YYYY-MM>&to=<YYYY-MM>
 * Monthly maximum / minimum load workbook for every plant of the client the signed-in user can see (RLS decides),
 * from the meter readings: summary matrix, a detailed row per plant and month, connected load vs peak.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to export data.');
  if (!user.permissions.has('view_today')) return text(403, 'You do not have access to energy data.');
  const sp = new URL(req.url).searchParams;
  const clientId = Number(sp.get('client'));
  let from = sp.get('from'), to = sp.get('to');
  const today = istToday();
  if (!Number.isInteger(clientId) || clientId <= 0 || !isMonth(from) || !isMonth(to)) return text(400, 'Bad request.');
  if (from > to) [from, to] = [to, from];
  if (to > today.slice(0, 7)) to = today.slice(0, 7);
  if (from > to) return text(400, 'The period is in the future.');
  const months: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  if (months.length > LOAD_REPORT_MAX_MONTHS) return text(400, `Pick at most ${LOAD_REPORT_MAX_MONTHS} months.`);

  const out = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const client = scope.clients.find((c) => c.client_id === clientId);
    if (!client) return null;                                   // not visible: same answer as missing
    const plants = scope.plants.filter((p) => p.client_id === clientId);
    const last = (() => { const [y, m] = to!.split('-').map(Number) as [number, number];
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return end < today ? end : today; })();
    const rows = await loadMonthlyLoadReport(q, plants.map((p) => p.plant_id), `${from}-01`, last);
    return { client, plants, rows };
  });
  if (!out) return text(404, 'Not found.');

  const now = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
  const buf = await plantLoadWorkbook({
    client: out.client.alias_name || out.client.name,
    plants: out.plants.map((p) => ({ plant_id: p.plant_id, name: p.name, connected_load: p.connected_load })),
    months, rows: out.rows, generatedAt: now,
  });
  const name = `${slug(out.client.alias_name || out.client.name)}_Monthly_Min_Max_Load_${from}_to_${to}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    },
  });
}

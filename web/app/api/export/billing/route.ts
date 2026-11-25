import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { billingWorkbook } from '@/lib/export';
import { loadBilling, resolveBillingMonths } from '@/lib/queries/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const slug = (s: string) => s.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');

/** GET /api/export/billing?plant=<id>&months=3|6|12 : Excel with Monthly and Day-wise sheets (RLS-checked). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to export data.');
  if (!user.permissions.has('view_billing')) return text(403, 'You do not have access to billing.');
  const sp = new URL(req.url).searchParams;
  const plantId = Number(sp.get('plant'));
  if (!Number.isInteger(plantId) || plantId <= 0) return text(400, 'Bad request.');
  const months = resolveBillingMonths(sp.get('months'));
  const out = await withUser(user.id, async (q) => {
    const [plant] = await q<{ name: string; client: string | null }>(
      `SELECT p.name, c.name AS client FROM plant p LEFT JOIN client c ON c.client_id = p.client_id WHERE p.plant_id = $1`, [plantId]);
    return plant ? { plant, data: await loadBilling(q, plantId, months) } : null;
  });
  if (!out) return text(404, 'Not found.');
  const now = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
  const buf = await billingWorkbook(out.data, { plant: out.plant.name, client: out.plant.client ?? '', from: out.data.from, to: out.data.to, generatedAt: now });
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${slug(out.plant.name)}_billing_${out.data.from.slice(0, 7)}_to_${out.data.to.slice(0, 7)}.xlsx"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    },
  });
}

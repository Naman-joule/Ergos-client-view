import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { isUnderRoot } from '@/lib/obligation';
import { getObligationFile, obligationFtpConfigured } from '@/lib/obligation-ftp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * GET /api/obligation-reports/file?id=<report id>[&download=1]
 * Streams one obligation report. The row must be visible to the user (RLS: their plants); the file path
 * comes from that row, never from the request.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to view reports.');
  if (!user.permissions.has('view_iex')) return text(403, 'You do not have access to IEX reports.');
  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return text(400, 'Bad request.');

  const [row] = await withUser(user.id, (q) => q<{ file_path: string; market: string; delivery_date: string; plant: string }>(
    `SELECT r.file_path, r.market, r.delivery_date, p.name AS plant
       FROM iex_obligation_report r JOIN plant p ON p.plant_id = r.plant_id WHERE r.id = $1`, [id]));
  if (!row || !isUnderRoot(row.file_path)) return text(404, 'Not found.');
  if (!obligationFtpConfigured()) return text(503, 'Report storage is not set up on the server.');

  try {
    const { stream, size } = await getObligationFile(row.file_path);
    const name = `IEX_${row.market}_DOR_${row.plant.replace(/[^\w-]+/g, '_')}_${row.delivery_date}.pdf`;
    const disp = sp.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disp}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...(size != null ? { 'Content-Length': String(size) } : {}),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    console.error('obligation: ftp error:', (e as Error).message);
    return text(502, 'The report server could not be reached, or the file is missing. Try again in a minute.');
  }
}

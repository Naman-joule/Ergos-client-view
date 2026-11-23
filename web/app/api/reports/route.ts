import { Readable, PassThrough } from 'node:stream';
import { Client } from 'basic-ftp';
import { currentUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { statementFilePath } from '@/lib/queries/savings';
import { REPORT_KINDS, ftpSettings, isReportKind, locateReport, reportFileName } from '@/lib/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const text = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * GET /api/reports?plant=<id>&date=<YYYY-MM-DD>&kind=excel|pdf|docx|zip
 * Streams one day's savings sheet. Access is decided by the database (RLS): the plant and the
 * statement row must be visible to the signed-in user. The file path never comes from the request.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return text(401, 'Sign in to download reports.');
  if (!user.permissions.has('view_savings')) return text(403, 'You do not have access to savings.');

  const sp = new URL(req.url).searchParams;
  const plantId = Number(sp.get('plant'));
  const date = sp.get('date') ?? '';
  const kind = sp.get('kind');
  if (!Number.isInteger(plantId) || plantId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isReportKind(kind)) {
    return text(400, 'Bad request.');
  }
  const spec = REPORT_KINDS[kind];

  const stored = await withUser(user.id, async (q) => {
    const [plant] = await q<{ name: string }>('SELECT name FROM plant WHERE plant_id = $1', [plantId]);   // RLS-filtered
    if (!plant) return undefined;
    return statementFilePath(q, plantId, plant.name, date, spec.column);
  });
  if (stored === undefined) return text(404, 'Not found.');      // plant not visible: same answer as missing
  const loc = locateReport(stored);
  if (!loc) return text(404, `No ${spec.label} file for this day.`);
  if (loc.via === 'url') return Response.redirect(loc.url, 302);

  const client = new Client(20_000);
  try {
    const s = ftpSettings();
    await client.access({ host: s.host, port: s.port, user: s.user, password: s.password, secure: s.secure,
      secureOptions: s.secure ? { servername: s.host } : undefined });
    let size: number | null = null;
    try { size = await client.size(loc.path); } catch { client.close(); return text(404, `The ${spec.label} file for this day is missing on the report server.`); }

    const body = new PassThrough();
    client.downloadTo(body, loc.path)
      .then(() => body.end())
      .catch((e: Error) => { console.error('reports: download failed:', e.message); body.destroy(e); })
      .finally(() => client.close());

    const name = reportFileName(loc.path, `${date}-${kind}`);
    return new Response(Readable.toWeb(body) as ReadableStream, {
      headers: {
        'Content-Type': spec.type,
        'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...(size != null ? { 'Content-Length': String(size) } : {}),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    client.close();
    console.error('reports: ftp error:', (e as Error).message);
    return text(502, 'The report server could not be reached. Try again in a minute.');
  }
}

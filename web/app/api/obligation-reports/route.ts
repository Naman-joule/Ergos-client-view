import { currentUser } from '@/lib/auth';
import { withUser, withUserWrite } from '@/lib/db';
import { MAX_OBLIGATION_BYTES, isObligationMarket, looksLikePdf, obligationPath } from '@/lib/obligation';
import { readObligationPdf } from '@/lib/obligation-pdf';
import { obligationFtpConfigured, putObligationFile } from '@/lib/obligation-ftp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, error, ...extra });

/**
 * POST /api/obligation-reports   multipart: plant, file (PDF), market (auto|DAM|RTM|…), replace (1 to overwrite)
 * Admins only. The delivery date and portfolio are read from the report itself, never from the file name.
 * One file per request (Vercel caps request bodies at 4.5 MB); the page uploads a batch one at a time.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, 'Sign in again.');
  if (!user.permissions.has('admin_access')) return fail(403, 'Only admins can upload obligation reports.');
  if (!obligationFtpConfigured()) return fail(503, 'Uploads are not set up: OBLIGATION_FTP_URL is missing on the server.');

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_OBLIGATION_BYTES + 64 * 1024) return fail(413, 'The file is too large (max 4 MB).');

  let form: FormData;
  try { form = await req.formData(); } catch { return fail(400, 'Bad upload.'); }
  const plantId = Number(form.get('plant'));
  const file = form.get('file');
  const marketIn = String(form.get('market') ?? 'auto');
  const replace = form.get('replace') === '1';
  if (!Number.isInteger(plantId) || plantId <= 0 || !(file instanceof File)) return fail(400, 'Bad upload.');
  if (marketIn !== 'auto' && !isObligationMarket(marketIn)) return fail(400, 'Unknown market.');
  if (!file.size) return fail(400, 'The file is empty.');
  if (file.size > MAX_OBLIGATION_BYTES) return fail(413, 'The file is too large (max 4 MB).');
  const name = (file.name || 'report.pdf').slice(0, 255);

  const data = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(data)) return fail(415, 'This is not a PDF.');
  const parsed = await readObligationPdf(data, name);
  if ('error' in parsed) return fail(422, parsed.error);
  const market = marketIn === 'auto' ? parsed.market : marketIn;
  // A day-ahead report (DAM, GDAM, HP-DAM) has a trading date; RTM doesn't. Refuse an override that contradicts it.
  const contradicts = market === 'RTM' ? Boolean(parsed.tradingDate) : market !== 'TAM' && !parsed.tradingDate;
  if (contradicts) {
    return fail(422, parsed.tradingDate
      ? `This is a day-ahead report (traded ${parsed.tradingDate}), so it can’t be filed as RTM.`
      : `This report has no trading date, so it’s a real-time (RTM) report and can’t be filed as ${market}.`);
  }
  const info = { market, deliveryDate: parsed.deliveryDate, tradingDate: parsed.tradingDate, portfolio: parsed.portfolioName ?? parsed.portfolioCode };

  // checks, as the signed-in user (RLS): plant visible, not a duplicate, portfolio consistent
  const check = await withUser(user.id, async (q) => {
    const [plant] = await q<{ name: string }>('SELECT name FROM plant WHERE plant_id = $1', [plantId]);
    if (!plant) return { error: 'Plant not found.' } as const;
    const [existing] = await q<{ id: number; original_name: string }>(
      'SELECT id, original_name FROM iex_obligation_report WHERE plant_id = $1 AND market = $2 AND delivery_date = $3', [plantId, market, parsed.deliveryDate]);
    let mismatch: string | null = null;
    if (parsed.portfolioCode) {
      const mine = await q<{ portfolio_code: string }>(
        'SELECT DISTINCT portfolio_code FROM iex_obligation_report WHERE plant_id = $1 AND portfolio_code IS NOT NULL', [plantId]);
      if (mine.length && !mine.some((r) => r.portfolio_code === parsed.portfolioCode)) {
        mismatch = `This report is for portfolio ${parsed.portfolioCode}${parsed.portfolioName ? ` (${parsed.portfolioName})` : ''}, but ${plant.name} already has reports for ${mine.map((r) => r.portfolio_code).join(', ')}. Check that the right plant is selected.`;
      } else {
        const [other] = await q<{ name: string }>(
          `SELECT p.name FROM iex_obligation_report r JOIN plant p ON p.plant_id = r.plant_id
            WHERE r.portfolio_code = $1 AND r.plant_id <> $2 LIMIT 1`, [parsed.portfolioCode, plantId]);
        if (other) mismatch = `Portfolio ${parsed.portfolioCode} is already filed under ${other.name}. Check that the right plant is selected.`;
      }
    }
    return { plant, existing, mismatch } as const;
  });
  if ('error' in check) return fail(404, check.error ?? 'Not found.');
  if (check.mismatch) return fail(409, check.mismatch, info);
  if (check.existing && !replace) {
    return fail(409, `${market} report for ${parsed.deliveryDate} is already uploaded (${check.existing.original_name}). Tick “Replace existing” to overwrite it.`, { ...info, exists: true });
  }

  const target = obligationPath(plantId, check.plant.name, market, parsed.deliveryDate);
  try {
    await putObligationFile(target, data);
  } catch (e) {
    console.error('obligation: upload failed:', (e as Error).message);
    return fail(502, 'The report server could not store the file. Try again in a minute.', info);
  }

  await withUserWrite(user.id, (q) => q(
    `INSERT INTO iex_obligation_report
       (plant_id, market, delivery_date, trading_date, portfolio_code, portfolio_name, file_path, original_name, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, app_user_id())
     ON CONFLICT (plant_id, market, delivery_date) DO UPDATE SET
       trading_date = EXCLUDED.trading_date, portfolio_code = EXCLUDED.portfolio_code, portfolio_name = EXCLUDED.portfolio_name,
       file_path = EXCLUDED.file_path, original_name = EXCLUDED.original_name, size_bytes = EXCLUDED.size_bytes,
       uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
    [plantId, market, parsed.deliveryDate, parsed.tradingDate, parsed.portfolioCode, parsed.portfolioName, target, name, data.byteLength]));

  return json(200, { ok: true, replaced: Boolean(check.existing), ...info });
}

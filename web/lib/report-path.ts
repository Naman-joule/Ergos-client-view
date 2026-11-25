// Pure helpers for savings-sheet paths (no server-only import, so node:test can load them). See lib/reports.ts.
import path from 'node:path/posix';

export const REPORT_KINDS = {
  excel: { column: 'excel_file_path', label: 'Excel', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { column: 'pdf_report_path', label: 'PDF', type: 'application/pdf' },
  docx: { column: 'statement_docx_path', label: 'Word', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  zip: { column: 'zip_bundle_path', label: 'ZIP', type: 'application/zip' },
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;
export const isReportKind = (k: unknown): k is ReportKind => typeof k === 'string' && k in REPORT_KINDS;

export type ReportLocation = { via: 'url'; url: string } | { via: 'ftp'; path: string } | null;

export function ftpConfigured(): boolean {
  return Boolean(process.env.REPORTS_FTP_URL);
}

/** Where a stored path points, or null when it can't be served safely. Pure apart from env. */
export function locateReport(stored: string | null | undefined, env: NodeJS.ProcessEnv = process.env): ReportLocation {
  const raw = (stored ?? '').trim();
  if (!raw) return null;
  let p = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    if (u.protocol === 'https:' || u.protocol === 'http:') return { via: 'url', url: u.toString() };
    if (u.protocol === 'local:') p = decodeURIComponent(u.host + u.pathname);   // older ergOS rows: local://tod_savings/excel/x.xlsx
    else if (u.protocol !== 'ftp:' && u.protocol !== 'ftps:') return null;
    else p = decodeURIComponent(u.pathname);
  }
  else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) return null;   // other schemes; C:\ drive paths are fine
  if (!env.REPORTS_FTP_URL) return null;
  p = p.replace(/\\/g, '/');                                   // Windows-style paths
  const strip = env.REPORTS_FTP_STRIP_PREFIX?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (strip && (p === strip || p.startsWith(strip + '/'))) p = p.slice(strip.length);
  if (p.split('/').includes('..')) return null;               // no climbing out
  const norm = path.normalize(p.startsWith('/') ? p : '/' + p);
  const root = env.REPORTS_FTP_ROOT ? path.normalize('/' + env.REPORTS_FTP_ROOT.replace(/^\/+/, '')).replace(/\/+$/, '') : '';
  if (root && norm !== root && !norm.startsWith(root + '/')) return null;
  if (norm === '/' || norm.endsWith('/')) return null;
  return { via: 'ftp', path: norm };
}

export function reportFileName(p: string, fallback: string): string {
  const base = path.basename(p).replace(/[^\w.\- ()]/g, '_');
  return base || fallback;
}

/** Connection settings from REPORTS_FTP_URL. */
export function ftpSettings(url = process.env.REPORTS_FTP_URL ?? '') {
  const u = new URL(url);
  const secure = u.protocol === 'ftps:';
  return {
    host: u.hostname,
    port: Number(u.port) || 21,
    user: decodeURIComponent(u.username) || 'anonymous',
    password: decodeURIComponent(u.password),
    secure,
  };
}

// ---------------------------------------------------------------------------- replaced period files
// ergOS names its files by date or date range and replaces them as the month goes on, e.g.
//   ToD_Savings_Calculations_IEX_HALDIRAM_01-Oct-2026_to_29-Oct-2026.xlsx  ->  ..._01-Oct-2026_to_31-Oct-2026.xlsx
//   IEX_Trade_Report_HALDIRAM_29-Oct-2026.pdf
// so a row's stored path can name a file that no longer exists. These helpers pick, from the folder's
// listing, the file of the same kind and client whose date (range) covers the trade date.
const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const DATE = '(\\d{2})-([A-Za-z]{3})-(\\d{4})';
const NAME_RE = new RegExp(`^(.*?)_${DATE}(?:_to_${DATE})?\\.([A-Za-z0-9]+)$`);
const ymd = (d: string, m: string, y: string) => (MON[m.toLowerCase()] ? `${y}-${MON[m.toLowerCase()]}-${d}` : null);

export interface DatedName { prefix: string; from: string; to: string; ext: string }
export function parseDatedName(name: string): DatedName | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const from = ymd(m[2]!, m[3]!, m[4]!);
  const to = m[5] ? ymd(m[5], m[6]!, m[7]!) : from;
  if (!from || !to) return null;
  return { prefix: m[1]!.toLowerCase(), from, to, ext: m[8]!.toLowerCase() };
}

/** The file in `names` (bare names from one folder) that best replaces `wanted` for `date`, or null. */
export function pickCovering(names: string[], wanted: string, date: string): string | null {
  const w = parseDatedName(path.basename(wanted));
  if (!w) return null;
  let best: { name: string; d: DatedName } | null = null;
  for (const n of names) {
    const d = parseDatedName(path.basename(n));
    if (!d || d.prefix !== w.prefix || d.ext !== w.ext || d.from > date || d.to < date) continue;
    if (!best || d.to > best.d.to || (d.to === best.d.to && d.from < best.d.from)) best = { name: path.basename(n), d };
  }
  return best?.name ?? null;
}

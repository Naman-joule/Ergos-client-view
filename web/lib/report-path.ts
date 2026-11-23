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
    if (u.protocol !== 'ftp:' && u.protocol !== 'ftps:') return null;
    p = decodeURIComponent(u.pathname);
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

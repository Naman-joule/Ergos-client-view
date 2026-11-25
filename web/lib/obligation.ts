// IEX Daily Obligation Reports (DOR): pure helpers, no server-only import, so node:test can load them.
//
// A DOR is a two-page PDF from IEX: page 1 is the obligation summary (funds pay-in, CTU/STU/distribution
// charges, fees), page 2 the 15-minute trade report. What matters for filing it:
//   - "Delivery Date" (every market)
//   - "Trading Date"  (day-ahead markets only: DAM / GDAM / HP-DAM trade the day before delivery; RTM doesn't)
//   - "Portfolio Code" (e.g. N2UP0AEV0002) and "Portfolio Name"
// File names are not reliable ("RTM BBPL 10 Aug.pdf", "RTM_IEX241126DOR_…_Final (1).pdf"), so the date and
// portfolio always come from the text of the report itself; the name only hints at the market.
import path from 'node:path/posix';

export const OBLIGATION_MARKETS = ['DAM', 'RTM', 'GDAM', 'HP-DAM', 'TAM'] as const;
export type ObligationMarket = (typeof OBLIGATION_MARKETS)[number];
export const isObligationMarket = (m: unknown): m is ObligationMarket =>
  typeof m === 'string' && (OBLIGATION_MARKETS as readonly string[]).includes(m);

export const MAX_OBLIGATION_BYTES = 4 * 1024 * 1024;   // Vercel's request body limit is 4.5 MB

export interface ParsedObligation {
  deliveryDate: string;              // YYYY-MM-DD
  tradingDate: string | null;        // YYYY-MM-DD, day-ahead markets only
  portfolioCode: string | null;
  portfolioName: string | null;
  entityId: string | null;
  market: ObligationMarket;          // detected
  marketFrom: 'name' | 'content';
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = /(?<!\d)(\d{1,2})-([A-Za-z]{3})-(\d{4}|\d{2})(?!\d)/g;   // pdf.js glues labels on: "6-Oct-26Trading Date"

function isoDate(d: string, m: string, y: string): string | null {
  const mon = MON[m.toLowerCase()];
  const day = Number(d);
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  if (!mon || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, mon - 1, day));
  if (dt.getUTCMonth() !== mon - 1) return null;                     // 31-Sep etc.
  return dt.toISOString().slice(0, 10);
}

/** Market from the file name, when it says so. */
export function marketFromName(name: string): ObligationMarket | null {
  const n = path.basename(name).toUpperCase().replace(/[\s_.]+/g, '-');
  if (/(^|-)(HP-?DAM|HPDAM)(-|$)/.test(n)) return 'HP-DAM';
  if (/(^|-)G-?DAM(-|$)/.test(n)) return 'GDAM';
  if (/(^|-)TAM(-|$)/.test(n)) return 'TAM';
  if (/(^|-)RTM(-|$)/.test(n)) return 'RTM';
  if (/(^|-)DAM(-|$)/.test(n)) return 'DAM';
  return null;
}

/**
 * Read the filing details from the report's page-1 text. Works on both layout-preserving text
 * (pdftotext -layout) and the reading-order text pdf.js returns, where labels and values are jumbled.
 * Returns an error string when the text isn't a daily obligation report.
 */
export function parseObligationText(text: string, fileName = ''): ParsedObligation | { error: string } {
  if (!/DAILY\s+OBLIGATION\s+SUMMARY\s+REPORT/i.test(text)) {
    return { error: 'This is not an IEX Daily Obligation Report (no “Daily Obligation Summary Report” heading).' };
  }
  // Page 1 only: the trade report on page 2 has no dates, but don't let anything after page 1 confuse us.
  const head = text.split(/Daily\s+Trade\s+Report/i)[0] ?? text;
  const dates = [...head.matchAll(DATE_RE)].map((m) => isoDate(m[1]!, m[2]!, m[3]!)).filter((d): d is string => !!d);
  const uniq = [...new Set(dates)].sort();
  const dayAhead = /Trading\s+Date/i.test(head);

  let deliveryDate: string | null = null;
  let tradingDate: string | null = null;
  if (dayAhead) {
    if (uniq.length < 2) return { error: 'Could not read both the trading and delivery dates from the report.' };
    tradingDate = uniq[0]!;
    deliveryDate = uniq[uniq.length - 1]!;                           // delivery is the later of the two
  } else {
    if (uniq.length !== 1) return { error: uniq.length ? 'The report has more than one date; could not tell which is the delivery date.' : 'Could not read the delivery date from the report.' };
    deliveryDate = uniq[0]!;
  }

  const codes = [...head.matchAll(/\b([A-Z]\d[A-Z]{2}\d[A-Z0-9]{3}\d{4})\b/g)].map((m) => m[1]!);
  const entityId = /Entity\s+ID\s*:?\s*([A-Z0-9]{12})\b/.exec(head)?.[1] ?? null;
  const portfolioCode = codes.find((c) => c !== entityId) ?? null;

  let portfolioName: string | null = null;
  if (portfolioCode) {
    // pdf.js: "N2UP0AEV0002 Bharatiyam_Beverages_Private_Limit\ned\n";  layout: "Portfolio Name : Bharatiyam_…_Limit\n   ed"
    const after = head.slice(head.indexOf(portfolioCode) + portfolioCode.length);
    const m = /^\s*(?::\s*)?([A-Za-z0-9&.()-]+(?:_[A-Za-z0-9&.()-]+)+)[ \t]*\n\s*([a-z]{1,6})\s*\n/.exec(after)
      ?? /Portfolio\s+Name\s*:\s*([A-Za-z0-9&.()-]+(?:_[A-Za-z0-9&.()-]+)+)(?:[ \t]*\n\s*([a-z]{1,6})\s*\n)?/.exec(head);
    if (m) portfolioName = (m[1]! + (m[2] ?? '')).replace(/_/g, ' ').trim();
  }

  const named = marketFromName(fileName);
  // The content only tells day-ahead from real-time; the name can be more specific (GDAM, HP-DAM).
  let market: ObligationMarket;
  let marketFrom: 'name' | 'content' = 'content';
  if (named && (dayAhead ? named !== 'RTM' : named === 'RTM' || named === 'TAM')) { market = named; marketFrom = 'name'; }
  else market = dayAhead ? 'DAM' : 'RTM';

  return { deliveryDate, tradingDate, portfolioCode, portfolioName, entityId, market, marketFrom };
}

/** Lower-case, dash-separated name for a folder. */
export function slug(s: string): string {
  return s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 60) || 'plant';
}

/** Root folder on the FTP server (always absolute, no trailing slash). */
export function obligationRoot(env: NodeJS.ProcessEnv = process.env): string {
  const r = (env.OBLIGATION_FTP_ROOT ?? '/iex_obligation').trim().replace(/\\/g, '/');
  const n = path.normalize('/' + r.replace(/^\/+/, '')).replace(/\/+$/, '');
  return n || '/iex_obligation';
}

/** <root>/<plant id>-<plant slug>/<YYYY>/<MM>/<MARKET>_<YYYY-MM-DD>.pdf */
export function obligationPath(plantId: number, plantName: string, market: ObligationMarket, deliveryDate: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) throw new Error('bad date');
  const [y, m] = deliveryDate.split('-');
  return `${obligationRoot(env)}/${plantId}-${slug(plantName)}/${y}/${m}/${market}_${deliveryDate}.pdf`;
}

/** A stored path is servable only if it sits under the root and doesn't climb out. */
export function isUnderRoot(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!p || p.includes('\\') || p.split('/').includes('..')) return false;
  const root = obligationRoot(env);
  return path.normalize(p) === p && p.startsWith(root + '/') && p.endsWith('.pdf');
}

export const looksLikePdf = (b: Uint8Array) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;   // %PDF-

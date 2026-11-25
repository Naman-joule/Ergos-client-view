import type { Query } from '../db';
import type { ObligationMarket } from '../obligation';

export interface ObligationRow {
  id: number; market: ObligationMarket; delivery_date: string; trading_date: string | null;
  portfolio_code: string | null; portfolio_name: string | null; original_name: string; size_bytes: number; uploaded_at: string;
}
export interface ObligationMonth { month: string; reports: number; days: number }

/** Reports for one plant in one month (RLS decides whether the plant is visible at all). */
export function obligationReports(q: Query, plantId: number, month: string): Promise<ObligationRow[]> {
  return q<ObligationRow>(
    `SELECT id, market, delivery_date, trading_date, portfolio_code, portfolio_name, original_name, size_bytes,
            to_char(uploaded_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') AS uploaded_at
       FROM iex_obligation_report
      WHERE plant_id = $1 AND delivery_date >= $2::date AND delivery_date < ($2::date + interval '1 month')
      ORDER BY delivery_date, market`, [plantId, `${month}-01`]);
}

/** Every month with reports for the plant, newest first. */
export function obligationMonths(q: Query, plantId: number): Promise<ObligationMonth[]> {
  return q<ObligationMonth>(
    `SELECT to_char(delivery_date, 'YYYY-MM') AS month, count(*)::int AS reports, count(DISTINCT delivery_date)::int AS days
       FROM iex_obligation_report WHERE plant_id = $1 GROUP BY 1 ORDER BY 1 DESC`, [plantId]);
}

/** Portfolio codes already on file for the plant. */
export async function plantPortfolios(q: Query, plantId: number): Promise<string[]> {
  const rows = await q<{ portfolio_code: string }>(
    `SELECT DISTINCT portfolio_code FROM iex_obligation_report WHERE plant_id = $1 AND portfolio_code IS NOT NULL`, [plantId]);
  return rows.map((r) => r.portfolio_code);
}

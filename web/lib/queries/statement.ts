// Which ergOS savings statements (iex_tod_daily_obligation, alias o) belong to plant $1. Shared by Savings
// and Billing, so both read the same statements.
/**
 * Daily statements that belong to plant $1. ergOS doesn't always fill plant_id on iex_tod_daily_obligation;
 * a statement without one belongs to the plant when its portfolio is this plant's (from its cleared trades or
 * open access charges) and no other plant's, so a multi-plant portfolio's statement isn't counted under each
 * plant. Plant names are not matched: two clients can name a plant the same (migration 011 closes the same gap
 * in RLS). $2 (the plant name) is kept in the signature for callers but no longer used.
 */
export const STATEMENT_OF_PLANT = `(
  o.plant_id = $1
  OR (o.plant_id IS NULL AND $2::text IS NOT NULL AND o.portfolio_id IN (
       SELECT u.portfolio_id FROM (
         SELECT b.portfolio_id, b.plant_id FROM trading_result_block b WHERE b.portfolio_id IS NOT NULL
         UNION
         SELECT c.portfolio_id, c.plant_id FROM plant_open_access_charges c
       ) u
       WHERE u.portfolio_id IN (SELECT portfolio_id FROM trading_result_block WHERE plant_id = $1 AND portfolio_id IS NOT NULL
                                UNION SELECT portfolio_id FROM plant_open_access_charges WHERE plant_id = $1)
       GROUP BY u.portfolio_id HAVING bool_and(u.plant_id = $1)
  ))
)`;

/** Each day's exchange cost on the plant's savings statement (₹, landed: energy + all charges). */
export const STATEMENT_COSTS_SQL = `
  SELECT DISTINCT ON (o.trade_date) o.trade_date::text AS d, o.iex_total_cost::float8 AS cost, o.volume_cleared_kwh::float8 AS kwh
  FROM iex_tod_daily_obligation o
  WHERE ${STATEMENT_OF_PLANT} AND o.trade_date BETWEEN $3::date AND $4::date AND coalesce(o.iex_total_cost, 0) > 0
  ORDER BY o.trade_date, (o.plant_id IS NULL), o.id DESC`;

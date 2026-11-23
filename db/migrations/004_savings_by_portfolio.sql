-- ergOS doesn't always fill iex_tod_daily_obligation.plant_id. A statement without one still belongs
-- to a plant through its portfolio (the plant's cleared trades or open access charges) or its
-- plant_name. Let users see exactly those statements for the plants they can already see.
-- Rows that match no accessible plant stay visible to admins only (policy app_read_admin_null_plant).
-- Safe to re-run.

SET client_min_messages = warning;

BEGIN;

DROP POLICY IF EXISTS app_read_by_portfolio ON iex_tod_daily_obligation;
CREATE POLICY app_read_by_portfolio ON iex_tod_daily_obligation FOR SELECT TO ergos_view_app
  USING (
    plant_id IS NULL AND (
      portfolio_id IN (
        SELECT b.portfolio_id FROM trading_result_block b
        WHERE b.plant_id IN (SELECT app_accessible_plant_ids()) AND b.portfolio_id IS NOT NULL)
      OR portfolio_id IN (
        SELECT c.portfolio_id FROM plant_open_access_charges c
        WHERE c.plant_id IN (SELECT app_accessible_plant_ids()))
      OR lower(trim(plant_name)) IN (
        SELECT lower(trim(p.name)) FROM plant p
        WHERE p.plant_id IN (SELECT app_accessible_plant_ids()))
    )
  );

-- Supports the portfolio lookups above and in the app.
CREATE INDEX IF NOT EXISTS trb_plant_portfolio_idx ON trading_result_block (plant_id, portfolio_id);
CREATE INDEX IF NOT EXISTS itdo_portfolio_date_idx ON iex_tod_daily_obligation (portfolio_id, trade_date);

COMMIT;

-- Savings statements without a plant_id (ergOS doesn't always fill it) are matched to a plant through their
-- portfolio. Migration 004 also matched them by plant_name, and by any portfolio seen on an accessible plant.
-- Both could cross tenants: two clients can name a plant the same ("Unit 1"), and a portfolio could carry
-- plants of more than one client. Now a NULL-plant statement is visible only when its portfolio is used by
-- accessible plants and by no plant the user can't see. portfolio_id is NOT NULL, so the name match added
-- nothing a portfolio doesn't. Safe to re-run.

SET client_min_messages = warning;
BEGIN;

-- Portfolios whose every plant (in trades and open access charges) the user can see. SECURITY DEFINER so it
-- also sees the plants the user can't, which is the point of the check.
CREATE OR REPLACE FUNCTION app_accessible_portfolio_ids() RETURNS SETOF varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH uses AS (
    SELECT portfolio_id, plant_id FROM trading_result_block WHERE portfolio_id IS NOT NULL AND plant_id IS NOT NULL
    UNION
    SELECT portfolio_id, plant_id FROM plant_open_access_charges WHERE portfolio_id IS NOT NULL AND plant_id IS NOT NULL
  ), mine AS (SELECT app_accessible_plant_ids() AS plant_id)
  SELECT u.portfolio_id FROM uses u
  GROUP BY u.portfolio_id
  HAVING bool_and(u.plant_id IN (SELECT plant_id FROM mine))
$$;
REVOKE ALL ON FUNCTION app_accessible_portfolio_ids() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ergos_view_app') THEN
    GRANT EXECUTE ON FUNCTION app_accessible_portfolio_ids() TO ergos_view_app;
  END IF;
END $$;

DROP POLICY IF EXISTS app_read_by_portfolio ON iex_tod_daily_obligation;
CREATE POLICY app_read_by_portfolio ON iex_tod_daily_obligation FOR SELECT TO ergos_view_app
  USING (plant_id IS NULL AND portfolio_id IN (SELECT app_accessible_portfolio_ids()));

CREATE INDEX IF NOT EXISTS oac_portfolio_plant_idx ON plant_open_access_charges (portfolio_id, plant_id);

COMMIT;

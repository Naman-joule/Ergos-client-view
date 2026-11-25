-- IEX market prices (DAM, RTM, GDAM) copied from the IEX market-data DB by the sync (IEX_DATABASE_URL).
-- They are market-wide, not client data: any signed-in user may read them; nobody else can.
-- iex_market_block gives one row per market, day and 15-minute block, from the latest scrape, with the
-- price in ₹/kWh. HP-DAM isn't collected by the IEX data DB yet, so it isn't here. Safe to re-run.

SET client_min_messages = warning;
BEGIN;

CREATE TABLE IF NOT EXISTS day_ahead_market_snapshot (
  id integer PRIMARY KEY, date date NOT NULL, time_block varchar(20), hour varchar(5),
  purchase_bid_mw float8, sell_bid_mw float8, mcv_mw float8, final_scheduled_volume_mw float8,
  mcp_rs_per_mwh float8, scraped_at timestamp
);
CREATE TABLE IF NOT EXISTS real_time_market_snapshot (
  id integer PRIMARY KEY, date date NOT NULL, time_block varchar(20), hour varchar(5), session_id varchar(10),
  purchase_bid_mw float8, sell_bid_mw float8, mcv_mw float8, final_scheduled_volume_mw float8,
  mcp_rs_per_mwh float8, scraped_at timestamp
);
-- GDAM volumes are published in MWh per block (the source names say so); bids are MW
CREATE TABLE IF NOT EXISTS green_day_ahead_market_snapshot (
  id integer PRIMARY KEY, date date NOT NULL, time_block varchar(20), hour varchar(5),
  purchase_bid_mw float8, total_sell_bid_mwh float8, total_mcv_mwh float8, total_fsv_mwh float8,
  solar_mcv_mwh float8, non_solar_mcv_mwh float8, hydro_mcv_mwh float8, wind_mcv_mwh float8,
  mcp_rs_per_mwh float8, scraped_at timestamp
);
CREATE INDEX IF NOT EXISTS dam_snapshot_date_idx ON day_ahead_market_snapshot (date);
CREATE INDEX IF NOT EXISTS rtm_snapshot_date_idx ON real_time_market_snapshot (date);
CREATE INDEX IF NOT EXISTS gdam_snapshot_date_idx ON green_day_ahead_market_snapshot (date);

-- readable by any signed-in user of the app (app_user_id() is set per request); no writes
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['day_ahead_market_snapshot', 'real_time_market_snapshot', 'green_day_ahead_market_snapshot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('DROP POLICY IF EXISTS signed_in_read ON %I', t);
    EXECUTE format('CREATE POLICY signed_in_read ON %I FOR SELECT USING (app_user_id() IS NOT NULL)', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ergos_view_app') THEN
      EXECUTE format('GRANT SELECT ON %I TO ergos_view_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- one row per market, day and block ("00:00 - 00:15" -> 1 … "23:45 - 24:00" -> 96), latest scrape wins
CREATE OR REPLACE VIEW iex_market_block WITH (security_invoker = true) AS
WITH raw AS (
  SELECT 'DAM'::text AS market, date, time_block, mcp_rs_per_mwh, mcv_mw AS mcv_mw, final_scheduled_volume_mw AS fsv_mw,
         purchase_bid_mw, sell_bid_mw, scraped_at FROM day_ahead_market_snapshot
  UNION ALL
  SELECT 'RTM', date, time_block, mcp_rs_per_mwh, mcv_mw, final_scheduled_volume_mw,
         purchase_bid_mw, sell_bid_mw, scraped_at FROM real_time_market_snapshot
  UNION ALL
  SELECT 'GDAM', date, time_block, mcp_rs_per_mwh, total_mcv_mwh * 4, total_fsv_mwh * 4,   -- MWh per block -> MW
         purchase_bid_mw, total_sell_bid_mwh * 4, scraped_at FROM green_day_ahead_market_snapshot
), parsed AS (
  SELECT *, (split_part(trim(time_block), ':', 1)::int * 4 + split_part(split_part(trim(time_block), ' ', 1), ':', 2)::int / 15 + 1) AS block
  FROM raw WHERE time_block ~ '^\s*\d{1,2}:\d{2}'
)
SELECT DISTINCT ON (market, date, block)
       market, date, block, mcp_rs_per_mwh / 1000.0 AS mcp_rs_per_kwh, mcv_mw, fsv_mw, purchase_bid_mw, sell_bid_mw, scraped_at
FROM parsed
WHERE block BETWEEN 1 AND 96
ORDER BY market, date, block, scraped_at DESC NULLS LAST;

REVOKE ALL ON iex_market_block FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ergos_view_app') THEN GRANT SELECT ON iex_market_block TO ergos_view_app; END IF;
END $$;

COMMIT;

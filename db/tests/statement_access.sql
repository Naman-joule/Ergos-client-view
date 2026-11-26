-- Statements without a plant_id: who may see them (migration 011). Run as the database owner; everything
-- happens in a transaction that is rolled back, so nothing is left behind:
--   psql "<owner url>" -f db/tests/statement_access.sql
\set QUIET on
\pset tuples_only on
\pset format unaligned
BEGIN;
CREATE TEMP TABLE _r (line text);
GRANT INSERT ON _r TO ergos_view_app;
-- fixtures: a K1 statement without plant_id; a films-portfolio statement named like a cement plant;
-- a portfolio shared by a cement plant and a films plant
INSERT INTO iex_tod_daily_obligation (id, plant_id, portfolio_id, trade_date, plant_name, volume_cleared_kwh)
VALUES (-1, NULL, 'DEMO-PF-K1', '2020-01-01', 'whatever', 1),
       (-2, NULL, 'DEMO-PF-F1', '2020-01-02', (SELECT name FROM plant WHERE plant_id = 900001), 1),
       (-3, NULL, 'SHARED-PF', '2020-01-03', 'shared', 1);
INSERT INTO plant_open_access_charges (id, plant_id, portfolio_id, effective_from)
VALUES (-1, 900001, 'SHARED-PF', '2020-01-01'), (-2, 900003, 'SHARED-PF', '2020-02-01');

SET ROLE ergos_view_app;
SELECT set_config('app.user_id', '900003', false);   -- cement client user
INSERT INTO _r SELECT CASE WHEN EXISTS (SELECT 1 FROM iex_tod_daily_obligation WHERE id = -1) THEN 'ok' ELSE 'FAIL' END || ': cement sees its K1 statement without plant_id';
INSERT INTO _r SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM iex_tod_daily_obligation WHERE id = -2) THEN 'ok' ELSE 'FAIL' END || ': cement does not see a films statement that has a cement plant''s name';
INSERT INTO _r SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM iex_tod_daily_obligation WHERE id = -3) THEN 'ok' ELSE 'FAIL' END || ': cement does not see a statement of a portfolio shared with films';
SELECT set_config('app.user_id', '900004', false);   -- films client user
INSERT INTO _r SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM iex_tod_daily_obligation WHERE id IN (-1, -3)) THEN 'ok' ELSE 'FAIL' END || ': films sees neither the K1 nor the shared statement';
RESET ROLE;
SELECT line FROM _r;
ROLLBACK;

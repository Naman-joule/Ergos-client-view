-- Tenant isolation checks. Run as ergos_view_app against a database loaded with the demo seed:
--   psql "postgresql://ergos_view_app:...@localhost/ecv" -f db/tests/rls_isolation.sql
-- Prints one line per check: "ok: ..." or "FAIL: ...".
\set QUIET on
\pset tuples_only on
\pset format unaligned

\o /dev/null
CREATE TEMP TABLE _check (n serial, line text);
CREATE OR REPLACE FUNCTION pg_temp.chk(ok boolean, what text, detail text DEFAULT '') RETURNS void
LANGUAGE sql AS $$ INSERT INTO _check (line) VALUES (CASE WHEN ok THEN 'ok: ' || what ELSE 'FAIL: ' || what || ' ' || detail END) $$;

SELECT pg_temp.chk(current_user = 'ergos_view_app', 'running as ergos_view_app', 'but as ' || current_user);

-- ---------------------------------------------------------------- no user set
SELECT set_config('app.user_id', '', false);
SELECT pg_temp.chk((SELECT count(*) FROM plant) = 0, 'no user: sees no plants', (SELECT count(*) FROM plant)::text);
SELECT pg_temp.chk((SELECT count(*) FROM client) = 0, 'no user: sees no clients');
SELECT pg_temp.chk((SELECT count(*) FROM plant_processed_meter_data) = 0, 'no user: sees no meter data');
SELECT pg_temp.chk((SELECT count(*) FROM iex_tod_daily_obligation) = 0, 'no user: sees no savings');
SELECT pg_temp.chk((SELECT count(*) FROM app_session_user()) = 0, 'no user: no session user');

-- ---------------------------------------------------------------- films user (900004)
SELECT set_config('app.user_id', '900004', false);
SELECT pg_temp.chk((SELECT count(*) FROM plant WHERE client_id = 900001) = 0, 'films: sees no cement plants');
SELECT pg_temp.chk((SELECT count(*) FROM plant) = 2, 'films: sees exactly its 2 plants', (SELECT string_agg(name, ',') FROM plant));
SELECT pg_temp.chk((SELECT array_agg(client_id ORDER BY client_id) FROM client) = ARRAY[900002], 'films: sees only its client');
SELECT pg_temp.chk((SELECT count(*) FROM iex_tod_daily_obligation WHERE plant_id IN (900001, 900002)) = 0, 'films: sees no cement savings');
SELECT pg_temp.chk((SELECT count(*) FROM iex_tod_daily_obligation) > 0, 'films: sees its own savings');
SELECT pg_temp.chk((SELECT count(*) FROM plant_processed_meter_data WHERE plant_id IN (900001, 900002, 900005)) = 0, 'films: sees no cement or solar meter data');
SELECT pg_temp.chk((SELECT count(*) FROM trading_result_block WHERE plant_id IN (900001, 900002)) = 0, 'films: sees no cement trades');
SELECT pg_temp.chk((SELECT count(*) FROM trading_result WHERE plant_id IN (900001, 900002)) = 0, 'films: sees no cement trade headers');
SELECT pg_temp.chk((SELECT count(*) FROM banking) = 0, 'films: sees no cement banking');
SELECT pg_temp.chk((SELECT count(*) FROM prebid_plan WHERE plant_id IN (900001, 900002)) = 0, 'films: sees no cement prebid plans');
SELECT pg_temp.chk((SELECT count(*) FROM state_grid_discom_tariff WHERE plant_id IN (900001, 900002)) = 0, 'films: sees no cement tariffs');
SELECT pg_temp.chk((SELECT count(*) FROM plant_gen_con_mapping) = 0, 'films: sees no cement solar mapping');
SELECT pg_temp.chk((SELECT count(*) FROM dashboard_config WHERE client_id IS NOT NULL AND client_id <> 900002) = 0, 'films: sees no other client config');
SELECT pg_temp.chk((SELECT count(*) FROM dashboard_config WHERE client_id = 900002) = 1, 'films: sees its own config');
SELECT pg_temp.chk((SELECT count(*) FROM user_client_map WHERE user_id <> 900004) = 0, 'films: sees only its own user_client_map rows');
DO $$ BEGIN
  PERFORM 1 FROM "user" LIMIT 1;
  PERFORM pg_temp.chk(false, 'films: cannot read "user"', 'select succeeded');
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk(true, 'films: cannot read "user" (permission denied)');
END $$;
DO $$ BEGIN
  INSERT INTO dashboard_config (client_id, version, status, spec) VALUES (900002, 99, 'draft', '{}');
  PERFORM pg_temp.chk(false, 'films: client_user cannot write dashboard_config', 'insert succeeded');
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk(true, 'films: client_user cannot write dashboard_config');
END $$;
DO $$ BEGIN
  UPDATE plant SET name = name WHERE plant_id = 900003;
  PERFORM pg_temp.chk(false, 'films: cannot write synced tables', 'update succeeded');
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk(true, 'films: cannot write synced tables');
END $$;

-- ---------------------------------------------------------------- single-plant user (900005)
SELECT set_config('app.user_id', '900005', false);
SELECT pg_temp.chk((SELECT count(*) FROM plant p JOIN plant_type t ON t.id = p.plant_type_id WHERE t.type = 'consumer') = 1,
                   'single-plant: sees exactly one consumer plant', (SELECT string_agg(name, ',') FROM plant));
SELECT pg_temp.chk((SELECT plant_id FROM plant) = 900002, 'single-plant: the plant is DEMO CEMENT K2');
SELECT pg_temp.chk((SELECT count(*) FROM plant_processed_meter_data WHERE plant_id IN (900001, 900005)) = 0, 'single-plant: sees no K1 or solar meter data');
SELECT pg_temp.chk((SELECT count(*) FROM iex_tod_daily_obligation WHERE plant_id <> 900002) = 0, 'single-plant: sees only K2 savings');

-- ---------------------------------------------------------------- cement user (900003): solar through the consumer
SELECT set_config('app.user_id', '900003', false);
SELECT pg_temp.chk((SELECT count(*) FROM plant_processed_meter_data WHERE plant_id = 900005) > 0, 'cement: sees mapped solar meter data');
SELECT pg_temp.chk((SELECT count(*) FROM plant WHERE client_id = 900002) = 0, 'cement: sees no films plants');

-- ---------------------------------------------------------------- manager (900002): may write config for an accessible client
SELECT set_config('app.user_id', '900002', false);
SELECT pg_temp.chk((SELECT count(*) FROM client) = 2, 'manager: sees both clients');
-- The write is undone by raising inside a sub-block, so the check result survives.
DO $$ BEGIN
  BEGIN
    INSERT INTO dashboard_config (client_id, version, status, spec) VALUES (900001, 99, 'draft', '{}');
    RAISE EXCEPTION 'undo';
  EXCEPTION
    WHEN raise_exception THEN PERFORM pg_temp.chk(true, 'manager: can write a draft config for an accessible client');
    WHEN insufficient_privilege THEN PERFORM pg_temp.chk(false, 'manager: can write a draft config for an accessible client', 'denied');
  END;
END $$;
DO $$ BEGIN
  INSERT INTO dashboard_config (client_id, version, status, spec) VALUES (NULL, 99, 'draft', '{}');
  PERFORM pg_temp.chk(false, 'manager: cannot write the global config', 'insert succeeded');
EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk(true, 'manager: cannot write the global config');
END $$;

-- ---------------------------------------------------------------- deactivated user sees nothing
-- (simulated: a user id that does not exist behaves like an inactive one)
SELECT set_config('app.user_id', '123456789', false);
SELECT pg_temp.chk((SELECT count(*) FROM plant) = 0, 'unknown user: sees no plants');

\o
SELECT line FROM _check ORDER BY n;

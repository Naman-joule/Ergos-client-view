-- ergOS client view: tenant isolation in PostgreSQL.
--
-- The web app connects as ergos_view_app, which is subject to row-level security.
-- Every app request runs in a transaction that does set_config('app.user_id', <id>, true).
-- The sync job connects as the table owner; RLS is enabled but NOT forced, so the owner bypasses it.
--
-- After running this file, give the role a login password by hand (never commit it):
--   ALTER ROLE ergos_view_app LOGIN PASSWORD '...';

SET client_min_messages = warning;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. App role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ergos_view_app') THEN
    CREATE ROLE ergos_view_app NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Revoke everything first
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- Supabase's API roles, only if they exist. Default privileges can only be changed for
-- objects created by the current role; Supabase also has defaults for supabase_admin,
-- which only the platform can change. Objects in this schema are created by the owner
-- running these migrations, so the current role's defaults are the ones that matter.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Grant back exactly what the app needs
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO ergos_view_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ergos_view_app;
REVOKE ALL ON TABLE "user" FROM ergos_view_app;          -- password hashes: only via app_auth_lookup()
GRANT INSERT, UPDATE ON TABLE dashboard_config TO ergos_view_app;
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SEQUENCE %s TO ergos_view_app',
                 pg_get_serial_sequence('public.dashboard_config', 'id'));
END
$$;

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER helpers (owned by the migration role, which bypasses RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::int
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM "user" u JOIN role r ON r.id = u.role_id
    WHERE u.id = app_user_id() AND u.is_active AND r.name = 'admin'
  )
$$;

-- Plants the current user may see:
--   admin                       -> every plant
--   otherwise, per mapped client -> all of that client's plants when the user has no
--                                   user_plant_map rows for that client, else only the
--                                   mapped plants. Inactive users get nothing.
CREATE OR REPLACE FUNCTION app_accessible_plant_ids() RETURNS SETOF integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.plant_id FROM plant p WHERE app_is_admin()
  UNION
  SELECT p.plant_id
  FROM "user" u
  JOIN user_client_map ucm ON ucm.user_id = u.id
  JOIN plant p ON p.client_id = ucm.client_id
  WHERE u.id = app_user_id()
    AND u.is_active
    AND (
      NOT EXISTS (
        SELECT 1 FROM user_plant_map upm JOIN plant p2 ON p2.plant_id = upm.plant_id
        WHERE upm.user_id = u.id AND p2.client_id = ucm.client_id
      )
      OR EXISTS (
        SELECT 1 FROM user_plant_map upm
        WHERE upm.user_id = u.id AND upm.plant_id = p.plant_id
      )
    )
$$;

CREATE OR REPLACE FUNCTION app_accessible_client_ids() RETURNS SETOF integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.client_id FROM client c WHERE app_is_admin()
  UNION
  SELECT DISTINCT p.client_id FROM plant p
  WHERE p.plant_id IN (SELECT app_accessible_plant_ids()) AND p.client_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION app_has_permission(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "user" u
    JOIN role_permission rp ON rp.role_id = u.role_id
    JOIN permission pm ON pm.permission_id = rp.permission_id
    WHERE u.id = app_user_id() AND u.is_active AND pm.permission_name = perm
  )
$$;

-- The only way the app can ever read a password hash.
CREATE OR REPLACE FUNCTION app_auth_lookup(p_email text)
RETURNS TABLE (id integer, password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash::text, COALESCE(u.is_active, false)
  FROM "user" u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_session_user()
RETURNS TABLE (id integer, email text, name text, role text, is_active boolean, permissions text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email::text, u.name::text, r.name::text, COALESCE(u.is_active, false),
         COALESCE(ARRAY(
           SELECT pm.permission_name::text
           FROM role_permission rp JOIN permission pm ON pm.permission_id = rp.permission_id
           WHERE rp.role_id = u.role_id
           ORDER BY 1
         ), '{}')
  FROM "user" u LEFT JOIN role r ON r.id = u.role_id
  WHERE u.id = app_user_id()
$$;

REVOKE ALL ON FUNCTION app_user_id(), app_is_admin(), app_accessible_plant_ids(),
  app_accessible_client_ids(), app_has_permission(text), app_auth_lookup(text),
  app_session_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_id(), app_is_admin(), app_accessible_plant_ids(),
  app_accessible_client_ids(), app_has_permission(text), app_auth_lookup(text),
  app_session_user() TO ergos_view_app;

-- ---------------------------------------------------------------------------
-- 5. Enable RLS on every table in public (not FORCE: the owner / sync job bypasses it)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Policies (all TO ergos_view_app). Re-runnable: drop first.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  -- reference tables
  FOREACH t IN ARRAY ARRAY['role', 'permission', 'role_permission', 'plant_type', 'markets', 'market_types', 'sync_runs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS app_read ON public.%I', t);
    EXECUTE format('CREATE POLICY app_read ON public.%I FOR SELECT TO ergos_view_app USING (true)', t);
  END LOOP;

  -- plant and every plant-scoped table
  FOREACH t IN ARRAY ARRAY['plant', 'plant_open_access_charges', 'state_grid_discom_tariff', 'state_grid_solar_tariff',
                           'trading_result', 'trading_result_block', 'prebid_plan', 'banking',
                           'optimization_results', 'iex_tod_daily_obligation'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS app_read ON public.%I', t);
    -- A NULL plant_id never matches IN (...), so NULL-plant savings rows are hidden here;
    -- the extra admin policy below makes them admin-only rather than invisible to everyone.
    EXECUTE format('CREATE POLICY app_read ON public.%I FOR SELECT TO ergos_view_app
                    USING (plant_id IN (SELECT app_accessible_plant_ids()))', t);
  END LOOP;
END
$$;

-- NULL-plant savings rows: visible to admins only (explicit, so "admin-only" really holds).
DROP POLICY IF EXISTS app_read_admin_null_plant ON iex_tod_daily_obligation;
CREATE POLICY app_read_admin_null_plant ON iex_tod_daily_obligation FOR SELECT TO ergos_view_app
  USING (plant_id IS NULL AND app_is_admin());

DROP POLICY IF EXISTS app_read ON client;
CREATE POLICY app_read ON client FOR SELECT TO ergos_view_app
  USING (client_id IN (SELECT app_accessible_client_ids()));

DROP POLICY IF EXISTS app_read ON plant_gen_con_mapping;
CREATE POLICY app_read ON plant_gen_con_mapping FOR SELECT TO ergos_view_app
  USING (target_plant_id IN (SELECT app_accessible_plant_ids()));

-- Meter data: accessible plants, or the source (solar) plant of an active mapping whose
-- target is accessible, so generation is visible through the consumer plant.
DROP POLICY IF EXISTS app_read ON plant_processed_meter_data;
CREATE POLICY app_read ON plant_processed_meter_data FOR SELECT TO ergos_view_app
  USING (
    plant_id IN (SELECT app_accessible_plant_ids())
    OR plant_id IN (
      SELECT m.source_plant_id FROM plant_gen_con_mapping m
      WHERE m.is_active AND m.target_plant_id IN (SELECT app_accessible_plant_ids())
    )
  );

DROP POLICY IF EXISTS app_read ON user_client_map;
CREATE POLICY app_read ON user_client_map FOR SELECT TO ergos_view_app USING (user_id = app_user_id());
DROP POLICY IF EXISTS app_read ON user_plant_map;
CREATE POLICY app_read ON user_plant_map  FOR SELECT TO ergos_view_app USING (user_id = app_user_id());

-- dashboard_config
DROP POLICY IF EXISTS app_read ON dashboard_config;
CREATE POLICY app_read ON dashboard_config FOR SELECT TO ergos_view_app
  USING (client_id IS NULL OR client_id IN (SELECT app_accessible_client_ids()));

DROP POLICY IF EXISTS app_insert ON dashboard_config;
CREATE POLICY app_insert ON dashboard_config FOR INSERT TO ergos_view_app
  WITH CHECK (
    app_has_permission('manage_dashboards')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT app_accessible_client_ids()))
      OR (client_id IS NULL AND app_is_admin())
    )
  );

DROP POLICY IF EXISTS app_update ON dashboard_config;
CREATE POLICY app_update ON dashboard_config FOR UPDATE TO ergos_view_app
  USING (
    app_has_permission('manage_dashboards')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT app_accessible_client_ids()))
      OR (client_id IS NULL AND app_is_admin())
    )
  )
  WITH CHECK (
    app_has_permission('manage_dashboards')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT app_accessible_client_ids()))
      OR (client_id IS NULL AND app_is_admin())
    )
  );

-- "user" has RLS enabled and no policy for the app role (and no grant): deny by default.

COMMIT;

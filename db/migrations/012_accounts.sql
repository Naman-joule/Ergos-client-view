-- Accounts: a login lockout shared by every server instance, and changing one's own password.
--   * The lockout used to live in each Vercel instance's memory, so it barely slowed password guessing.
--     Failures are now kept here: 5 failed sign-ins for an email within 15 minutes lock it for 15 minutes.
--   * A signed-in user can set a new password (the app checks the current one first). The app role still
--     can't read or write "user" directly; these SECURITY DEFINER functions are the only way in.
-- Safe to re-run.
SET client_min_messages = warning;
BEGIN;

CREATE TABLE IF NOT EXISTS login_failure (
  id     bigserial PRIMARY KEY,
  email  text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_failure_email_at_idx ON login_failure (email, at DESC);
REVOKE ALL ON login_failure FROM PUBLIC;
ALTER TABLE login_failure ENABLE ROW LEVEL SECURITY;   -- no policies: only the functions below touch it

-- true while the email is locked: 5+ failures in the last 15 minutes
CREATE OR REPLACE FUNCTION app_login_locked(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*) >= 5 FROM login_failure WHERE email = lower(trim(p_email)) AND at > now() - interval '15 minutes'
$$;

CREATE OR REPLACE FUNCTION app_login_failed(p_email text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO login_failure (email) VALUES (lower(trim(left(p_email, 100))));
  DELETE FROM login_failure WHERE at < now() - interval '1 day';
$$;

CREATE OR REPLACE FUNCTION app_login_succeeded(p_email text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM login_failure WHERE email = lower(trim(p_email));
$$;

-- the signed-in user's own email and password hash, to check the current password before a change
CREATE OR REPLACE FUNCTION app_own_auth() RETURNS TABLE (email text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.email::text, u.password_hash::text FROM "user" u WHERE u.id = app_user_id() AND u.is_active
$$;

-- set the signed-in user's password (a bcrypt hash made by the app)
CREATE OR REPLACE FUNCTION app_set_own_password(p_hash text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^\$2[aby]\$1[0-4]\$.{53}$' THEN RAISE EXCEPTION 'not a bcrypt hash'; END IF;
  UPDATE "user" SET password_hash = p_hash, last_reset = now() WHERE id = app_user_id() AND is_active;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

REVOKE ALL ON FUNCTION app_login_locked(text), app_login_failed(text), app_login_succeeded(text),
  app_own_auth(), app_set_own_password(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ergos_view_app') THEN
    GRANT EXECUTE ON FUNCTION app_login_locked(text), app_login_failed(text), app_login_succeeded(text),
      app_own_auth(), app_set_own_password(text) TO ergos_view_app;
  END IF;
END $$;

COMMIT;

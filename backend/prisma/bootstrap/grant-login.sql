-- ══════════════════════════════════════════════════════════════════
-- ROLE LOGIN BOOTSTRAP — the one step migrations deliberately omit
-- ══════════════════════════════════════════════════════════════════
--
-- `20260817164428_bootstrap_database_roles` creates `dartstore_app` and
-- `dartstore_platform` as NOLOGIN, because a migration is committed to
-- the repository and a migration must therefore never carry a password.
--
-- This script is the other half: it grants LOGIN and sets the password
-- from a value supplied at run time. It is NOT a migration, it is never
-- run by `migrate deploy`, and it contains no secret of its own — the
-- two passwords arrive as psql variables.
--
-- Run ONCE per environment, as a role that may ALTER ROLE (on Neon this
-- is `neondb_owner`), immediately after the first `migrate deploy`:
--
--   psql "$OWNER_DATABASE_URL" \
--     -v app_password="$DARTSTORE_APP_PASSWORD" \
--     -v platform_password="$DARTSTORE_PLATFORM_PASSWORD" \
--     -f prisma/bootstrap/grant-login.sql
--
-- Then set, from the same two secrets:
--   DATABASE_URL           → connects as dartstore_app
--   DATABASE_URL_PLATFORM  → connects as dartstore_platform
--
-- Re-running it rotates the passwords and nothing else. It never widens
-- a privilege: NOSUPERUSER and NOBYPASSRLS are re-asserted here too, so
-- a rotation cannot accidentally hand either role a way around RLS.

\set ON_ERROR_STOP on

ALTER ROLE dartstore_app
  WITH LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

ALTER ROLE dartstore_platform
  WITH LOGIN PASSWORD :'platform_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Fail loudly rather than leave a half-provisioned environment that
-- only reveals itself as "permission denied" under production traffic.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dartstore_app' AND rolcanlogin) THEN
    RAISE EXCEPTION 'dartstore_app cannot log in after bootstrap';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dartstore_platform' AND rolcanlogin) THEN
    RAISE EXCEPTION 'dartstore_platform cannot log in after bootstrap';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('dartstore_app','dartstore_platform')
               AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'a runtime role can bypass RLS — refusing to complete bootstrap';
  END IF;
END
$$;

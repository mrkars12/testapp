-- ══════════════════════════════════════════════════════════════════
-- DATABASE ROLES — the bootstrap the RLS migration depends on
-- ══════════════════════════════════════════════════════════════════
--
-- `20260817164429_enable_payment_rls` (the migration immediately after
-- this one) writes `CREATE POLICY … TO dartstore_app` twenty times.
-- PostgreSQL resolves a role name at policy-creation time, so that
-- migration cannot run unless the role already exists.
--
-- Until this file existed it did not. The two runtime roles were
-- created by hand, once, directly against the development database, and
-- the repository carried no record of them at all — so `migrate deploy`
-- against an empty database failed on the third statement of the RLS
-- migration and every migration after it was unreachable. That is
-- exactly the class of "hidden manual DB state a production deployment
-- would miss" this bootstrap removes.
--
-- ── WHY THESE ROLES CARRY NO PASSWORD ──────────────────────────────
--
-- A migration is committed to the repository, so a migration must never
-- contain a credential. Both roles are therefore created NOLOGIN: they
-- can own policies and hold grants — everything the schema needs to
-- express its security model — but they cannot be connected to.
--
-- Granting LOGIN and setting a password is a DEPLOYMENT step, performed
-- once per environment from whatever secret store that environment
-- uses, and it is documented in `prisma/BOOTSTRAP.md` beside the script
-- that performs it. The split is the point: the repository owns the
-- SHAPE of the security model (who exists, what they may touch), the
-- environment owns the SECRETS (how they authenticate).
--
-- ── IDEMPOTENT ON PURPOSE ──────────────────────────────────────────
--
-- Roles are cluster-scoped, not database-scoped, so a second database
-- on the same cluster will find them already present. And the existing
-- development database already has both, created by hand — this file
-- must be a no-op there rather than an error. Neither branch touches
-- LOGIN or the password, so re-running this can never lock a live
-- application out of its own database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dartstore_app') THEN
    -- The application's own connection. Every storefront and dashboard
    -- request runs as this role, and RLS — not grants — is what keeps
    -- one merchant out of another's rows.
    CREATE ROLE dartstore_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dartstore_platform') THEN
    -- The platform sweep connection: the outbox dispatcher, the
    -- reconciliation sweep, the expiry job's cart pass, and the webhook
    -- arrival record. These are the operations that legitimately span
    -- every store at once, which is why they cannot run under a
    -- tenant-scoped policy.
    --
    -- NOBYPASSRLS is deliberate and load-bearing: this role is NOT a
    -- back door around row-level security. It reaches cross-store rows
    -- only through the narrow, explicitly enumerated policies granted
    -- in `20260903130000_platform_roles_grants_and_policies`, and
    -- nothing else.
    CREATE ROLE dartstore_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Both roles are re-asserted as non-superuser and RLS-bound even when
-- they already existed, so an environment where someone once widened
-- them by hand is narrowed back by deploying. This is the one property
-- worth enforcing on every run: a role that bypasses RLS makes every
-- policy in the next migration decorative.
ALTER ROLE dartstore_app     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
ALTER ROLE dartstore_platform NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

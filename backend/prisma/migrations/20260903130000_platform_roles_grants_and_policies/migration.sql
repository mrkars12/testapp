-- ══════════════════════════════════════════════════════════════════
-- GRANTS AND PLATFORM POLICIES — the other half of the security model
-- ══════════════════════════════════════════════════════════════════
--
-- `20260817164428` created the two roles and `20260817164429` gave the
-- tenant tables their policies. Neither issued a single GRANT, and no
-- migration in this repository ever has: every privilege the runtime
-- depends on was applied by hand to one development database and
-- existed nowhere else. A database built from this repository could
-- therefore pass `migrate deploy` and still refuse every query the
-- application makes.
--
-- This migration is that missing half. It runs LAST because a grant can
-- only name a table that already exists, and the tables it covers are
-- created across eight earlier migrations (`carts` and `cart_items` as
-- recently as `20260903000000`).
--
-- Idempotent throughout: GRANT is naturally repeatable, and every
-- policy is dropped-if-exists before being created, so deploying this
-- against the development database that already carries these objects
-- by hand converges on exactly the same state rather than erroring.

-- ══════════════════════════════════════════════════════════════════
-- PART 1 — dartstore_app: the application connection
-- ══════════════════════════════════════════════════════════════════
--
-- Broad DML across the schema, and that is correct rather than lax:
-- for this role the access boundary is ROW LEVEL SECURITY, not the
-- grant table. Every tenant-scoped table carries a policy keyed on
-- `app.store_id` / `app.mode`, so a missing WHERE clause is refused by
-- the database even though the grant would have allowed it. Narrowing
-- the grants instead would move the boundary to a place that cannot
-- express "only this merchant's rows".
--
-- Notably NOT granted: TRUNCATE, REFERENCES, TRIGGER, and any DDL. The
-- application never needs them, and TRUNCATE in particular ignores RLS
-- entirely — a role that can TRUNCATE a tenant table can erase every
-- merchant's data in one statement, policies or no policies.
GRANT USAGE ON SCHEMA public TO dartstore_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO dartstore_app;

-- BIGSERIAL primary keys mean almost every INSERT touches a sequence.
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO dartstore_app;

-- So that a table added by a LATER migration is usable without that
-- migration having to remember this file exists. Default privileges
-- apply only to objects created by the role that sets them, which is
-- the migration runner — the same role that runs every future
-- migration, so the coverage is exactly right.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dartstore_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dartstore_app;

-- ══════════════════════════════════════════════════════════════════
-- PART 2 — dartstore_platform: the cross-store sweep connection
-- ══════════════════════════════════════════════════════════════════
--
-- LEAST PRIVILEGE, ENUMERATED FROM THE CALL SITES. This role exists for
-- the handful of operations that legitimately span every store at once
-- and therefore cannot run under a tenant policy. Each grant below is
-- justified by a specific line of application code, and nothing is
-- granted "just in case" — a privilege this role does not need is a
-- privilege that turns a bug into a cross-tenant incident.
--
--   outbox_messages              SELECT, UPDATE
--       OutboxDispatcherService.claimBatch() runs
--       `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) … RETURNING`
--       to lease a batch spanning several stores; deadLetterCount()
--       and stalePendingCount() read.
--
--   webhook_events               SELECT, INSERT, UPDATE
--       WebhookIngestionService.record() inserts the arrival record
--       before the owning store is known, and updates it three times as
--       the callback is classified. PaymentAccountService reads it back.
--
--   payment_idempotency_records  SELECT, DELETE
--       IdempotencyService's hourly cron deletes expired records across
--       all stores.
--
--   payment_intents              SELECT
--       ReconciliationService.sweep() finds stale non-terminal intents.
--
--   payment_accounts             SELECT
--       PaymentFactApplier and the webhook account resolver resolve the
--       owning store FROM the account, so this read necessarily precedes
--       any tenant context.
--
--   carts                        SELECT
--       CheckoutExpiryJob.sweepExpiredCarts() finds expired idle carts.
--       Each one is then abandoned inside its OWN tenant transaction on
--       the application connection, which is why no write grant is
--       needed here and none is given.
--
-- Every other table in the schema is unreachable to this role: no
-- grant, and RLS enabled with no policy naming it, which is a denial
-- twice over. In particular it has NO access to orders, checkouts,
-- products, inventory, ledger entries, captures or refunds.
GRANT USAGE ON SCHEMA public TO dartstore_platform;

GRANT SELECT, UPDATE         ON TABLE "outbox_messages"             TO dartstore_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE "webhook_events"              TO dartstore_platform;
GRANT SELECT, DELETE         ON TABLE "payment_idempotency_records" TO dartstore_platform;
GRANT SELECT                 ON TABLE "payment_intents"             TO dartstore_platform;
GRANT SELECT                 ON TABLE "payment_accounts"            TO dartstore_platform;
GRANT SELECT                 ON TABLE "carts"                       TO dartstore_platform;

-- The one sequence this role advances: `webhook_events.id` on the
-- arrival-record INSERT above. No other table is written by it.
GRANT USAGE, SELECT ON SEQUENCE "webhook_events_id_seq" TO dartstore_platform;

-- ══════════════════════════════════════════════════════════════════
-- PART 3 — the platform's row policies
-- ══════════════════════════════════════════════════════════════════
--
-- A grant alone is not enough. When RLS is enabled on a table and no
-- policy names the current role, PostgreSQL denies every row — so
-- without these the grants above would produce empty result sets and
-- silently-zero-row updates rather than errors, which is the worst of
-- both worlds. (`webhook_events` needs no policy: it is deliberately
-- outside the tenant RLS set, as its own migration records, because a
-- callback's owning store is unknown at insert time.)
--
-- `USING (true)` is the honest expression here: a platform sweep's
-- entire purpose is to see every store's rows. The containment is that
-- the role reaches only these five tables, only with these verbs, and
-- that every row it finds is then acted on inside a normal tenant
-- transaction on the application connection.
--
-- Written as separate per-command policies rather than one FOR ALL, so
-- that reading `pg_policy` shows precisely which verb is permitted on
-- which table without having to cross-reference the grant table.

-- outbox_messages — read and lease.
DROP POLICY IF EXISTS dartstore_platform_outbox_select ON "outbox_messages";
CREATE POLICY dartstore_platform_outbox_select ON "outbox_messages"
  FOR SELECT TO dartstore_platform USING (true);

DROP POLICY IF EXISTS dartstore_platform_outbox_update ON "outbox_messages";
CREATE POLICY dartstore_platform_outbox_update ON "outbox_messages"
  FOR UPDATE TO dartstore_platform USING (true) WITH CHECK (true);

-- payment_idempotency_records — read and expire.
DROP POLICY IF EXISTS dartstore_platform_idempotency_select ON "payment_idempotency_records";
CREATE POLICY dartstore_platform_idempotency_select ON "payment_idempotency_records"
  FOR SELECT TO dartstore_platform USING (true);

DROP POLICY IF EXISTS dartstore_platform_idempotency_delete ON "payment_idempotency_records";
CREATE POLICY dartstore_platform_idempotency_delete ON "payment_idempotency_records"
  FOR DELETE TO dartstore_platform USING (true);

-- payment_intents — read only. Reconciliation asks the provider and
-- feeds the answer through the applier, which writes on the tenant
-- connection.
DROP POLICY IF EXISTS dartstore_platform_payment_intents_select ON "payment_intents";
CREATE POLICY dartstore_platform_payment_intents_select ON "payment_intents"
  FOR SELECT TO dartstore_platform USING (true);

-- payment_accounts — read only. This is the lookup that RESOLVES the
-- tenant, so it is the one read that cannot itself be tenant-scoped.
DROP POLICY IF EXISTS dartstore_platform_payment_accounts_select ON "payment_accounts";
CREATE POLICY dartstore_platform_payment_accounts_select ON "payment_accounts"
  FOR SELECT TO dartstore_platform USING (true);

-- carts — read only. This is the policy that was applied by hand to the
-- development database on 2026-09-03 and existed in no migration; the
-- name is kept identical so that deploying this file against that
-- database replaces like with like.
DROP POLICY IF EXISTS dartstore_platform_carts_select ON "carts";
CREATE POLICY dartstore_platform_carts_select ON "carts"
  FOR SELECT TO dartstore_platform USING (true);

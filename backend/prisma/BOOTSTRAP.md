# Database bootstrap — the deployment contract

`prisma migrate deploy` builds **the entire structure and the entire
security model**: tables, indexes, partial indexes, CHECK constraints,
row-level security, every policy, both runtime roles, and every grant.
Verified by replaying the chain against two empty PostgreSQL 16
databases and diffing the result against `schema.prisma` (empty diff).

Exactly **one** thing it deliberately does not do: give the two runtime
roles a password.

## Why the split

A migration lives in the repository. A password must not. So
`20260817164428_bootstrap_database_roles` creates `dartstore_app` and
`dartstore_platform` as `NOLOGIN` — able to own policies and hold grants,
which is everything the *schema* needs to express — and the credential
half is applied once per environment from that environment's secret
store by `prisma/bootstrap/grant-login.sql`.

The repository owns the **shape** of the security model. The environment
owns the **secrets**.

## Provisioning a new environment

```bash
# 1. Structure + security model. Runs as the database owner.
DATABASE_URL="$OWNER_DATABASE_URL" npx prisma migrate deploy

# 2. Credentials. Also as the owner (on Neon: neondb_owner).
psql "$OWNER_DATABASE_URL" \
  -v app_password="$DARTSTORE_APP_PASSWORD" \
  -v platform_password="$DARTSTORE_PLATFORM_PASSWORD" \
  -f prisma/bootstrap/grant-login.sql

# 3. Point the application at the two least-privilege roles.
#    DATABASE_URL          → dartstore_app
#    DATABASE_URL_PLATFORM → dartstore_platform
```

`migrate deploy` must run as the **owner**, not as `dartstore_app`:
`CREATE POLICY` and `GRANT` both require ownership of the table. This is
the same lesson `out/ي/NEON_EXPIRY_GRANTS_APPLY_REPORT.md` records the
hard way — a `GRANT` issued by a non-owner returns success, emits only a
warning, and grants nothing.

## The two roles

| | `dartstore_app` | `dartstore_platform` |
|---|---|---|
| Used by | every storefront and dashboard request | the outbox dispatcher, reconciliation sweep, expiry job's cart pass, webhook arrival record |
| Tables | all (67) | **6, enumerated** |
| Verbs | SELECT/INSERT/UPDATE/DELETE | per-table, least privilege |
| TRUNCATE / REFERENCES / TRIGGER | **never** | **never** |
| `rolsuper` | false | false |
| `rolbypassrls` | **false** | **false** |
| Access boundary | row-level security | grants *and* narrow per-command policies |

`dartstore_app` holds broad DML on purpose: for that role the boundary
is RLS, not the grant table, so a query missing a `store_id` predicate is
refused by the database. `TRUNCATE` is withheld from both because it
ignores RLS entirely.

`dartstore_platform` is **not** a back door. It has `NOBYPASSRLS`, and
reaches cross-store rows only through six explicitly enumerated
per-command policies:

| Table | Privileges | Justified by |
|---|---|---|
| `outbox_messages` | SELECT, UPDATE | `OutboxDispatcherService.claimBatch()` leases a cross-store batch |
| `webhook_events` | SELECT, INSERT, UPDATE | `WebhookIngestionService.record()` — the owning store is unknown at insert time |
| `payment_idempotency_records` | SELECT, DELETE | `IdempotencyService`'s hourly expiry cron |
| `payment_intents` | SELECT | `ReconciliationService.sweep()` |
| `payment_accounts` | SELECT | the lookup that *resolves* the tenant, so it cannot itself be tenant-scoped |
| `carts` | SELECT | `CheckoutExpiryJob.sweepExpiredCarts()`; each cart is then abandoned in its own tenant transaction |

It has no access at all to orders, checkouts, products, inventory,
ledger entries, captures or refunds.

## Deploying to the EXISTING development database

`20260817164429_enable_payment_rls` was **edited** to make the chain
replayable (it dropped a table and altered a policy that no migration
ever created). Its checksum therefore no longer matches the row already
recorded in that database's `_prisma_migrations`, and `migrate deploy`
will refuse to proceed until that is reconciled:

```bash
npx prisma migrate resolve --applied 20260817164429_enable_payment_rls
```

The two new migrations (`…164428_bootstrap_database_roles` and
`…130000_platform_roles_grants_and_policies`) are safe to apply there
normally: both are fully idempotent, and the second re-creates
`dartstore_platform_carts_select` under the same name it was given by
hand on 2026-09-03, so it replaces like with like.

This reconciliation is a **deployment action against a live database**
and was deliberately not performed during this work.

#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Migration replay verification — the gate that F-02 existed for.
#
# Builds a database from NOTHING but `prisma migrate deploy`, then
# asserts that everything the runtime depends on is actually there:
# the schema (by diffing against schema.prisma), the roles, the row
# policies, the least-privilege grants, the partial indexes and the
# CHECK constraints.
#
# The bug this catches is the one that shipped: a migration chain that
# looks complete because one long-lived database was patched by hand.
# Nothing here consults an existing database — that is the whole point.
#
#   ./scripts/verify-migration-replay.sh [port]
#
# Requires Docker. Never touches DATABASE_URL or any real database.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

PORT="${1:-55510}"
SHADOW_PORT="$((PORT + 1))"
NAME="migverify-$PORT"
SHADOW="migverify-$SHADOW_PORT"
URL="postgresql://owner:p@localhost:${PORT}/app"
SHADOW_URL="postgresql://owner:p@localhost:${SHADOW_PORT}/shadow"

cleanup() { docker rm -f "$NAME" "$SHADOW" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

fail() { echo "FAIL: $*" >&2; exit 1; }

start() {
  docker run -d --name "$1" -e POSTGRES_PASSWORD=p -e POSTGRES_USER=owner \
    -e POSTGRES_DB="$2" -p "$3:5432" postgres:16-alpine >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$1" pg_isready -U owner >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "postgres $1 did not become ready"
}

echo "→ empty PostgreSQL 16"
start "$NAME" app "$PORT"
start "$SHADOW" shadow "$SHADOW_PORT"

echo "→ prisma migrate deploy (from zero)"
DATABASE_URL="$URL" npx prisma migrate deploy >/dev/null || fail "migrate deploy failed"

echo "→ schema matches schema.prisma"
DIFF="$(npx prisma migrate diff --from-url "$URL" \
          --to-schema-datamodel ./prisma/schema.prisma \
          --shadow-database-url "$SHADOW_URL" --script)"
[[ "$DIFF" == *"empty migration"* ]] || fail "schema drift after replay:\n$DIFF"

q() { docker exec "$NAME" psql -U owner -d app -tAc "$1" | tr -d '[:space:]'; }

echo "→ runtime roles"
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname IN ('dartstore_app','dartstore_platform')")" == 2 ]] \
  || fail "runtime roles missing"
# The single most important property in this file: a role that bypasses
# RLS makes every policy decorative.
[[ "$(q "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'dartstore%' AND (rolsuper OR rolbypassrls)")" == 0 ]] \
  || fail "a runtime role is superuser or bypasses RLS"

echo "→ row-level security"
[[ "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity")" -ge 21 ]] \
  || fail "expected at least 21 RLS-enabled tables"
for t in Order OrderItem carts cart_items payment_intents payment_attempts inventory_reservations outbox_messages; do
  [[ "$(q "SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname='$t'")" == "t" ]] \
    || fail "RLS not enabled on $t"
done
[[ "$(q "SELECT count(*) FROM pg_policy pol JOIN pg_class cls ON cls.oid=pol.polrelid WHERE cls.relname='Order' AND pol.polname='order_store_isolation'")" == 1 ]] \
  || fail "order_store_isolation missing (the policy the RLS migration used to only ALTER)"

echo "→ platform least privilege"
PLATFORM_PRIVS="$(q "SELECT string_agg(table_name||':'||privilege_type,',' ORDER BY table_name,privilege_type) FROM information_schema.table_privileges WHERE grantee='dartstore_platform'")"
EXPECTED="carts:SELECT,outbox_messages:SELECT,outbox_messages:UPDATE,payment_accounts:SELECT,payment_idempotency_records:DELETE,payment_idempotency_records:SELECT,payment_intents:SELECT,webhook_events:INSERT,webhook_events:SELECT,webhook_events:UPDATE"
[[ "$PLATFORM_PRIVS" == "$EXPECTED" ]] \
  || fail "platform privileges drifted.\n  expected: $EXPECTED\n  actual:   $PLATFORM_PRIVS"
# Neither role may TRUNCATE: TRUNCATE ignores RLS entirely.
[[ "$(q "SELECT count(*) FROM information_schema.table_privileges WHERE grantee LIKE 'dartstore%' AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')")" == 0 ]] \
  || fail "a runtime role holds TRUNCATE/REFERENCES/TRIGGER"

echo "→ application grants"
[[ "$(q "SELECT count(DISTINCT table_name) FROM information_schema.table_privileges WHERE grantee='dartstore_app'")" -ge 60 ]] \
  || fail "dartstore_app is missing table grants"

echo "→ database backstops (not expressible in schema.prisma)"
for idx in checkouts_one_live_per_cart inventory_reservations_held_by_variant_idx store_owner_default_unique; do
  [[ "$(q "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='$idx'")" == 1 ]] \
    || fail "index $idx missing"
done
for c in product_variant_inventory_floor inventory_reservation_quantity_positive; do
  [[ "$(q "SELECT convalidated FROM pg_constraint WHERE conname='$c'")" == "t" ]] \
    || fail "constraint $c missing or not validated"
done

echo
echo "PASS — migration chain replays from empty and produces the full security model."

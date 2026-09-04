-- ══════════════════════════════════════════════════════════════════
-- CHECKOUT ROW LEVEL SECURITY — closing the last tenant-scoped gap
-- ══════════════════════════════════════════════════════════════════
--
-- `checkouts` is registered tenant-scoped (`store_id` + `mode`, see
-- `src/common/tenant/tenant-scoped-models.ts`) and holds the most
-- customer PII of any table in the system: name, email, phone and
-- shipping address. It was nonetheless the one tenant-scoped table with
-- no RLS policy — 20260817164429 enabled RLS on `Order`, `OrderItem`
-- and 17 payment tables, 20260903000000 added `carts`/`cart_items`, and
-- both left `checkouts` alone.
--
-- That was not an oversight in those migrations: the application could
-- not have survived them. Four checkout reads ran on the guarded client
-- OUTSIDE any tenant transaction, so `app.store_id` was never set and
-- every one of them would have returned zero rows the moment a policy
-- existed. Three of those reads existed precisely to DISCOVER a
-- checkout's mode from its public token, which is a chicken-and-egg
-- problem with a policy that tests `mode`.
--
-- Those reads were converted first (see the companion code change):
-- the storefront controller now passes its own configured mode into
-- every token-addressed read, and the cross-store expiry sweep moved to
-- the platform connection — the same idiom the cart sweep already uses.
-- This migration is therefore the SECOND half of that change and is
-- safe only with it.
--
-- Shapes are taken unchanged from 20260817164429 and 20260903000000:
--   * `checkouts`            — Shape 1 (store_id AND mode)
--   * `checkout_line_items`  — Shape 3 (no store_id of its own; scoped
--                              through the parent, exactly as
--                              `OrderItem` is through `Order` and
--                              `cart_items` through `carts`)
--
-- Idempotent throughout: ENABLE ROW LEVEL SECURITY is repeatable, and
-- every policy is preceded by DROP POLICY IF EXISTS so a re-run
-- replaces rather than fails.

ALTER TABLE "checkouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout_line_items" ENABLE ROW LEVEL SECURITY;

-- Shape 1 (store_id and mode), as on every other tenant-scoped table.
DROP POLICY IF EXISTS checkout_store_isolation ON "checkouts";
CREATE POLICY checkout_store_isolation ON "checkouts"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

-- Shape 3 (no store_id of its own; scoped through the parent). The
-- parent predicate carries BOTH store and mode, so a line item cannot
-- be reached from the wrong mode either.
DROP POLICY IF EXISTS checkout_line_item_store_isolation ON "checkout_line_items";
CREATE POLICY checkout_line_item_store_isolation ON "checkout_line_items"
FOR ALL TO dartstore_app
USING (
  EXISTS (
    SELECT 1 FROM "checkouts" c
    WHERE c.id = "checkout_line_items".checkout_id
      AND c.store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
      AND c.mode::text = NULLIF(current_setting('app.mode', true), '')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "checkouts" c
    WHERE c.id = "checkout_line_items".checkout_id
      AND c.store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
      AND c.mode::text = NULLIF(current_setting('app.mode', true), '')
  )
);

-- ══════════════════════════════════════════════════════════════════
-- The platform half — the cross-store expiry sweep
-- ══════════════════════════════════════════════════════════════════
--
-- `CheckoutExpiryJob.releaseExpired()` finds expired uncommitted
-- checkouts ACROSS ALL STORES; sweeping every store is the point of a
-- sweep. It read through the guarded (tenant) connection, which worked
-- only because `checkouts` had no policy. With the policy above in
-- place that read would see nothing at all and stock held by expired
-- checkouts would never be released — a silent failure of exactly the
-- kind this table's absence from RLS already was.
--
-- So the sweep moves to `dartstore_platform`, the connection that
-- exists for cross-store reads, and gets the narrowest possible grant:
-- SELECT only. Each checkout is then released inside its OWN tenant
-- transaction, so nothing here writes cross-tenant. This is the same
-- treatment `carts` received in 20260903130000, for the same reason.
--
-- Note what is NOT granted: no INSERT, no UPDATE, no DELETE on
-- `checkouts`, and nothing at all on `checkout_line_items`. The sweep
-- reads identity (`id`, `store_id`, `mode`) and nothing else; the
-- customer PII on this table stays unreachable from the platform
-- connection's write path because it has none.
GRANT SELECT ON TABLE "checkouts" TO dartstore_platform;

DROP POLICY IF EXISTS dartstore_platform_checkouts_select ON "checkouts";
CREATE POLICY dartstore_platform_checkouts_select ON "checkouts"
  FOR SELECT TO dartstore_platform USING (true);

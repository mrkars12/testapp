-- ══════════════════════════════════════════════════════════════════
-- Server-authoritative storefront cart — PURCHASE IDENTITY
-- ══════════════════════════════════════════════════════════════════
--
-- The problem: nothing recorded that two browser tabs were looking at
-- the same *purchase*. Each tab held its own localStorage cart, posted
-- its own /checkout with its own per-attempt Idempotency-Key, and the
-- server had no way to tell "the same shopper pressing Place Order
-- twice" from "two genuinely different purchases". Both produced a
-- checkout, an intent, and a real payment session at the provider.
--
-- The fix is a row, not a heuristic. A Cart is minted server-side and
-- addressed by an opaque HttpOnly cookie, so every tab of the same
-- browser resolves to the SAME cart row, and the cart carries the one
-- column that answers the question: `active_checkout_id`.
--
-- Deliberately NOT a purchase fingerprint. Nothing here hashes
-- {customer, lines, amount}, and nothing has a time window: a shopper
-- who buys the same two products again five seconds later gets a fresh
-- cart, a fresh checkout and a second order, which is correct. The
-- constraint asserted is "one live checkout per cart", never "one
-- purchase per basket shape".
--
-- Additive in every respect. Two new tables, one new enum, one new
-- nullable column on `checkouts`. No backfill, no rewrite, no drop, no
-- type change, and no existing row or query changes meaning. Deployed
-- on its own the whole thing is inert: nothing reads or writes the new
-- tables until the backend that follows it ships, and `cart_id` stays
-- NULL for every checkout that has ever existed.

-- CreateEnum
--
-- `converted` and `abandoned` are terminal. A cart never returns to
-- `active`: a shopper who wants to buy again gets a NEW cart, which is
-- what makes repeat purchases work with no time window at all.
CREATE TYPE "CartStatus" AS ENUM ('active', 'converted', 'abandoned');

-- CreateTable
--
-- No money anywhere in this table, on purpose. Pricing stays exactly
-- where it is — `resolveLines()`, server-side, out of ProductVariant —
-- so the cart cannot become a second, weaker source of an amount.
CREATE TABLE "carts" (
    "id" BIGSERIAL NOT NULL,
    "store_id" BIGINT NOT NULL,
    "mode" "Mode" NOT NULL,
    -- The secret in the cookie. Stored raw, exactly like
    -- `checkouts.token` beside it: hashing one of the two and not the
    -- other is its own kind of bug.
    "token" VARCHAR(64) NOT NULL,
    -- Non-secret, publishable. This is what a browser and a log line
    -- may see; it can neither read nor modify a cart.
    "public_id" VARCHAR(32) NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'active',
    -- THE COLUMN THIS MIGRATION EXISTS FOR. NULL means no live
    -- checkout; a value means one tab already has one, and every other
    -- tab converges on it instead of creating a second.
    "active_checkout_id" BIGINT,
    -- A short lease held across the provider call, which necessarily
    -- happens OUTSIDE a database transaction. Same shape as
    -- `payment_idempotency_records.locked_until`, and for the same
    -- reason: a process that dies mid-call must free the cart by
    -- itself rather than wedge a shopper's basket for 30 days.
    "claimed_until" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    -- Identity of the order this cart became. Not a payment status:
    -- whether that order was paid is read from the order.
    "converted_order_id" BIGINT,
    "converted_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- variant_id and quantity, and nothing else. A title, a price or an
-- image here would be a client-supplied value that later looks
-- authoritative.
CREATE TABLE "cart_items" (
    "id" BIGSERIAL NOT NULL,
    "cart_id" BIGINT NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_token_key" ON "carts"("token");

-- CreateIndex
CREATE UNIQUE INDEX "carts_public_id_key" ON "carts"("public_id");

-- CreateIndex
CREATE INDEX "carts_store_id_mode_status_idx" ON "carts"("store_id", "mode", "status");

-- CreateIndex
CREATE INDEX "carts_expires_at_idx" ON "carts"("expires_at");

-- CreateIndex
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items"("cart_id");

-- CreateIndex
-- One row per variant per cart: "add the same thing again" is an
-- increment, never a second row that the pricing loop would charge for
-- twice.
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
--
-- Which cart this checkout was priced from. Identity only, written
-- once by the INSERT that creates the row and never updated —
-- the identical discipline `supersedes_id` follows. Plain nullable
-- BIGINT with no foreign key, matching `order_id` and `supersedes_id`
-- above it: same lookup pattern, and no new referential action
-- interacting with the store-level cascade.
ALTER TABLE "checkouts" ADD COLUMN "cart_id" BIGINT;

-- CreateIndex
CREATE INDEX "checkouts_cart_id_idx" ON "checkouts"("cart_id");

-- ══════════════════════════════════════════════════════════════════
-- THE DATABASE-LEVEL BACKSTOP
-- ══════════════════════════════════════════════════════════════════
--
-- The application serialises the claim with SELECT ... FOR UPDATE on
-- the cart row, which is where a duplicate actually dies — before a
-- single byte reaches the gateway. This index is the belt to that
-- transaction's braces: even if the claim logic were ever wrong, or a
-- future code path forgot it, PostgreSQL itself refuses the second
-- live checkout for one cart.
--
-- Scoped to `cart_id IS NOT NULL`, so every checkout that has ever
-- existed (all of which have cart_id = NULL) is exempt and nothing
-- historic can violate it. "Live" is the same pair of conditions the
-- expiry sweep uses: no order yet, and a status that can still be paid.
CREATE UNIQUE INDEX "checkouts_one_live_per_cart"
  ON "checkouts"("cart_id")
  WHERE "cart_id" IS NOT NULL
    AND "order_id" IS NULL
    AND "status" IN ('open', 'pending_payment');

-- ══════════════════════════════════════════════════════════════════
-- Row Level Security — in the exact shape of 20260817164429
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;

-- Shape 1 (store_id and mode), as on every other tenant-scoped table.
CREATE POLICY cart_store_isolation ON "carts"
FOR ALL TO dartstore_app
USING (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
  AND mode::text = NULLIF(current_setting('app.mode', true), '')
);

-- Shape 3 (no store_id of its own; scoped through the parent), exactly
-- as `OrderItem` is scoped through `Order`. A cart item is reachable
-- only via its cart, and this says so rather than leaving the table
-- looking like an oversight. Note the parent predicate carries BOTH
-- store and mode, so a cart item cannot be reached from the wrong mode
-- either.
CREATE POLICY cart_item_store_isolation ON "cart_items"
FOR ALL TO dartstore_app
USING (
  EXISTS (
    SELECT 1 FROM "carts" c
    WHERE c.id = "cart_items".cart_id
      AND c.store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
      AND c.mode::text = NULLIF(current_setting('app.mode', true), '')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "carts" c
    WHERE c.id = "cart_items".cart_id
      AND c.store_id = NULLIF(current_setting('app.store_id', true), '')::bigint
      AND c.mode::text = NULLIF(current_setting('app.mode', true), '')
  )
);

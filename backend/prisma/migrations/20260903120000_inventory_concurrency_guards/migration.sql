-- ══════════════════════════════════════════════════════════════════
-- Inventory concurrency guards — THE BACKSTOP, NOT THE MECHANISM
-- ══════════════════════════════════════════════════════════════════
--
-- The mechanism is in the application: every checkout now locks the
-- ProductVariant rows it needs with SELECT ... FOR UPDATE in ascending
-- id order, nets live `held` reservations against `inventory_qty`, and
-- writes its reservation in the SAME transaction — which commits before
-- the provider is called. That is where a duplicate sale actually dies.
--
-- This migration is the belt to that transaction's braces, in the exact
-- spirit of `checkouts_one_live_per_cart`: even a future code path that
-- forgets the guard cannot leave the database in a state the business
-- rules forbid.
--
-- Additive in every respect. Two CHECK constraints and one partial
-- index. No column added, no column dropped, no type changed, no
-- backfill, and no existing row rewritten. Verified against the
-- development database before authoring: 12 variant rows, 0 would
-- violate; 235 reservation rows, 0 would violate.

-- ══════════════════════════════════════════════════════════════════
-- THE INVENTORY FLOOR
-- ══════════════════════════════════════════════════════════════════
--
-- NOT a blanket `inventory_qty >= 0`, and the difference is the whole
-- point. `continue_selling` is backorder: the merchant has explicitly
-- said this variant may be sold past zero, the storefront advertises it
-- ("In stock — ships once prepared"), and the resulting NEGATIVE number
-- is the only record the system keeps of units owed. A blanket
-- non-negative constraint would delete that capability and would fail
-- immediately against the backorder row that already exists.
--
-- So the invariant is conditional, and it is the same predicate the
-- application's guarded decrement carries. The two must stay in step:
-- see `decrementInventory()` in src/stores/inventory/inventory-claim.ts.
--
-- Added WITHOUT `NOT VALID`. The existing negative row satisfies this
-- constraint because its `continue_selling` is true, so the validation
-- scan passes on current data with no cleanup step. `NOT VALID` would
-- not have helped in any case: it exempts existing rows from the
-- initial scan only, and any later UPDATE of such a row is still
-- checked.
--
-- Operational consequence, deliberately accepted: turning
-- `continue_selling` OFF on a variant that is currently in deficit will
-- be refused. That is correct — a merchant cannot coherently say "stop
-- selling past zero" about a variant already past zero — and
-- `assertInventoryFloor()` in product.service.ts refuses it first, with
-- a sentence the merchant can act on, so this constraint is never the
-- thing the user sees.
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "product_variant_inventory_floor"
  CHECK ("continue_selling" OR "inventory_qty" >= 0);

-- ══════════════════════════════════════════════════════════════════
-- RESERVATION SANITY
-- ══════════════════════════════════════════════════════════════════
--
-- A zero or negative reservation would silently corrupt the
-- availability aggregate, which is a SUM over exactly this column: a
-- negative row would manufacture stock out of nothing.
ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservation_quantity_positive"
  CHECK ("quantity" > 0);

-- ══════════════════════════════════════════════════════════════════
-- THE NETTING INDEX
-- ══════════════════════════════════════════════════════════════════
--
-- Availability is `inventory_qty` minus the sum of `held` reservation
-- quantities for the same (store, mode, variant). That aggregate now
-- runs on the hot path of every checkout, inside a transaction holding
-- row locks, so it must not scan dead rows.
--
-- Partial on `state = 'held'` rather than a plain composite: `held` is
-- the transient minority state. `converted` has already moved
-- `inventory_qty` and `released`/`expired` are not live, so the vast
-- majority of this table is permanently irrelevant to the query and is
-- correctly kept out of the index entirely.
--
-- The pre-existing full index on (store_id, mode, variant_id) is left
-- in place: it serves the general per-variant reservation lookup, which
-- is a different question from "what is being held right now".
CREATE INDEX "inventory_reservations_held_by_variant_idx"
  ON "inventory_reservations"("store_id", "mode", "variant_id")
  WHERE "state" = 'held';

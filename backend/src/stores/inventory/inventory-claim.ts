import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/* ══════════════════════════════════════════════════════════════════════
   THE INVENTORY CLAIM.

   Before this existed, stock was read in one transaction, the provider
   was called, and the hold was written in a SECOND transaction. Two
   shoppers on two different carts both read the same number, both
   passed, both paid — and `inventory_qty` went negative with nobody
   having done anything wrong. The cart lock from Round 8 cannot help:
   it serialises one cart against itself, and overselling is a
   contention between DIFFERENT carts over a shared row.

   So the claim moves here, and it is a claim rather than a check:

     1. Lock every ProductVariant the checkout touches, FOR UPDATE, in
        ascending id order. The lock is what makes two concurrent
        claimants take turns; the ORDER is what stops two multi-line
        checkouts holding each other's next row (a cart of {A,B} and a
        cart of {B,A} deadlock without it).

     2. Compute availability as `inventory_qty` minus the quantity
        already held by LIVE reservations on the same store/mode/variant.
        `held` only: `released` and `expired` are not live, and
        `converted` has already moved `inventory_qty` itself. Counting
        `released` would make a shopper retrying after a decline block
        themselves with their own superseded hold.

     3. Refuse, or write the reservation — in the SAME transaction, so
        there is no window between deciding and holding.

   These are plain functions taking a `Prisma.TransactionClient`, the
   same shape as `cart-slot.ts`, so the checkout path, the finaliser in
   the payments module, and the admin order path can all join a
   transaction another module owns without those modules importing each
   other.

   TWO FLAGS, AND THEY ARE NOT THE SAME FLAG:

     track_inventory = false   this variant is not counted at all. No
                               reservation, no decrement, no gate.

     continue_selling = true   backorder. Counted, held and decremented
                               exactly like any other variant, but
                               availability can NEVER refuse the sale.
                               `inventory_qty` goes negative and that
                               negative IS the deficit — it is the only
                               record the system keeps of units owed.
                               See ROUND9A_CONTINUE_SELLING_DECISION.md.
   ══════════════════════════════════════════════════════════════════════ */

/** One line of a claim: what to hold, and under which flags. */
export interface ClaimLine {
  variantId: bigint;
  quantity: number;
  trackInventory: boolean;
  continueSelling: boolean;
}

/** Raised when availability cannot cover a gated line. */
export class InsufficientStockError extends Error {
  constructor(
    readonly variantId: bigint,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Insufficient stock for variant ${variantId}: ` +
        `requested ${requested}, available ${available}.`,
    );
    this.name = 'InsufficientStockError';
  }
}

/**
 * Takes the row locks, in ascending variant id.
 *
 * Raw SQL because `FOR UPDATE` has no Prisma expression, and a bare
 * SELECT on ProductVariant rather than a join, so only the variant rows
 * are locked and the ordering is exactly the one asked for. The locks
 * are held until the enclosing transaction ends.
 *
 * De-duplicated and sorted here rather than at the call sites: the
 * deadlock-freedom argument depends on EVERY claimant using the same
 * order, so no caller is trusted to have sorted its own list.
 */
export async function lockVariants(
  tx: Prisma.TransactionClient,
  variantIds: readonly bigint[],
): Promise<void> {
  const ordered = [...new Set(variantIds.map((id) => id.toString()))]
    .map((id) => BigInt(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (ordered.length === 0) return;

  await tx.$queryRaw`
    SELECT "id"
    FROM "ProductVariant"
    WHERE "id" IN (${Prisma.join(ordered)})
    ORDER BY "id"
    FOR UPDATE
  `;
}

/**
 * How much of each variant live reservations are already holding.
 *
 * ══════════════════════════════════════════════════════════════════
 * STORE-SCOPED, AND DELIBERATELY *NOT* MODE-SCOPED.
 * ══════════════════════════════════════════════════════════════════
 *
 * THE RULE, stated once so the four functions in this file cannot drift
 * apart again:
 *
 *   `mode` is a PAYMENT-PROCESSING dimension. It is not an inventory
 *   dimension. One variant has ONE physical pool of units, and every
 *   claim against it competes with every other claim regardless of
 *   which payment mode asked.
 *
 * The schema says so plainly. Everything on the catalog and fulfilment
 * side — `Product`, `ProductVariant` (which owns the single
 * `inventory_qty` column), `Order`, `OrderItem` — has no `mode` column
 * at all. Everything on the payment side — `Checkout`, `PaymentIntent`,
 * `Cart` — does. `InventoryReservation` carries one only because it
 * hangs off a mode-scoped `Checkout`; it is inherited from the payment
 * dimension and was never a statement that stock is partitioned.
 *
 * This used to filter on `mode`, and that made the netting disagree
 * with the decrement it protects. `decrementInventory()` below has
 * never had a mode predicate — it cannot, because the column it writes
 * has no mode — so availability was computed from one HALF of the holds
 * and then applied to the WHOLE pool:
 *
 *     one unit left, held by a test-mode checkout
 *     admin manual order runs with mode='live'
 *       → sums held WHERE mode='live'  → 0
 *       → availability 1 - 0 = 1       → passes
 *       → decrements the shared column → 0
 *     the test-mode shopper then pays
 *       → the guard refuses, or on a backorder variant goes to -1
 *
 * The row locks in `lockVariants()` serialised those two perfectly and
 * they still both said yes, because each was subtracting only its own
 * half of the holds. That is the same shape of bug the whole claim was
 * built to close, one dimension over.
 *
 * The store predicate stays, and matters: different merchants own
 * different physical stock. `assertAbsoluteEditIsSafe()` below has
 * always aggregated without a mode filter, so this brings the two into
 * agreement rather than moving them apart.
 */
async function heldQuantities(
  tx: Prisma.TransactionClient,
  input: { storeId: bigint; variantIds: readonly bigint[] },
): Promise<Map<string, number>> {
  if (input.variantIds.length === 0) return new Map();

  const rows = await tx.inventoryReservation.groupBy({
    by: ['variant_id'],
    where: {
      store_id: input.storeId,
      variant_id: { in: [...input.variantIds] },
      state: 'held',
    },
    _sum: { quantity: true },
  });

  return new Map(
    rows.map((row) => [row.variant_id.toString(), row._sum.quantity ?? 0]),
  );
}

/**
 * Availability per variant: on hand, minus what is already held.
 *
 * Exposed for the admin order path, which checks availability but
 * writes no reservation of its own — it decrements immediately.
 *
 * The caller must have locked the rows first; this function does not,
 * because both callers lock a superset of what they then read.
 */
export async function readAvailability(
  tx: Prisma.TransactionClient,
  input: { storeId: bigint; variantIds: readonly bigint[] },
): Promise<Map<string, number>> {
  if (input.variantIds.length === 0) return new Map();

  /*
   * Store-predicated through `Product`, exactly like the decrement and
   * the increment below. `ProductVariant` carries no `store_id` of its
   * own and no RLS policy, so without this join the availability read
   * would address a variant by bare id — safe only for as long as every
   * caller remembers to pre-filter. The two statements that WRITE this
   * column have always joined; this one now does too.
   */
  const variants = await tx.productVariant.findMany({
    where: {
      id: { in: [...input.variantIds] },
      product: { store_id: input.storeId },
    },
    select: { id: true, inventory_qty: true },
  });

  const held = await heldQuantities(tx, input);

  return new Map(
    variants.map((variant) => [
      variant.id.toString(),
      variant.inventory_qty - (held.get(variant.id.toString()) ?? 0),
    ]),
  );
}

/**
 * Locks, nets, and refuses — the read half of a claim.
 *
 * Throws `InsufficientStockError` on the FIRST line that does not fit.
 * Because every caller runs this inside a transaction, a throw rolls
 * back everything: a multi-line checkout takes all of its stock or none
 * of it, with no partial-hold state to clean up afterwards.
 *
 * Untracked lines are skipped entirely — not locked, not netted, not
 * checked. Backorder lines ARE locked and netted (so their holds stay
 * honest and the lock ordering stays complete) but can never be
 * refused.
 */
export async function assertAvailable(
  tx: Prisma.TransactionClient,
  input: { storeId: bigint; lines: readonly ClaimLine[] },
): Promise<void> {
  const tracked = input.lines.filter((line) => line.trackInventory);
  if (tracked.length === 0) return;

  const variantIds = tracked.map((line) => line.variantId);

  await lockVariants(tx, variantIds);

  const available = await readAvailability(tx, {
    storeId: input.storeId,
    variantIds,
  });

  /*
   * Summed per variant, not checked per line: the same variant can
   * legitimately appear twice in one request on the stateless path
   * (the server cart merges duplicates, a raw `dto.items` need not),
   * and two lines of three against a stock of four must be refused
   * even though neither line alone exceeds it.
   */
  const requested = new Map<string, number>();
  for (const line of tracked) {
    const key = line.variantId.toString();
    requested.set(key, (requested.get(key) ?? 0) + line.quantity);
  }

  for (const line of tracked) {
    // Backorder: availability is not permitted to refuse the sale.
    if (line.continueSelling) continue;

    const key = line.variantId.toString();
    const want = requested.get(key) ?? line.quantity;
    const have = available.get(key) ?? 0;

    if (have < want) {
      throw new InsufficientStockError(line.variantId, want, have);
    }
  }
}

/**
 * Takes stock, or refuses to.
 *
 * The guard carries the SAME disjunction as the database CHECK
 * constraint `product_variant_inventory_floor`: a backorder variant may
 * always be decremented, any other must have the units on hand. Writing
 * the guard as a bare `inventory_qty >= quantity` would silently break
 * every backorder sale, which is why the two predicates are stated
 * together here and must stay in step.
 *
 * The store predicate is joined through Product because ProductVariant
 * carries no `store_id` of its own and no RLS policy — it is the same
 * ownership check `order-cancellation.service.ts` already makes, and
 * without it this statement would address a variant by bare id.
 *
 * `updated_at` is set explicitly: Prisma's `@updatedAt` is applied by
 * the client, and this is raw SQL.
 *
 * @returns true when the units were taken, false when the guard
 *   refused. A false is never an error by itself — the caller decides,
 *   because "no money has moved" and "the customer has already paid"
 *   are two different situations with two different right answers.
 */
export async function decrementInventory(
  tx: Prisma.TransactionClient,
  input: {
    storeId: bigint;
    variantId: bigint;
    quantity: number;
  },
): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE "ProductVariant" AS pv
    SET "inventory_qty" = pv."inventory_qty" - ${input.quantity}::int,
        "updated_at" = CURRENT_TIMESTAMP
    FROM "Product" AS p
    WHERE pv."id" = ${input.variantId}
      AND p."id" = pv."product_id"
      AND p."store_id" = ${input.storeId}
      AND (pv."continue_selling" OR pv."inventory_qty" >= ${input.quantity}::int)
  `;

  return affected > 0;
}

/**
 * Guards an ABSOLUTE stock edit — Round 9 §8 R6.
 *
 * A merchant's product save writes `inventory_qty` as a whole number
 * parsed from the request, never as a delta. That is a
 * read-modify-write whose read happened in the browser, so a sale that
 * commits between the form loading and the save being submitted is
 * silently added back.
 *
 * THE DEFINED BEHAVIOUR, and the reason it is in two parts:
 *
 *   1. The edit is SERIALISED against the claim. The caller locks the
 *      variant rows with `lockVariants()` first, in the same ascending
 *      order every claimant uses, so an edit and a concurrent checkout
 *      can never interleave: one of them goes first, completely, and
 *      the other sees its result. Without this the two are a genuine
 *      torn read-modify-write; with it, the outcome is always one of
 *      two well-defined states.
 *
 *   2. The edit MAY NOT DESTROY A LIVE HOLD. This function refuses an
 *      absolute value that cannot cover the units live checkouts are
 *      already holding, because those units belong to shoppers who are
 *      mid-payment: writing a number below them would either oversell
 *      them or strand their reservation against stock that no longer
 *      exists. Backorder variants are exempt for the usual reason —
 *      `continue_selling` means availability may go below zero.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not detect a stale
 * absolute number whose sale has already CONVERTED. Once the units are
 * decremented and the reservation is `converted`, nothing in the
 * request distinguishes "the merchant recounted and there really are
 * 10" from "the merchant is echoing back a 10 they loaded before the
 * sale". Telling those apart requires the value the merchant saw — an
 * optimistic version token on the request, or the adjustment-delta API
 * — and Round 9 §10 names both as the follow-up rather than this
 * round's remit. Under the lock, that case is last-writer-wins, and it
 * is now a documented behaviour rather than an unexamined race.
 */
export async function assertAbsoluteEditIsSafe(
  tx: Prisma.TransactionClient,
  input: {
    storeId: bigint;
    variantId: bigint;
    newQty: number;
    continueSelling: boolean;
    title: string;
  },
): Promise<void> {
  if (input.continueSelling) return;

  /*
   * Mode-blind, like every other aggregate over this column — see the
   * rule in `heldQuantities()`. A merchant lowering stock below the
   * units a shopper is mid-payment for must be refused whichever
   * payment mode that shopper's checkout is running in, because they
   * are all holding from the same physical pool.
   */
  const held = await tx.inventoryReservation.aggregate({
    where: {
      store_id: input.storeId,
      variant_id: input.variantId,
      state: 'held',
    },
    _sum: { quantity: true },
  });

  const heldUnits = held._sum.quantity ?? 0;

  if (heldUnits === 0 || input.newQty >= heldUnits) return;

  throw new BadRequestException(
    `"${input.title}" has ${heldUnits} unit(s) held by checkouts in ` +
      `progress. Set its stock to at least ${heldUnits}, or wait for ` +
      'those checkouts to finish, before lowering it further.',
  );
}

/**
 * Gives stock back, for a cancellation that restocks.
 *
 * An increment needs no availability guard — it can never breach the
 * floor — but it does need the same store predicate as the decrement,
 * for the same reason.
 */
export async function incrementInventory(
  tx: Prisma.TransactionClient,
  input: {
    storeId: bigint;
    variantId: bigint;
    quantity: number;
  },
): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE "ProductVariant" AS pv
    SET "inventory_qty" = pv."inventory_qty" + ${input.quantity}::int,
        "updated_at" = CURRENT_TIMESTAMP
    FROM "Product" AS p
    WHERE pv."id" = ${input.variantId}
      AND p."id" = pv."product_id"
      AND p."store_id" = ${input.storeId}
  `;

  return affected > 0;
}

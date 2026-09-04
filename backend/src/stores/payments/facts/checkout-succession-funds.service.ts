import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Mode } from '@prisma/client';
import {
  MAX_SUCCESSION_DEPTH,
  MAX_SUCCESSION_NODES,
  fundsSecuredElsewhereInChain,
  type DescendantFunds,
} from '../../checkout/checkout-succession';

/**
 * ==================================================================
 * The succession funds invariant, resolved against the database
 * ==================================================================
 *
 * > A checkout with any descendant that has secured funds must not
 * > itself secure funds again.
 *
 * `checkout-succession.ts` holds the rule with no database in it. This
 * holds the two things the rule cannot do for itself: walk the chain,
 * and make the answer survive concurrency.
 *
 * Lives in the payments module, beside CheckoutFinalizerService and for
 * the same reason: both the applier (Payment Core) and CheckoutService
 * need it, CheckoutModule already imports PaymentsModule, and putting it
 * the other way round would be a cycle.
 *
 * ── Why the lock is not optional ──────────────────────────────────
 *
 * A predecessor and its successor are DIFFERENT checkouts with DIFFERENT
 * intents. The applier's optimistic concurrency is a `version` check on
 * one intent row, so a capture landing on A never conflicts with a
 * capture landing on B — they touch no common row. Transactions run at
 * Prisma's default READ COMMITTED, so A's read of B's state is correct
 * as of A's snapshot and simply does not see B's concurrent commit:
 *
 *     T1 (capture for A)                T2 (capture for B)
 *     read chain → B not yet paid       …
 *     ⇒ not blocked  ◄── stale          B captured, Order created
 *     Order created  ✗                  COMMIT
 *
 * Two Orders, two real charges, from nothing more exotic than timing.
 * The verdict therefore cannot be claimed from application ordering; it
 * has to be serialised in the database. `pg_advisory_xact_lock` keyed on
 * the chain's ROOT does exactly that, and is the mechanism already used
 * in this module by `PaymentFactApplier.findBeneficiary`.
 *
 * The root is the right key because it is the one identifier every
 * member of a chain shares, and it is stable: `supersedes_id` is written
 * once, in the INSERT that creates the successor, so links only ever
 * point backwards and a root can never be re-parented.
 */
@Injectable()
export class CheckoutSuccessionFundsService {
  private readonly logger = new Logger(CheckoutSuccessionFundsService.name);

  /**
   * Serialises everything that reads or changes this chain's verdict.
   *
   * MUST be called inside the caller's transaction, before the verdict
   * is read, by BOTH sides: whoever asks "may this checkout take money"
   * and whoever makes the answer true by securing funds. A lock only one
   * side takes serialises nothing.
   *
   * `pg_advisory_xact_lock` releases on COMMIT or ROLLBACK, so the
   * applier's existing catch-and-classify path cannot leak one. Only
   * ever one chain lock is held at a time, so there is no lock ordering
   * to get wrong and no deadlock available.
   */
  async lockChain(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<void> {
    const rootId = await this.rootOf(tx, storeId, mode, checkoutId);
    const lockKey = `checkout_succession:${storeId.toString()}:${mode}:${rootId.toString()}`;

    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and
    // the statement runs purely for the lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  /**
   * The head of this checkout's chain.
   *
   * Walks `supersedes_id` BACKWARDS by primary key. Bounded by the same
   * constant as the forward walk, and cycle-safe by a `seen` set even
   * though the write rule already makes a cycle impossible — a bound
   * that depends on a data invariant staying true is not a bound.
   */
  private async rootOf(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<bigint> {
    let current = checkoutId;
    const seen = new Set<string>([current.toString()]);

    for (let depth = 0; depth < MAX_SUCCESSION_DEPTH; depth += 1) {
      const row = await tx.checkout.findFirst({
        where: { id: current, store_id: storeId, mode },
        select: { supersedes_id: true },
      });

      const parent = row?.supersedes_id ?? null;
      if (parent === null) break;

      const key = parent.toString();
      if (seen.has(key)) break;
      seen.add(key);
      current = parent;
    }

    return current;
  }

  /**
   * Does any descendant of this checkout hold secured funds?
   *
   * Call `lockChain` first, in the same transaction, or the answer is a
   * snapshot that another transaction may already have invalidated.
   *
   * Short-circuits on the overwhelmingly common shape — a checkout
   * nobody retried has no descendants, which costs one indexed lookup
   * against `checkouts_supersedes_id_idx` and returns.
   */
  async isBlocked(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<boolean> {
    const others = await this.chainMembersExcept(tx, storeId, mode, checkoutId);
    if (others.length === 0) return false;

    const blocked = fundsSecuredElsewhereInChain(others);

    if (blocked) {
      this.logger.warn(
        `Checkout ${checkoutId} is superseded by a descendant that secured ` +
          `funds; it may not secure funds again.`,
      );
    }

    return blocked;
  }

  /* ══════════════════════════════════════════════════════════════
     THE CART ARM OF THE SAME INVARIANT.

     Everything above keys on `supersedes_id`, and `supersedes_id` is
     only ever written when the BROWSER sends `supersedes_checkout_token`
     on the retry. `frontend/.../checkout/page.tsx` keeps that token in a
     `useRef` — browser memory, not storage, and deliberately so — which
     means a reload between the failed attempt and the retry loses it.
     The server then has no idea the two checkouts are the same purchase,
     and the whole Round 5/6 protection is silently absent:

       1. Cart C, checkout A, shopper pays; the webhook is delayed.
       2. A expires (or a decline abandons it); the cart slot goes back
          and cart C stays `active`, which is what makes retry work.
       3. The shopper reloads and retries. `supersedesTokenRef` is null,
          so B is created with `supersedes_id = NULL`.
       4. B pays. Order 2 exists, cart C is `converted`.
       5. A's payment finally lands. Nothing links A to B, so
          `isBlocked()` says no — and a SECOND Order is created for one
          basket, with no `payment.superseded_funds_detected` and so no
          alarm and no remediation.

     Round 8 already built the server-side answer to "is this the same
     purchase?" — `Checkout.cart_id`. It was simply never connected to
     this. This is that wire.

     `checkouts_one_live_per_cart` does not cover it: that index only
     forbids two LIVE checkouts at once, and by step 3 A is no longer
     live.

     The chain arm is NOT replaced. A checkout with no cart (the
     cookieless stateless path) still has only the chain, and a chain
     that spans two carts still blocks. The two arms answer the same
     question from different evidence, and either one blocking is enough.
     ══════════════════════════════════════════════════════════════ */

  /**
   * Serialises everything that reads or changes THIS CART's verdict.
   *
   * The chain lock cannot do this job. A predecessor and its successor
   * are different checkouts with different intents, and in the case this
   * arm exists for they are not even in the same chain — so their two
   * captures share no row, no chain root, and nothing to contend on.
   * Under READ COMMITTED both would read "cart still active" and both
   * would finalise:
   *
   *     T1 (capture for A)              T2 (capture for B)
   *     read cart C → active            …
   *     ⇒ not blocked  ◄── stale        cart C converted, Order created
   *     Order created  ✗                COMMIT
   *
   * Two Orders, two real charges, from nothing more exotic than timing —
   * the identical failure the chain lock was introduced to close, one
   * identifier over.
   *
   * Keyed on the CART, so every checkout priced from one basket
   * serialises regardless of which chain it belongs to. Taken with the
   * same `pg_advisory_xact_lock` the chain uses, and always AFTER it, so
   * the two locks have one global order and cannot deadlock against each
   * other. A checkout with no cart takes no lock at all.
   */
  async lockCart(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<void> {
    const cartId = await this.cartIdOf(tx, storeId, mode, checkoutId);
    if (cartId === null) return;

    const lockKey = `checkout_cart_funds:${storeId.toString()}:${mode}:${cartId.toString()}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  /**
   * Has this checkout's cart already become somebody else's Order?
   *
   * Call `lockCart` first, in the same transaction, or the answer is a
   * snapshot another transaction may already have invalidated.
   *
   * The comparison against the checkout's OWN `order_id` is what keeps
   * this from firing on the ordinary path. When a checkout finalises it
   * converts its own cart in the same transaction, so afterwards the
   * cart is `converted` and points at that checkout's order — asking
   * again (a redelivered capture, a later manual capture on the same
   * attempt) must answer "no". Only a cart converted to a DIFFERENT
   * order means this checkout's money arrived for a purchase somebody
   * else already completed.
   */
  async isCartConvertedElsewhere(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<boolean> {
    const checkout = await tx.checkout.findFirst({
      where: { id: checkoutId, store_id: storeId, mode },
      select: { cart_id: true, order_id: true },
    });

    // No cart: the cookieless stateless path, and every checkout that
    // existed before Round 8. The chain arm is all there is, exactly as
    // before.
    if (!checkout?.cart_id) return false;

    const cart = await tx.cart.findFirst({
      where: { id: checkout.cart_id, store_id: storeId, mode },
      select: { status: true, converted_order_id: true },
    });

    if (!cart || cart.status !== 'converted') return false;
    if (cart.converted_order_id === null) return false;

    // This checkout's own conversion. Not a collision.
    if (
      checkout.order_id !== null &&
      cart.converted_order_id === checkout.order_id
    ) {
      return false;
    }

    this.logger.warn(
      `Checkout ${checkoutId} secured funds for cart ${checkout.cart_id}, ` +
        `which was already converted to order ${cart.converted_order_id} by ` +
        'another checkout. It may not create a second order.',
    );

    return true;
  }

  /** The cart a checkout was priced from, or null. */
  private async cartIdOf(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<bigint | null> {
    const checkout = await tx.checkout.findFirst({
      where: { id: checkoutId, store_id: storeId, mode },
      select: { cart_id: true },
    });

    return checkout?.cart_id ?? null;
  }

  /**
   * Every other member of this checkout's chain, with each one's payment
   * state attached.
   *
   * Walks from the ROOT, not from this checkout, so the answer covers
   * both directions. Forward-only would close just the case where an old
   * checkout pays after its replacement did, and leave the mirror image
   * open — a predecessor settling late and legitimately, and then its
   * successor settling too, which is two real charges reached without a
   * single illegal state.
   *
   * Transitive, not one hop: A → B → C with only C paid must block A as
   * well as B, and a single-hop check lets A straight through.
   */
  private async chainMembersExcept(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<DescendantFunds[]> {
    const rootId = await this.rootOf(tx, storeId, mode, checkoutId);

    const seen = new Set<string>([rootId.toString()]);
    const found: {
      id: bigint;
      hasOrder: boolean;
      offeringId: bigint | null;
    }[] = [];
    let frontier: bigint[] = [rootId];

    // The root is a chain member too, unless it is the checkout being
    // decided. Walking from it and then removing self is what makes this
    // symmetric.
    if (rootId !== checkoutId) {
      const root = await tx.checkout.findFirst({
        where: { id: rootId, store_id: storeId, mode },
        select: { id: true, order_id: true, selected_offering_id: true },
      });

      if (root) {
        found.push({
          id: root.id,
          hasOrder: root.order_id !== null,
          offeringId: root.selected_offering_id,
        });
      }
    }

    for (let depth = 0; depth < MAX_SUCCESSION_DEPTH; depth += 1) {
      if (frontier.length === 0) break;

      const rows = await tx.checkout.findMany({
        where: { store_id: storeId, mode, supersedes_id: { in: frontier } },
        select: { id: true, order_id: true, selected_offering_id: true },
        orderBy: { id: 'asc' },
        take: MAX_SUCCESSION_NODES,
      });

      frontier = [];
      for (const row of rows) {
        const key = row.id.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        // Never decided against itself.
        if (row.id !== checkoutId) {
          found.push({
            id: row.id,
            hasOrder: row.order_id !== null,
            offeringId: row.selected_offering_id,
          });
        }
        frontier.push(row.id);
      }

      if (seen.size >= MAX_SUCCESSION_NODES) break;
    }

    if (found.length === 0) return [];

    const intents = await tx.paymentIntent.findMany({
      where: {
        store_id: storeId,
        mode,
        context_kind: 'checkout',
        context_id: { in: found.map((row) => row.id.toString()) },
      },
      select: {
        context_id: true,
        status: true,
        captured_total_minor: true,
      },
    });

    const intentByCheckout = new Map(
      intents.map((intent) => [intent.context_id, intent]),
    );

    /*
     * Whether an Order on a descendant was created against money or
     * against a promise.
     *
     * Cash on delivery and bank transfer commit an Order with nothing
     * secured behind it. Treating a bare `order_id` as proof of funds
     * would freeze a predecessor whose successor was a COD order — the
     * customer's card never touched, and their original payment
     * permanently refused. Only looked up for descendants that actually
     * have an Order, so the common path pays nothing for it.
     */
    const offeringIds = found
      .filter((row) => row.hasOrder && row.offeringId !== null)
      .map((row) => row.offeringId as bigint);

    const securesFundsByOffering = new Map<string, boolean>();

    if (offeringIds.length > 0) {
      const offerings = await tx.paymentMethodOffering.findMany({
        where: { id: { in: offeringIds }, store_id: storeId, mode },
        select: { id: true, commitment_kind: true },
      });

      for (const offering of offerings) {
        securesFundsByOffering.set(
          offering.id.toString(),
          offering.commitment_kind === 'funds_secured',
        );
      }
    }

    return found.map((row) => {
      const intent = intentByCheckout.get(row.id.toString());

      return {
        id: row.id,
        intentStatus: intent?.status ?? null,
        capturedTotalMinor: intent?.captured_total_minor ?? 0n,
        hasOrder: row.hasOrder,
        commitmentSecuresFunds:
          row.offeringId === null
            ? false
            : (securesFundsByOffering.get(row.offeringId.toString()) ?? false),
      };
    });
  }
}

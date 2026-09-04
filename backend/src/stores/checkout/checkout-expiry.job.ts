import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import type { Mode } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { crossStoreQuery } from '../../common/tenant/cross-store-query'
import { releaseCartSlot } from '../cart/cart-slot'

/**
 * ==================================================================
 * Releasing abandoned checkouts
 * ==================================================================
 *
 * A funds_secured checkout holds stock rather than taking it, because
 * the customer may never complete the payment. That is correct — but it
 * only works if something eventually gives the stock back.
 *
 * Nothing did. `expires_at` was written on every reservation and never
 * read, so a shopper who opened a card payment and closed the tab held
 * that inventory permanently. Most carts are abandoned, so a store would
 * bleed sellable stock continuously with no visible cause.
 *
 * Offline checkouts are unaffected: their reservations are written as
 * `converted` at commitment, so there is nothing held to release.
 */

/** Cap per run so a backlog cannot monopolise a worker. */
const BATCH_SIZE = 200

@Injectable()
export class CheckoutExpiryJob {
  private readonly logger = new Logger(CheckoutExpiryJob.name)

  private running = false

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) return

    this.running = true
    try {
      /*
       * TWO SWEEPS, TWO ERROR BOUNDARIES — deliberately not one.
       *
       * These halves run on DIFFERENT database connections. The
       * reservation release runs as `dartstore_app`; the cart sweep
       * reads across every store and therefore runs as
       * `dartstore_platform`. They fail for different reasons and mean
       * different things to whoever is on call.
       *
       * A single try/catch around both actively misled an operator
       * once. The platform role was missing its SELECT on `carts`, so
       * `sweepExpiredCarts()` threw `42501` on every tick and the only
       * line in the log read "Checkout expiry sweep failed" — which
       * reads as "expired stock is not being released", the far more
       * alarming of the two. It was not: `releaseExpired()` had already
       * run to completion and committed. A whole report was written on
       * the wrong diagnosis before the stack trace was read closely
       * enough to show which half had actually thrown
       * (`out/ي/NEON_EXPIRY_GRANTS_APPLY_REPORT.md` §3).
       *
       * So each half now catches its own failure and names itself, and
       * neither can hide the other: if the cart sweep is broken, the
       * reservation release still runs and still reports, and the log
       * says exactly which one needs attention.
       */
      await this.runReleaseExpired()

      // Runs after the checkout sweep on purpose: a checkout released
      // above frees its cart's slot, so the cart becomes sweepable in
      // the same tick rather than a minute later. It runs even if that
      // sweep failed — the two are independent, and skipping this
      // because the other broke would be the same masking in a
      // different shape.
      await this.runSweepExpiredCarts()
    } finally {
      this.running = false
    }
  }

  /**
   * The reservation-release half, with its own error boundary.
   *
   * @returns how many checkouts were released; 0 if the sweep failed.
   */
  private async runReleaseExpired(): Promise<number> {
    try {
      const released = await this.releaseExpired()
      if (released > 0) {
        this.logger.log(`Released ${released} expired checkout(s).`)
      }
      return released
    } catch (error) {
      this.logger.error(
        `[checkout-expiry] Releasing expired checkouts failed: ${
          (error as Error).message
        }. Expired reservations are still holding stock.`,
        (error as Error).stack,
      )
      return 0
    }
  }

  /**
   * The cart-abandonment half, with its own error boundary.
   *
   * Names the platform connection in the message because that is the
   * thing that is usually wrong when this fails, and it is not
   * discoverable from the error text PostgreSQL returns.
   *
   * @returns how many carts were abandoned; 0 if the sweep failed.
   */
  private async runSweepExpiredCarts(): Promise<number> {
    try {
      const abandoned = await this.sweepExpiredCarts()
      if (abandoned > 0) {
        this.logger.log(`Abandoned ${abandoned} expired cart(s).`)
      }
      return abandoned
    } catch (error) {
      this.logger.error(
        `[cart-expiry] Abandoning expired carts failed: ${
          (error as Error).message
        }. This half runs on the platform connection ` +
          '(DATABASE_URL_PLATFORM); a permission error here means ' +
          'dartstore_platform is missing SELECT on carts. Expired ' +
          'checkout reservations are unaffected and were released ' +
          'separately.',
        (error as Error).stack,
      )
      return 0
    }
  }

  /**
   * Releases stock held by checkouts that expired without committing.
   *
   * Exposed separately so it can be invoked on demand and asserted in
   * tests without waiting for the schedule.
   *
   * @returns how many checkouts were released.
   */
  async releaseExpired(now = new Date()): Promise<number> {
    // Sweeping every store is the point of the sweep. The per-checkout
    // release below is scoped normally.
    const expired = await crossStoreQuery(
      'platform_sweep',
      'find expired uncommitted checkouts across all stores',
      /*
       * `platform()`, not `guarded()`, for the same reason the cart
       * sweep below uses it: as of
       * `20260904090000_enable_checkout_rls` the `checkouts` table
       * carries an RLS policy, so a read with no tenant context
       * installed sees NOTHING — this sweep would have quietly found
       * zero expired checkouts forever and stock held by abandoned
       * checkouts would never have been released.
       *
       * `dartstore_platform` holds SELECT on `checkouts` and nothing
       * else: it reads identity (`id`, `store_id`, `mode`) here, and
       * every write below happens inside the checkout's OWN tenant
       * transaction. Nothing in this method writes cross-tenant.
       */
      () =>
        this.prisma.platform().checkout.findMany({
          where: {
            // Only checkouts still waiting. A committed one owns its
            // stock, and a failed one was already released where it
            // failed.
            status: { in: ['open', 'pending_payment'] },
            expires_at: { lt: now },
            order_id: null,
          },
          orderBy: { expires_at: 'asc' },
          take: BATCH_SIZE,
          select: { id: true, store_id: true, mode: true },
        }),
    )

    let released = 0

    for (const checkout of expired) {
      try {
        await this.releaseOne(checkout.id, checkout.store_id, checkout.mode, now)
        released += 1
      } catch (error) {
        // One bad checkout must not stop the sweep.
        this.logger.warn(
          `Releasing checkout ${checkout.id} failed: ${(error as Error).message}`,
        )
      }
    }

    return released
  }

  private async releaseOne(
    checkoutId: bigint,
    storeId: bigint,
    mode: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      // Compare-and-set: only one sweeper (or one sweeper racing a
      // completing payment) moves the checkout out of its open state, so
      // stock is never released twice and never released from underneath
      // a payment that just succeeded.
      const claimed = await tx.checkout.updateMany({
        where: {
          id: checkoutId,
          store_id: storeId,
          status: { in: ['open', 'pending_payment'] },
          order_id: null,
        },
        data: { status: 'expired' },
      })

      if (claimed.count === 0) return

      await tx.inventoryReservation.updateMany({
        where: { checkout_id: checkoutId, store_id: storeId, state: 'held' },
        data: { state: 'expired', settled_at: now },
      })

      // The payment never completed, so the intent should not sit
      // non-terminal forever and be swept by reconciliation.
      await tx.paymentIntent.updateMany({
        where: {
          store_id: storeId,
          context_kind: 'checkout',
          context_id: checkoutId.toString(),
          status: {
            notIn: [
              'captured',
              'partially_captured',
              'refunded',
              'partially_refunded',
              'failed',
              'cancelled',
              'expired',
            ],
          },
        },
        data: { status: 'expired', terminal_at: now },
      })

      /*
       * And the cart gets its slot back, in this same transaction.
       *
       * A checkout that expired without being paid must not keep
       * holding its cart: the shopper is still shopping, and the next
       * Place Order has to be able to claim the slot again. The cart
       * stays `active` — an expired attempt is not a statement about
       * the basket.
       *
       * Inside the transaction that just marked the checkout expired,
       * for the same reason the reservation release is: a slot freed by
       * a write that could be lost separately is a slot that leaks.
       */
      await releaseCartSlot(tx, {
        checkoutId,
        storeId,
        mode: mode as Mode,
      })
    })
  }

  /**
   * Retires carts nobody came back to.
   *
   * A cart lives 30 days, refreshed on every mutation. Past that it is
   * `abandoned` — terminal — and the shopper's next add-to-cart mints a
   * fresh one. Without this the table grows without bound and a cookie
   * from months ago silently resurrects a basket its owner has long
   * forgotten.
   *
   * Deliberately refuses to abandon a cart that still holds a live
   * checkout slot: an expiring cart must never be the thing that takes
   * a payable checkout away from someone mid-payment. Those carts are
   * swept on a later run, once the checkout above has released them.
   *
   * @returns how many carts were abandoned.
   */
  async sweepExpiredCarts(now = new Date()): Promise<number> {
    const expired = await crossStoreQuery(
      'platform_sweep',
      'find expired carts across all stores',
      /*
       * `platform()`, not `guarded()`, and for a concrete reason: the
       * cart tables carry RLS policies, so a read with no tenant
       * context installed sees nothing at all. That is the policy
       * working — and a platform sweep is exactly the case the owner
       * connection exists for. Same idiom as the outbox dispatcher's
       * cross-store claim, and as `releaseExpired` above, which now
       * reads `checkouts` the same way for the same reason. Each cart
       * is then updated inside its OWN tenant transaction below, so
       * nothing here writes cross-tenant.
       */
      () =>
        this.prisma.platform().cart.findMany({
          where: {
            status: 'active',
            expires_at: { lt: now },
            active_checkout_id: null,
          },
          orderBy: { expires_at: 'asc' },
          take: BATCH_SIZE,
          select: { id: true, store_id: true, mode: true },
        }),
    )

    let abandoned = 0

    for (const cart of expired) {
      try {
        await this.prisma.withTenantTransaction(
          cart.store_id,
          cart.mode,
          async (tx) => {
            // Compare-and-set on the same conditions, so a cart that
            // acquired a checkout between the read and this write is
            // left alone.
            const claimed = await tx.cart.updateMany({
              where: {
                id: cart.id,
                store_id: cart.store_id,
                mode: cart.mode,
                status: 'active',
                active_checkout_id: null,
                expires_at: { lt: now },
              },
              data: { status: 'abandoned', version: { increment: 1 } },
            })

            if (claimed.count > 0) abandoned += 1
          },
        )
      } catch (error) {
        // One bad cart must not stop the sweep.
        this.logger.warn(
          `Abandoning cart ${cart.id} failed: ${(error as Error).message}`,
        )
      }
    }

    return abandoned
  }
}
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { crossStoreQuery } from '../../common/tenant/cross-store-query'

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
      const released = await this.releaseExpired()
      if (released > 0) {
        this.logger.log(`Released ${released} expired checkout(s).`)
      }
    } catch (error) {
      this.logger.error(
        `Checkout expiry sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
      )
    } finally {
      this.running = false
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
      () =>
        this.prisma.guarded().checkout.findMany({
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
          select: { id: true, store_id: true },
        }),
    )

    let released = 0

    for (const checkout of expired) {
      try {
        await this.releaseOne(checkout.id, checkout.store_id, now)
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
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
    })
  }
}
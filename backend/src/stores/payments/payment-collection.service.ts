import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Mode } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { LedgerService } from '../../ledger/ledger.service'
import { offlineCollected } from '../../ledger/posting-rules'
import { OutboxService } from '../../common/messaging/outbox.service'
import { parseDecimal } from '../../common/money/money.util'
import { assertIntentTransition } from './payment-intent.state'

/**
 * ==================================================================
 * Recording collection of an offline payment
 * ==================================================================
 *
 * Cash on delivery and bank transfer produce revenue at commitment and
 * a receivable that stays open until the merchant confirms the money
 * arrived. This is the only way that receivable ever clears.
 *
 * Without it a merchant can take a COD order and never mark it paid,
 * and offline_receivable grows forever.
 *
 * Idempotent: the ledger dedupe key makes a repeated call a no-op, and
 * an already-paid order is reported as a conflict rather than posted
 * twice.
 */
@Injectable()
export class PaymentCollectionService {
  private readonly logger = new Logger(PaymentCollectionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async recordCollection(
    storeId: bigint,
    orderId: string,
    options: { mode?: Mode; reference?: string } = {},
  ) {
    const mode: Mode = options.mode ?? 'live'

    const order = await this.prisma.guarded().order.findFirst({
      where: { id: BigInt(orderId), store_id: storeId },
    })

    if (!order) throw new NotFoundException('Order not found.')

    if (order.payment_status === 'PAID') {
      throw new ConflictException('Order is already marked as paid.')
    }

    if (order.payment_status === 'REFUNDED') {
      throw new ConflictException('A refunded order cannot be marked as paid.')
    }

    // Legacy orders predate checkout and have no committed receivable, so
    // posting a collection against them would drive offline_receivable
    // negative. They must be reconciled by hand.
    if (order.checkout_id === null) {
      throw new BadRequestException(
        'This order was not created through checkout and has no ledger entry to settle.',
      )
    }

    const currency = (order.currency || 'USD').toUpperCase()
    const total = parseDecimal(String(order.total), currency)

    if (total.amountMinor <= 0n) {
      throw new BadRequestException('Order total must be greater than zero.')
    }

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        store_id: storeId,
        mode,
        context_kind: 'checkout',
        context_id: order.checkout_id.toString(),
      },
    })

    if (!intent) {
      throw new NotFoundException('No payment intent found for this order.')
    }

    assertIntentTransition(intent.status, 'captured')

    const beneficiary = await this.prisma.guarded().beneficiary.findFirst({
      where: { store_id: storeId, mode, kind: 'store', external_ref: null },
      select: { id: true },
    })

    if (!beneficiary) {
      throw new NotFoundException('Store beneficiary is missing.')
    }

    const now = new Date()

    const updated = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set claim. This is the concurrency guard: only one
      // transaction can flip UNPAID -> PAID. A second concurrent caller
      // blocks on the row lock, re-evaluates the WHERE after the first
      // commits, matches nothing, and rolls back before writing a
      // Capture.
      //
      // Capture has no unique constraint of its own, so without this the
      // only thing preventing a duplicate would be the unique dedupe_key
      // on payment_events happening to be inserted first. That is an
      // ordering accident, not a guarantee.
      const claimed = await tx.order.updateMany({
        where: { id: order.id, store_id: storeId, payment_status: 'UNPAID' },
        data: { payment_status: 'PAID', paid_at: now },
      })

      if (claimed.count === 0) {
        throw new ConflictException(
          'Order was marked as paid by another request.',
        )
      }

      const capture = await tx.capture.create({
        data: {
          intent_id: intent.id,
          store_id: storeId,
          mode,
          amount_minor: total.amountMinor,
          currency,
          status: 'succeeded',
          gateway_capture_ref: options.reference ?? null,
          captured_at: now,
        },
        select: { id: true },
      })

      await tx.captureAllocation.create({
        data: {
          capture_id: capture.id,
          beneficiary_id: beneficiary.id,
          store_id: storeId,
          mode,
          amount_minor: total.amountMinor,
          kind: 'revenue',
        },
      })

      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'captured',
          captured_total_minor: total.amountMinor,
          terminal_at: now,
          version: { increment: 1 },
        },
      })

      await tx.paymentAttempt.updateMany({
        where: { intent_id: intent.id, status: { notIn: ['succeeded', 'failed'] } },
        data: { status: 'succeeded', next_action_kind: 'none' },
      })

      await tx.paymentEvent.create({
        data: {
          intent_id: intent.id,
          store_id: storeId,
          mode,
          event_type: 'payment.collected.offline',
          dedupe_key: `intent:${intent.id}:collected`,
          source: 'merchant',
          applied: true,
          payload_redacted: {
            orderId: order.id.toString(),
            amountMinor: total.amountMinor.toString(),
            currency,
            reference: options.reference ?? null,
          } as Prisma.InputJsonValue,
          occurred_at: now,
        },
      })

      // Clears the receivable opened at commitment.
      await this.ledger.post(tx, {
        storeId,
        mode,
        currency,
        entryType: 'payment.collected.offline',
        sourceKind: 'order',
        sourceId: order.id.toString(),
        dedupeKey: `order:${order.id}:collected`,
        occurredAt: now,
        memo: `Collection for order ${order.order_number}`,
        postings: offlineCollected({ totalMinor: total.amountMinor }),
      })

      // Already updated by the claim above; read it back for the response.
      const saved = await tx.order.findFirstOrThrow({
        where: { id: order.id, store_id: storeId },
        select: {
          id: true,
          order_number: true,
          payment_status: true,
          paid_at: true,
          status: true,
        },
      })

      await this.outbox.emit(tx, {
        storeId,
        mode,
        aggregateType: 'order',
        aggregateId: order.id.toString(),
        eventType: 'payment.collected',
        payload: {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          intentId: intent.id.toString(),
          captureId: capture.id.toString(),
          amountMinor: total.amountMinor.toString(),
          currency,
        },
        occurredAt: now,
      })

      return saved
    })

    this.logger.log(
      `Offline payment collected: store ${storeId} order ${updated.order_number} ${total.amountMinor} ${currency}`,
    )

    return {
      id: updated.id.toString(),
      order_number: updated.order_number,
      status: updated.status,
      payment_status: updated.payment_status,
      paid_at: updated.paid_at,
    }
  }
}
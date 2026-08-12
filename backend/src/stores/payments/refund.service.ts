import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { PaymentAccountService } from './payment-account.service'
import { ProviderRegistry } from './gateways/provider-registry.service'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { ProviderError, pspIdempotencyKey } from './gateways/provider.types'

/**
 * ==================================================================
 * Merchant-initiated refunds
 * ==================================================================
 *
 * Asks the provider to refund, then feeds the resulting facts through
 * the same applier a webhook would use. Nothing here writes a Refund row
 * or posts to the ledger directly — that stays in one place, so a
 * merchant-initiated refund and the provider's later confirmation
 * collapse to a single effect instead of double-counting.
 *
 * The refund is bound to the intent that took the payment, and the
 * ledger rule is chosen from that intent's payment_mode snapshot. A
 * store that changes payment mode still refunds old orders correctly.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly accounts: PaymentAccountService,
    private readonly applier: PaymentFactApplier,
  ) {}

  async refundOrder(
    storeId: bigint,
    orderId: string,
    options: { mode?: Mode; amountMinor?: bigint; reason?: string } = {},
  ) {
    const mode: Mode = options.mode ?? 'live'

    const order = await this.prisma.guarded().order.findFirst({
      where: { id: BigInt(orderId), store_id: storeId },
      select: { id: true, order_number: true, checkout_id: true, payment_status: true },
    })

    if (!order) throw new NotFoundException('Order not found.')

    if (order.payment_status === 'UNPAID') {
      throw new BadRequestException(
        'This order was never paid. Cancel it instead of refunding.',
      )
    }

    if (order.checkout_id === null) {
      throw new BadRequestException(
        'This order predates checkout and has no payment to refund.',
      )
    }

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        store_id: storeId,
        mode,
        context_kind: 'checkout',
        context_id: order.checkout_id.toString(),
      },
    })

    if (!intent) throw new NotFoundException('No payment found for this order.')

    if (intent.payment_mode !== 'MERCHANT_GATEWAY') {
      throw new BadRequestException(
        `Refunds are not implemented for the ${intent.payment_mode} payment mode.`,
      )
    }

    const capturedTotal: bigint = BigInt(intent.captured_total_minor)
    const refundedTotal: bigint = BigInt(intent.refunded_total_minor)
    const refundable: bigint = capturedTotal - refundedTotal

    if (refundable <= 0n) {
      throw new ConflictException('This payment has already been fully refunded.')
    }

    const amountMinor: bigint = options.amountMinor ?? refundable

    if (amountMinor <= 0n) {
      throw new BadRequestException('Refund amount must be greater than zero.')
    }

    if (amountMinor > refundable) {
      throw new BadRequestException(
        `Refund of ${amountMinor} exceeds the ${refundable} still refundable.`,
      )
    }

    if (intent.account_id === null) {
      throw new BadRequestException('This payment has no gateway account.')
    }

    const account = await this.prisma.guarded().paymentAccount.findFirstOrThrow({
      where: { id: intent.account_id, store_id: storeId, mode: intent.mode },
      select: { id: true, gateway: true },
    })

    const provider = this.providers.get(account.gateway)

    if (!provider.capabilities.partialRefund || !provider.refund) {
      throw new BadRequestException(
        `${account.gateway} does not support refunds through the API. ` +
          `Refund it in the provider dashboard; the webhook will reconcile it.`,
      )
    }

    const attempt = await this.prisma.guarded().paymentAttempt.findFirst({
      where: { intent_id: intent.id, store_id: storeId, mode: intent.mode },
      orderBy: { sequence: 'desc' },
      select: { gateway_reference: true },
    })

    if (!attempt?.gateway_reference) {
      throw new BadRequestException(
        'This payment has no gateway reference to refund against.',
      )
    }

    const capture = await this.prisma.guarded().capture.findFirst({
      where: {
        intent_id: intent.id,
        store_id: storeId,
        mode: intent.mode,
        status: 'succeeded',
      },
      orderBy: { id: 'asc' },
      select: { gateway_capture_ref: true },
    })

    const credentials = await this.accounts.revealCredentialsForGateway(
      storeId,
      intent.mode,
      account.id,
    )

    let facts

    try {
      facts = await provider.refund({
        accountId: account.id,
        gatewayReference: attempt.gateway_reference,
        gatewayCaptureRef: capture?.gateway_capture_ref ?? null,
        amountMinor,
        currency: intent.currency,
        reason: options.reason,
        credentials,
        // Derived, never random: a retried refund must carry the same key
        // or the provider issues a second one.
        idempotencyKey: pspIdempotencyKey({
          storeId,
          intentId: BigInt(intent.id),
          attemptSequence: 1,
          operation: `refund:${amountMinor}`,
        }),
        mode,
      })
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.error(
          `Refund refused by ${account.gateway} (${error.code}): ${error.message}`,
        )
        throw new BadRequestException(
          `The provider refused the refund (${error.code}).`,
        )
      }
      throw error
    }

    // The provider reports cumulative totals; the applier turns that into
    // a Refund row, allocations and a ledger entry.
    const results = await this.applier.applyMany(facts, 'merchant')

    const applied = results.some((r) => r.outcome === 'applied')

    const after = await this.prisma.guarded().paymentIntent.findFirstOrThrow({
      where: { id: intent.id, store_id: storeId, mode: intent.mode },
      select: { status: true, refunded_total_minor: true, captured_total_minor: true },
    })

    this.logger.log(
      `Refund of ${amountMinor} on order ${order.order_number} ` +
        `(${applied ? 'applied' : 'not applied'}).`,
    )

    return {
      order_id: order.id.toString(),
      order_number: order.order_number,
      refunded_amount_minor: amountMinor.toString(),
      refunded_total_minor: after.refunded_total_minor.toString(),
      captured_total_minor: after.captured_total_minor.toString(),
      payment_status: after.status,
      applied,
    }
  }
}
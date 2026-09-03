import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { IdempotencyService } from '../../common/idempotency/idempotency.service'
import { fingerprintRequest } from '../../common/idempotency/idempotency.types'
import { PaymentAccountService } from './payment-account.service'
import { ProviderRegistry } from './gateways/provider-registry.service'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { ProviderError, pspIdempotencyKey } from './gateways/provider.types'
import { outboundIdempotencyKey } from './gateways/payment-provider.interface'

/** Idempotency scope for a merchant-initiated refund. */
export const REFUND_SCOPE = 'payments.refund'

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
    private readonly idempotency: IdempotencyService,
  ) {}

  async refundOrder(
    storeId: bigint,
    orderId: string,
    options: {
      mode?: Mode
      amountMinor?: bigint
      reason?: string
      idempotencyKey?: string
    } = {},
  ) {
    const mode: Mode = options.mode ?? 'live'

    return this.idempotency.runExclusive(
      {
        storeId,
        mode,
        scope: REFUND_SCOPE,
        idempotencyKey: options.idempotencyKey,
        fingerprint: fingerprintRequest({
          method: 'POST',
          path: `/stores/payments/orders/${orderId}/refund`,
          body: {
            mode,
            amount_minor: options.amountMinor?.toString() ?? null,
            reason: options.reason ?? null,
          },
        }),
      },
      () => this.runRefund(storeId, orderId, mode, options),
      {
        inFlightMessage:
          'This refund is already being processed. Please wait a moment.',
      },
    )
  }

  /** The actual refund. Split out so idempotency can wrap it. */
  private async runRefund(
    storeId: bigint,
    orderId: string,
    mode: Mode,
    options: { amountMinor?: bigint; reason?: string },
  ) {

    // Everything needed to decide *whether* a refund is possible, and to
    // build the provider request, is a read — grouped into one tenant
    // transaction so app.store_id/app.mode are installed once for all of
    // them, in the exact order the checks always ran in. The provider
    // call itself must stay outside any transaction (never hold a
    // database transaction open across network I/O), so it starts only
    // after this block returns.
    const {
      order,
      intent,
      amountMinor,
      account,
      offline,
      refund: providerRefund,
      provider,
      gatewayReference,
      gatewayPaymentId,
      capture,
    } = await this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: BigInt(orderId), store_id: storeId },
        select: {
          id: true,
          order_number: true,
          checkout_id: true,
          payment_status: true,
        },
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

      const intent = await tx.paymentIntent.findFirst({
        where: {
          store_id: storeId,
          mode,
          context_kind: 'checkout',
          context_id: order.checkout_id.toString(),
        },
      })

      if (!intent) throw new NotFoundException('No payment found for this order.')

      if (intent.account_id === null) {
        throw new BadRequestException('This payment has no gateway account.')
      }

      const account = await tx.paymentAccount.findFirstOrThrow({
        where: { id: intent.account_id, store_id: storeId, mode: intent.mode },
        select: { id: true, gateway: true },
      })

      const provider = this.providers.get(account.gateway)

      // Offline or gateway is the adapter's own declaration, not a list of
      // gateway names kept in step by hand: an adapter that settles
      // outside any provider says so with offlineCommitmentKind, and COD
      // and bank transfer are exactly the two that do.
      const offline = provider.capabilities.offlineCommitmentKind !== null

      // The payment_mode guard is about which *gateway* ledger rule
      // applies, so it only governs the gateway path. Money the merchant
      // collected in cash reverses through refundIssuedOffline whatever
      // the store's gateway payment mode happens to be.
      if (!offline && intent.payment_mode !== 'MERCHANT_GATEWAY') {
        throw new BadRequestException(
          `Refunds are not implemented for the ${intent.payment_mode} payment mode.`,
        )
      }

      const capturedTotal: bigint = BigInt(intent.captured_total_minor)
      const refundedTotal: bigint = BigInt(intent.refunded_total_minor)
      const refundable: bigint = capturedTotal - refundedTotal

      if (refundable <= 0n) {
        throw new ConflictException(
          'This payment has already been fully refunded.',
        )
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

      // An offline refund has no provider to ask and no gateway reference
      // to quote: the money was taken in cash, so the whole outbound call
      // is skipped and the refund is applied directly.
      if (offline) {
        return {
          order,
          intent,
          amountMinor,
          account,
          provider,
          offline: true as const,
          refund: undefined,
          gatewayReference: '',
          gatewayPaymentId: null,
          capture: null,
        }
      }

      if (!provider.capabilities.refundSupported || !provider.refund) {
        throw new BadRequestException(
          `${account.gateway} does not support refunds through the API. ` +
            `Refund it in the provider dashboard; the webhook will reconcile it.`,
        )
      }

      // A partial refund must be one the adapter can actually honour —
      // the same shape as the partial-capture guard. Refunding in full
      // instead would move more of the merchant's money than they asked.
      if (amountMinor < refundable && !provider.capabilities.partialRefund) {
        throw new BadRequestException(
          `${account.gateway} does not support partial refunds. ` +
            `Refund the full ${refundable} remaining, or use the provider dashboard.`,
        )
      }

      // Narrowed here, not on `provider` itself: the object returned
      // below crosses a function boundary, and TypeScript does not carry
      // an optional-property narrowing across that.
      const refund = provider.refund

      const attempt = await tx.paymentAttempt.findFirst({
        where: { intent_id: intent.id, store_id: storeId, mode: intent.mode },
        orderBy: { sequence: 'desc' },
        select: { gateway_reference: true, gateway_payment_id: true },
      })

      if (!attempt?.gateway_reference) {
        throw new BadRequestException(
          'This payment has no gateway reference to refund against.',
        )
      }

      const gatewayReference = attempt.gateway_reference
      // Null until a callback or a status poll has told us the provider's
      // own payment id. Adapters that key their manage-payment APIs on it
      // refuse the operation rather than guessing.
      const gatewayPaymentId = attempt.gateway_payment_id

      const capture = await tx.capture.findFirst({
        where: {
          intent_id: intent.id,
          store_id: storeId,
          mode: intent.mode,
          status: 'succeeded',
        },
        orderBy: { id: 'asc' },
        select: { gateway_capture_ref: true },
      })

      return {
        order,
        intent,
        amountMinor,
        account,
        provider,
        offline: false as const,
        refund,
        gatewayReference,
        gatewayPaymentId,
        capture,
      }
    })

    if (offline) {
      // Same writer as the gateway path — Refund row, proportional
      // allocations, ledger entry, order status and outbox all happen in
      // PaymentFactApplier, in one transaction. Only the posting rule and
      // the absence of a provider call differ.
      const result = await this.applier.applyOfflineRefund({
        storeId,
        mode: intent.mode,
        intentId: intent.id,
        amountMinor,
        reason: options.reason,
      })

      const after = await this.readIntent(storeId, intent.mode, intent.id)

      this.logger.log(
        `Offline refund of ${amountMinor} on order ${order.order_number} ` +
          `(${result.outcome}).`,
      )

      return {
        order_id: order.id.toString(),
        order_number: order.order_number,
        refunded_amount_minor: amountMinor.toString(),
        refunded_total_minor: after.refunded_total_minor.toString(),
        captured_total_minor: after.captured_total_minor.toString(),
        payment_status: after.status,
        applied: result.outcome === 'applied',
      }
    }

    const credentials = await this.accounts.revealCredentialsForGateway(
      storeId,
      intent.mode,
      account.id,
    )

    let facts

    try {
      facts = await providerRefund({
        accountId: account.id,
        gatewayReference,
        gatewayPaymentId,
        gatewayCaptureRef: capture?.gateway_capture_ref ?? null,
        amountMinor,
        currency: intent.currency,
        reason: options.reason,
        credentials,
        // Derived, never random: a retried refund must carry the same key
        // or the provider issues a second one.
        idempotencyKey: outboundIdempotencyKey(provider, {
          operation: 'refund',
          base: pspIdempotencyKey({
            storeId,
            intentId: BigInt(intent.id),
            attemptSequence: 1,
            operation: `refund:${amountMinor}`,
          }),
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

    const after = await this.readIntent(storeId, intent.mode, intent.id)

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

  /** The intent as it stands after the refund, for the response. */
  private async readIntent(storeId: bigint, mode: Mode, intentId: bigint) {
    return this.prisma.withTenantTransaction(storeId, mode, (tx) =>
      tx.paymentIntent.findFirstOrThrow({
        where: { id: intentId, store_id: storeId, mode },
        select: {
          status: true,
          refunded_total_minor: true,
          captured_total_minor: true,
        },
      }),
    )
  }
}

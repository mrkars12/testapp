import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type { Mode, PaymentIntentStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { IdempotencyService } from '../../common/idempotency/idempotency.service'
import { fingerprintRequest } from '../../common/idempotency/idempotency.types'
import { PaymentAccountService } from './payment-account.service'
import { ProviderRegistry } from './gateways/provider-registry.service'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { ProviderError, pspIdempotencyKey } from './gateways/provider.types'
import { outboundIdempotencyKey } from './gateways/payment-provider.interface'
import { canTransitionIntent, isTerminalIntent } from './payment-intent.state'

/**
 * ==================================================================
 * Capturing and voiding an authorised payment
 * ==================================================================
 *
 * The other half of manual capture. An offering configured
 * `capture_mode: manual` authorises at checkout and takes nothing; the
 * money only moves when the merchant captures here, or is released when
 * they void.
 *
 * Deliberately thin, exactly like RefundService: it decides *whether*
 * the operation is allowed, asks the provider, and hands the resulting
 * facts to PaymentFactApplier. Nothing here writes a Capture row, moves
 * the intent or posts to the ledger — that stays in the applier, so a
 * merchant-initiated capture and the provider's later webhook for the
 * same capture collapse into one effect instead of double-counting.
 */

/** Idempotency scopes. Distinct per operation so one key can be reused across them. */
export const CAPTURE_SCOPE = 'payments.capture'
export const VOID_SCOPE = 'payments.void'

/** Intent states from which a manual capture is meaningful. */
const CAPTURABLE: readonly PaymentIntentStatus[] = [
  'authorized',
  'partially_captured',
]

@Injectable()
export class PaymentCaptureService {
  private readonly logger = new Logger(PaymentCaptureService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly accounts: PaymentAccountService,
    private readonly applier: PaymentFactApplier,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Captures an authorised payment, fully or partially.
   *
   * Omit amountMinor to capture everything still authorised.
   */
  async captureOrder(
    storeId: bigint,
    orderId: string,
    options: {
      mode?: Mode
      amountMinor?: bigint
      idempotencyKey?: string
    } = {},
  ) {
    const mode: Mode = options.mode ?? 'live'

    return this.idempotency.runExclusive(
      {
        storeId,
        mode,
        scope: CAPTURE_SCOPE,
        idempotencyKey: options.idempotencyKey,
        fingerprint: fingerprintRequest({
          method: 'POST',
          path: `/stores/payments/orders/${orderId}/capture`,
          body: {
            mode,
            amount_minor: options.amountMinor?.toString() ?? null,
          },
        }),
      },
      () => this.runCapture(storeId, orderId, mode, options.amountMinor),
      {
        inFlightMessage:
          'This capture is already being processed. Please wait a moment.',
      },
    )
  }

  /**
   * Releases an authorisation that was never captured.
   *
   * Voiding after any capture is refusing on purpose: money that moved
   * comes back through a refund, which posts to the ledger. Letting a
   * void stand in for that would silently skip the reversal entry.
   */
  async voidOrder(
    storeId: bigint,
    orderId: string,
    options: {
      mode?: Mode
      reason?: string
      idempotencyKey?: string
    } = {},
  ) {
    const mode: Mode = options.mode ?? 'live'

    return this.idempotency.runExclusive(
      {
        storeId,
        mode,
        scope: VOID_SCOPE,
        idempotencyKey: options.idempotencyKey,
        fingerprint: fingerprintRequest({
          method: 'POST',
          path: `/stores/payments/orders/${orderId}/void`,
          body: { mode, reason: options.reason ?? null },
        }),
      },
      () => this.runVoid(storeId, orderId, mode, options.reason),
      {
        inFlightMessage:
          'This void is already being processed. Please wait a moment.',
      },
    )
  }

  /* ---------------------------------------------------------------- */

  private async runCapture(
    storeId: bigint,
    orderId: string,
    mode: Mode,
    requestedAmountMinor?: bigint,
  ) {
    const {
      intent,
      order,
      account,
      provider,
      amountMinor,
      gatewayReference,
      gatewayPaymentId,
      capture,
    } = await this.resolve(storeId, orderId, mode, {
        operation: 'capture',
        requestedAmountMinor,
      })

    const credentials = await this.accounts.revealCredentialsForGateway(
      storeId,
      intent.mode,
      account.id,
    )

    let facts

    try {
      facts = await capture({
        accountId: account.id,
        gatewayReference,
        gatewayPaymentId,
        // The delta to take now. The provider reports the cumulative
        // total back, which is what the applier reconciles against.
        amountMinor,
        currency: intent.currency,
        credentials,
        // Derived, never random: a retried capture must carry the same
        // key or the provider takes the money twice.
        idempotencyKey: outboundIdempotencyKey(provider, {
          operation: 'capture',
          base: pspIdempotencyKey({
            storeId,
            intentId: BigInt(intent.id),
            attemptSequence: 1,
            operation: `capture:${amountMinor}`,
          }),
        }),
        mode: intent.mode,
      })
    } catch (error) {
      throw this.domainError(error, account.gateway, 'capture')
    }

    const results = await this.applier.applyMany(facts, 'merchant')
    const applied = results.some((r) => r.outcome === 'applied')

    const after = await this.readIntent(storeId, intent.mode, intent.id)

    this.logger.log(
      `Capture of ${amountMinor} on order ${order.order_number} ` +
        `(${applied ? 'applied' : 'not applied'}).`,
    )

    return {
      order_id: order.id.toString(),
      order_number: order.order_number,
      captured_amount_minor: amountMinor.toString(),
      captured_total_minor: after.captured_total_minor.toString(),
      amount_minor: after.amount_minor.toString(),
      payment_status: after.status,
      applied,
    }
  }

  private async runVoid(
    storeId: bigint,
    orderId: string,
    mode: Mode,
    reason?: string,
  ) {
    const {
      intent,
      order,
      account,
      provider,
      gatewayReference,
      gatewayPaymentId,
      voidAuthorization,
    } = await this.resolve(storeId, orderId, mode, { operation: 'void' })

    const credentials = await this.accounts.revealCredentialsForGateway(
      storeId,
      intent.mode,
      account.id,
    )

    let facts

    try {
      facts = await voidAuthorization({
        accountId: account.id,
        gatewayReference,
        gatewayPaymentId,
        credentials,
        idempotencyKey: outboundIdempotencyKey(provider, {
          operation: 'void',
          base: pspIdempotencyKey({
            storeId,
            intentId: BigInt(intent.id),
            attemptSequence: 1,
            operation: 'void',
          }),
        }),
        mode: intent.mode,
      })
    } catch (error) {
      throw this.domainError(error, account.gateway, 'void')
    }

    const results = await this.applier.applyMany(facts, 'merchant')
    const applied = results.some((r) => r.outcome === 'applied')

    const after = await this.readIntent(storeId, intent.mode, intent.id)

    this.logger.log(
      `Void on order ${order.order_number} (${applied ? 'applied' : 'not applied'})` +
        (reason ? `: ${reason}` : '.'),
    )

    return {
      order_id: order.id.toString(),
      order_number: order.order_number,
      payment_status: after.status,
      captured_total_minor: after.captured_total_minor.toString(),
      applied,
    }
  }

  /**
   * Everything needed to decide whether the operation is allowed, and to
   * build the provider request.
   *
   * All reads, grouped into one tenant transaction so app.store_id and
   * app.mode are installed once for the whole sequence. The provider call
   * itself runs after this returns — never hold a database transaction
   * open across network I/O.
   */
  private async resolve(
    storeId: bigint,
    orderId: string,
    mode: Mode,
    op:
      | { operation: 'capture'; requestedAmountMinor?: bigint }
      | { operation: 'void' },
  ) {
    return this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
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

      if (order.checkout_id === null) {
        throw new BadRequestException(
          'This order predates checkout and has no payment to act on.',
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

      if (!intent) {
        throw new NotFoundException('No payment found for this order.')
      }

      if (intent.payment_mode !== 'MERCHANT_GATEWAY') {
        throw new BadRequestException(
          `${op.operation === 'capture' ? 'Capture' : 'Void'} is not implemented ` +
            `for the ${intent.payment_mode} payment mode.`,
        )
      }

      if (intent.account_id === null) {
        throw new BadRequestException('This payment has no gateway account.')
      }

      const account = await tx.paymentAccount.findFirstOrThrow({
        where: { id: intent.account_id, store_id: storeId, mode: intent.mode },
        select: { id: true, gateway: true },
      })

      const provider = this.providers.get(account.gateway)

      const attempt = await tx.paymentAttempt.findFirst({
        where: { intent_id: intent.id, store_id: storeId, mode: intent.mode },
        orderBy: { sequence: 'desc' },
        select: { gateway_reference: true, gateway_payment_id: true },
      })

      if (!attempt?.gateway_reference) {
        throw new BadRequestException(
          'This payment has no gateway reference to act on.',
        )
      }

      const gatewayReference = attempt.gateway_reference
      // Null until a callback or a status poll has told us the provider's
      // own payment id. Adapters that key their manage-payment APIs on it
      // refuse the operation rather than guessing.
      const gatewayPaymentId = attempt.gateway_payment_id

      if (op.operation === 'capture') {
        if (!provider.capabilities.manualCapture || !provider.capture) {
          throw new BadRequestException(
            `${account.gateway} does not support capturing through the API.`,
          )
        }

        if (!CAPTURABLE.includes(intent.status)) {
          throw new ConflictException(
            `A payment in state "${intent.status}" cannot be captured.`,
          )
        }

        const capturedTotal: bigint = BigInt(intent.captured_total_minor)
        const capturable: bigint = BigInt(intent.amount_minor) - capturedTotal

        if (capturable <= 0n) {
          throw new ConflictException(
            'This payment has already been fully captured.',
          )
        }

        const amountMinor: bigint = op.requestedAmountMinor ?? capturable

        if (amountMinor <= 0n) {
          throw new BadRequestException(
            'Capture amount must be greater than zero.',
          )
        }

        if (amountMinor > capturable) {
          throw new BadRequestException(
            `Capture of ${amountMinor} exceeds the ${capturable} still authorised.`,
          )
        }

        // A partial capture must be one the adapter can actually honour.
        if (amountMinor < capturable && !provider.capabilities.partialCapture) {
          throw new BadRequestException(
            `${account.gateway} does not support partial capture.`,
          )
        }

        // Narrowed here rather than on `provider`: the value crosses a
        // function boundary and TypeScript does not carry an
        // optional-property narrowing across that.
        const capture = provider.capture

        return {
          order,
          intent,
          account,
          provider,
          amountMinor,
          gatewayReference,
          gatewayPaymentId,
          capture,
          voidAuthorization: undefined as never,
        }
      }

      if (!provider.capabilities.voidSupported || !provider.voidAuthorization) {
        throw new BadRequestException(
          `${account.gateway} does not support voiding through the API.`,
        )
      }

      if (BigInt(intent.captured_total_minor) > 0n) {
        throw new ConflictException(
          'This payment has already been captured. Refund it instead of voiding.',
        )
      }

      // The state machine is the authority on what may still be
      // cancelled, rather than a second list kept in step by hand.
      //
      // Terminal states are checked separately because
      // canTransitionIntent() treats a self-transition as legal, so an
      // already-cancelled intent would otherwise pass this guard and be
      // voided a second time at the provider.
      if (
        isTerminalIntent(intent.status) ||
        !canTransitionIntent(intent.status, 'cancelled')
      ) {
        throw new ConflictException(
          `A payment in state "${intent.status}" cannot be voided.`,
        )
      }

      const voidAuthorization = provider.voidAuthorization

      return {
        order,
        intent,
        account,
        provider,
        amountMinor: 0n,
        gatewayReference,
        gatewayPaymentId,
        capture: undefined as never,
        voidAuthorization,
      }
    })
  }

  private async readIntent(storeId: bigint, mode: Mode, intentId: bigint) {
    return this.prisma.withTenantTransaction(storeId, mode, (tx) =>
      tx.paymentIntent.findFirstOrThrow({
        where: { id: intentId, store_id: storeId, mode },
        select: {
          status: true,
          amount_minor: true,
          captured_total_minor: true,
          refunded_total_minor: true,
        },
      }),
    )
  }

  /**
   * A provider refusal is a domain outcome, not a server fault. Letting a
   * ProviderError escape would turn a declined capture into a 500.
   */
  private domainError(
    error: unknown,
    gateway: string,
    operation: 'capture' | 'void',
  ): unknown {
    if (error instanceof ProviderError) {
      this.logger.error(
        `${operation} refused by ${gateway} (${error.code}): ${error.message}`,
      )

      return new BadRequestException(
        `The provider refused the ${operation} (${error.code}).`,
      )
    }

    return error
  }
}

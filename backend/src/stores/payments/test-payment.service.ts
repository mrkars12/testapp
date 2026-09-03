import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import type {
  PaymentAttemptStatus,
  PaymentIntentStatus,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { PaymentAccountService } from './payment-account.service'
import { ProviderRegistry } from './gateways/provider-registry.service'
import { IdReservationService, PAYMENT_INTENTS_TABLE } from '../../common/ids/id-reservation.service'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { findGateway } from './gateway-catalog'
import { DecryptionError } from '../../common/crypto/key-provider.interface'
import { outboundIdempotencyKey } from './gateways/payment-provider.interface'
import {
  ProviderError,
  buildFactDedupeKey,
  isPaymentErrorCode,
  nextActionKindName,
  nextActionPayload,
  pspIdempotencyKey,
  safeFailureMessage,
  type InitializeResult,
  type NextAction,
  type ObservedFact,
} from './gateways/provider.types'
import type { InitiateTestPaymentDto } from './dto/initiate-test-payment.dto'

/** Marks a PaymentIntent as belonging to this flow, never a real checkout. */
export const TEST_PAYMENT_TOKEN_PREFIX = 'mtest:'

/**
 * Appends a query parameter to an absolute URL, tolerating one that
 * already has its own query string. Mirrors the identically-named helper
 * in checkout.service.ts / stripe.adapter.ts — kept as its own small copy
 * here rather than a shared export, the same way those two already do,
 * so this flow doesn't reach into the storefront checkout module for a
 * five-line pure function.
 */
function withQueryParam(url: string, key: string, value: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set(key, value)
  return parsed.toString()
}

/**
 * Small, fixed amount for a merchant test transaction. This is a real call
 * to the provider's TEST environment — never a live charge — so the exact
 * figure only needs to be valid, not meaningful.
 */
const TEST_AMOUNT_MINOR = 100n

/**
 * ==================================================================
 * Merchant-only test payments
 * ==================================================================
 *
 * A merchant proving their own TEST-mode gateway credentials actually
 * work, end to end, against the real provider — never a fake "success"
 * button, and never the public storefront checkout path.
 *
 * Deliberately does not create a Checkout or an Order:
 *   - PaymentIntent.context_kind is 'manual' (an existing catalog value,
 *     not a new one — no migration needed), with a synthetic
 *     `context_id` token instead of a Checkout id.
 *   - PaymentFactApplier only ever creates/updates an Order when
 *     `context_kind === 'checkout'` (see payment-fact.applier.ts) — a
 *     'manual' intent can never produce one, by construction, not by a
 *     convention this service has to remember to honour.
 *
 * Every entry point takes `storeId` from the caller (the controller's
 * `@ActiveStore()`, resolved by `SessionAuthGuard` + `ActiveStoreGuard`)
 * — never a client-supplied id — so a merchant can only ever reach their
 * own store's test accounts and test results.
 */
@Injectable()
export class TestPaymentService {
  private readonly logger = new Logger(TestPaymentService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: PaymentAccountService,
    private readonly providers: ProviderRegistry,
    private readonly ids: IdReservationService,
    private readonly applier: PaymentFactApplier,
  ) {}

  /**
   * Starts a real TEST-mode payment against the store's own configured
   * account for this gateway. Never touches Order/Checkout/inventory.
   */
  async initiate(
    storeId: bigint,
    currency: string,
    dto: InitiateTestPaymentDto,
  ) {
    const gateway = findGateway(dto.gateway)

    if (!gateway || !gateway.supports_test_mode) {
      throw new BadRequestException(
        'This gateway does not support a test payment.',
      )
    }

    if (!this.providers.has(dto.gateway)) {
      throw new BadRequestException(
        'This gateway has no adapter registered.',
      )
    }

    const { account, offering } = await this.prisma.withTenantTransaction(
      storeId,
      'test',
      async (tx) => {
        const account = await tx.paymentAccount.findFirst({
          where: {
            store_id: storeId,
            mode: 'test',
            gateway: dto.gateway as never,
            status: { in: ['active', 'verifying'] },
          },
          orderBy: { updated_at: 'desc' },
        })

        if (!account) {
          throw new NotFoundException(
            'No working test-mode account is configured for this gateway. ' +
              'Save and verify test credentials in Payment Settings first.',
          )
        }

        const offering = await tx.paymentMethodOffering.findFirst({
          where: {
            account_id: account.id,
            store_id: storeId,
            mode: 'test',
            ...(dto.method ? { method: dto.method as never } : {}),
          },
          orderBy: { position: 'asc' },
        })

        if (!offering) {
          throw new NotFoundException(
            'No test payment method is configured for this gateway.',
          )
        }

        return { account, offering }
      },
    )

    const intentId = await this.ids.reserve(PAYMENT_INTENTS_TABLE)
    const token = `${TEST_PAYMENT_TOKEN_PREFIX}${randomUUID().replace(/-/g, '')}`

    let credentials: Readonly<Record<string, string>>

    try {
      credentials = await this.accounts.revealCredentialsForGateway(
        storeId,
        'test',
        account.id,
      )
    } catch (error) {
      if (error instanceof DecryptionError) {
        this.logger.error(
          `Could not decrypt test credentials for account ${account.id} ` +
            `(${error.reason}): ${error.message}`,
        )
        throw new BadRequestException(
          'This gateway’s test credentials could not be read. Please re-enter them in Payment Settings.',
        )
      }
      throw error
    }

    const provider = this.providers.assertCanHandle({
      gateway: dto.gateway,
      method: offering.method,
      currency,
    })

    let result: InitializeResult

    try {
      result = await provider.initializePayment({
        storeId,
        mode: 'test',
        accountId: account.id,
        offeringId: offering.id,
        method: offering.method,
        gatewayMethodConfig: offering.gateway_method_config,
        intentId,
        attemptId: null,
        attemptSequence: 1,
        amountMinor: TEST_AMOUNT_MINOR,
        currency,
        credentials,
        idempotencyKey: outboundIdempotencyKey(provider, {
          operation: 'initialize',
          base: pspIdempotencyKey({
            storeId,
            intentId,
            attemptSequence: 1,
            operation: 'initialize',
          }),
        }),
        captureMethod: offering.capture_mode,
        /**
         * What THIS surface can render.
         *
         * The Test Payment tool is a merchant settings screen: it can
         * hand its tab to a provider URL and receive it back, and that
         * is all. It mounts no provider SDK, so an adapter must not
         * answer it with an in-page form — a `client_sdk` action here
         * produced an attempt with no gateway reference that nothing on
         * this surface could advance, and the page fell through to its
         * result route without the merchant ever reaching the provider.
         *
         * Declaring the constraint is what makes the adapter return its
         * hosted flow instead. The storefront checkout, which CAN mount
         * the form, passes no constraint and is unaffected.
         */
        hostableNextActionKinds: ['redirect', 'bank_instructions', 'none'],
        // The token is generated above, before this call, specifically so
        // it can be embedded in the return URL here — the same token is
        // reused as the PaymentIntent's `context_id` below, so the
        // provider's redirect back and this flow's own DB row are
        // correlated by construction, not by a second identifier. Mirrors
        // how checkout.service.ts embeds `checkoutToken` into the
        // storefront's return URL before its own adapter call.
        ...(dto.return_url
          ? { returnUrl: withQueryParam(dto.return_url, 'token', token) }
          : {}),
        metadata: { merchant_test: 'true' },
      })
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.warn(
          `Test payment adapter "${dto.gateway}" refused to initialise ` +
            `(${error.code}): ${error.message}`,
        )
        result = { kind: 'failed', errorCode: error.code, raw: error.message }
      } else {
        throw error
      }
    }

    const { intentStatus, attemptStatus, nextAction } = classify(result)

    await this.prisma.withTenantTransaction(storeId, 'test', async (tx) => {
      await tx.paymentIntent.create({
        data: {
          id: intentId,
          store_id: storeId,
          mode: 'test',
          context_kind: 'manual',
          context_id: token,
          amount_minor: TEST_AMOUNT_MINOR,
          currency,
          capture_method: offering.capture_mode,
          usage: 'one_time',
          status: intentStatus,
          offering_id: offering.id,
          account_id: account.id,
        },
      })

      const storedPayload = nextActionPayload(nextAction)

      await tx.paymentAttempt.create({
        data: {
          intent_id: intentId,
          store_id: storeId,
          mode: 'test',
          sequence: 1,
          account_id: account.id,
          offering_id: offering.id,
          status: attemptStatus,
          gateway_reference: refOf(result)?.gatewayReference ?? null,
          gateway_payment_id: refOf(result)?.gatewayPaymentId ?? null,
          next_action_kind: nextActionKindName(nextAction),
          next_action_payload: storedPayload
            ? (storedPayload as Prisma.InputJsonValue)
            : Prisma.DbNull,
          error_code: result.kind === 'failed' ? result.errorCode : null,
          // Mirrors what the async fact-applier path already persists
          // for a webhook/sync-derived failure (`failureMessageOf(fact)`
          // in payment-fact.applier.ts) — the raw internal detail, never
          // returned to the frontend directly (only the safe mapped
          // `failure_message` is), but otherwise lost the moment this
          // function returns if not captured here.
          error_message_raw: result.kind === 'failed' ? (result.raw ?? null) : null,
          psp_idempotency_key: pspIdempotencyKey({
            storeId,
            intentId,
            attemptSequence: 1,
            operation: 'initialize',
          }),
        },
      })
    })

    if (result.kind === 'authorized' || result.kind === 'succeeded') {
      const fact = syntheticFact(result, account.id, currency)
      if (fact) await this.applier.applyMany([fact], 'api')
    }

    this.logger.log(
      `Merchant test payment ${token} for store ${storeId} / ${dto.gateway}: ${result.kind}`,
    )

    return this.status(storeId, token)
  }

  /**
   * Re-reads status after the merchant completes an action (Stripe.js
   * confirm, or returning from a hosted redirect). The provider is asked
   * directly rather than trusting anything the browser carries back.
   */
  async sync(storeId: bigint, token: string) {
    const intent = await this.findIntent(storeId, token)

    if (intent.account_id) {
      await this.pullProviderStatus(storeId, intent.id, intent.account_id)
    }

    return this.status(storeId, token)
  }

  /** Safe, non-secret status for the result pages. */
  async status(storeId: bigint, token: string) {
    const intent = await this.findIntent(storeId, token)

    const attempt = await this.prisma.withTenantTransaction(
      storeId,
      'test',
      (tx) =>
        tx.paymentAttempt.findFirst({
          where: { intent_id: intent.id, store_id: storeId, mode: 'test' },
          orderBy: { sequence: 'desc' },
          select: {
            status: true,
            gateway_reference: true,
            error_code: true,
            next_action_kind: true,
            next_action_payload: true,
          },
        }),
    )

    const account = intent.account_id
      ? await this.prisma.withTenantTransaction(storeId, 'test', (tx) =>
          tx.paymentAccount.findFirst({
            where: { id: intent.account_id!, store_id: storeId, mode: 'test' },
            select: { gateway: true },
          }),
        )
      : null

    return {
      token,
      gateway: account?.gateway ?? null,
      mode: 'test' as const,
      status: intent.status,
      attempt_status: attempt?.status ?? null,
      amount: intent.amount_minor.toString(),
      currency: intent.currency,
      provider_reference: attempt?.gateway_reference ?? null,
      error_code: attempt?.error_code ?? null,
      failure_message:
        attempt?.error_code && isPaymentErrorCode(attempt.error_code)
          ? safeFailureMessage(attempt.error_code)
          : null,
      next_action:
        attempt && attempt.next_action_kind !== 'none'
          ? {
              kind: attempt.next_action_kind,
              ...((attempt.next_action_payload ?? {}) as Record<string, unknown>),
            }
          : null,
      created_at: intent.created_at.toISOString(),
    }
  }

  /* ---------------------------------------------------------------- */

  private async findIntent(storeId: bigint, token: string) {
    if (!token.startsWith(TEST_PAYMENT_TOKEN_PREFIX)) {
      throw new NotFoundException('Test payment not found.')
    }

    const intent = await this.prisma.withTenantTransaction(
      storeId,
      'test',
      (tx) =>
        tx.paymentIntent.findFirst({
          where: {
            store_id: storeId,
            mode: 'test',
            context_kind: 'manual',
            context_id: token,
          },
        }),
    )

    if (!intent) {
      throw new NotFoundException('Test payment not found.')
    }

    return intent
  }

  private async pullProviderStatus(
    storeId: bigint,
    intentId: bigint,
    accountId: bigint,
  ): Promise<void> {
    try {
      const account = await this.prisma.withTenantTransaction(
        storeId,
        'test',
        (tx) =>
          tx.paymentAccount.findFirst({
            where: { id: accountId, store_id: storeId, mode: 'test' },
            select: { id: true, gateway: true },
          }),
      )

      if (!account || !this.providers.has(account.gateway)) return

      const provider = this.providers.get(account.gateway)
      if (!provider.capabilities.statusPolling) return

      const attempt = await this.prisma.withTenantTransaction(
        storeId,
        'test',
        (tx) =>
          tx.paymentAttempt.findFirst({
            where: { intent_id: intentId, store_id: storeId, mode: 'test' },
            orderBy: { sequence: 'desc' },
            select: { gateway_reference: true },
          }),
      )

      if (!attempt?.gateway_reference) return

      const credentials = await this.accounts.revealCredentialsForGateway(
        storeId,
        'test',
        account.id,
      )

      const facts = await provider.fetchStatus({
        accountId: account.id,
        gatewayReference: attempt.gateway_reference,
        credentials,
        mode: 'test',
      })

      if (facts.length > 0) {
        await this.applier.applyMany(facts, 'return_url')
      }
    } catch (error) {
      this.logger.warn(
        `Test payment status sync failed for intent ${intentId}: ${(error as Error).message}`,
      )
    }
  }
}

function refOf(result: InitializeResult) {
  switch (result.kind) {
    case 'requires_action':
    case 'authorized':
    case 'succeeded':
    case 'pending':
      return result.refs
    default:
      return undefined
  }
}

function classify(result: InitializeResult): {
  intentStatus: PaymentIntentStatus
  attemptStatus: PaymentAttemptStatus
  nextAction: NextAction
} {
  switch (result.kind) {
    case 'succeeded':
      return {
        intentStatus: 'captured',
        attemptStatus: 'succeeded',
        nextAction: { kind: 'none' },
      }
    case 'authorized':
      return {
        intentStatus: 'authorized',
        attemptStatus: 'authorized',
        nextAction: { kind: 'none' },
      }
    case 'requires_action':
      return {
        intentStatus: 'requires_action',
        attemptStatus: 'requires_action',
        nextAction: result.nextAction,
      }
    case 'pending':
      return {
        intentStatus: 'processing',
        attemptStatus: 'processing',
        nextAction: { kind: 'poll', pollAfterSeconds: result.pollAfterSeconds },
      }
    case 'failed':
    case 'no_gateway':
      return {
        intentStatus: 'failed',
        attemptStatus: 'failed',
        nextAction: { kind: 'none' },
      }
  }
}

function syntheticFact(
  result: InitializeResult,
  accountId: bigint,
  currency: string,
): ObservedFact | null {
  if (result.kind !== 'authorized' && result.kind !== 'succeeded') return null

  const reference = result.refs?.gatewayReference
  if (!reference) return null

  const factType =
    result.kind === 'succeeded' ? 'attempt_captured' : 'attempt_authorized'

  const cumulativeAmountMinor =
    result.kind === 'succeeded'
      ? result.capturedAmountMinor
      : result.authorizedAmountMinor

  return {
    dedupeKey: buildFactDedupeKey({
      accountId,
      gatewayReference: reference,
      factType,
      cumulativeAmountMinor,
      currency: currency.toUpperCase(),
    }),
    accountId,
    gatewayReference: reference,
    factType,
    cumulativeAmountMinor,
    currency: currency.toUpperCase(),
    refs: result.refs,
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common'
import { IPaymentProvider } from '../../payment-provider.interface'
import {
  ProviderError,
  buildFactDedupeKey,
  type CaptureInput,
  type CredentialValidationResult,
  type FetchStatusInput,
  type GatewayCapabilities,
  type InitializeResult,
  type ObservedFact,
  type ParseWebhookInput,
  type PaymentCallContext,
  type RefundInput,
} from '../../provider.types'
import {
  STRIPE_CLIENT_FACTORY,
  defaultStripeClientFactory,
  type StripeClientFactory,
  type StripeClientLike,
} from './stripe-client'
import { fromStripeAmount, toStripeAmount } from './stripe-amount'
import { mapStripeError, stripeErrorMessage } from './stripe-error-map'
import {
  factsFromEvent,
  factsFromIntent,
  type StripeEventLike,
  type StripeIntentLike,
} from './stripe-fact-map'

/**
 * Reads a header case-insensitively, tolerating the array form.
 *
 * Express lowercases inbound header names, but nothing in the contract
 * guarantees that, so the keys are compared rather than the lookup name.
 */
function headerValue(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  const wanted = name.toLowerCase()

  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue

    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value === 'string' && value.length > 0) return value
  }

  return null
}

/**
 * ==================================================================
 * Stripe
 * ==================================================================
 *
 * A translation layer and nothing more. It converts our call context
 * into Stripe's shape, and Stripe's responses into ObservedFacts. It
 * never writes to the database, never decides state transitions, and
 * never reaches for credentials itself.
 *
 * Two things it is careful about:
 *
 *   The idempotency key sent to Stripe is the deterministic one derived
 *   from the intent and attempt, not a fresh UUID. A retried request
 *   must carry the same key or Stripe creates a second charge.
 *
 *   Signature verification happens against the raw bytes. A parsed and
 *   re-serialised body will not verify, which is why the controller
 *   passes rawBody through untouched.
 */
@Injectable()
export class StripeAdapter implements IPaymentProvider {
  private readonly logger = new Logger(StripeAdapter.name)

  readonly capabilities: GatewayCapabilities = {
    gateway: 'stripe',
    methods: ['card', 'apple_pay', 'google_pay'],
    currencies: 'all',
    exponentOverrides: {},
    manualCapture: true,
    partialCapture: true,
    // Stripe's multicapture is limited and opt-in; not claimed here.
    multiCapture: false,
    partialRefund: true,
    voidSupported: true,
    authorizationExpiry: true,
    vaulting: true,
    merchantInitiated: true,
    threeDSecure: true,
    webhooks: true,
    statusPolling: true,
    settlementReports: false,
    webhookResolution: 'endpoint_scoped',
    offlineCommitmentKind: null,
  }

  /**
   * The factory is injected rather than defaulted. A default parameter
   * still emits paramtypes metadata, so Nest tries to resolve it and
   * fails at boot; an explicit optional token avoids that while keeping
   * `new StripeAdapter(stub)` usable in tests.
   */
  constructor(
    @Inject(STRIPE_CLIENT_FACTORY)
    private readonly clientFactory: StripeClientFactory = defaultStripeClientFactory,
  ) {}

  async validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
  }): Promise<CredentialValidationResult> {
    const secretKey = input.credentials.secret_key

    if (!secretKey || secretKey.trim().length === 0) {
      return {
        valid: false,
        errorCode: 'configuration_error',
        message: 'Stripe secret key is missing.',
      }
    }

    try {
      await this.client(secretKey).balance.retrieve()
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        errorCode: mapStripeError(error),
        message: stripeErrorMessage(error),
      }
    }
  }

  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    const client = this.client(this.secretKey(context.credentials))

    const params: Record<string, unknown> = {
      amount: toStripeAmount(context.amountMinor, context.currency),
      currency: context.currency.toLowerCase(),
      capture_method: 'automatic',
      // Off-session confirmation is never implied here; the customer is
      // present and completes the action returned below.
      automatic_payment_methods: { enabled: true },
      metadata: {
        store_id: context.storeId.toString(),
        intent_id: context.intentId.toString(),
        mode: context.mode,
      },
    }

    if (context.statementDescriptor) {
      params.statement_descriptor_suffix = context.statementDescriptor.slice(0, 22)
    }

    try {
      const intent = (await client.paymentIntents.create(params, {
        idempotencyKey: this.idempotencyKey(context, 'initialize'),
      })) as StripeIntentLike & { client_secret?: string }

      if (intent.status === 'succeeded') {
        return {
          kind: 'succeeded',
          capturedAmountMinor: fromStripeAmount(
            intent.amount_received ?? intent.amount,
            intent.currency,
          ),
          refs: { gatewayReference: intent.id, gatewayPaymentId: intent.id },
        }
      }

      if (intent.status === 'requires_capture') {
        return {
          kind: 'authorized',
          authorizedAmountMinor: fromStripeAmount(
            intent.amount_capturable ?? intent.amount,
            intent.currency,
          ),
          refs: { gatewayReference: intent.id, gatewayPaymentId: intent.id },
        }
      }

      if (!intent.client_secret) {
        throw new ProviderError(
          'unknown',
          `Stripe returned ${intent.status} with no client secret.`,
        )
      }

      return {
        kind: 'requires_action',
        nextAction: {
          kind: 'client_sdk',
          clientSecret: intent.client_secret,
          sdkHints: { publishable_key: context.credentials.publishable_key ?? null },
        },
        refs: { gatewayReference: intent.id, gatewayPaymentId: intent.id },
      }
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      const intent = (await client.paymentIntents.retrieve(
        input.gatewayReference,
      )) as StripeIntentLike

      return factsFromIntent({ accountId: input.accountId, intent })
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async parseWebhook(input: ParseWebhookInput): Promise<ObservedFact[]> {
    const signature = headerValue(input.headers, 'stripe-signature')

    if (!signature) {
      throw new ProviderError('configuration_error', 'Missing stripe-signature header.')
    }

    // No secret key needed to verify; the signing secret is enough, which
    // keeps webhook handling independent of the API credential.
    const client = this.clientFactory('sk_unused_for_verification')

    let event: StripeEventLike

    try {
      event = client.webhooks.constructEvent(
        input.rawBody,
        signature,
        input.signingSecret,
      ) as StripeEventLike
    } catch (error) {
      // A bad signature is an authentication failure, not a server fault.
      throw new ProviderError(
        'authentication_failed',
        `Stripe webhook signature verification failed: ${stripeErrorMessage(error)}`,
      )
    }

    return factsFromEvent({ accountId: input.accountId, event })
  }

  async capture(input: CaptureInput): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      const intent = (await client.paymentIntents.capture(
        input.gatewayReference,
        { amount_to_capture: toStripeAmount(input.amountMinor, input.currency) },
        { idempotencyKey: input.idempotencyKey },
      )) as StripeIntentLike

      return factsFromIntent({ accountId: input.accountId, intent })
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async voidAuthorization(input: {
    accountId: bigint
    gatewayReference: string
    credentials: Readonly<Record<string, string>>
    idempotencyKey: string
    mode: 'test' | 'live'
  }): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      const intent = (await client.paymentIntents.cancel(
        input.gatewayReference,
        {},
        { idempotencyKey: input.idempotencyKey },
      )) as StripeIntentLike

      return factsFromIntent({ accountId: input.accountId, intent })
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async refund(input: RefundInput): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      const refund = await client.refunds.create(
        {
          payment_intent: input.gatewayReference,
          amount: toStripeAmount(input.amountMinor, input.currency),
          ...(input.reason ? { metadata: { reason: input.reason } } : {}),
        },
        { idempotencyKey: input.idempotencyKey },
      )

      const succeeded = refund.status === 'succeeded' || refund.status === 'pending'

      return [
        {
          dedupeKey: buildFactDedupeKey({
            accountId: input.accountId,
            gatewayReference: input.gatewayReference,
            factType: succeeded ? 'refund_succeeded' : 'refund_failed',
            cumulativeAmountMinor: fromStripeAmount(
              refund.amount,
              input.currency,
            ),
            currency: input.currency.toUpperCase(),
          }),
          accountId: input.accountId,
          gatewayReference: input.gatewayReference,
          factType: succeeded ? 'refund_succeeded' : 'refund_failed',
          cumulativeAmountMinor: fromStripeAmount(refund.amount, input.currency),
          currency: input.currency.toUpperCase(),
          refs: { gatewayCaptureRef: String(refund.id) },
          rawRedacted: { refund_status: refund.status },
        },
      ]
    } catch (error) {
      throw this.wrap(error)
    }
  }

  /* ---------------------------------------------------------------- */

  private client(secretKey: string): StripeClientLike {
    return this.clientFactory(secretKey)
  }

  private secretKey(credentials: Readonly<Record<string, string>>): string {
    const key = credentials.secret_key

    if (!key || key.trim().length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Stripe is not configured for this store: secret key is missing.',
      )
    }

    return key
  }

  private idempotencyKey(context: PaymentCallContext, operation: string): string {
    return [
      'psp',
      context.storeId.toString(),
      context.intentId.toString(),
      String(context.attemptSequence),
      operation,
    ].join(':')
  }

  private wrap(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error

    const code = mapStripeError(error)
    const message = stripeErrorMessage(error)

    this.logger.warn(`Stripe call failed (${code}): ${message}`)

    return new ProviderError(code, message)
  }
}

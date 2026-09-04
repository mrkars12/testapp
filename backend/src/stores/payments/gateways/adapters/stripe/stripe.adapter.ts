import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { IPaymentProvider } from '../../payment-provider.interface'
import {
  ProviderError,
  buildFactDedupeKey,
  callContextIdempotencyKey,
  type CaptureInput,
  type CredentialValidationResult,
  type FetchStatusInput,
  type GatewayCapabilities,
  type InitializeResult,
  type ObservedFact,
  type ParseWebhookInput,
  type PaymentCallContext,
  type RefundInput,
  type WebhookDescriptor,
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
  factFromExpiredSession,
  factsFromEvent,
  factsFromIntent,
  isRecognisedEventType,
  type StripeEventLike,
  type StripeIntentLike,
} from './stripe-fact-map'

/** The parts of a Stripe Checkout Session this adapter reads. */
interface StripeCheckoutSessionLike {
  id: string
  url?: string | null
  payment_intent?: string | { id: string } | null
}

/** A Stripe id field that may or may not have been expanded. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? value : value.id
}

/**
 * Appends a query parameter to an absolute URL, tolerating one that
 * already has its own query string. `context.returnUrl` is always
 * absolute here (checkout.service.ts builds it from `window.location`
 * client-side before sending it), so a parse failure is not a case this
 * needs to silently paper over.
 */
function withQueryParam(url: string, key: string, value: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set(key, value)
  return parsed.toString()
}

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
 * Whether a Stripe secret key belongs to the mode it was saved under.
 *
 * Stripe's own key prefixes: `sk_test_` / `sk_live_`, and `rk_test_` /
 * `rk_live_` for restricted keys. Anything else is a shape we do not
 * recognise and is not rejected — see `validateCredentials`.
 */
function matchesMode(key: string, mode: Mode): boolean {
  const other = mode === 'live' ? 'test' : 'live'

  for (const prefix of ['sk_', 'rk_']) {
    if (key.startsWith(`${prefix}${other}_`)) return false
  }

  return true
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
    automaticCapture: true,
    manualCapture: true,
    partialCapture: true,
    // Stripe's multicapture is limited and opt-in; not claimed here.
    multiCapture: false,
    refundSupported: true,
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
    // Final architecture: a hosted Stripe Checkout Session. The customer
    // is redirected to Stripe's own domain to complete payment (card,
    // wallets, Link, whatever the account is eligible for — Stripe
    // decides, not this adapter) and is sent back to `session.url`'s
    // configured return URL. No `client_sdk`/Stripe.js path remains on
    // our own pages for the customer-facing flow.
    nextActionKinds: ['redirect'],
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

  /**
   * Checks the secret key is real and is for the right mode.
   *
   * The mode is checked first, from the key itself, and that check is
   * load-bearing rather than cosmetic: `balance.retrieve()` succeeds for
   * a test key exactly as it does for a live one, so without it a
   * `sk_test_` key pasted into a **live** account validates, the account
   * reaches `active`, the offering is exposed at checkout, and live
   * orders are created against Stripe *test* PaymentIntents — orders the
   * ledger records as funded while no money has moved.
   *
   * The same guard already exists on the Paymob, Moyasar and Tap
   * adapters, and `mode_mismatch` is in the taxonomy for exactly this.
   *
   * An unrecognised prefix is accepted. Only an unambiguous
   * contradiction is worth failing on, and Stripe mints restricted keys
   * (`rk_…`) and has changed key formats before.
   */
  async validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
    mode?: Mode
  }): Promise<CredentialValidationResult> {
    const secretKey = input.credentials.secret_key

    if (!secretKey || secretKey.trim().length === 0) {
      return {
        valid: false,
        errorCode: 'configuration_error',
        message: 'Stripe secret key is missing.',
      }
    }

    const mode = input.mode

    if (mode && !matchesMode(secretKey.trim(), mode)) {
      return {
        valid: false,
        errorCode: 'mode_mismatch',
        message:
          `This is not a ${mode} Stripe secret key. ` +
          `${mode === 'live' ? 'Live' : 'Test'} keys start with sk_${mode}_.`,
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

  /**
   * Final architecture: Stripe Checkout Sessions (hosted), not a raw
   * PaymentIntent confirmed in-page via Stripe.js. Chosen over
   * `ui_mode: 'embedded'` because a hosted redirect needs zero Stripe SDK
   * on our own pages and slots directly into the `next_action.kind:
   * 'redirect'` shape every other adapter (Paymob/Moyasar/Tap) already
   * uses — no second customer-facing Stripe lifecycle competing with it.
   *
   * A `mode: 'payment'` Checkout Session creates its underlying
   * PaymentIntent synchronously, so `session.payment_intent` is the real
   * `pi_...` id from the moment the session exists — recorded as
   * `gatewayReference`, exactly as the previous direct-PaymentIntent flow
   * did. That is deliberate: `fetchStatus`, `capture`, `voidAuthorization`
   * and `refund` below, and every webhook event this adapter maps, still
   * operate on a PaymentIntent id and needed no changes for this
   * migration — only the customer-facing initiation shape changed.
   * `gatewayPaymentId` carries the Checkout Session id itself (`cs_...`),
   * available for audit/troubleshooting but not required by any
   * downstream lookup.
   */
  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    const client = this.client(this.secretKey(context.credentials))

    if (!context.returnUrl) {
      throw new ProviderError(
        'configuration_error',
        'Stripe Checkout requires a return URL to send the customer back to.',
      )
    }

    const paymentIntentData: Record<string, unknown> = {
      // The merchant's configured mode, not a constant — see the
      // PaymentIntent-era comment this replaced: manual capture must stay
      // manual, or the one thing it exists to prevent (taking the money
      // at authorisation) happens anyway.
      capture_method: context.captureMethod === 'manual' ? 'manual' : 'automatic',
      metadata: {
        store_id: context.storeId.toString(),
        intent_id: context.intentId.toString(),
        mode: context.mode,
      },
    }

    if (context.statementDescriptor) {
      paymentIntentData.statement_descriptor_suffix = context.statementDescriptor.slice(0, 22)
    }

    const params: Record<string, unknown> = {
      mode: 'payment',
      // Checkout Sessions require line items rather than a bare amount.
      // The cart/pricing was already validated and aggregated server-side
      // (CheckoutService) before this adapter is ever called — this is
      // one line representing that already-final total, not a second
      // pricing computation the browser could influence.
      line_items: [
        {
          price_data: {
            currency: context.currency.toLowerCase(),
            unit_amount: toStripeAmount(context.amountMinor, context.currency),
            product_data: { name: `Order (${context.currency.toUpperCase()})` },
          },
          quantity: 1,
        },
      ],
      // Dynamic payment-method eligibility, not a hardcoded list — Stripe
      // decides what's actually offered (cards, Link, wallets, etc.) from
      // the account's own configuration. `payment_method_types` is
      // deliberately omitted rather than set.
      payment_intent_data: paymentIntentData,
      success_url: context.returnUrl,
      cancel_url: withQueryParam(context.returnUrl, 'stripe_cancelled', '1'),
      metadata: {
        store_id: context.storeId.toString(),
        intent_id: context.intentId.toString(),
        mode: context.mode,
      },
    }

    try {
      const session = (await client.checkout.sessions.create(params, {
        // The key core derived and recorded on the attempt, not a second
        // derivation of the same rule: two copies agree until one of them
        // changes, and the symptom of them disagreeing is a double charge.
        idempotencyKey: callContextIdempotencyKey(context, 'initialize'),
      })) as StripeCheckoutSessionLike

      if (!session.url) {
        throw new ProviderError(
          'unknown',
          'Stripe Checkout Session was created with no hosted URL.',
        )
      }

      const paymentIntentId = idOf(session.payment_intent)

      // Verified against the live Stripe TEST API (2026-08-23): a
      // `mode: 'payment'` Checkout Session does NOT always create its
      // PaymentIntent synchronously — this account's sessions return
      // `payment_intent: null` until the customer actually submits
      // payment on the hosted page, even with `payment_method_types`
      // pinned to `['card']` and `expand: ['payment_intent']`. Throwing
      // here (the previous behaviour) failed *every* Stripe attempt
      // before the customer ever reached Stripe's page — this is not a
      // rare anomaly to fail loudly on, it is the normal case.
      //
      // The Checkout Session's own id stands in as the reference until
      // then. `fetchStatus`/`capture`/`voidAuthorization`/`refund` below
      // all resolve a `cs_...` reference to the real PaymentIntent id
      // when they need to call Stripe with it, and `factsFromIntent`'s
      // `lookupReference` keeps every fact keyed on whatever reference
      // is actually stored on the attempt — so nothing downstream needs
      // to know the PaymentIntent didn't exist yet at this point.
      return {
        kind: 'requires_action',
        nextAction: { kind: 'redirect', url: session.url, method: 'GET' },
        refs: {
          gatewayReference: paymentIntentId ?? session.id,
          gatewayPaymentId: session.id,
        },
      }
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      if (input.gatewayReference.startsWith('cs_')) {
        const session = (await client.checkout.sessions.retrieve(input.gatewayReference, {
          expand: ['payment_intent'],
        })) as StripeCheckoutSessionLike & { status?: string; currency?: string }

        const paymentIntent = session.payment_intent

        if (!paymentIntent) {
          // Customer has not (yet, or ever) submitted payment on the
          // hosted page. Expired is the one terminal outcome reachable
          // from here; anything else in flight emits nothing, exactly
          // like an in-flight PaymentIntent status.
          if (session.status === 'expired') {
            return [
              factFromExpiredSession({
                accountId: input.accountId,
                sessionId: input.gatewayReference,
                currency: session.currency ?? 'usd',
              }),
            ]
          }
          return []
        }

        const intent =
          typeof paymentIntent === 'string'
            ? ((await client.paymentIntents.retrieve(paymentIntent)) as StripeIntentLike)
            : (paymentIntent as unknown as StripeIntentLike)

        return factsFromIntent({
          accountId: input.accountId,
          intent,
          lookupReference: input.gatewayReference,
        })
      }

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

  /**
   * Reads the event envelope without verifying anything.
   *
   * Only safe on a body whose signature already passed — which is the
   * only place ingestion calls it.
   */
  describeWebhook(input: { rawBody: Buffer }): WebhookDescriptor | null {
    let parsed: unknown

    try {
      parsed = JSON.parse(input.rawBody.toString('utf8'))
    } catch {
      return null
    }

    if (typeof parsed !== 'object' || parsed === null) return null

    const event = parsed as { id?: unknown; type?: unknown }

    if (typeof event.id !== 'string' || typeof event.type !== 'string') {
      return null
    }

    return {
      eventId: event.id,
      eventType: event.type,
      recognised: isRecognisedEventType(event.type),
    }
  }

  async capture(input: CaptureInput): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      const paymentIntentId = await this.resolveToPaymentIntentId(client, input.gatewayReference)

      const intent = (await client.paymentIntents.capture(
        paymentIntentId,
        { amount_to_capture: toStripeAmount(input.amountMinor, input.currency) },
        { idempotencyKey: input.idempotencyKey },
      )) as StripeIntentLike

      return factsFromIntent({
        accountId: input.accountId,
        intent,
        lookupReference: input.gatewayReference,
      })
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
      const paymentIntentId = await this.resolveToPaymentIntentId(client, input.gatewayReference)

      const intent = (await client.paymentIntents.cancel(
        paymentIntentId,
        {},
        { idempotencyKey: input.idempotencyKey },
      )) as StripeIntentLike

      return factsFromIntent({
        accountId: input.accountId,
        intent,
        lookupReference: input.gatewayReference,
      })
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async refund(input: RefundInput): Promise<ObservedFact[]> {
    const client = this.client(this.secretKey(input.credentials))

    try {
      const paymentIntentId = await this.resolveToPaymentIntentId(client, input.gatewayReference)

      const refund = await client.refunds.create(
        {
          payment_intent: paymentIntentId,
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

  /**
   * capture/void/refund all call a Stripe endpoint that only accepts a
   * real PaymentIntent id — never a Checkout Session id, even though
   * that may be what's stored as this attempt's gatewayReference (see
   * `initializePayment`). By the time any of these three are called the
   * PaymentIntent must already exist (the attempt reached
   * authorized/succeeded to get here), so an unresolvable `cs_...`
   * reference here is a genuine anomaly, not the normal in-flight case
   * `fetchStatus` has to tolerate.
   */
  private async resolveToPaymentIntentId(
    client: StripeClientLike,
    reference: string,
  ): Promise<string> {
    if (!reference.startsWith('cs_')) return reference

    const session = (await client.checkout.sessions.retrieve(
      reference,
    )) as StripeCheckoutSessionLike
    const paymentIntentId = idOf(session.payment_intent)

    if (!paymentIntentId) {
      throw new ProviderError(
        'unknown',
        'Stripe Checkout Session has no PaymentIntent yet — cannot capture/void/refund.',
      )
    }

    return paymentIntentId
  }

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

  private wrap(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error

    const code = mapStripeError(error)
    const message = stripeErrorMessage(error)

    this.logger.warn(`Stripe call failed (${code}): ${message}`)

    return new ProviderError(code, message)
  }
}

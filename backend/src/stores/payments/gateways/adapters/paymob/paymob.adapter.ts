import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { IPaymentProvider } from '../../payment-provider.interface'
import {
  ProviderError,
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
  PAYMOB_EGYPT_BASE_URL,
  PAYMOB_EGYPT_CHECKOUT_URL,
  PAYMOB_HTTP,
  defaultPaymobHttp,
  type PaymobHttp,
} from './paymob-client'
import { mapPaymobError, paymobErrorText } from './paymob-error-map'
import { verifyHmac } from './paymob-hmac'
import {
  factsFromTransaction,
  isRecognisedCallbackType,
  transactionId,
  type PaymobCallbackEnvelope,
  type PaymobTransaction,
} from './paymob-fact-map'

/**
 * ==================================================================
 * Paymob — Intention API + Unified Checkout (Egypt)
 * ==================================================================
 *
 * A translation layer, exactly like the Stripe adapter: our call context
 * in, Paymob's shapes out, Paymob's responses back as ObservedFacts. It
 * never writes to the database, never decides a state transition, and
 * never reaches for credentials itself.
 *
 * The flow implemented is the one Paymob documents as *the* API path
 * today:
 *
 *   1. POST /v1/intention/ with the amount, currency and integration
 *      ID(s). Returns a client secret and a Paymob order id.
 *   2. Redirect the customer to Unified Checkout with the client secret
 *      and the merchant's public key.
 *   3. Paymob POSTs a transaction-processed callback, HMAC-signed.
 *
 * Source: https://developers.paymob.com/paymob-docs/integration-paths/apis
 * ("Integration flow": create intention → checkout experience →
 * callbacks → HMAC), accessed 2026-08-19.
 *
 * Three things it is careful about:
 *
 *   Two identifiers, not one. Facts correlate on the Paymob **order**
 *   id, which exists as soon as the intention does; the manage-payment
 *   APIs key on the **transaction** id, which does not exist until a
 *   customer has paid. Conflating them is the single easiest way to
 *   build a Paymob integration that cannot refund.
 *
 *   Two authentication schemes, because Paymob has two. The Intention
 *   and manage-payment APIs take `Authorization: Token <secret key>`;
 *   Transaction Inquiry takes a Bearer auth token minted from the API
 *   key. Both are documented; neither is interchangeable.
 *
 *   The HMAC is computed over the transaction object and compared with
 *   the `hmac` **query parameter**, which is where Paymob puts it — not
 *   a header, and not the body.
 */

/** Paths, relative to the market's base URL. All from the official docs. */
const PATHS = {
  /** POST — .../developers/intention-apis/create-intention */
  intention: '/v1/intention/',
  /** POST — .../developers/manage-payment-apis/capture */
  capture: '/api/acceptance/capture',
  /** POST — .../developers/manage-payment-apis/void */
  void: '/api/acceptance/void_refund/void',
  /** POST — .../developers/manage-payment-apis/refund */
  refund: '/api/acceptance/void_refund/refund',
  /** POST — .../developers/authentication-request-generate-auth-token-1 */
  authTokens: '/api/auth/tokens',
  /** POST — .../developers/transaction-inquiry-apis/transaction-inquiry */
  inquiryByOrder: '/api/ecommerce/orders/transaction_inquiry',
} as const

@Injectable()
export class PaymobAdapter implements IPaymentProvider {
  private readonly logger = new Logger(PaymobAdapter.name)

  readonly capabilities: GatewayCapabilities = {
    gateway: 'paymob',
    // The catalog's Paymob methods. Which of them a given account can
    // actually serve is decided by the integration IDs the merchant
    // configures per offering, which is Paymob's own model: the
    // Intention API takes integration IDs in `payment_methods`.
    methods: ['card', 'wallet', 'kiosk'],
    // Egypt only, and Paymob requires the intention currency to match
    // the integration ID's currency. Claiming 'all' would be a claim
    // about integrations we cannot see.
    currencies: ['EGP'],
    // Paymob's amounts are already the currency's minor unit ("cents").
    exponentOverrides: {},
    automaticCapture: true,
    // Auth/Cap is a documented core feature, and the Capture API is
    // documented. Which mode a payment takes is a property of the
    // merchant's integration ID, not of our request — see the report.
    manualCapture: true,
    // "Capture amount cannot exceed auth amount" — an amount is passed,
    // so a smaller one is a partial capture.
    partialCapture: true,
    // "The payment transaction can have more than one partial capture
    // transaction."
    multiCapture: true,
    refundSupported: true,
    // Refund takes amount_cents, and the docs describe more than one
    // partial refund per payment transaction.
    partialRefund: true,
    voidSupported: true,
    // Not documented in the pages this stage is built from.
    authorizationExpiry: false,
    // Pay With Saved Cards and MIT are documented features but are not
    // implemented here, so they are not claimed.
    vaulting: false,
    merchantInitiated: false,
    // "completes any required authentication (such as 3D Secure)"; the
    // callback carries is_3d_secure.
    threeDSecure: true,
    webhooks: true,
    // Transaction Inquiry APIs, documented as the fallback for a missed
    // callback — which is exactly what reconciliation uses it for.
    statusPolling: true,
    settlementReports: false,
    // The callback URL is per account: the merchant sets it on the
    // integration ID, so the account is known from the URL and no part
    // of the unverified body is parsed to route it.
    webhookResolution: 'endpoint_scoped',
    // Paymob's dashboard calls it the HMAC secret, and so does the
    // catalog field the merchant fills in.
    webhookSecretField: 'hmac_secret',
    // Unified Checkout is a redirect.
    nextActionKinds: ['redirect'],
    offlineCommitmentKind: null,
  }

  constructor(
    @Inject(PAYMOB_HTTP)
    private readonly http: PaymobHttp = defaultPaymobHttp,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Credentials                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Checks the merchant's keys are real and are for the right mode.
   *
   * Paymob documents no "verify this secret key" endpoint, so the live
   * check is the Authentication Request — an officially documented call
   * that authenticates the merchant's API key and mints an auth token.
   *
   * Before spending a network round trip, the mode is checked against
   * the key itself: Paymob's dashboard issues `..._test_...` and
   * `..._live_...` keys, and pasting a test key into a live account is
   * the most common way a merchant breaks their own checkout. That
   * mismatch has its own code, so the merchant is told what is actually
   * wrong.
   *
   * Sources: .../need-help/faq/getting-integration-credentials (key
   * modes and prefixes), .../developers/authentication-request-generate-auth-token-1
   */
  async validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
    mode: Mode
  }): Promise<CredentialValidationResult> {
    const secretKey = (input.credentials.secret_key ?? '').trim()
    const publicKey = (input.credentials.public_key ?? '').trim()
    const apiKey = (input.credentials.api_key ?? '').trim()

    for (const [name, value] of [
      ['secret_key', secretKey],
      ['public_key', publicKey],
      ['api_key', apiKey],
    ] as const) {
      if (value.length === 0) {
        return {
          valid: false,
          errorCode: 'configuration_error',
          message: `Paymob ${name} is missing.`,
        }
      }
    }

    const wrongMode = [
      ['secret_key', secretKey],
      ['public_key', publicKey],
    ].find(([, value]) => !this.matchesMode(value, input.mode))

    if (wrongMode) {
      return {
        valid: false,
        errorCode: 'mode_mismatch',
        message:
          `The Paymob ${wrongMode[0]} is not a ${input.mode} key. ` +
          `Switch the mode toggle in the Paymob dashboard and copy the key again.`,
      }
    }

    const response = await this.call({
      method: 'POST',
      path: PATHS.authTokens,
      headers: {},
      body: { api_key: apiKey },
      operation: 'validate credentials',
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )

    if (!response.ok) {
      const error = response.error

      // A rejected key is a domain outcome, not a server fault: throwing
      // would turn a merchant's typo into a 500 at the settings screen.
      if (error instanceof ProviderError) {
        return { valid: false, errorCode: error.code, message: error.message }
      }

      throw error
    }

    const token = this.readString(response.value, 'token')

    if (!token) {
      return {
        valid: false,
        errorCode: 'unknown',
        message: 'Paymob accepted the API key but returned no auth token.',
      }
    }

    return { valid: true }
  }

  /* ---------------------------------------------------------------- */
  /* Initialize                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Creates a payment intention and hands back the Unified Checkout URL.
   *
   * Always `requires_action`: the Intention API creates an intention,
   * never a payment. Money moves only once the customer has completed
   * checkout, and we hear about it in the callback.
   *
   * Source: .../developers/intention-apis/create-intention and
   * .../developers/checkout-experiences/unified-checkout-redirection
   */
  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    const secretKey = this.requireSecretKey(context.credentials)
    const publicKey = (context.credentials.public_key ?? '').trim()

    if (publicKey.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Paymob is not configured for this store: public key is missing.',
      )
    }

    const integration = this.integrationId(context)

    const body: Record<string, unknown> = {
      // "The total transaction amount, expressed in cents" — the same
      // minor units the rest of this codebase moves money in, so this is
      // a widening rather than a conversion.
      amount: Number(context.amountMinor),
      currency: context.currency.toUpperCase(),
      payment_methods: [integration],
      // Returned in the callback as merchant_order_id. Deterministic, so
      // it also correlates a retry to the attempt it belongs to.
      special_reference: callContextIdempotencyKey(context, 'initialize'),
      extras: {
        store_id: context.storeId.toString(),
        intent_id: context.intentId.toString(),
        mode: context.mode,
      },
    }

    if (context.returnUrl) {
      // Where the customer's browser lands afterwards. Distinct from the
      // callback: the docs are explicit that "callbacks are the source
      // of truth for payment status" and redirects are for the customer.
      body.redirection_url = context.returnUrl
    }

    const response = await this.call({
      method: 'POST',
      path: PATHS.intention,
      headers: this.secretAuth(secretKey),
      body,
      operation: 'create intention',
    })

    const clientSecret = this.readString(response, 'client_secret')
    const orderId = this.readNumberish(response, 'intention_order_id')

    if (!clientSecret || !orderId) {
      // Without either we cannot send the customer to checkout, or match
      // the callback back to this attempt.
      throw new ProviderError(
        'unknown',
        'Paymob created an intention without a client secret or order id.',
      )
    }

    return {
      kind: 'requires_action',
      nextAction: {
        kind: 'redirect',
        url: `${PAYMOB_EGYPT_CHECKOUT_URL}?publicKey=${encodeURIComponent(
          publicKey,
        )}&clientSecret=${encodeURIComponent(clientSecret)}`,
        method: 'GET',
      },
      refs: {
        // The order id, not the intention id: it is what every callback
        // carries as order.id.
        gatewayReference: orderId,
      },
    }
  }

  /* ---------------------------------------------------------------- */
  /* Status                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * The last transaction on an order, straight from Paymob.
   *
   * Paymob positions the Transaction Inquiry APIs exactly as this
   * codebase uses them: "Transaction Inquiry APIs should be used only
   * for manual checks from your system or as a fallback mechanism in
   * case a callback is missed."
   *
   * Uses the by-order endpoint because the order id is what we hold from
   * the moment the intention was created; the by-transaction endpoint
   * would need an id we may never have seen.
   *
   * Source: .../developers/transaction-inquiry-apis/transaction-inquiry
   */
  async fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]> {
    const apiKey = (input.credentials.api_key ?? '').trim()

    if (apiKey.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Paymob status lookup needs the API key, which is not configured for this store.',
      )
    }

    // Inquiry authenticates with an auth token, not the secret key.
    const auth = await this.call({
      method: 'POST',
      path: PATHS.authTokens,
      headers: {},
      body: { api_key: apiKey },
      operation: 'authenticate for status lookup',
    })

    const token = this.readString(auth, 'token')

    if (!token) {
      throw new ProviderError(
        'configuration_error',
        'Paymob returned no auth token for the configured API key.',
      )
    }

    const transaction = (await this.call({
      method: 'POST',
      path: PATHS.inquiryByOrder,
      headers: { authorization: `Bearer ${token}` },
      body: { auth_token: token, order_id: input.gatewayReference },
      operation: 'transaction inquiry',
    })) as PaymobTransaction

    return factsFromTransaction({
      accountId: input.accountId,
      transaction,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Webhooks                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Verifies the HMAC, then maps the transaction into facts.
   *
   * Verification and mapping are one method because a body that has not
   * been verified must never be mapped — and the HMAC is computed over
   * the *parsed* transaction object rather than the raw bytes, because
   * that is what Paymob signs: twenty named fields, concatenated.
   *
   * Source: .../developers/webhook-callbacks-and-hmac → HMAC
   */
  async parseWebhook(input: ParseWebhookInput): Promise<ObservedFact[]> {
    let envelope: PaymobCallbackEnvelope

    try {
      envelope = JSON.parse(input.rawBody.toString('utf8')) as PaymobCallbackEnvelope
    } catch {
      throw new ProviderError(
        'authentication_failed',
        'Paymob callback body is not JSON.',
      )
    }

    const transaction = envelope?.obj

    if (!transaction || typeof transaction !== 'object') {
      throw new ProviderError(
        'authentication_failed',
        'Paymob callback carries no transaction object.',
      )
    }

    // Paymob sends the signature in the query string, not a header.
    const received = this.queryValue(input.query, 'hmac')

    if (!received) {
      throw new ProviderError(
        'authentication_failed',
        'Paymob callback has no hmac query parameter.',
      )
    }

    const verified = verifyHmac({
      source: transaction,
      secret: input.signingSecret,
      received,
    })

    if (!verified) {
      // A forged or altered callback. Nothing has touched payment state:
      // facts are produced below and applied by the caller.
      throw new ProviderError(
        'authentication_failed',
        'Paymob callback HMAC verification failed.',
      )
    }

    return factsFromTransaction({
      accountId: input.accountId,
      transaction,
    })
  }

  /**
   * The callback's identity, for dedupe and audit.
   *
   * Paymob has one callback type and no event id of its own, so the
   * identity is the transaction plus the moment it changed. The
   * `updated_at` matters: the same transaction is delivered again when
   * it is later captured, voided or refunded, and keying on the
   * transaction id alone would file every one of those as a duplicate of
   * the original payment and silently drop it.
   *
   * ⚠️ Reads an unverified body. Only safe after parseWebhook has passed,
   * which is the only place ingestion calls it.
   */
  describeWebhook(input: { rawBody: Buffer }): WebhookDescriptor | null {
    let envelope: PaymobCallbackEnvelope

    try {
      envelope = JSON.parse(input.rawBody.toString('utf8')) as PaymobCallbackEnvelope
    } catch {
      return null
    }

    if (typeof envelope !== 'object' || envelope === null) return null

    const transaction = envelope.obj
    const id = transaction ? transactionId(transaction) : ''

    if (id.length === 0) return null

    const changedAt =
      transaction?.updated_at === undefined || transaction.updated_at === null
        ? ''
        : String(transaction.updated_at)

    return {
      eventId: changedAt ? `${id}:${changedAt}` : id,
      eventType: String(envelope.type ?? 'unknown'),
      recognised: isRecognisedCallbackType(envelope.type),
    }
  }

  /* ---------------------------------------------------------------- */
  /* Capture / void / refund                                           */
  /* ---------------------------------------------------------------- */

  async capture(input: CaptureInput): Promise<ObservedFact[]> {
    const transaction = (await this.call({
      method: 'POST',
      path: PATHS.capture,
      headers: this.secretAuth(this.requireSecretKey(input.credentials)),
      body: {
        transaction_id: this.requireTransactionId(input.gatewayPaymentId, 'capture'),
        amount_cents: Number(input.amountMinor),
      },
      operation: 'capture',
    })) as PaymobTransaction

    return factsFromTransaction({ accountId: input.accountId, transaction })
  }

  async voidAuthorization(input: {
    accountId: bigint
    gatewayReference: string
    gatewayPaymentId: string | null
    credentials: Readonly<Record<string, string>>
    idempotencyKey: string
    mode: 'test' | 'live'
  }): Promise<ObservedFact[]> {
    const transaction = (await this.call({
      method: 'POST',
      path: PATHS.void,
      headers: this.secretAuth(this.requireSecretKey(input.credentials)),
      body: {
        transaction_id: this.requireTransactionId(input.gatewayPaymentId, 'void'),
      },
      operation: 'void',
    })) as PaymobTransaction

    return factsFromTransaction({ accountId: input.accountId, transaction })
  }

  async refund(input: RefundInput): Promise<ObservedFact[]> {
    const transaction = (await this.call({
      method: 'POST',
      path: PATHS.refund,
      headers: this.secretAuth(this.requireSecretKey(input.credentials)),
      body: {
        transaction_id: this.requireTransactionId(input.gatewayPaymentId, 'refund'),
        amount_cents: Number(input.amountMinor),
      },
      operation: 'refund',
    })) as PaymobTransaction

    return factsFromTransaction({ accountId: input.accountId, transaction })
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * One request, with the error taxonomy applied on the way out.
   *
   * Every Paymob call goes through here so that no call site has to
   * remember to map a status code, and so a transport failure becomes a
   * ProviderError rather than escaping as a driver exception.
   */
  private async call(input: {
    method: 'GET' | 'POST'
    path: string
    headers: Record<string, string>
    body?: unknown
    operation: string
  }): Promise<unknown> {
    let response

    try {
      response = await this.http({
        method: input.method,
        url: `${PAYMOB_EGYPT_BASE_URL}${input.path}`,
        headers: input.headers,
        body: input.body,
      })
    } catch (error) {
      // Transport, not Paymob: DNS, TLS, socket, abort. Retryable, and
      // deliberately not reported as a decline.
      const message = error instanceof Error ? error.message : 'request failed'

      this.logger.warn(`Paymob ${input.operation} could not be sent: ${message}`)

      throw new ProviderError(
        'provider_timeout',
        `Paymob could not be reached (${input.operation}).`,
        message.slice(0, 300),
      )
    }

    if (response.status >= 200 && response.status < 300) {
      return response.body
    }

    const code = mapPaymobError({ status: response.status, body: response.body })
    const text = paymobErrorText({ status: response.status, body: response.body })

    // The message carries only Paymob's own error text: the request body
    // holds customer data and the headers hold the secret key.
    this.logger.warn(`Paymob ${input.operation} failed (${code}): ${text}`)

    throw new ProviderError(code, text)
  }

  /** `Authorization: Token <secret key>`, as the docs specify. */
  private secretAuth(secretKey: string): Record<string, string> {
    return { authorization: `Token ${secretKey}` }
  }

  private requireSecretKey(
    credentials: Readonly<Record<string, string>>,
  ): string {
    const key = (credentials.secret_key ?? '').trim()

    if (key.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Paymob is not configured for this store: secret key is missing.',
      )
    }

    return key
  }

  /**
   * The Paymob transaction id, or a clear refusal.
   *
   * Null means no callback or status poll has told us one yet, which
   * means there is no transaction at Paymob to act on. Refusing is the
   * honest answer; sending the order id in its place would have Paymob
   * reject it as an invalid transaction, or worse, act on someone else's.
   */
  private requireTransactionId(
    gatewayPaymentId: string | null,
    operation: string,
  ): string {
    const id = (gatewayPaymentId ?? '').trim()

    if (id.length === 0) {
      throw new ProviderError(
        'configuration_error',
        `This payment has no Paymob transaction id yet, so it cannot be ${operation}ed. ` +
          `It is recorded when Paymob's callback arrives.`,
      )
    }

    return id
  }

  /**
   * The integration ID for this offering.
   *
   * Paymob issues a different integration ID per payment method, which
   * is why the catalog marks it multi-integration: the merchant stores
   * one per offering in `gateway_method_config`. Numeric IDs are sent as
   * numbers and names as strings, both of which the docs accept.
   */
  private integrationId(context: PaymentCallContext): number | string {
    const configured = (context.gatewayMethodConfig ?? '').trim()

    if (configured.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'This Paymob payment method has no integration ID configured.',
      )
    }

    return /^\d+$/.test(configured) ? Number(configured) : configured
  }

  /**
   * Whether a key belongs to the mode the account is configured for.
   *
   * Paymob's dashboard issues mode-specific secret and public keys, and
   * the mode appears in the key itself (`egy_sk_test_…`, `pk_live_…`).
   * Checked as a token so the market prefix does not matter.
   */
  private matchesMode(key: string, mode: Mode): boolean {
    const other = mode === 'live' ? '_test_' : '_live_'
    const own = mode === 'live' ? '_live_' : '_test_'

    // Unrecognised shape: not our business to reject. Only an
    // unambiguous contradiction is worth failing on.
    if (!key.includes(own) && !key.includes(other)) return true

    return key.includes(own) && !key.includes(other)
  }

  private readString(body: unknown, key: string): string | null {
    if (typeof body !== 'object' || body === null) return null

    const value = (body as Record<string, unknown>)[key]

    return typeof value === 'string' && value.length > 0 ? value : null
  }

  private readNumberish(body: unknown, key: string): string | null {
    if (typeof body !== 'object' || body === null) return null

    const value = (body as Record<string, unknown>)[key]

    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()

    return null
  }

  private queryValue(
    query: Readonly<Record<string, string | string[] | undefined>>,
    name: string,
  ): string | null {
    for (const [key, raw] of Object.entries(query ?? {})) {
      if (key.toLowerCase() !== name) continue

      const value = Array.isArray(raw) ? raw[0] : raw

      if (typeof value === 'string' && value.length > 0) return value
    }

    return null
  }
}

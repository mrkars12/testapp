import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Mode, PaymentMethodKey } from '@prisma/client'
import { IPaymentProvider } from '../../payment-provider.interface'
import {
  ProviderError,
  callContextIdempotencyKey,
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
  TAP_BASE_URL,
  TAP_HTTP,
  defaultTapHttp,
  type TapHttp,
} from './tap-client'
import { mapTapError, mapTapResponseCode, tapErrorText } from './tap-error-map'
import {
  classifyCharge,
  factsFromCharge,
  factsFromPayload,
  isRecognisedPayload,
  tapObjectKind,
  type TapCharge,
  type TapRefund,
} from './tap-fact-map'
import { fromTapAmount, toTapAmount } from './tap-amount'
import { hashMatches, tapHash, tapHashFields } from './tap-hash'

/**
 * ==================================================================
 * Tap Payments — Charges API, redirect flow
 * ==================================================================
 *
 * A translation layer, like the Stripe, Paymob and Moyasar adapters: our
 * call context in, Tap's shapes out, Tap's responses back as
 * ObservedFacts. No database access, no state transitions, no reaching
 * for credentials.
 *
 * The flow is the documented **redirect** flow, and that choice is
 * forced by the documentation rather than preferred:
 *
 *   `POST /v2/charges` takes `source.id`. Passing a raw or encrypted
 *   card there is the PCI flow, and passing a `token_id` requires Tap's
 *   Card SDK in the browser. Neither is available to a server-side
 *   adapter.
 *
 *   Passing a **payment-method source id** is the server-initiated
 *   route Tap documents end to end: "In the response of the \charge
 *   request, you'll receive a transaction.url containing a URL for the
 *   payment page. The user should be redirected to this URL."
 *
 * So:
 *
 *   1. POST /v2/charges          → { id, status: "INITIATED", transaction.url }
 *   2. redirect the customer to `transaction.url`
 *   3. Tap POSTs the charge to `post.url` with a `hashstring` header
 *   4. verify the hash → ObservedFact, correlated on `charge.id`
 *   5. GET /v2/charges/{charge_id} covers a callback that never arrived
 *
 * One identifier throughout, unlike Paymob and Moyasar: the charge id is
 * what the create call returns, what the callback carries, what the
 * retrieve endpoint reads and what `POST /v2/refunds` takes as
 * `charge_id`.
 *
 * Two capabilities Tap documents are deliberately **not** claimed here,
 * because the redirect flow cannot reach them:
 *
 *   Manual capture. Capturing means "Create a Charge Request … Pass the
 *   'Authorize ID' in the Source", and an Authorize ID only exists if
 *   the payment began at `POST /v2/authorize`, whose source must be a
 *   "Token ID from the Card Library". A charge created here can never
 *   reach an authorized state, so `capture()` could only ever fail.
 *
 *   Void. Tap documents no manual void endpoint at all: `PUT
 *   /v2/authorize/{authorize_id}` "only accepts the description,
 *   metadata, and receipt arguments", and the sole documented way to
 *   release an authorization is the scheduled `auto: {type: "VOID",
 *   time}` set when the authorize is created. There is nothing to
 *   implement without inventing an endpoint.
 *
 * Sources, accessed 2026-08-19:
 *   https://developers.tap.company/reference/create-a-charge
 *   https://developers.tap.company/reference/charges
 *   https://developers.tap.company/docs/redirect
 *   https://developers.tap.company/docs/webhook
 *   https://developers.tap.company/docs/idempotency
 *   https://developers.tap.company/docs/authorize-and-capture
 *   https://developers.tap.company/reference/update-an-authorize
 *   https://developers.tap.company/reference/refunds
 *   https://developers.tap.company/reference/list-all-charges
 *   https://developers.tap.company/docs/authentication
 */

/** Paths under the versioned base URL. All from the official docs. */
const PATHS = {
  /** POST — .../reference/create-a-charge */
  charges: '/charges',
  /** GET {id} — .../docs/redirect, "Step 4: Retrieve the transaction" */
  charge: (id: string) => `/charges/${encodeURIComponent(id)}`,
  /** POST — .../reference/list-all-charges, used only to test a key */
  chargeList: '/charges/list',
  /** POST — .../reference/create-a-refund */
  refunds: '/refunds',
} as const

/**
 * Our payment methods → Tap's documented `source.id` values.
 *
 * Every value here appears in Tap's own source table or in the Redirect
 * guide's list of sources for this exact flow. A method with no
 * documented source id would be one this adapter cannot serve, which is
 * why the map and the declared `methods` are the same set.
 */
const SOURCE_BY_METHOD: Readonly<Partial<Record<PaymentMethodKey, string>>> = {
  // "To display ONLY the Card payment methods on a Tap hosted page. The
  // Create a Charge will return the transaction.url…"
  card: 'src_card',
  // "mada (local payment switch in KSA). For this payment method, a
  // transaction.url is always returned."
  mada: 'src_sa.mada',
  knet: 'src_kw.knet',
  benefit: 'src_bh.benefit',
  // Listed among the redirect flow's sources in the Redirect guide.
  apple_pay: 'src_apple_pay',
}

/**
 * Where the payer's identity comes from.
 *
 * `customer.first_name` and `customer.email` are **required** by Create
 * a Charge. `PaymentCallContext` carries no payer identity field of its
 * own, so the adapter reads it from the context's `metadata` map under
 * these keys rather than fabricating a customer — a placeholder name and
 * address on a real charge is worse than a refusal.
 *
 * `checkout.service.ts::payerMetadata()` populates exactly these keys
 * (`customer_first_name`/`customer_middle_name`/`customer_last_name`/
 * `customer_email`) from the checkout's own `customer_name`/
 * `customer_email` fields — this is not a blocker in the current
 * codebase; see `checkout-payer-context.integration.spec.ts`'s "Tap"
 * cases for the regression coverage.
 */
const CUSTOMER_KEYS = {
  id: 'customer_id',
  firstName: 'customer_first_name',
  middleName: 'customer_middle_name',
  lastName: 'customer_last_name',
  email: 'customer_email',
  phoneCountryCode: 'customer_phone_country_code',
  phoneNumber: 'customer_phone_number',
} as const

@Injectable()
export class TapAdapter implements IPaymentProvider {
  private readonly logger = new Logger(TapAdapter.name)

  readonly capabilities: GatewayCapabilities = {
    gateway: 'tap',
    // Exactly the methods with a documented source id for the redirect
    // flow. Which of them a payer actually sees is decided by Tap from
    // the merchant's own account configuration.
    methods: ['card', 'mada', 'knet', 'benefit', 'apple_pay'],
    // "Three-letter ISO currency code, in uppercase. Must be a supported
    // currency." Tap publishes no list of which, so narrowing it here
    // would be our guess rather than their rule; an account that cannot
    // take a currency is told so by Tap.
    currencies: 'all',
    // Tap's amounts are decimals in the major unit, converted against
    // the ISO exponent in `tap-amount.ts`. That is a representation
    // difference, not a disagreement about the number of decimal places:
    // Tap states "in ISO standard decimal places".
    exponentOverrides: {},
    // A charge settles in one step: status goes to CAPTURED.
    automaticCapture: true,
    // Documented, but unreachable from this flow. See the header.
    manualCapture: false,
    partialCapture: false,
    multiCapture: false,
    refundSupported: true,
    // "Partial Refund: A partial refund returns a portion of the
    // transaction amount. Multiple partial refunds can be issued…"
    partialRefund: true,
    // No manual void endpoint is documented. See the header.
    voidSupported: false,
    authorizationExpiry: false,
    // Card saving and payment agreements are documented and not
    // implemented here.
    vaulting: false,
    merchantInitiated: false,
    // "All Customer-initiated Transaction (CIT) transactions are 3DS
    // enforced as true by default."
    threeDSecure: true,
    webhooks: true,
    // GET /v2/charges/{charge_id} is what reconciliation needs when a
    // callback is lost.
    statusPolling: true,
    settlementReports: false,
    // Tap posts to whatever `post.url` the charge request carried, so
    // the account is known from the URL we minted and no part of the
    // unverified body is parsed to route it.
    webhookResolution: 'endpoint_scoped',
    // Tap issues no separate signing secret: the `hashstring` header is
    // an HMAC keyed by the merchant's Secret API Key.
    webhookSecretField: 'secret_key',
    nextActionKinds: ['redirect'],
    offlineCommitmentKind: null,
  }

  constructor(
    @Inject(TAP_HTTP)
    private readonly http: TapHttp = defaultTapHttp,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Credentials                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Checks the secret key is real and is for the right mode.
   *
   * Tap publishes no dedicated "verify this key" endpoint, so the live
   * check is a read the key is allowed to make — listing charges — which
   * authenticates without creating anything. The documented rejection
   * for a bad key is `7022 Invalid_Data / Missing required header:
   * authorization`, which the error map turns into a configuration
   * error.
   *
   * The mode is checked first, from the key itself: Tap issues a "Test -
   * Secret Key … sandbox environment" and a "Live - Secret Key … the
   * production environment", and shows the live form as
   * `sk_live_xxxxxxxxxxyz`. A live key saved against a test account is
   * the most common way a merchant breaks their own checkout, and it
   * deserves a better message than a generic authorization failure.
   */
  async validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
    mode: Mode
  }): Promise<CredentialValidationResult> {
    const secretKey = (input.credentials.secret_key ?? '').trim()

    if (secretKey.length === 0) {
      return {
        valid: false,
        errorCode: 'configuration_error',
        message: 'Tap secret key is missing.',
      }
    }

    if (!this.matchesMode(secretKey, input.mode)) {
      return {
        valid: false,
        errorCode: 'mode_mismatch',
        message:
          `This is not a ${input.mode} Tap secret key. ` +
          `${input.mode === 'live' ? 'Live' : 'Test'} keys start with ` +
          `sk_${input.mode}_.`,
      }
    }

    const outcome = await this.call({
      method: 'POST',
      path: PATHS.chargeList,
      apiKey: secretKey,
      // The smallest documented read. No filter is required, and `limit`
      // keeps the response small.
      body: { limit: 1 },
      operation: 'validate credentials',
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    )

    if (outcome.ok) return { valid: true }

    // A rejected key is a domain outcome, not a server fault: throwing
    // would turn a merchant's typo into a 500 at the settings screen.
    if (outcome.error instanceof ProviderError) {
      return {
        valid: false,
        errorCode: outcome.error.code,
        message: outcome.error.message,
      }
    }

    throw outcome.error
  }

  /* ---------------------------------------------------------------- */
  /* Initialize                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Creates a charge and hands back Tap's hosted payment URL.
   *
   * Normally `requires_action`: an INITIATED charge is a request for
   * payment, never a payment. Money moves when the customer completes
   * Tap's page, and we hear about it on `post.url`.
   */
  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    const secretKey = this.requireSecretKey(context.credentials)
    const currency = context.currency.toUpperCase()

    const body: Record<string, unknown> = {
      // "A positive decimal representing how much to charge in the
      // currency unit" — converted from our minor units against the ISO
      // exponent, never assumed to be a division by 100.
      amount: toTapAmount(context.amountMinor, currency),
      currency,
      // "All Customer-initiated Transaction (CIT) transactions are 3DS
      // enforced as true by default"; both are sent explicitly so the
      // charge does not depend on a default changing.
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      customer: this.customer(context),
      source: { id: this.sourceId(context.method) },
      redirect: { url: this.redirectUrl(context) },
      reference: {
        // "For Reconciliation purposes, ensure that the reference.order
        // and reference.transaction are passed via API/SDK."
        order: context.intentId.toString(),
        transaction: callContextIdempotencyKey(context, 'initialize'),
        // "An idempotent string is a unique identifier included in the
        // payment request to restrict duplicate actions." The key core
        // derived, sent verbatim.
        idempotent: callContextIdempotencyKey(context, 'initialize'),
      },
      metadata: {
        store_id: context.storeId.toString(),
        intent_id: context.intentId.toString(),
        mode: context.mode,
      },
    }

    const postUrl = (context.credentials.post_url ?? '').trim()

    if (postUrl.length > 0) {
      // "After payment is completed, Tap will POST the response payload
      // as a raw data to this URL." Distinct from `redirect`, which is
      // where the payer's browser lands.
      body.post = { url: postUrl }
    }

    const descriptor = context.statementDescriptor?.trim()

    if (descriptor) body.statement_descriptor = descriptor.slice(0, 255)

    const merchantId = (context.credentials.merchant_id ?? '').trim()

    if (merchantId.length > 0) {
      // "The ID of the Merchant Account to which the funds need to be
      // routed."
      body.merchant = { id: merchantId }
    }

    const charge = (await this.call({
      method: 'POST',
      path: PATHS.charges,
      apiKey: secretKey,
      body,
      operation: 'create charge',
    })) as TapCharge

    return this.resultFromCharge(charge, currency)
  }

  /* ---------------------------------------------------------------- */
  /* Status                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * The charge, straight from Tap.
   *
   * The documented retrieve call: "Make a \charge request to retrieve
   * the transaction details, specifying the charge_id contained in
   * tap_id" — `GET https://api.tap.company/v2/charges/{charge_id}`. This
   * is what covers a callback that never arrived, and what the customer's
   * return from the redirect is resolved with.
   */
  async fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]> {
    const secretKey = this.requireSecretKey(input.credentials)

    const charge = await this.call({
      method: 'GET',
      path: PATHS.charge(input.gatewayReference),
      apiKey: secretKey,
      operation: 'retrieve charge',
    })

    return factsFromCharge({
      accountId: input.accountId,
      charge: (charge ?? {}) as TapCharge,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Webhooks                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Verifies the `hashstring` header, then maps the object into facts.
   *
   * Tap's scheme is an HMAC-SHA256 over seven named fields of the posted
   * object, keyed by the merchant's Secret API Key — see `tap-hash.ts`
   * for the exact string and for why only those fields may be trusted.
   *
   * Verification and mapping are one method on purpose: a body that has
   * not been verified must never be mapped.
   */
  async parseWebhook(input: ParseWebhookInput): Promise<ObservedFact[]> {
    let payload: unknown

    try {
      payload = JSON.parse(input.rawBody.toString('utf8'))
    } catch {
      throw new ProviderError(
        'authentication_failed',
        'Tap callback body is not JSON.',
      )
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new ProviderError(
        'authentication_failed',
        'Tap callback body is not an object.',
      )
    }

    const received = this.header(input.headers, 'hashstring')

    if (received.length === 0) {
      throw new ProviderError(
        'authentication_failed',
        'Tap callback is missing its hashstring header.',
      )
    }

    const fields = tapHashFields(payload)

    if (fields === null) {
      // Nothing to hash: no id, or an amount in a currency whose decimal
      // places we cannot know. Either way the body cannot be verified,
      // and an unverifiable body is refused rather than mapped.
      throw new ProviderError(
        'authentication_failed',
        'Tap callback carries no verifiable id, amount and currency.',
      )
    }

    if (!hashMatches(received, tapHash(fields, input.signingSecret))) {
      // A forged callback, or one for a different account. Nothing has
      // touched payment state: facts are produced below and applied by
      // the caller.
      throw new ProviderError(
        'authentication_failed',
        'Tap callback hashstring does not match.',
      )
    }

    // `live_mode` tells us which environment produced the event. A test
    // callback reaching a live account (or the reverse) is a
    // misconfigured endpoint, and applying it would mix real and
    // simulated money.
    const liveMode = (payload as { live_mode?: unknown }).live_mode

    if (typeof liveMode === 'boolean') {
      const expectedLive = input.mode === 'live'

      if (liveMode !== expectedLive) {
        throw new ProviderError(
          'mode_mismatch',
          `Tap sent a ${liveMode ? 'live' : 'test'} callback to a ` +
            `${input.mode} account.`,
        )
      }
    }

    return factsFromPayload({ accountId: input.accountId, payload })
  }

  /**
   * The callback's identity, for deduplication and audit.
   *
   * Tap sends no event envelope: there is no event id and no event type
   * anywhere in the payload, only the object itself. Both parts are
   * therefore synthesised from fields the hash covers — the object's id
   * and its status — so a redelivery of the same callback is identical
   * while a later, different outcome for the same charge is distinct.
   *
   * ⚠️ Reads an unverified body. Only safe after parseWebhook has passed,
   * which is the only place ingestion calls it.
   */
  describeWebhook(input: { rawBody: Buffer }): WebhookDescriptor | null {
    let payload: unknown

    try {
      payload = JSON.parse(input.rawBody.toString('utf8'))
    } catch {
      return null
    }

    if (typeof payload !== 'object' || payload === null) return null

    const object = payload as { id?: unknown; status?: unknown }

    const id = typeof object.id === 'string' ? object.id : ''
    if (id.length === 0) return null

    const kind = tapObjectKind(payload) ?? 'unknown'
    const status =
      typeof object.status === 'string' && object.status.length > 0
        ? object.status
        : 'unknown'

    return {
      eventId: `${id}:${status}`,
      eventType: `${kind}.${status}`,
      recognised: isRecognisedPayload(payload),
    }
  }

  /* ---------------------------------------------------------------- */
  /* Refund                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Refunds a charge, in full or in part.
   *
   * Keyed on `charge_id`, which is our `gatewayReference`: Tap uses one
   * identifier for the payment throughout, so there is no second id to
   * wait for as there is with Paymob and Moyasar.
   *
   * The amount is always sent. Tap's API "allows to control the amount.
   * Either a full or Partial", and our caller has already decided which;
   * omitting it and hoping for the right default would move more of the
   * merchant's money than they asked for.
   */
  async refund(input: RefundInput): Promise<ObservedFact[]> {
    const secretKey = this.requireSecretKey(input.credentials)

    const chargeId = (input.gatewayReference ?? '').trim()

    if (chargeId.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'This payment has no Tap charge id, so it cannot be refunded.',
      )
    }

    const currency = input.currency.toUpperCase()

    const body: Record<string, unknown> = {
      charge_id: chargeId,
      amount: toTapAmount(input.amountMinor, currency),
      currency,
      // Required by the endpoint. Tap's own sample uses
      // "requested_by_customer" as the value.
      reason: input.reason?.trim() || 'requested_by_customer',
      reference: {
        // Refunds are one of the three endpoints the idempotency guide
        // names. The key core derived, sent verbatim.
        idempotent: input.idempotencyKey,
        merchant: input.idempotencyKey,
      },
    }

    const postUrl = (input.credentials.post_url ?? '').trim()

    if (postUrl.length > 0) {
      // A refund that is ACCEPTED rather than REFUNDED completes later,
      // and "the completion of the refund will trigger a webhook
      // notification to your server (post.url)".
      body.post = { url: postUrl }
    }

    const refund = (await this.call({
      method: 'POST',
      path: PATHS.refunds,
      apiKey: secretKey,
      body,
      operation: 'refund',
    })) as TapRefund

    return factsFromPayload({
      accountId: input.accountId,
      payload: { object: 'refund', ...refund },
      // The refund response echoes charge_id, but the caller's reference
      // is authoritative.
      gatewayReference: chargeId,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * The charge Tap just created, as a normalised result.
   *
   * Three shapes, all documented: INITIATED with a payment URL is the
   * redirect flow's normal path; CAPTURED is money already taken; and
   * every other terminal status is a failure whose reason comes from the
   * published response-code table.
   */
  private resultFromCharge(
    charge: TapCharge,
    currency: string,
  ): InitializeResult {
    const id = this.readString(charge, 'id')

    if (!id) {
      throw new ProviderError(
        'unknown',
        'Tap created a charge without an id.',
      )
    }

    const status = String(charge.status ?? '').toUpperCase()
    const url = typeof charge.transaction?.url === 'string' ? charge.transaction.url : ''

    if (status === 'CAPTURED') {
      const captured = fromTapAmount(charge.amount, currency)

      return {
        kind: 'succeeded',
        capturedAmountMinor: captured ?? 0n,
        refs: { gatewayReference: id, gatewayPaymentId: id },
      }
    }

    if (url.length > 0) {
      return {
        kind: 'requires_action',
        nextAction: { kind: 'redirect', url, method: 'GET' },
        refs: { gatewayReference: id, gatewayPaymentId: id },
      }
    }

    if (classifyCharge(status) === 'attempt_failed') {
      return {
        kind: 'failed',
        errorCode: mapTapResponseCode(charge.response?.code),
        raw: `${status}: ${String(charge.response?.message ?? '')}`.slice(0, 300),
      }
    }

    // INITIATED with no payment URL: the customer cannot be sent
    // anywhere, so there is no attempt to record as pending.
    throw new ProviderError(
      'unknown',
      `Tap returned a ${status || 'statusless'} charge with no payment URL.`,
    )
  }

  /**
   * One request, with the error taxonomy applied on the way out.
   *
   * Every Tap call goes through here so no call site has to remember to
   * map a status, and so a transport failure becomes a ProviderError
   * rather than escaping as a driver exception.
   */
  private async call(input: {
    method: 'GET' | 'POST'
    path: string
    apiKey: string
    body?: unknown
    operation: string
  }): Promise<unknown> {
    let response

    try {
      response = await this.http({
        method: input.method,
        url: `${TAP_BASE_URL}${input.path}`,
        apiKey: input.apiKey,
        body: input.body,
      })
    } catch (error) {
      // Transport, not Tap: DNS, TLS, socket, abort. Retryable, and
      // deliberately not reported as a decline.
      const message = error instanceof Error ? error.message : 'request failed'

      this.logger.warn(`Tap ${input.operation} could not be sent: ${message}`)

      throw new ProviderError(
        'provider_timeout',
        `Tap could not be reached (${input.operation}).`,
        message.slice(0, 300),
      )
    }

    if (response.status >= 200 && response.status < 300) {
      return response.body
    }

    const code = mapTapError({ status: response.status, body: response.body })
    const text = tapErrorText({ status: response.status, body: response.body })

    // The message carries only Tap's own error text: the request body
    // holds customer data and the key is in the Authorization header.
    this.logger.warn(`Tap ${input.operation} failed (${code}): ${text}`)

    throw new ProviderError(code, text)
  }

  /**
   * The payer, as Create a Charge requires them.
   *
   * `customer.first_name` and `customer.email` are documented as
   * required, and `customer.id` is documented as sufficient on its own:
   * "If ID is passed, no need to pass the other parameters of this
   * object."
   *
   * Refusing is deliberate. A charge carrying an invented name and a
   * placeholder address reaches the customer's receipt, Tap's dashboard
   * and the merchant's reconciliation, and is far harder to undo than a
   * payment that never started.
   */
  private customer(context: PaymentCallContext): Record<string, unknown> {
    const metadata = context.metadata ?? {}

    const existing = this.metaString(metadata, CUSTOMER_KEYS.id)

    if (existing.length > 0) return { id: existing }

    const firstName = this.metaString(metadata, CUSTOMER_KEYS.firstName)
    const email = this.metaString(metadata, CUSTOMER_KEYS.email)

    if (firstName.length === 0 || email.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Tap requires the payer’s first name and email on every charge, ' +
          `and neither was supplied (expected "${CUSTOMER_KEYS.firstName}" ` +
          `and "${CUSTOMER_KEYS.email}" in the call metadata).`,
      )
    }

    const customer: Record<string, unknown> = { first_name: firstName, email }

    const middleName = this.metaString(metadata, CUSTOMER_KEYS.middleName)
    const lastName = this.metaString(metadata, CUSTOMER_KEYS.lastName)

    if (middleName.length > 0) customer.middle_name = middleName
    if (lastName.length > 0) customer.last_name = lastName

    const countryCode = this.metaString(metadata, CUSTOMER_KEYS.phoneCountryCode)
    const number = this.metaString(metadata, CUSTOMER_KEYS.phoneNumber)

    if (countryCode.length > 0 && number.length > 0) {
      // "The Country Code of the Phone Number. Do not add +."
      customer.phone = {
        country_code: countryCode.replace(/^\+/, ''),
        number,
      }
    }

    return customer
  }

  /**
   * Where the payer's browser lands after Tap's page.
   *
   * `redirect` is a required field of Create a Charge, so an account
   * without one cannot take a payment at all. The call context's
   * `returnUrl` wins when core supplies one; the merchant's configured
   * URL is the fallback, and it is what makes the account usable today.
   */
  private redirectUrl(context: PaymentCallContext): string {
    const fromContext = context.returnUrl?.trim() ?? ''

    if (fromContext.length > 0) return fromContext

    const configured = (context.credentials.redirect_url ?? '').trim()

    if (configured.length > 0) return configured

    throw new ProviderError(
      'configuration_error',
      'Tap requires a redirect URL on every charge, and none is configured ' +
        'for this store.',
    )
  }

  /** The documented `source.id` for this offering's method. */
  private sourceId(method: PaymentMethodKey): string {
    const source = SOURCE_BY_METHOD[method]

    if (!source) {
      throw new ProviderError(
        'method_unavailable',
        `Tap has no documented payment source for the "${method}" method.`,
      )
    }

    return source
  }

  private requireSecretKey(
    credentials: Readonly<Record<string, string>>,
  ): string {
    const key = (credentials.secret_key ?? '').trim()

    if (key.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Tap is not configured for this store: secret key is missing.',
      )
    }

    return key
  }

  /**
   * Whether a key belongs to the mode the account is configured for.
   *
   * An unrecognised shape is not rejected — only an unambiguous
   * contradiction is worth failing on, and Tap is free to mint a key
   * format we have not seen.
   */
  private matchesMode(key: string, mode: Mode): boolean {
    const own = mode === 'live' ? 'sk_live_' : 'sk_test_'
    const other = mode === 'live' ? 'sk_test_' : 'sk_live_'

    if (key.startsWith(other)) return false
    if (key.startsWith(own)) return true

    return true
  }

  /** A header value, lower-cased key, first entry of a repeated header. */
  private header(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    name: string,
  ): string {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== name) continue

      const raw = Array.isArray(value) ? value[0] : value

      return typeof raw === 'string' ? raw.trim() : ''
    }

    return ''
  }

  private metaString(
    metadata: Readonly<Record<string, unknown>>,
    key: string,
  ): string {
    const value = metadata[key]

    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number') return String(value)

    return ''
  }

  private readString(body: unknown, key: string): string | null {
    if (typeof body !== 'object' || body === null) return null

    const value = (body as Record<string, unknown>)[key]

    return typeof value === 'string' && value.length > 0 ? value : null
  }
}

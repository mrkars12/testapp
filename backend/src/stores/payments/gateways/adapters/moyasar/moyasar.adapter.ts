import { Inject, Injectable, Logger } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
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
  type ProviderFormSpec,
  type RefundInput,
  type WebhookDescriptor,
} from '../../provider.types'
import {
  MOYASAR_BASE_URL,
  MOYASAR_HTTP,
  defaultMoyasarHttp,
  type MoyasarHttp,
} from './moyasar-client'
import { mapMoyasarError, moyasarErrorText } from './moyasar-error-map'
import {
  factsFromEmbeddedPayment,
  factsFromInvoice,
  factsFromPayment,
  isPaymentEvent,
  isRecognisedEvent,
  type MoyasarPayment,
  type MoyasarWebhookEvent,
} from './moyasar-fact-map'

/**
 * ==================================================================
 * Moyasar — Invoices (hosted checkout) + Payments API
 * ==================================================================
 *
 * A translation layer, like the Stripe and Paymob adapters: our call
 * context in, Moyasar's shapes out, Moyasar's responses back as
 * ObservedFacts. No database access, no state transitions, no reaching
 * for credentials.
 *
 * The flow is **Invoices**, not the Payments API, and that choice is
 * forced by the documentation rather than preferred:
 *
 *   `POST /payments` takes a `source` object which is a raw card
 *   (`number`, `cvc`), a token, or a wallet payload. Moyasar is explicit
 *   that "Sending cardholder data to the merchant backend is prohibited
 *   and will result in canceling the agreement" — the card path belongs
 *   in the browser, behind the publishable key.
 *
 *   `POST /invoices` is the documented server-initiated route: it
 *   returns "URL for the checkout page that the merchant must present to
 *   the payer", and Moyasar hosts the form, the validation and 3DS.
 *
 * So:
 *
 *   1. POST /v1/invoices              → { id, status: "initiated", url }
 *   2. redirect the customer to `url`
 *   3. Moyasar POSTs a webhook        → { id, type, secret_token, data: payment }
 *   4. verify secret_token → ObservedFact via data.invoice_id
 *
 * Two identifiers, as with Paymob and for the same reason: facts
 * correlate on the **invoice** id, which exists from step 1, while
 * `/payments/:id/refund` keys on the **payment** id, which does not
 * exist until someone pays.
 *
 * Sources, accessed 2026-08-19:
 *   https://docs.moyasar.com/api/invoices/01-create-invoice
 *   https://docs.moyasar.com/api/payments/05-refund-payment
 *   https://docs.moyasar.com/api/other/webhooks/webhook-reference
 *   https://docs.moyasar.com/api/authentication
 */

/** Paths under the versioned base URL. All from the official docs. */
/**
 * The Moyasar Payment Form build the storefront loads.
 *
 * Pinned deliberately. Verified by probing the CDN directly: 1.19.0 is
 * the highest published version (1.19.1 and above return 403), and the
 * asset's own banner reads "Moyasar Payment Form v1.19.0 (c) 2020-2025
 * Moyasar Ltd.".
 */
export const MOYASAR_FORM_VERSION = '1.19.0'

const PATHS = {
  /** POST — .../api/invoices/01-create-invoice */
  invoices: '/invoices',
  /** GET {id} — .../api/invoices/04-show-invoice */
  invoice: (id: string) => `/invoices/${encodeURIComponent(id)}`,
  /** POST — .../api/payments/05-refund-payment */
  refund: (id: string) => `/payments/${encodeURIComponent(id)}/refund`,
  /** GET — .../api/payments/03-list-payments, used only to test a key */
  payments: '/payments',
  /** GET {id} — .../api/payments/04-fetch-payment (embedded verification) */
  payment: (id: string) => `/payments/${encodeURIComponent(id)}`,
} as const

/**
 * ==================================================================
 * Moyasar's forms, as Moyasar publishes them
 * ==================================================================
 *
 * Moyasar's Embedded Payment Form is ONE surface that hosts several
 * provider methods, not one surface per method. Read directly out of
 * the pinned bundle (cdn.moyasar.com/mpf/1.19.0/moyasar.js), which is
 * the integration contract we actually ship:
 *
 *   - the form's method vocabulary is exactly `creditcard`, `applepay`
 *     and `stcpay` (`Tn.Gn`), and its default when `methods` is not an
 *     array is `["applepay","creditcard","stcpay"]`;
 *   - `supported_networks` defaults to
 *     `["amex","mada","visa","mastercard"]` and is a property of the
 *     **card** component — mada has its own BIN table inside that
 *     component (`cr(){return "mada"}`), i.e. mada is a card NETWORK
 *     the card form already accepts, not a form of its own;
 *   - STC Pay is a method of that same form (`stcpay`). It renders its
 *     own button, takes a Saudi mobile number, creates the payment with
 *     `source: {type:'stcpay', mobile}`, and completes an OTP in a modal
 *     by POSTing `{otp_value}` to the `transaction_url` the provider put
 *     on the initiated payment. It has NO configuration option of its
 *     own — nothing in the bundle reads an `stc_pay_*` key — and no
 *     device or browser requirement, because it is a phone number and a
 *     one-time code rather than a platform wallet. Once the OTP settles
 *     the form redirects to `callback_url` with `?id=&status=&message=`,
 *     which is byte-for-byte the return the card path already produces;
 *     see the bundle's redirect builder, where only `creditcard` takes
 *     the 3DS `transaction_url` detour instead.
 *   - Samsung Pay is NOT in this bundle. Its method vocabulary is
 *     exactly the three above; the string `samsung` does not occur in
 *     cdn.moyasar.com/mpf/1.19.0/moyasar.js at all, and 1.19.0 is the
 *     highest build published under that path. Moyasar do support it,
 *     in a different major of the form (npm `moyasar-payment-form` 2.x)
 *     whose configuration is a breaking change from this one — nested
 *     `apple_pay: {...}` objects instead of the flat `apple_pay_*` keys
 *     read below. Adding a `samsungpay` string to THIS form's `methods`
 *     would render nothing. It is therefore left out rather than
 *     declared; see MOYASAR_STCPAY_SAMSUNGPAY_EMBEDDED_FINAL_REPORT.md.
 *   - Apple Pay is a method of that SAME form (`applepay`), not a
 *     surface of its own. It additionally requires `apple_pay_label`,
 *     `apple_pay_validate_merchant_url`, `apple_pay_country` and
 *     (optionally) `apple_pay_supported_countries`,
 *     `apple_pay_merchant_capabilities`, `apple_pay_version` — and the
 *     form throws on the missing ones ("Apple Pay label is required",
 *     "Validate Merchat URL is required for Apple Pay"), which would
 *     take the card component down with it.
 *
 * So the mapping is:
 *
 *   card + mada  → the embedded Payment Form's card component
 *   apple_pay    → the embedded Payment Form's Apple Pay button, for an
 *                  account that configured Apple Pay
 *                → the hosted invoice otherwise, where Moyasar performs
 *                  the merchant validation themselves
 *   stc_pay      → the embedded Payment Form's STC Pay button,
 *                  unconditionally: there is no account configuration it
 *                  can be missing. What it DOES depend on is the method
 *                  being enabled on the merchant's own Moyasar account —
 *                  a step taken in Moyasar's dashboard, not here. An
 *                  account without it gets the provider's own error
 *                  inside the provider's own form, which is the honest
 *                  place for it: we cannot see the account's enabled
 *                  methods through the publishable key.
 *   samsung_pay  → nothing. Not a method of this bundle at all.
 *
 * The last line is why Apple Pay is a CONDITIONAL member of the embedded
 * form (`methodCredentialKeys`) rather than a plain one: membership
 * depends on the merchant's own configuration, and an unconfigured
 * account must not be handed a form that throws on mount.
 *
 * Declaring it here rather than deriving it in the checkout is the
 * point: only the adapter knows the provider's contract, and the
 * capability model already refuses a descriptor that contradicts it.
 */

/**
 * Moyasar's official merchant-validation endpoint.
 *
 * Apple requires the merchant session to be fetched server-side from
 * Apple with the merchant identity certificate. Moyasar hosts that for
 * web integrations, so `apple_pay_validate_merchant_url` points at them
 * and no Apple certificate ever has to exist on our side.
 *
 * The form POSTs `{validation_url, domain_name, display_name,
 * publishable_api_key}` to it and hands the JSON straight to
 * `session.completeMerchantValidation` — read out of the pinned bundle,
 * not assumed.
 *
 * Source: https://docs.moyasar.com/api/other/apple-pay/request-apple-pay-session/
 */
export const MOYASAR_APPLE_PAY_VALIDATION_URL =
  'https://api.moyasar.com/v1/applepay/initiate'

/**
 * The account configuration Apple Pay cannot mount without.
 *
 * Only the two the form has no default for. `supported_countries`
 * (`["SA"]`), `merchant_capabilities`
 * (`["supports3DS","supportsCredit","supportsDebit"]`) and `version`
 * (`6`) all default inside the form, so requiring them would refuse
 * accounts the provider would happily serve.
 */
export const MOYASAR_APPLE_PAY_KEYS = [
  'apple_pay_label',
  'apple_pay_country',
] as const

export const MOYASAR_PROVIDER_FORMS: readonly ProviderFormSpec[] = [
  {
    id: 'moyasar_form_card',
    methods: ['card', 'mada', 'apple_pay', 'stc_pay'],
    // The embedded form, mounted in our own checkout.
    nextActionKind: 'client_sdk',
    // It cannot start without one; see `embeddedCredentialKeys`.
    requiresCredentialKeys: ['publishable_key'],
    // Apple Pay joins this surface only for an account that configured
    // it. Without these the provider's form throws on mount.
    methodCredentialKeys: { apple_pay: MOYASAR_APPLE_PAY_KEYS },
    // An account with no publishable key still gets a working checkout,
    // on the hosted invoice. That is the pre-existing behaviour and the
    // reason this is a fallback rather than "unavailable".
    fallbackNextActionKind: 'redirect',
  },
  {
    id: 'moyasar_invoice_apple_pay',
    methods: ['apple_pay'],
    // The unconditional fallback surface for Apple Pay: a merchant who
    // enabled the method but configured none of its options still gets a
    // working payment, on Moyasar's hosted invoice where Moyasar does
    // the merchant validation. Honestly labelled redirect, because that
    // is what it is.
    nextActionKind: 'redirect',
  },
]

/** The form's own name for each of our methods. */
const FORM_METHOD_BY_METHOD: Partial<Record<PaymentMethodKey, string>> = {
  card: 'creditcard',
  mada: 'creditcard',
  apple_pay: 'applepay',
  // Unconditional, unlike `applepay`: the form's STC Pay component needs
  // no configuration option at all, so there is nothing an account can
  // be missing that would make it throw on mount.
  stc_pay: 'stcpay',
}

/**
 * The card networks each of our methods stands for, in the form's
 * `supported_networks` vocabulary.
 *
 * Sending them explicitly is what makes the merchant's `mada` offering
 * mean something: a merchant with `card` enabled and `mada` disabled
 * gets a form that does not advertise mada, instead of the provider's
 * default set regardless of what they configured.
 */
const CARD_NETWORKS: Partial<Record<PaymentMethodKey, readonly string[]>> = {
  card: ['visa', 'mastercard', 'amex'],
  mada: ['mada'],
}

/**
 * Our methods → the form's method vocabulary, derived from the forms
 * above rather than written out again.
 *
 * A method absent from this map is one the embedded form cannot host
 * for us, and the adapter falls back to the hosted invoice for it.
 */
const EMBEDDED_FORM_METHODS: Partial<Record<PaymentMethodKey, string>> =
  Object.fromEntries(
    MOYASAR_PROVIDER_FORMS.filter(
      (form) => form.nextActionKind === 'client_sdk',
    ).flatMap((form) =>
      form.methods.flatMap((method) => {
        const providerMethod = FORM_METHOD_BY_METHOD[method]
        return providerMethod ? [[method, providerMethod] as const] : []
      }),
    ),
  )

/**
 * The Apple Pay options this account configured, in the form's own
 * vocabulary — or `null` when it configured none, which is how the
 * caller knows not to put `applepay` in the form's `methods`.
 *
 * Only the two the form has no default for are required; the rest are
 * passed through when present and left to the provider's documented
 * defaults when not, so a merchant is never forced to restate a value
 * the provider would have chosen identically.
 */
export function applePayFormOptions(
  credentials: Record<string, string>,
): Record<string, unknown> | null {
  const label = (credentials.apple_pay_label ?? '').trim()
  const country = (credentials.apple_pay_country ?? '').trim().toUpperCase()

  // Validated to the form's own rules rather than merely "present": a
  // country the form will reject is worse than no Apple Pay at all,
  // because it throws and takes the card component with it.
  if (!label || !/^[A-Z]{2}$/.test(country)) return null

  const options: Record<string, unknown> = {
    apple_pay_label: label.slice(0, 64),
    apple_pay_country: country,
    // Moyasar's own endpoint. Not merchant-configurable: pointing this
    // anywhere else means someone else signing our merchant sessions.
    apple_pay_validate_merchant_url: MOYASAR_APPLE_PAY_VALIDATION_URL,
  }

  // "must be an array" of "ISO 3166 country codes" — the form's words.
  const supported = splitList(credentials.apple_pay_supported_countries)
    .map((entry) => entry.toUpperCase())
    .filter((entry) => /^[A-Z]{2}$/.test(entry))
  if (supported.length > 0) {
    options.apple_pay_supported_countries = supported
  }

  const capabilities = splitList(
    credentials.apple_pay_merchant_capabilities,
  ).filter((entry) => APPLE_PAY_CAPABILITIES.includes(entry))
  if (capabilities.length > 0) {
    options.apple_pay_merchant_capabilities = capabilities
  }

  return options
}

/** Apple's own vocabulary; anything else is rejected by ApplePaySession. */
const APPLE_PAY_CAPABILITIES: readonly string[] = [
  'supports3DS',
  'supportsCredit',
  'supportsDebit',
  'supportsEMV',
]

/** A merchant-entered comma or space separated list, cleaned up. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

@Injectable()
export class MoyasarAdapter implements IPaymentProvider {
  private readonly logger = new Logger(MoyasarAdapter.name)

  readonly capabilities: GatewayCapabilities = {
    gateway: 'moyasar',
    // The catalog's Moyasar methods. Which of them a payer is offered is
    // decided by Moyasar's hosted invoice page from the merchant's own
    // account configuration.
    methods: ['card', 'mada', 'apple_pay', 'stc_pay'],
    // The docs specify "ISO-4217 three-letter currency code" and place
    // no restriction on the set, giving SAR, KWD and JPY as worked
    // examples. Narrowing it here would be our guess, not their rule;
    // an account that cannot take a currency is told so by Moyasar.
    currencies: 'all',
    // Moyasar's amounts are already the smallest currency unit, for
    // two-, three- and zero-decimal currencies alike.
    exponentOverrides: {},
    // An invoice payment settles in one step: status goes to `paid`.
    automaticCapture: true,
    // The Capture API is documented, but `manual: true` is an option on
    // the *Payments* API's source object and has no equivalent on an
    // invoice. A payment created through this adapter can therefore
    // never reach `authorized`, so capture is an operation the
    // orchestrator could never legitimately reach. Claiming it — and
    // shipping a capture() that can only ever fail — would be the trap
    // the capability model exists to prevent.
    manualCapture: false,
    partialCapture: false,
    multiCapture: false,
    refundSupported: true,
    // "An optional amount for the refund process, less than our equal to
    // the payment amount (or captured). If this field is missing, then
    // the full amount will be refunded."
    partialRefund: true,
    // Void is documented, but like capture it is reachable only for
    // payments this adapter cannot create. See the report.
    voidSupported: false,
    authorizationExpiry: false,
    // Tokenization is documented and not implemented here.
    vaulting: false,
    merchantInitiated: false,
    // Moyasar runs 3DS on its hosted invoice page; `3ds` defaults to true
    // on the underlying payment.
    threeDSecure: true,
    webhooks: true,
    // GET /invoices/:id returns the invoice with its payments, which is
    // what reconciliation needs when a webhook is lost.
    statusPolling: true,
    settlementReports: false,
    // The merchant registers one webhook endpoint per account in the
    // Moyasar dashboard, so the account is known from our URL and no
    // part of the unverified body is parsed to route it.
    webhookResolution: 'endpoint_scoped',
    // Both, and which one a given merchant gets is decided per account
    // by `embeddedCredentialKeys` below. The hosted invoice is the
    // fallback that every existing account keeps; the embedded form is
    // what an account with a publishable key gets instead.
    nextActionKinds: ['redirect', 'client_sdk'],
    offlineCommitmentKind: null,
    // Moyasar Form cannot start without a publishable key
    // (`pk_test_`/`pk_live_`), which the docs describe as "restricted to
    // a single operation only and safe to be shipped into client code".
    // It is an optional credential, so an account without one is
    // correctly presented as redirect rather than as a form that could
    // never initialise.
    embeddedCredentialKeys: ['publishable_key'],
    // The two customer-facing surfaces Moyasar actually publishes. This
    // is what stops the checkout from turning `card` and `mada` — two
    // networks of ONE form — into two payment experiences.
    providerForms: MOYASAR_PROVIDER_FORMS,
  }

  constructor(
    @Inject(MOYASAR_HTTP)
    private readonly http: MoyasarHttp = defaultMoyasarHttp,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Credentials                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Checks the secret key is real and is for the right mode.
   *
   * Moyasar publishes no dedicated "verify this key" endpoint, so the
   * live check is a read the key is allowed to make — listing payments —
   * which authenticates without creating anything. A 401 there is
   * exactly the documented `authentication_error`.
   *
   * The mode is checked first, from the key itself: "Test API keys are
   * prefixed with … pk_test_, sk_test_. Live API keys … pk_live_,
   * sk_live_." A live key saved against a test account is the most
   * common way a merchant breaks their own checkout, and it deserves a
   * better message than a generic authorization failure.
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
        message: 'Moyasar secret key is missing.',
      }
    }

    if (!this.matchesMode(secretKey, input.mode)) {
      return {
        valid: false,
        errorCode: 'mode_mismatch',
        message:
          `This is not a ${input.mode} Moyasar secret key. ` +
          `${input.mode === 'live' ? 'Live' : 'Test'} keys start with ` +
          `sk_${input.mode}_.`,
      }
    }

    const outcome = await this.call({
      method: 'GET',
      path: PATHS.payments,
      apiKey: secretKey,
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
   * Creates an invoice and hands back its hosted checkout URL.
   *
   * Always `requires_action`: an invoice is a request for payment, never
   * a payment. Money moves when the customer completes Moyasar's hosted
   * page, and we hear about it in the webhook.
   */
  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    const secretKey = this.requireSecretKey(context.credentials)

    const publishableKey = (context.credentials.publishable_key ?? '').trim()

    const formMethod = EMBEDDED_FORM_METHODS[context.method]
    // A surface that cannot render an in-page form must be given the
    // hosted invoice instead. Without this the merchant Test Payment
    // tool received a `client_sdk` action it had no branch for and went
    // straight to its result route without ever visiting Moyasar.
    const canHostForm =
      context.hostableNextActionKinds === undefined ||
      context.hostableNextActionKinds.includes('client_sdk')

    // Apple Pay is a member of the embedded form only for an account
    // that configured it. The same rule decided the grouping upstream;
    // it is restated here because `initializePayment` is reachable
    // without it (the merchant tool, a stale offering), and mounting a
    // form that throws is worse than the hosted invoice.
    const applePayReady =
      context.method !== 'apple_pay' ||
      applePayFormOptions(context.credentials) !== null

    if (
      publishableKey &&
      context.returnUrl &&
      formMethod &&
      canHostForm &&
      applePayReady
    ) {
      return this.prepareEmbeddedPayment(context, publishableKey, formMethod)
    }

    const body: Record<string, unknown> = {
      // "A positive integer representing the payment amount in the
      // smallest currency unit" — the same units we hold, so this is a
      // widening rather than a conversion.
      amount: Number(context.amountMinor),
      currency: context.currency.toUpperCase(),
      // Required by the API, and shown to the payer on the invoice.
      description: context.statementDescriptor?.trim()
        ? context.statementDescriptor.trim().slice(0, 255)
        : `Order ${context.intentId.toString()}`,
      // Echoed back on the payment and in webhook messages, which makes
      // a retry traceable to the attempt it belongs to.
      metadata: {
        store_id: context.storeId.toString(),
        intent_id: context.intentId.toString(),
        mode: context.mode,
        reference: callContextIdempotencyKey(context, 'initialize'),
      },
    }

    if (context.returnUrl) {
      // Where the *payer* lands after paying. Distinct from callback_url,
      // which the docs stress "is not used to redirect the user, this is
      // only used to send a notification".
      body.success_url = context.returnUrl
      body.back_url = context.returnUrl
    }

    const invoice = await this.call({
      method: 'POST',
      path: PATHS.invoices,
      apiKey: secretKey,
      body,
      operation: 'create invoice',
    })

    const id = this.readString(invoice, 'id')
    const url = this.readString(invoice, 'url')

    if (!id || !url) {
      // Without either we cannot send the customer to checkout, or match
      // the webhook back to this attempt.
      throw new ProviderError(
        'unknown',
        'Moyasar created an invoice without an id or a checkout URL.',
      )
    }

    return {
      kind: 'requires_action',
      nextAction: { kind: 'redirect', url, method: 'GET' },
      refs: { gatewayReference: id },
    }
  }

  /**
   * Embedded: hand the browser what Moyasar Form needs, and create
   * nothing here.
   *
   * The form creates the payment itself, in the browser, against the
   * publishable key — which is the entire point: card data goes to
   * Moyasar's own component and never reaches our backend, so the
   * Payments API's prohibition on cardholder data touching a merchant
   * server is satisfied by construction rather than by policy.
   *
   * That means this call returns **no gateway reference**: there is no
   * provider object yet. The attempt is stored without one, and the
   * payment id arrives later — either from the browser through the
   * checkout confirm endpoint, or from the webhook. Both correlate on
   * `metadata.intent_id`, which the applier already resolves through
   * `internalIntentRef` and then binds. Nothing about that mechanism is
   * new; this is the second caller of it.
   *
   * `callback_url` is required by the form and is where the payer lands
   * after 3DS. It is the storefront's own return URL, already validated
   * against this deployment's origin allowlist before it reached here.
   *
   * Source: https://docs.moyasar.com/guides/card-payments/basic-integration/
   * and https://docs.moyasar.com/guides/references/form-configuration/
   */
  private prepareEmbeddedPayment(
    context: PaymentCallContext,
    publishableKey: string,
    formMethod: string,
  ): InitializeResult {
    // Deduplicated and ordered by the CARD_NETWORKS table rather than by
    // the caller, so the same merchant configuration always produces the
    // same list.
    const enabled = context.formMethods ?? []
    const networks = [
      ...new Set(enabled.flatMap((method) => CARD_NETWORKS[method] ?? [])),
    ]

    // The provider methods this one form must render, in the form's own
    // vocabulary. Derived from the merchant's grouped methods rather
    // than from the single method the payer's radio named, because the
    // whole point of the grouping is that card, mada and Apple Pay are
    // ONE surface: the payer picks the method inside the provider's
    // form, not before it.
    //
    // Falls back to the representative's own method when the caller did
    // not group anything (the merchant Test Payment tool), which is the
    // behaviour that existed before Apple Pay joined this form.
    const grouped = [
      ...new Set(
        enabled.flatMap((method) => {
          const providerMethod = EMBEDDED_FORM_METHODS[method]
          return providerMethod ? [providerMethod] : []
        }),
      ),
    ]

    // Decided here from the credentials themselves, not taken on trust
    // from the caller's method list. The grouping upstream applies the
    // same rule, but this is the last point before a third party's
    // `init()` — and `applepay` without complete options is not a
    // missing button, it is a form that throws on mount and leaves the
    // payer with no card fields either.
    const applePay = applePayFormOptions(context.credentials)
    const formMethods = (grouped.length > 0 ? grouped : [formMethod]).filter(
      (method) => method !== 'applepay' || applePay !== null,
    )

    return {
      kind: 'requires_action',
      nextAction: {
        kind: 'client_sdk',
        // No client secret: Moyasar's form is driven by the publishable
        // key plus the payment's parameters.
        publishableKey,
        config: {
          // Minor units, exactly as we hold them.
          amount: Number(context.amountMinor),
          currency: context.currency.toUpperCase(),
          description: context.statementDescriptor?.trim()
            ? context.statementDescriptor.trim().slice(0, 255)
            : `Order ${context.intentId.toString()}`,
          callback_url: context.returnUrl,
          // Explicit, never the form's default: its default is
          // `["applepay","creditcard","stcpay"]` regardless of what the
          // merchant enabled, and an unconfigured `applepay` in that
          // list makes the whole form throw ("Apple Pay label is
          // required"). Sending exactly the merchant's own grouped
          // methods is what makes the form render what they switched on
          // and nothing else.
          methods: formMethods,
          // Apple Pay's options, for an account that configured it.
          // Spread rather than nested: these are top-level form options
          // in Moyasar's contract.
          ...(formMethods.includes('applepay') ? (applePay ?? {}) : {}),
          // The networks this merchant's enabled offerings add up to.
          // `supported_networks` belongs to the card component and
          // defaults to ["amex","mada","visa","mastercard"], so a
          // merchant who did not enable mada would otherwise be shown a
          // mada badge on a form they never switched it on for.
          //
          // Omitted entirely when the caller did not group offerings
          // (the merchant Test Payment tool), which leaves the
          // provider's default exactly as it was.
          ...(networks.length > 0 ? { supported_networks: networks } : {}),
          // The correlation channel. Documented as "searchable key/value
          // pairs to the payments", echoed on the payment and in every
          // webhook, which is what lets a payment created in the browser
          // find its attempt here.
          metadata: {
            store_id: context.storeId.toString(),
            intent_id: context.intentId.toString(),
            mode: context.mode,
            reference: callContextIdempotencyKey(context, 'initialize'),
          },
        },
        sdkHints: {
          // Pinned rather than floating: an unpinned payment form is a
          // third party changing our checkout without a deploy. Probed
          // against the CDN — 1.19.0 is the highest published build.
          form_version: MOYASAR_FORM_VERSION,
        },
      },
    }
  }

  /* ---------------------------------------------------------------- */
  /* Status                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * The invoice and its payments, straight from Moyasar.
   *
   * Fetches the invoice rather than a payment because the invoice id is
   * what we hold from the moment the attempt was created; the payment id
   * only becomes known once a webhook has arrived, which is precisely
   * the case this call exists to cover.
   */
  async fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]> {
    const secretKey = this.requireSecretKey(input.credentials)

    // Two resources, one adapter. A redirect attempt's reference is an
    // invoice id; an embedded attempt's is a payment id, because the
    // browser form created a payment and no invoice ever existed. The
    // strings are indistinguishable, so core tells us which next action
    // produced the attempt and we map that to the right endpoint.
    if (input.referenceKind === 'client_sdk') {
      const payment = await this.call({
        method: 'GET',
        path: PATHS.payment(input.gatewayReference),
        apiKey: secretKey,
        operation: 'fetch payment',
      })

      return factsFromEmbeddedPayment({
        accountId: input.accountId,
        payment: (payment ?? {}) as MoyasarPayment,
      })
    }

    const invoice = await this.call({
      method: 'GET',
      path: PATHS.invoice(input.gatewayReference),
      apiKey: secretKey,
      operation: 'fetch invoice',
    })

    return factsFromInvoice({
      accountId: input.accountId,
      invoice: (invoice ?? {}) as {
        id?: unknown
        status?: unknown
        currency?: unknown
        payments?: readonly MoyasarPayment[]
      },
    })
  }

  /* ---------------------------------------------------------------- */
  /* Webhooks                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Verifies the shared secret, then maps the payment into facts.
   *
   * Moyasar does not sign its callbacks. The documented mechanism is a
   * **secret token**: "a password you need to validate on your server to
   * make sure the notification is coming from moyasar", chosen by the
   * merchant when registering the endpoint and echoed in every payload.
   *
   * That is weaker than an HMAC — it is a bearer secret in a body, so it
   * cannot prove the body was not altered, only that the sender knew the
   * secret. Two consequences are honoured here: the comparison is
   * constant-time, and the token is never logged or put in an error.
   * Implementing a signature check instead would mean inventing one.
   */
  async parseWebhook(input: ParseWebhookInput): Promise<ObservedFact[]> {
    let event: MoyasarWebhookEvent

    try {
      event = JSON.parse(input.rawBody.toString('utf8')) as MoyasarWebhookEvent
    } catch {
      throw new ProviderError(
        'authentication_failed',
        'Moyasar callback body is not JSON.',
      )
    }

    if (typeof event !== 'object' || event === null) {
      throw new ProviderError(
        'authentication_failed',
        'Moyasar callback body is not an object.',
      )
    }

    const received = typeof event.secret_token === 'string' ? event.secret_token : ''

    if (!this.secretMatches(received, input.signingSecret)) {
      // A forged callback, or one for a different endpoint. Nothing has
      // touched payment state: facts are produced below and applied by
      // the caller.
      throw new ProviderError(
        'authentication_failed',
        'Moyasar callback secret token does not match.',
      )
    }

    // `live` tells us which mode produced the event. A test event
    // reaching a live account (or the reverse) is a misconfigured
    // endpoint, and applying it would mix real and simulated money.
    if (typeof event.live === 'boolean') {
      const expectedLive = input.mode === 'live'

      if (event.live !== expectedLive) {
        throw new ProviderError(
          'mode_mismatch',
          `Moyasar sent a ${event.live ? 'live' : 'test'} event to a ` +
            `${input.mode} account.`,
        )
      }
    }

    // Card authentication events carry a card_auth, not a payment, and
    // move no money. Recognised and ignored rather than mis-parsed.
    if (!isPaymentEvent(event.type)) return []

    const payment = event.data

    if (!payment || typeof payment !== 'object') return []

    const facts = factsFromPayment({ accountId: input.accountId, payment })

    if (facts.length > 0) return facts

    /*
     * The embedded fallback.
     *
     * `factsFromPayment` correlates on `invoice_id`, and a payment the
     * **Moyasar Payment Form** created in the browser has none — nothing
     * created an invoice, the form created the payment directly. Every
     * webhook for the embedded checkout was therefore dropped with zero
     * facts: verified in this deployment's own `webhook_events`, where 23
     * signature-verified `payment_paid` / `payment_failed` callbacks were
     * recorded `status = ignored, fact_count = 0`.
     *
     * That left the embedded flow able to settle only through the
     * customer's own browser calling `/confirm`. A payer who closed the
     * tab, went Back out of the 3DS challenge, or lost connectivity left
     * a checkout that nothing could ever resolve — which is exactly the
     * "جارٍ معالجة الدفع" screen that never ends.
     *
     * `factsFromEmbeddedPayment` is the mapping that already exists for
     * this shape (it is what `fetchStatus` uses for a `client_sdk`
     * attempt): the payment's own id is the reference and
     * `metadata.intent_id` is the correlation. Reached only when the
     * invoice-based mapping produced nothing, so the invoice flow is
     * bit-for-bit unchanged.
     */
    return factsFromEmbeddedPayment({ accountId: input.accountId, payment })
  }

  /**
   * The callback's identity, for dedupe and audit.
   *
   * Moyasar supplies both parts itself — "id: The event's unique ID" and
   * "type: The type of the event" — so unlike Paymob nothing has to be
   * synthesised. The id is per *event*, not per payment, so a later
   * refund of the same payment is a distinct delivery and is not
   * mistaken for a redelivery.
   *
   * ⚠️ Reads an unverified body. Only safe after parseWebhook has passed,
   * which is the only place ingestion calls it.
   */
  describeWebhook(input: { rawBody: Buffer }): WebhookDescriptor | null {
    let event: MoyasarWebhookEvent

    try {
      event = JSON.parse(input.rawBody.toString('utf8')) as MoyasarWebhookEvent
    } catch {
      return null
    }

    if (typeof event !== 'object' || event === null) return null

    const id = typeof event.id === 'string' ? event.id : ''
    if (id.length === 0) return null

    return {
      eventId: id,
      eventType: typeof event.type === 'string' ? event.type : 'unknown',
      recognised: isRecognisedEvent(event.type),
    }
  }

  /* ---------------------------------------------------------------- */
  /* Refund                                                            */
  /* ---------------------------------------------------------------- */

  async refund(input: RefundInput): Promise<ObservedFact[]> {
    const secretKey = this.requireSecretKey(input.credentials)

    const paymentId = (input.gatewayPaymentId ?? '').trim()

    if (paymentId.length === 0) {
      // Before a webhook or a status poll there is no Moyasar payment to
      // refund. Sending the invoice id in its place would have Moyasar
      // reject it — or, worse, act on a different record.
      throw new ProviderError(
        'configuration_error',
        'This payment has no Moyasar payment id yet, so it cannot be refunded. ' +
          "It is recorded when Moyasar's callback arrives.",
      )
    }

    const payment = (await this.call({
      method: 'POST',
      path: PATHS.refund(paymentId),
      apiKey: secretKey,
      // "If this field is missing, then the full amount will be
      // refunded" — we always send it, because our caller has already
      // decided the amount and a silent full refund would move more of
      // the merchant's money than they asked for.
      body: { amount: Number(input.amountMinor) },
      operation: 'refund',
    })) as MoyasarPayment

    return factsFromPayment({
      accountId: input.accountId,
      // The refund response is the payment object, but it does not
      // always echo invoice_id; the caller's reference is authoritative.
      payment: { ...payment, invoice_id: input.gatewayReference },
    })
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * One request, with the error taxonomy applied on the way out.
   *
   * Every Moyasar call goes through here so no call site has to remember
   * to map a status, and so a transport failure becomes a ProviderError
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
        url: `${MOYASAR_BASE_URL}${input.path}`,
        apiKey: input.apiKey,
        body: input.body,
      })
    } catch (error) {
      // Transport, not Moyasar: DNS, TLS, socket, abort. Retryable, and
      // deliberately not reported as a decline.
      const message = error instanceof Error ? error.message : 'request failed'

      this.logger.warn(`Moyasar ${input.operation} could not be sent: ${message}`)

      throw new ProviderError(
        'provider_timeout',
        `Moyasar could not be reached (${input.operation}).`,
        message.slice(0, 300),
      )
    }

    if (response.status >= 200 && response.status < 300) {
      return response.body
    }

    const code = mapMoyasarError({ status: response.status, body: response.body })
    const text = moyasarErrorText({ status: response.status, body: response.body })

    // The message carries only Moyasar's own error text: the request
    // body holds customer data and the key is in the auth header.
    this.logger.warn(`Moyasar ${input.operation} failed (${code}): ${text}`)

    throw new ProviderError(code, text)
  }

  private requireSecretKey(
    credentials: Readonly<Record<string, string>>,
  ): string {
    const key = (credentials.secret_key ?? '').trim()

    if (key.length === 0) {
      throw new ProviderError(
        'configuration_error',
        'Moyasar is not configured for this store: secret key is missing.',
      )
    }

    return key
  }

  /**
   * Whether a key belongs to the mode the account is configured for.
   *
   * An unrecognised shape is not rejected — only an unambiguous
   * contradiction is worth failing on, and Moyasar is free to mint a key
   * format we have not seen.
   */
  private matchesMode(key: string, mode: Mode): boolean {
    const own = mode === 'live' ? 'sk_live_' : 'sk_test_'
    const other = mode === 'live' ? 'sk_test_' : 'sk_live_'

    if (key.startsWith(other)) return false
    if (key.startsWith(own)) return true

    return true
  }

  /** Constant-time comparison; a length mismatch is simply a mismatch. */
  private secretMatches(received: string, expected: string): boolean {
    if (received.length === 0 || expected.length === 0) return false

    const a = Buffer.from(received, 'utf8')
    const b = Buffer.from(expected, 'utf8')

    if (a.length !== b.length) return false

    return timingSafeEqual(a, b)
  }

  private readString(body: unknown, key: string): string | null {
    if (typeof body !== 'object' || body === null) return null

    const value = (body as Record<string, unknown>)[key]

    return typeof value === 'string' && value.length > 0 ? value : null
  }
}

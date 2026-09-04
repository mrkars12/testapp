import type {
  CaptureMode,
  CommitmentKind,
  Mode,
  PaymentMethodKey,
} from '@prisma/client'

/**
 * ==================================================================
 * Provider contract types
 * ==================================================================
 *
 * Pure types and small helpers. No Nest, no Prisma client, no I/O, so
 * every taxonomy here is unit-testable on its own.
 *
 * Two taxonomies do most of the work:
 *
 *   PaymentErrorCode  - every adapter maps its provider's raw error
 *                       strings into this closed set. Retry policy,
 *                       failover and customer messaging all key off it,
 *                       so nothing downstream ever string-matches a
 *                       provider code.
 *
 *   ObservedFactType  - every adapter maps its provider's events into
 *                       this closed set, so orchestration never sees a
 *                       provider-specific event name.
 */

/* ---------------------------------------------------------------- */
/* Errors                                                            */
/* ---------------------------------------------------------------- */

/**
 * The closed set, as a value.
 *
 * Declared once and derived into the type, rather than a union written
 * out in one place and a `readonly PaymentErrorCode[]` list written out
 * again in the conformance suite. Two hand-maintained copies of a closed
 * taxonomy drift, and the drift is only noticed when an unmapped code
 * reaches the orchestrator.
 */
export const PAYMENT_ERROR_CODES = [
  'declined_insufficient_funds',
  'declined_do_not_honor',
  'declined_card_invalid',
  'declined_risk',
  'authentication_required',
  'authentication_failed',
  'amount_limit',
  'currency_unsupported',
  'method_unavailable',
  'duplicate_request',
  'provider_unavailable',
  'provider_timeout',
  'rate_limited',
  'configuration_error',
  'mode_mismatch',
  'unknown',
] as const

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number]

export function isPaymentErrorCode(value: unknown): value is PaymentErrorCode {
  return (
    typeof value === 'string' &&
    (PAYMENT_ERROR_CODES as readonly string[]).includes(value)
  )
}

/**
 * Merchant/customer-safe sentence for a `PaymentErrorCode`.
 *
 * The one place a code is ever turned into user-facing text. Nothing else
 * should linearize a code into a message, and nothing should ever show the
 * bare code (or the literal string `unknown`) as the primary sentence — a
 * code that fails to map to anything more specific still gets a real
 * sentence here, never the taxonomy's own catch-all name.
 */
const SAFE_FAILURE_MESSAGE: Readonly<Record<PaymentErrorCode, string>> = {
  declined_insufficient_funds: 'تم رفض العملية: الرصيد غير كافٍ.',
  declined_do_not_honor: 'تم رفض العملية من البنك المُصدر للبطاقة.',
  declined_card_invalid: 'بيانات البطاقة غير صحيحة أو منتهية الصلاحية.',
  declined_risk: 'تم رفض العملية لأسباب أمنية من البنك المُصدر.',
  authentication_required: 'العملية تحتاج تأكيد إضافي (3D Secure) لم يكتمل.',
  authentication_failed: 'فشل التحقق من هوية حامل البطاقة.',
  amount_limit: 'المبلغ يتجاوز الحد المسموح به لهذه البطاقة أو الحساب.',
  currency_unsupported: 'العملة غير مدعومة لهذه البوابة.',
  method_unavailable: 'وسيلة الدفع غير متاحة حالياً.',
  duplicate_request: 'تم رصد محاولة دفع مكررة لنفس العملية.',
  provider_unavailable: 'تعذر الوصول إلى بوابة الدفع، يرجى المحاولة لاحقاً.',
  provider_timeout: 'انتهت مهلة الاتصال ببوابة الدفع.',
  rate_limited: 'عدد كبير من المحاولات في وقت قصير، يرجى المحاولة لاحقاً.',
  configuration_error: 'هناك خطأ في إعدادات بوابة الدفع لدى التاجر.',
  mode_mismatch: 'عدم تطابق بين وضع الاختبار والوضع الفعلي لبوابة الدفع.',
  unknown: 'تعذر إكمال عملية الدفع.',
}

export function safeFailureMessage(code: PaymentErrorCode): string {
  return SAFE_FAILURE_MESSAGE[code] ?? SAFE_FAILURE_MESSAGE.unknown
}

/**
 * Codes worth retrying with the same provider.
 *
 * A decline is not retryable: the card said no and asking again just
 * annoys the issuer. Transport problems are.
 */
const RETRYABLE: ReadonlySet<PaymentErrorCode> = new Set<PaymentErrorCode>([
  'provider_unavailable',
  'provider_timeout',
  'rate_limited',
])

/** Codes that should trigger failover to another account, if configured. */
const FAILOVER: ReadonlySet<PaymentErrorCode> = new Set<PaymentErrorCode>([
  'provider_unavailable',
  'provider_timeout',
  'configuration_error',
])

export function isRetryable(code: PaymentErrorCode): boolean {
  return RETRYABLE.has(code)
}

export function shouldFailover(code: PaymentErrorCode): boolean {
  return FAILOVER.has(code)
}

/** Whether the customer can fix it by trying a different instrument. */
export function isCustomerActionable(code: PaymentErrorCode): boolean {
  return (
    code === 'declined_insufficient_funds' ||
    code === 'declined_do_not_honor' ||
    code === 'declined_card_invalid' ||
    code === 'authentication_failed' ||
    code === 'amount_limit'
  )
}

/**
 * The whole of what core code is allowed to know about a failure.
 *
 * Services branch on these four fields and nothing else — never on a
 * provider's own error string, never on the gateway key. An adapter's
 * taxonomy stays inside the adapter; this is what crosses the boundary.
 */
export interface PaymentErrorClassification {
  readonly code: PaymentErrorCode
  readonly retryable: boolean
  readonly customerActionable: boolean
  readonly failover: boolean
}

export function classifyPaymentError(
  code: PaymentErrorCode,
): PaymentErrorClassification {
  return {
    code,
    retryable: isRetryable(code),
    customerActionable: isCustomerActionable(code),
    failover: shouldFailover(code),
  }
}

export class ProviderError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
    readonly raw?: string,
  ) {
    super(message)
    this.name = 'ProviderError'
    Object.setPrototypeOf(this, ProviderError.prototype)
  }
}

/**
 * Turns anything an adapter threw into a ProviderError.
 *
 * Adapters are expected to map their own taxonomy and throw
 * ProviderError themselves; this is the backstop for the ones that let
 * a transport exception escape. Without it a driver-level `TypeError`
 * reaches orchestration as an unclassifiable failure and is retried, or
 * not, by accident.
 *
 * The raw message is kept on `raw`, never promoted into `code`: only the
 * closed taxonomy crosses the boundary.
 */
export function normalizeProviderError(
  error: unknown,
  fallback: PaymentErrorCode = 'unknown',
): ProviderError {
  if (error instanceof ProviderError) return error

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Provider call failed.'

  return new ProviderError(fallback, message, message.slice(0, 500))
}

/* ---------------------------------------------------------------- */
/* Gateway references                                                */
/* ---------------------------------------------------------------- */

/**
 * Identifiers a provider hands back.
 *
 * Scoped to the account, never to the gateway: two stores sharing one
 * provider account can legitimately produce the same reference.
 */
export interface GatewayRefs {
  readonly gatewayReference?: string
  readonly gatewayPaymentId?: string
  readonly gatewayCaptureRef?: string
  readonly gatewayCustomerId?: string
}

/* ---------------------------------------------------------------- */
/* Next action                                                       */
/* ---------------------------------------------------------------- */

/**
 * What the customer must do next.
 *
 * Deliberately not "a redirect URL or nothing". Kiosk methods return a
 * reference code the customer takes to a counter, and manual bank
 * transfer returns account details. Modelling only redirects would
 * exclude a third of the target providers.
 */
export type NextAction =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'redirect'
      readonly url: string
      readonly method: 'GET' | 'POST'
      readonly formFields?: Readonly<Record<string, string>>
    }
  | { readonly kind: 'iframe'; readonly url: string }
  | {
      /**
       * The provider's own payment UI, mounted inside our checkout.
       *
       * `clientSecret` is optional because not every provider has one:
       * Stripe's Elements are driven by a per-payment client secret,
       * while Moyasar's form is driven by a publishable key plus the
       * payment's parameters and creates the payment itself. A shape
       * that demanded a client secret could only ever describe the
       * first kind.
       *
       * Everything in here reaches the browser. Only values the
       * provider publishes as client-safe may be put in it — a
       * publishable key is designed to be shipped to a browser; a
       * secret key never is. `config` is deliberately a flat record of
       * such values rather than the credential map, so no adapter can
       * pass its credentials through by accident.
       */
      readonly kind: 'client_sdk'
      readonly clientSecret?: string
      readonly publishableKey?: string
      readonly config?: Readonly<Record<string, unknown>>
      readonly sdkHints?: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'reference_code'
      readonly code: string
      readonly expiresAt?: Date
      readonly instructions?: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'bank_instructions'
      readonly fields: Readonly<Record<string, unknown>>
    }
  | { readonly kind: 'poll'; readonly pollAfterSeconds: number }

export type NextActionKindName = NextAction['kind']

/** Maps a next action onto the NextActionKind enum stored on the attempt. */
export function nextActionKindName(action: NextAction): NextActionKindName {
  return action.kind
}

/** Storable payload for the attempt row. Never includes secrets. */
export function nextActionPayload(
  action: NextAction,
): Record<string, unknown> | null {
  switch (action.kind) {
    case 'none':
      return null
    case 'redirect':
      return {
        url: action.url,
        method: action.method,
        form_fields: action.formFields ?? null,
      }
    case 'iframe':
      return { url: action.url }
    case 'client_sdk':
      return {
        client_secret: action.clientSecret ?? null,
        publishable_key: action.publishableKey ?? null,
        config: action.config ?? null,
        sdk_hints: action.sdkHints ?? null,
      }
    case 'reference_code':
      return {
        code: action.code,
        expires_at: action.expiresAt ? action.expiresAt.toISOString() : null,
        instructions: action.instructions ?? null,
      }
    case 'bank_instructions':
      return { ...action.fields }
    case 'poll':
      return { poll_after_seconds: action.pollAfterSeconds }
  }
}

/* ---------------------------------------------------------------- */
/* Initialize result                                                 */
/* ---------------------------------------------------------------- */

export type InitializeResult =
  | {
      readonly kind: 'requires_action'
      readonly nextAction: NextAction
      readonly refs?: GatewayRefs
      readonly expiresAt?: Date
    }
  | {
      readonly kind: 'authorized'
      readonly authorizedAmountMinor: bigint
      readonly refs?: GatewayRefs
    }
  | {
      readonly kind: 'succeeded'
      readonly capturedAmountMinor: bigint
      readonly refs?: GatewayRefs
    }
  | {
      readonly kind: 'pending'
      readonly pollAfterSeconds: number
      readonly refs?: GatewayRefs
    }
  /** No provider call happened: cash on delivery, manual bank transfer. */
  | {
      readonly kind: 'no_gateway'
      readonly commitmentKind: CommitmentKind
      readonly nextAction?: NextAction
    }
  | {
      readonly kind: 'failed'
      readonly errorCode: PaymentErrorCode
      readonly raw?: string
    }

/* ---------------------------------------------------------------- */
/* Observed facts                                                    */
/* ---------------------------------------------------------------- */

export type ObservedFactType =
  | 'attempt_authorized'
  | 'attempt_captured'
  | 'attempt_failed'
  | 'attempt_expired'
  | 'attempt_voided'
  | 'refund_succeeded'
  | 'refund_failed'
  | 'dispute_opened'
  | 'dispute_updated'
  /**
   * Closed with an outcome. Split into two types rather than one
   * `dispute_closed` carrying a status field, because won and lost post
   * opposite ledger entries and the taxonomy is what orchestration
   * switches on — the same reason refunds are succeeded/failed rather
   * than one type with a flag.
   */
  | 'dispute_won'
  | 'dispute_lost'
  /** Closed with no financial outcome, e.g. a withdrawn enquiry. */
  | 'dispute_closed'
  | 'settlement_line'

/**
 * A single fact about a payment, normalised.
 *
 * Webhooks, reconciliation sweeps and the customer's return from a
 * gateway all produce these. The dedupe key is derived from the content,
 * not from the transport, so the same fact arriving by three routes
 * collapses to one application.
 */
export interface ObservedFact {
  readonly dedupeKey: string
  readonly accountId: bigint
  readonly gatewayReference: string
  readonly factType: ObservedFactType
  /** Cumulative as the provider sees it, not a delta. */
  readonly cumulativeAmountMinor?: bigint
  readonly currency?: string
  readonly occurredAt?: Date
  readonly providerSequence?: number
  readonly refs?: GatewayRefs
  readonly rawRedacted?: Record<string, unknown>
  /**
   * Structured reason for an `attempt_failed` fact, when the adapter could
   * classify the provider's decline/error into the closed taxonomy. Unset
   * (not `'unknown'`) when the adapter has nothing to classify — the
   * applier keeps whatever code the attempt already has rather than
   * overwriting a real reason with a blank one.
   */
  readonly failureCode?: PaymentErrorCode
  /**
   * Our own `PaymentIntent.id` (stringified), when the adapter can read it
   * back from provider-held metadata. Every adapter's `initializePayment`
   * already sends this in the outbound call (`metadata: { intent_id: ... }`
   * — see e.g. stripe.adapter.ts) so the provider round-trips it on
   * whatever it sends back.
   *
   * This exists for one narrow case: a fact can arrive keyed on a
   * `gatewayReference` that doesn't match what's stored on the attempt
   * yet — not because anything is wrong, but because the reference a
   * provider settles on can be resolved *after* the attempt was created
   * under a provisional one (Stripe: the attempt is stored under the
   * Checkout Session id until the customer pays; the PaymentIntent id a
   * `payment_intent.*` webhook carries is a different, real reference
   * that can arrive before anything has resolved the two together). When
   * the primary `(accountId, gatewayReference)` lookup misses,
   * `PaymentFactApplier` falls back to this field to find the exact same
   * row by our own primary key instead of the provider's, and corrects
   * the stored reference in the same transaction — so every fact after
   * that, from either identifier, keeps working normally with zero
   * further special-casing.
   */
  readonly internalIntentRef?: string
}

/**
 * Content-derived dedupe key.
 *
 * Includes the cumulative amount so a "captured 40 of 100" fact and a
 * later "captured 100 of 100" fact are distinct, while the same fact
 * redelivered is identical.
 */
export function buildFactDedupeKey(input: {
  accountId: bigint
  gatewayReference: string
  factType: ObservedFactType
  cumulativeAmountMinor?: bigint
  currency?: string
}): string {
  return [
    'fact',
    input.accountId.toString(),
    input.gatewayReference,
    input.factType,
    input.cumulativeAmountMinor === undefined
      ? '-'
      : input.cumulativeAmountMinor.toString(),
    input.currency ?? '-',
  ].join(':')
}

/* ---------------------------------------------------------------- */
/* Capabilities                                                      */
/* ---------------------------------------------------------------- */

export type WebhookResolution = 'none' | 'endpoint_scoped' | 'payload_scoped'

/**
 * What an adapter can actually do.
 *
 * The orchestrator refuses impossible operations from this descriptor
 * before calling the adapter, so each adapter does not invent its own
 * "not supported" error.
 *
 * A capability matrix is only as good as its enforcement, which is why
 * the conformance suite asserts the declarations against behaviour.
 */
export interface GatewayCapabilities {
  readonly gateway: string
  readonly methods: readonly PaymentMethodKey[]
  /** 'all' means the adapter accepts whatever the account is set up for. */
  readonly currencies: readonly string[] | 'all'
  /**
   * Per-currency wire exponent, where the provider disagrees with ISO.
   * Empty means "use the ISO exponent from the currency registry".
   */
  readonly exponentOverrides: Readonly<Record<string, number>>
  /**
   * Money moves on authorisation, with no second call.
   *
   * Declared separately from `manualCapture` rather than inferred as
   * "not manual": a provider can support both, and one that supports
   * neither is offline. Inferring would make those two indistinguishable.
   */
  readonly automaticCapture: boolean
  readonly manualCapture: boolean
  readonly partialCapture: boolean
  readonly multiCapture: boolean
  /**
   * Refunds through the API at all, at the full captured amount.
   *
   * `partialRefund` used to carry both meanings, which left no way to
   * describe a provider that refunds only in full — the refund path
   * would refuse it outright and the merchant would be told to use the
   * dashboard for a refund the API could have made.
   */
  readonly refundSupported: boolean
  readonly partialRefund: boolean
  readonly voidSupported: boolean
  readonly authorizationExpiry: boolean
  readonly vaulting: boolean
  readonly merchantInitiated: boolean
  readonly threeDSecure: boolean
  readonly webhooks: boolean
  readonly statusPolling: boolean
  readonly settlementReports: boolean
  readonly webhookResolution: WebhookResolution
  /**
   * Which credential field holds the callback signing secret.
   *
   * Providers do not agree on a name: Stripe issues a "webhook signing
   * secret", Paymob an "HMAC secret", and a merchant copying either from
   * a dashboard should see the name their provider uses. Ingestion reads
   * this rather than assuming one spelling, so a provider whose secret is
   * called something else does not need a branch in core.
   *
   * Defaults to `webhook_secret` when omitted.
   */
  readonly webhookSecretField?: string
  /**
   * The customer-action kinds this adapter can return.
   *
   * A storefront has to know which of these it must be able to render
   * before the method is offered, and the conformance suite holds the
   * adapter to it: a next action of a kind not declared here fails the
   * contract rather than reaching a checkout that cannot display it.
   */
  readonly nextActionKinds: readonly NextActionKindName[]
  /** Commitment produced when no provider call takes place. */
  readonly offlineCommitmentKind: CommitmentKind | null
  /**
   * Credential keys an account must have configured before this adapter
   * can host its payment UI inside our checkout.
   *
   * Declaring `client_sdk` in `nextActionKinds` says the adapter *can*
   * run embedded; this says what a particular merchant's account needs
   * for it to actually work. Moyasar's form cannot start without a
   * publishable key, and that key is an optional per-account credential,
   * so two merchants on the same adapter legitimately differ.
   *
   * Only key *names* are ever compared against this — the values stay in
   * the backend. Empty or absent means "nothing extra required".
   */
  readonly embeddedCredentialKeys?: readonly string[]
  /**
   * The provider's own customer-facing forms, when one form hosts more
   * than one of our methods. See ProviderFormSpec below.
   *
   * Optional: an adapter that omits it is read as "every method is its
   * own payment experience", which is what every adapter did before
   * this field existed.
   */
  readonly providerForms?: readonly ProviderFormSpec[]
}

/**
 * ==================================================================
 * Provider forms
 * ==================================================================
 *
 * A **provider form** is one customer-facing payment surface that the
 * provider publishes, and it may host more than one of our methods.
 *
 * This exists because `PaymentMethodOffering` != payment experience.
 * An offering says what the *merchant* switched on; a form says what
 * the *payer* is actually going to see. Moyasar is the case that makes
 * the difference concrete: its Payment Form renders a single card
 * component whose `supported_networks` default is
 * `["amex","mada","visa","mastercard"]`, so a merchant with both a
 * `card` offering and a `mada` offering has enabled two networks of one
 * form — not two checkouts. Letting the database's granularity decide
 * the UI's granularity is what produced two radio buttons that mounted
 * a byte-identical form.
 *
 * Declared by the adapter, because the adapter is the only thing that
 * knows the provider's own integration contract. Absent means "one form
 * per method", which is the behaviour every other adapter already has
 * and keeps them untouched.
 *
 * The form names the **next-action kind** it produces rather than a
 * presentation mode of its own: presentation is already derived from
 * action kinds (payment-presentation.ts) and a second vocabulary here
 * would be a second source of the same truth.
 */
export interface ProviderFormSpec {
  /** Stable identifier, unique within the adapter. */
  readonly id: string
  /**
   * Our methods this one surface hosts.
   *
   * Every entry must also appear in `capabilities.methods`. A method may
   * be listed by more than one form only when every form but the last
   * makes it *conditional* through `methodCredentialKeys` — see there.
   */
  readonly methods: readonly PaymentMethodKey[]
  /** The customer action this form produces when it is available. */
  readonly nextActionKind: NextActionKindName
  /**
   * Credential key NAMES an account must have configured for this form
   * to be reachable at all. Same contract as `embeddedCredentialKeys`:
   * names only, never values.
   */
  readonly requiresCredentialKeys?: readonly string[]
  /**
   * Extra credential key NAMES a **particular method** needs before this
   * form will host it — the rest of the form is unaffected.
   *
   * This exists because a provider surface can host a method only when
   * the merchant has configured something extra for that one method.
   * Moyasar is the case: its Payment Form renders Apple Pay in the same
   * surface as the card component, but the form throws outright
   * ("Apple Pay label is required", "Validate Merchat URL is required
   * for Apple Pay") unless the Apple Pay options are present — which
   * would take the card form down with it. So Apple Pay is a *member*
   * of the embedded form for an account that configured it, and is left
   * to the next form that lists it for an account that did not.
   *
   * A method whose keys are unsatisfied is not dropped: it falls through
   * to the next form in `providerForms` order that hosts it. The last
   * form listing a method must therefore be unconditional, which is what
   * `capabilityContradictions` enforces.
   *
   * Names only, never values — the same rule as everywhere else here:
   * deciding how to present a method must never require decrypted
   * credentials to leave the part of the backend that owns them.
   */
  readonly methodCredentialKeys?: Readonly<
    Partial<Record<PaymentMethodKey, readonly string[]>>
  >
  /**
   * What the payer gets instead when `requiresCredentialKeys` is not
   * satisfied. Absent means the form simply is not offered.
   *
   * Moyasar's card form falls back to the hosted invoice for an account
   * with no publishable key, which is why this is not the same thing as
   * "unavailable".
   */
  readonly fallbackNextActionKind?: NextActionKindName
}

/**
 * Whether this form hosts `method` for an account with these credential
 * key names configured.
 *
 * Unconditional membership is the common case; `methodCredentialKeys`
 * is what makes a single method's membership account-dependent.
 */
export function formHostsMethod(
  form: ProviderFormSpec,
  method: PaymentMethodKey,
  configuredCredentialKeys: readonly string[],
): boolean {
  if (!form.methods.includes(method)) return false

  const required = form.methodCredentialKeys?.[method]
  if (!required || required.length === 0) return true

  return required.every((key) => configuredCredentialKeys.includes(key))
}

/**
 * The action kind this form will actually produce for an account with
 * these credential key names configured, or `null` when the form is not
 * reachable for that account at all.
 */
export function formNextActionKind(
  form: ProviderFormSpec,
  configuredCredentialKeys: readonly string[],
): NextActionKindName | null {
  const required = form.requiresCredentialKeys ?? []
  const satisfied = required.every((key) =>
    configuredCredentialKeys.includes(key),
  )

  if (satisfied) return form.nextActionKind
  return form.fallbackNextActionKind ?? null
}

/**
 * The form hosting a method for this account, or `undefined` for an
 * adapter that declares none — in which case the method is its own
 * experience.
 *
 * First match in declaration order wins, so an adapter orders its forms
 * best-surface-first and the conditional members fall through to the
 * unconditional fallback surface on their own.
 */
export function providerFormFor(
  capabilities: GatewayCapabilities,
  method: PaymentMethodKey,
  configuredCredentialKeys: readonly string[] = [],
): ProviderFormSpec | undefined {
  return capabilities.providerForms?.find((form) =>
    formHostsMethod(form, method, configuredCredentialKeys),
  )
}

/**
 * Whether this adapter can run embedded for an account that has the
 * given credentials configured.
 *
 * Takes the configured key **names**, never the values: deciding how to
 * present a payment method must never require decrypted credentials to
 * leave the part of the backend that owns them.
 */
export function embeddedAvailable(
  capabilities: GatewayCapabilities,
  configuredCredentialKeys: readonly string[],
): boolean {
  if (!capabilities.nextActionKinds.includes('client_sdk')) return false

  const required = capabilities.embeddedCredentialKeys ?? []
  return required.every((key) => configuredCredentialKeys.includes(key))
}

/** True when the adapter settles outside any provider (COD, bank transfer). */
export function isOfflineGateway(capabilities: GatewayCapabilities): boolean {
  return capabilities.offlineCommitmentKind !== null
}

/**
 * Every rule the capability descriptor must obey, in one place.
 *
 * Returns the problems rather than throwing, so the same function can
 * fail a boot (registry), fail a test (conformance) and describe a
 * would-be provider in a diagnostic. Rules that reference an adapter's
 * *methods* live in the registry; these are the ones a descriptor can
 * contradict on its own.
 */
export function capabilityContradictions(
  capabilities: GatewayCapabilities,
): string[] {
  const problems: string[] = []
  const c = capabilities

  if (c.methods.length === 0) {
    problems.push('declares no supported methods')
  }

  if (c.partialCapture && !c.manualCapture) {
    problems.push('declares partialCapture without manualCapture')
  }

  if (c.multiCapture && !c.manualCapture) {
    problems.push('declares multiCapture without manualCapture')
  }

  if (c.partialRefund && !c.refundSupported) {
    problems.push('declares partialRefund without refundSupported')
  }

  if (c.webhooks && c.webhookResolution === 'none') {
    problems.push('declares webhooks but no resolution strategy')
  }

  if (!c.webhooks && c.webhookResolution !== 'none') {
    problems.push(
      `declares webhookResolution "${c.webhookResolution}" without webhooks`,
    )
  }

  if (isOfflineGateway(c)) {
    // There is no provider behind an offline method, so there is nothing
    // to capture, void, refund, poll or call back.
    for (const [flag, value] of [
      ['automaticCapture', c.automaticCapture],
      ['manualCapture', c.manualCapture],
      ['voidSupported', c.voidSupported],
      ['refundSupported', c.refundSupported],
      ['webhooks', c.webhooks],
      ['statusPolling', c.statusPolling],
      ['threeDSecure', c.threeDSecure],
    ] as const) {
      if (value) problems.push(`settles offline but declares ${flag}`)
    }
  } else if (!c.automaticCapture && !c.manualCapture) {
    // Online and unable to take money either way describes an adapter
    // that can start a payment it can never complete.
    problems.push('declares neither automaticCapture nor manualCapture')
  }

  // Provider forms describe the same adapter from the payer's side, so
  // they must agree with what it already declared. A form naming a
  // method the adapter does not support, or an action kind it cannot
  // emit, is a descriptor contradicting itself — and the checkout would
  // publish that contradiction to a customer as a payment experience
  // that cannot start.
  const forms = c.providerForms ?? []
  const seen = new Set<PaymentMethodKey>()
  /** Methods already claimed *unconditionally* — nothing may follow one. */
  const claimedOutright = new Set<PaymentMethodKey>()

  for (const form of forms) {
    if (form.methods.length === 0) {
      problems.push(`provider form "${form.id}" hosts no methods`)
    }

    for (const method of form.methods) {
      if (!c.methods.includes(method)) {
        problems.push(
          `provider form "${form.id}" hosts unsupported method "${method}"`,
        )
      }

      // A method may repeat across forms only as a *conditional* member
      // that falls through to a later surface. An unconditional listing
      // is final: anything after it is unreachable, and a form that
      // could never be chosen is exactly the kind of contradiction this
      // function exists to catch.
      const conditional = (form.methodCredentialKeys?.[method] ?? []).length > 0
      if (claimedOutright.has(method)) {
        problems.push(
          `method "${method}" appears in more than one form after an ` +
            'unconditional one',
        )
      }
      if (!conditional) claimedOutright.add(method)

      seen.add(method)
    }

    for (const method of Object.keys(
      form.methodCredentialKeys ?? {},
    ) as PaymentMethodKey[]) {
      if (!form.methods.includes(method)) {
        problems.push(
          `provider form "${form.id}" conditions method "${method}" ` +
            'it does not host',
        )
      }
    }

    for (const kind of [form.nextActionKind, form.fallbackNextActionKind]) {
      if (kind !== undefined && !c.nextActionKinds.includes(kind)) {
        problems.push(
          `provider form "${form.id}" declares action kind "${kind}" ` +
            'the adapter cannot emit',
        )
      }
    }
  }

  if (forms.length > 0) {
    // A partial mapping would leave some methods grouped and others not,
    // and nothing downstream could tell which rule applied to a given
    // offering. Either the adapter describes its surfaces or it does not.
    for (const method of c.methods) {
      if (!seen.has(method)) {
        problems.push(
          `declares provider forms but method "${method}" belongs to none`,
        )
      } else if (!claimedOutright.has(method)) {
        // Every listing of it was conditional, so an account that
        // configured none of those extras would be offered the method in
        // settings and then find no surface for it at checkout.
        problems.push(
          `method "${method}" is conditional in every form; it needs an ` +
            'unconditional surface to fall back to',
        )
      }
    }
  }

  return problems
}

/** The credential key holding the callback signing secret. */
export function webhookSecretField(capabilities: GatewayCapabilities): string {
  return capabilities.webhookSecretField ?? 'webhook_secret'
}

export function supportsMethod(
  capabilities: GatewayCapabilities,
  method: PaymentMethodKey,
): boolean {
  return capabilities.methods.includes(method)
}

export function supportsCurrency(
  capabilities: GatewayCapabilities,
  currency: string,
): boolean {
  if (capabilities.currencies === 'all') return true
  return capabilities.currencies.includes(currency.trim().toUpperCase())
}

/* ---------------------------------------------------------------- */
/* Operations                                                        */
/* ---------------------------------------------------------------- */

/**
 * The provider-facing operations the lifecycle is made of.
 *
 * Named so idempotency keys, conformance cases and diagnostics all use
 * one spelling. `status` and `webhook` are inbound rather than outbound,
 * and carry no idempotency key of their own — inbound duplication is
 * settled by fact dedupe, not by a key we send.
 */
export const PAYMENT_OPERATIONS = [
  'initialize',
  'capture',
  'void',
  'refund',
  'status',
  'webhook',
] as const

export type PaymentOperation = (typeof PAYMENT_OPERATIONS)[number]

/** Operations that carry an outbound idempotency key. */
export const IDEMPOTENT_OPERATIONS: readonly PaymentOperation[] = [
  'initialize',
  'capture',
  'void',
  'refund',
]

/* ---------------------------------------------------------------- */
/* Call context                                                      */
/* ---------------------------------------------------------------- */

/**
 * Everything an adapter needs for one call.
 *
 * Credentials are passed in already decrypted. Adapters never touch the
 * credential store, which keeps the encryption path in one place and
 * stops each adapter from becoming a second way to read secrets.
 */
export interface PaymentCallContext {
  readonly storeId: bigint
  readonly mode: Mode
  readonly accountId: bigint
  readonly offeringId: bigint
  readonly method: PaymentMethodKey
  readonly gatewayMethodConfig: string
  readonly intentId: bigint
  readonly attemptId: bigint | null
  readonly attemptSequence: number
  readonly amountMinor: bigint
  readonly currency: string
  readonly credentials: Readonly<Record<string, string>>
  /**
   * The merchant's configured capture mode for this offering.
   *
   * `manual` means authorise now and capture later, so the adapter must
   * tell the provider not to take the money on authorisation. Omitted
   * means `automatic`: adapters that cannot separate the two ignore it.
   */
  readonly captureMethod?: CaptureMode
  /**
   * The deterministic key for this outbound call.
   *
   * Supplied by core so the key the attempt row records and the key the
   * provider receives are provably the same value, rather than two
   * derivations that agree until one of them changes. Adapters that
   * predate it fall back to deriving their own, which produces the same
   * string.
   */
  readonly idempotencyKey?: string
  /** Shown on the customer's statement where the provider supports it. */
  readonly statementDescriptor?: string
  readonly returnUrl?: string
  /**
   * The next-action kinds the SURFACE making this call can actually
   * host.
   *
   * An adapter that can offer more than one shape of customer action
   * must not pick one the caller has no way to render. The storefront
   * checkout mounts a provider's in-page form, so it can host
   * `client_sdk`; the merchant Test Payment tool is a settings screen
   * that can only hand its tab to a URL, so it cannot — and an adapter
   * that answered `client_sdk` there produced an attempt nothing could
   * advance, which is exactly the bug this field exists to prevent.
   *
   * Omitted means "no constraint", which keeps every existing caller and
   * the conformance suite answering for the adapter in the abstract.
   */
  readonly hostableNextActionKinds?: readonly NextActionKindName[]
  /**
   * Every method the provider FORM this payment is being made through
   * hosts — the sibling offerings the merchant also has enabled on the
   * same surface, `method` included.
   *
   * A form can host several of our methods (see ProviderFormSpec), and
   * the provider often wants that set spelled out: Moyasar's card
   * component takes `supported_networks`, so a merchant who enabled
   * `card` but not `mada` should get a form that does not advertise
   * mada. Without this the adapter can only see the one representative
   * method and has to fall back to the provider's default set.
   *
   * Omitted means "the caller does not group offerings", and an adapter
   * must then behave exactly as it did before this field existed.
   */
  readonly formMethods?: readonly PaymentMethodKey[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Deterministic idempotency key for an outbound provider call.
 *
 * Derived, never random: a retry must send the same key or the provider
 * treats it as a new charge. That is the single most common way
 * idempotency is implemented wrongly.
 */
export function pspIdempotencyKey(input: {
  storeId: bigint
  intentId: bigint
  attemptSequence: number
  operation: PaymentOperation | string
}): string {
  return [
    'psp',
    input.storeId.toString(),
    input.intentId.toString(),
    String(input.attemptSequence),
    input.operation,
  ].join(':')
}

/**
 * The same key, derived from a call context.
 *
 * Exists so an adapter never has to re-implement the derivation
 * privately — which is how the sent key and the recorded key come to
 * disagree.
 */
export function callContextIdempotencyKey(
  context: PaymentCallContext,
  operation: PaymentOperation,
): string {
  return (
    context.idempotencyKey ??
    pspIdempotencyKey({
      storeId: context.storeId,
      intentId: context.intentId,
      attemptSequence: context.attemptSequence,
      operation,
    })
  )
}

export interface ValidateCredentialsInput {
  readonly credentials: Readonly<Record<string, string>>
  readonly mode: Mode
}

export interface CredentialValidationResult {
  readonly valid: boolean
  readonly errorCode?: PaymentErrorCode
  readonly message?: string
}

export interface FetchStatusInput {
  readonly accountId: bigint
  readonly gatewayReference: string
  readonly credentials: Readonly<Record<string, string>>
  readonly mode: Mode
  /**
   * Which next action produced the attempt this reference belongs to.
   *
   * One adapter can hold references to two different provider resources.
   * Moyasar is the live example: a redirect attempt's reference is an
   * **invoice** id, and an embedded attempt's is a **payment** id, and
   * the two are indistinguishable as strings. Core cannot name provider
   * resources, so it passes the only thing it legitimately knows — its
   * own next-action vocabulary — and the adapter maps that to whichever
   * of its endpoints applies.
   *
   * Optional, and adapters that hold exactly one kind of reference
   * ignore it, so nothing that predates this changes behaviour.
   */
  readonly referenceKind?: NextActionKindName
}

export interface ParseWebhookInput {
  readonly accountId: bigint
  readonly rawBody: Buffer
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  /**
   * The callback URL's query string.
   *
   * Not every provider signs in a header. Paymob delivers the HMAC of a
   * server-to-server callback as a `hmac` query parameter, so an adapter
   * that only ever sees headers could not verify one. Kept separate from
   * `headers` because it is separately attacker-controlled and separately
   * unverified until the adapter says otherwise.
   */
  readonly query: Readonly<Record<string, string | string[] | undefined>>
  readonly signingSecret: string
  readonly mode: Mode
}

/**
 * The provider's own identity for a callback.
 *
 * `recognised` says whether the mapper knows this event type at all, so
 * an event nobody handles is filed as "recognised but not acted on"
 * rather than as an unknown one — the difference matters when deciding
 * whether silence is expected or a gap.
 */
export interface WebhookDescriptor {
  readonly eventId: string
  readonly eventType: string
  readonly recognised: boolean
}

export interface RefundInput {
  readonly accountId: bigint
  readonly gatewayReference: string
  /**
   * The provider's identifier for the payment itself, where it differs
   * from the reference we match facts on.
   *
   * Stripe's are the same value. Paymob's are not: facts correlate on the
   * Paymob *order* id, which exists from the moment the intention is
   * created, while its capture, void and refund APIs key on the
   * *transaction* id, which only exists once a customer has paid. Null
   * until a callback or a status poll has told us one.
   */
  readonly gatewayPaymentId: string | null
  readonly gatewayCaptureRef: string | null
  readonly amountMinor: bigint
  readonly currency: string
  readonly reason?: string
  readonly credentials: Readonly<Record<string, string>>
  readonly idempotencyKey: string
  readonly mode: Mode
}

export interface CaptureInput {
  readonly accountId: bigint
  readonly gatewayReference: string
  /** See RefundInput.gatewayPaymentId. */
  readonly gatewayPaymentId: string | null
  readonly amountMinor: bigint
  readonly currency: string
  readonly credentials: Readonly<Record<string, string>>
  readonly idempotencyKey: string
  readonly mode: Mode
}

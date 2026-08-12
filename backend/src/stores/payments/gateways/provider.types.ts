import type { CommitmentKind, Mode, PaymentMethodKey } from '@prisma/client'

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

export type PaymentErrorCode =
  | 'declined_insufficient_funds'
  | 'declined_do_not_honor'
  | 'declined_card_invalid'
  | 'declined_risk'
  | 'authentication_required'
  | 'authentication_failed'
  | 'amount_limit'
  | 'currency_unsupported'
  | 'method_unavailable'
  | 'duplicate_request'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'rate_limited'
  | 'configuration_error'
  | 'mode_mismatch'
  | 'unknown'

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
      readonly kind: 'client_sdk'
      readonly clientSecret: string
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
        client_secret: action.clientSecret,
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
  readonly manualCapture: boolean
  readonly partialCapture: boolean
  readonly multiCapture: boolean
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
  /** Commitment produced when no provider call takes place. */
  readonly offlineCommitmentKind: CommitmentKind | null
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
  /** Shown on the customer's statement where the provider supports it. */
  readonly statementDescriptor?: string
  readonly returnUrl?: string
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
  operation: string
}): string {
  return [
    'psp',
    input.storeId.toString(),
    input.intentId.toString(),
    String(input.attemptSequence),
    input.operation,
  ].join(':')
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
}

export interface ParseWebhookInput {
  readonly accountId: bigint
  readonly rawBody: Buffer
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly signingSecret: string
  readonly mode: Mode
}

export interface RefundInput {
  readonly accountId: bigint
  readonly gatewayReference: string
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
  readonly amountMinor: bigint
  readonly currency: string
  readonly credentials: Readonly<Record<string, string>>
  readonly idempotencyKey: string
  readonly mode: Mode
}

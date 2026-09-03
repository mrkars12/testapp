import type {
  CaptureInput,
  CredentialValidationResult,
  FetchStatusInput,
  GatewayCapabilities,
  InitializeResult,
  ObservedFact,
  ParseWebhookInput,
  PaymentCallContext,
  PaymentOperation,
  RefundInput,
  ValidateCredentialsInput,
  WebhookDescriptor,
} from './provider.types'
import type { WebhookAccountRef } from './webhook-resolution'

/**
 * The contract every gateway adapter implements.
 *
 * Optional members are gated by the capability descriptor: the
 * orchestrator checks `capabilities` before calling, so an adapter never
 * has to invent its own "not supported" error. The registry refuses at
 * boot any adapter that declares a capability without the method behind
 * it, so the gating is a fact rather than a convention.
 *
 * `fetchStatus` is deliberately NOT optional. It is what makes the
 * system correct when webhooks are lost, and it is the single most
 * commonly skipped method in payment integrations.
 *
 * Adding a provider is: implement this interface, list the class in
 * `gateways.module.ts`, add a conformance case. No core service learns
 * the provider's name.
 */
export interface IPaymentProvider {
  readonly capabilities: GatewayCapabilities

  /** Test call made when a merchant saves credentials. */
  validateCredentials(
    input: ValidateCredentialsInput,
  ): Promise<CredentialValidationResult>

  /** Starts an attempt. */
  initializePayment(context: PaymentCallContext): Promise<InitializeResult>

  /**
   * Authoritative status straight from the provider.
   *
   * Used by reconciliation, by the customer's return from a redirect,
   * and by the invariant checker. Never optional.
   */
  fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]>

  /* ---------------------------------------------------------------- */
  /* Webhook hooks                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Verifies the signature and maps the callback into normalised facts.
   *
   * Verification and mapping are one method on purpose: a body that has
   * not been verified must never be mapped, and separating them creates
   * a mapper somebody can call on unverified bytes.
   *
   * Required when capabilities.webhooks is true.
   */
  parseWebhook?(input: ParseWebhookInput): Promise<ObservedFact[]>

  /**
   * The provider's own identity for this callback: its event id and type.
   *
   * Separate from parseWebhook because it answers a different question —
   * "which event is this" for deduplication and audit, rather than "what
   * changed". Returns null when the body carries no recognisable
   * envelope.
   *
   * ⚠️ Does not verify anything. Callers must only use it on a body whose
   * signature has already passed, or they are trusting attacker input.
   */
  describeWebhook?(input: { rawBody: Buffer }): WebhookDescriptor | null

  /**
   * Which account a payload-scoped callback belongs to.
   *
   * Required when capabilities.webhookResolution is 'payload_scoped', and
   * meaningless otherwise — an endpoint-scoped provider is routed by the
   * URL, which needs no parsing at all.
   *
   * ⚠️ Runs on unverified bytes from an unauthenticated endpoint. It must
   * not throw, and what it returns selects *which signing secret to
   * verify against* — never which payment to move. Ingestion still
   * verifies afterwards, so a forged reference buys an attacker nothing
   * beyond choosing whose secret rejects them.
   */
  extractWebhookAccountRef?(input: {
    rawBody: Buffer
    headers: Readonly<Record<string, string | string[] | undefined>>
  }): WebhookAccountRef | null

  /* ---------------------------------------------------------------- */
  /* Operations                                                        */
  /* ---------------------------------------------------------------- */

  /** Required when capabilities.manualCapture is true. */
  capture?(input: CaptureInput): Promise<ObservedFact[]>

  /** Required when capabilities.voidSupported is true. */
  voidAuthorization?(input: {
    accountId: bigint
    gatewayReference: string
    /** See RefundInput.gatewayPaymentId. */
    gatewayPaymentId: string | null
    credentials: Readonly<Record<string, string>>
    idempotencyKey: string
    mode: 'test' | 'live'
  }): Promise<ObservedFact[]>

  /** Required when capabilities.refundSupported is true. */
  refund?(input: RefundInput): Promise<ObservedFact[]>

  /* ---------------------------------------------------------------- */
  /* Idempotency                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Reshapes the deterministic key core derived, where a provider must.
   *
   * Not a second idempotency system: the input is always the key core
   * already built and recorded, and the only legitimate reason to
   * implement this is a provider that rejects our key's length or
   * character set. It must stay a pure function of its input — a hash or
   * a truncation, never a fresh value — because a retry carrying a
   * different key is how a customer gets charged twice.
   */
  idempotencyKeyFor?(input: {
    base: string
    operation: PaymentOperation
  }): string
}

/** An adapter that has actually implemented the webhook side. */
export type WebhookCapableProvider = IPaymentProvider &
  Required<Pick<IPaymentProvider, 'parseWebhook'>>

/**
 * Narrows to the webhook hooks, declaration and implementation together.
 *
 * Ingestion asks this once instead of testing the flag and the method
 * separately at each use, which is where the two drift apart.
 */
export function isWebhookCapable(
  provider: IPaymentProvider,
): provider is WebhookCapableProvider {
  return (
    provider.capabilities.webhooks && typeof provider.parseWebhook === 'function'
  )
}

/**
 * The key to send outbound for one operation.
 *
 * Core calls this rather than the provider hook directly, so an adapter
 * that does not implement the hook — every adapter today — still gets
 * the derived key without a null check at each call site.
 */
export function outboundIdempotencyKey(
  provider: IPaymentProvider,
  input: { base: string; operation: PaymentOperation },
): string {
  return provider.idempotencyKeyFor
    ? provider.idempotencyKeyFor(input)
    : input.base
}

/** DI token: interfaces do not exist at runtime. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS')

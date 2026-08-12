import type {
  CaptureInput,
  CredentialValidationResult,
  FetchStatusInput,
  GatewayCapabilities,
  InitializeResult,
  ObservedFact,
  ParseWebhookInput,
  PaymentCallContext,
  RefundInput,
} from './provider.types'

/**
 * The contract every gateway adapter implements.
 *
 * Optional members are gated by the capability descriptor: the
 * orchestrator checks `capabilities` before calling, so an adapter never
 * has to invent its own "not supported" error.
 *
 * `fetchStatus` is deliberately NOT optional. It is what makes the
 * system correct when webhooks are lost, and it is the single most
 * commonly skipped method in payment integrations.
 */
export interface IPaymentProvider {
  readonly capabilities: GatewayCapabilities

  /** Test call made when a merchant saves credentials. */
  validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
    mode: GatewayCapabilities extends never ? never : 'test' | 'live'
  }): Promise<CredentialValidationResult>

  /** Starts an attempt. */
  initializePayment(context: PaymentCallContext): Promise<InitializeResult>

  /**
   * Authoritative status straight from the provider.
   *
   * Used by reconciliation, by the customer's return from a redirect,
   * and by the invariant checker. Never optional.
   */
  fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]>

  /** Required when capabilities.webhooks is true. */
  parseWebhook?(input: ParseWebhookInput): Promise<ObservedFact[]>

  /** Required when capabilities.manualCapture is true. */
  capture?(input: CaptureInput): Promise<ObservedFact[]>

  /** Required when capabilities.voidSupported is true. */
  voidAuthorization?(input: {
    accountId: bigint
    gatewayReference: string
    credentials: Readonly<Record<string, string>>
    idempotencyKey: string
    mode: 'test' | 'live'
  }): Promise<ObservedFact[]>

  /** Required when capabilities.partialRefund is true. */
  refund?(input: RefundInput): Promise<ObservedFact[]>
}

/** DI token: interfaces do not exist at runtime. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS')

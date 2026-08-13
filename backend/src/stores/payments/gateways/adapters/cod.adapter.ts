import { Injectable } from '@nestjs/common'
import { IPaymentProvider } from '../payment-provider.interface'
import type {
  CredentialValidationResult,
  FetchStatusInput,
  GatewayCapabilities,
  InitializeResult,
  ObservedFact,
  PaymentCallContext,
} from '../provider.types'

/**
 * Cash on delivery.
 *
 * There is no provider. The merchant accepts an unfunded promise, the
 * order is created, and money is recorded when the courier hands it
 * over. Modelling it as an adapter rather than an `if` branch is what
 * lets checkout treat it identically to Stripe.
 */
@Injectable()
export class CodAdapter implements IPaymentProvider {
  readonly capabilities: GatewayCapabilities = {
    gateway: 'cod',
    methods: ['cod'],
    currencies: 'all',
    exponentOverrides: {},
    manualCapture: false,
    partialCapture: false,
    multiCapture: false,
    partialRefund: false,
    voidSupported: false,
    authorizationExpiry: false,
    vaulting: false,
    merchantInitiated: false,
    threeDSecure: false,
    webhooks: false,
    statusPolling: false,
    settlementReports: false,
    webhookResolution: 'none',
    offlineCommitmentKind: 'promise_accepted',
  }

  async validateCredentials(): Promise<CredentialValidationResult> {
    // Nothing to validate; there is no account to reach.
    return { valid: true }
  }

  async initializePayment(
    _context: PaymentCallContext,
  ): Promise<InitializeResult> {
    return { kind: 'no_gateway', commitmentKind: 'promise_accepted' }
  }

  /**
   * Always empty.
   *
   * Collection is a merchant action, not something a provider can be
   * asked about, so reconciliation has nothing to poll.
   */
  async fetchStatus(_input: FetchStatusInput): Promise<ObservedFact[]> {
    return []
  }
}

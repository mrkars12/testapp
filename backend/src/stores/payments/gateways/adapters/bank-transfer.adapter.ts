import { Injectable } from '@nestjs/common'
import { IPaymentProvider } from '../payment-provider.interface'
import {
  ProviderError,
  type CredentialValidationResult,
  type FetchStatusInput,
  type GatewayCapabilities,
  type InitializeResult,
  type ObservedFact,
  type PaymentCallContext,
} from '../provider.types'

/** Credential keys that must be present for the method to be usable. */
const REQUIRED_FIELDS = ['bank_name', 'account_holder'] as const

/** Keys copied into the customer-facing instructions, in this order. */
const INSTRUCTION_FIELDS = [
  'bank_name',
  'account_holder',
  'account_number',
  'iban',
  'swift',
  'instructions',
] as const

/**
 * Manual bank transfer.
 *
 * No provider either, but unlike cash on delivery it must hand the
 * customer something: the merchant's bank details. That is exactly the
 * shape a kiosk method needs too, which is why `no_gateway` carries an
 * optional next action instead of the result union having a special
 * case per manual method.
 */
@Injectable()
export class BankTransferAdapter implements IPaymentProvider {
  readonly capabilities: GatewayCapabilities = {
    gateway: 'bank_transfer',
    methods: ['bank_transfer'],
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
    offlineCommitmentKind: 'awaiting_offline_settlement',
  }

  async validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
  }): Promise<CredentialValidationResult> {
    const missing = REQUIRED_FIELDS.filter(
      (field) => !this.present(input.credentials[field]),
    )

    if (missing.length > 0) {
      return {
        valid: false,
        errorCode: 'configuration_error',
        message: `Missing bank details: ${missing.join(', ')}.`,
      }
    }

    return { valid: true }
  }

  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    const missing = REQUIRED_FIELDS.filter(
      (field) => !this.present(context.credentials[field]),
    )

    if (missing.length > 0) {
      throw new ProviderError(
        'configuration_error',
        `Bank transfer is not configured for this store. Missing: ${missing.join(', ')}.`,
      )
    }

    const fields: Record<string, unknown> = {}

    for (const field of INSTRUCTION_FIELDS) {
      const value = context.credentials[field]
      fields[field] = this.present(value) ? value : null
    }

    return {
      kind: 'no_gateway',
      commitmentKind: 'awaiting_offline_settlement',
      nextAction: { kind: 'bank_instructions', fields },
    }
  }

  /** No provider to ask; the merchant confirms the transfer arrived. */
  async fetchStatus(_input: FetchStatusInput): Promise<ObservedFact[]> {
    return []
  }

  private present(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0
  }
}

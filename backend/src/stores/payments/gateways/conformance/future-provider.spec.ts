import { ProviderRegistry } from '../provider-registry.service'
import { GatewayParityCheck } from '../gateway-parity.check'
import { parityFailures } from '../gateway-parity'
import type { IPaymentProvider } from '../payment-provider.interface'
import {
  buildFactDedupeKey,
  callContextIdempotencyKey,
  ProviderError,
  type CaptureInput,
  type FetchStatusInput,
  type GatewayCapabilities,
  type InitializeResult,
  type ObservedFact,
  type ParseWebhookInput,
  type PaymentCallContext,
  type RefundInput,
} from '../provider.types'
import type { WebhookAccountRef } from '../webhook-resolution'
import { resolveWebhookAccountRef } from '../webhook-resolution'
import { conformanceContext, runProviderConformance } from './provider-conformance'

/**
 * ==================================================================
 * The registration path a future provider takes
 * ==================================================================
 *
 * This file answers one question: *can a provider unlike the three we
 * ship be added without touching core?*
 *
 * The adapter below is not a provider. It has no endpoints, no
 * signatures and no request formats — nothing about it is copied from
 * Paymob, Moyasar, Tap, MyFatoorah or Fawry, and it is deliberately
 * named so it can never be mistaken for one. What it does have is the
 * combination of traits none of the shipped adapters exercise:
 *
 *   • payload-scoped webhook resolution
 *   • a redirect next action rather than a client SDK
 *   • refunds in full only, no partial
 *   • an idempotency key reshaped to fit a length limit
 *
 * It lives only in this test, is never exported, and is never added to
 * `gateways.module.ts`. If any of these traits required a change in a
 * core service, this file could not exist.
 */

const CONTRACT_ONLY = 'contract_only_not_a_real_gateway'

/** A provider account identifier, as a payload-scoped provider would use. */
const MERCHANT_REF = 'merchant-alpha'

class ContractOnlyAdapter implements IPaymentProvider {
  /** `alwaysFails` gives the conformance suite a failure to classify. */
  constructor(private readonly alwaysFails = false) {}

  readonly capabilities: GatewayCapabilities = {
    gateway: CONTRACT_ONLY,
    methods: ['card', 'wallet'],
    currencies: ['USD', 'EGP'],
    exponentOverrides: {},
    automaticCapture: true,
    manualCapture: true,
    partialCapture: false,
    multiCapture: false,
    refundSupported: true,
    // Full refunds only — the case the old model could not express.
    partialRefund: false,
    voidSupported: true,
    authorizationExpiry: false,
    vaulting: false,
    merchantInitiated: false,
    threeDSecure: true,
    webhooks: true,
    statusPolling: true,
    settlementReports: false,
    webhookResolution: 'payload_scoped',
    nextActionKinds: ['redirect'],
    offlineCommitmentKind: null,
  }

  async validateCredentials(input: {
    credentials: Readonly<Record<string, string>>
  }) {
    return input.credentials.api_key
      ? { valid: true }
      : {
          valid: false,
          errorCode: 'configuration_error' as const,
          message: 'API key is missing.',
        }
  }

  async initializePayment(
    context: PaymentCallContext,
  ): Promise<InitializeResult> {
    if (this.alwaysFails) {
      throw new ProviderError('provider_unavailable', 'the provider is down')
    }

    this.sentKeys.push(callContextIdempotencyKey(context, 'initialize'))

    return {
      kind: 'requires_action',
      nextAction: {
        kind: 'redirect',
        url: 'https://example.invalid/pay',
        method: 'GET',
      },
      refs: { gatewayReference: 'ref_contract_only' },
    }
  }

  readonly sentKeys: string[] = []

  async fetchStatus(input: FetchStatusInput): Promise<ObservedFact[]> {
    return [this.fact(input.accountId, 'attempt_authorized', 10_000n)]
  }

  async parseWebhook(input: ParseWebhookInput): Promise<ObservedFact[]> {
    if (input.headers['x-contract-signature'] !== input.signingSecret) {
      throw new ProviderError('authentication_failed', 'signature mismatch')
    }

    return [this.fact(input.accountId, 'attempt_captured', 10_000n)]
  }

  /**
   * Reads the merchant reference out of an unverified body.
   *
   * The shape is this test's own invention and describes no real
   * provider. What matters is that it returns a reference and never
   * throws, whatever bytes arrive.
   */
  extractWebhookAccountRef(input: { rawBody: Buffer }): WebhookAccountRef | null {
    try {
      const parsed = JSON.parse(input.rawBody.toString('utf8')) as {
        merchant?: unknown
      }

      return typeof parsed.merchant === 'string'
        ? { kind: 'provider_account', providerAccountRef: parsed.merchant }
        : null
    } catch {
      return null
    }
  }

  async capture(input: CaptureInput): Promise<ObservedFact[]> {
    return [this.fact(input.accountId, 'attempt_captured', input.amountMinor)]
  }

  async voidAuthorization(input: {
    accountId: bigint
    gatewayReference: string
  }): Promise<ObservedFact[]> {
    return [this.fact(input.accountId, 'attempt_voided')]
  }

  async refund(input: RefundInput): Promise<ObservedFact[]> {
    return [this.fact(input.accountId, 'refund_succeeded', input.amountMinor)]
  }

  /** A provider that caps keys at 20 characters; a hash, never a new value. */
  idempotencyKeyFor(input: { base: string }): string {
    return input.base.slice(0, 20)
  }

  private fact(
    accountId: bigint,
    factType: ObservedFact['factType'],
    amount?: bigint,
  ): ObservedFact {
    return {
      dedupeKey: buildFactDedupeKey({
        accountId,
        gatewayReference: 'ref_contract_only',
        factType,
        cumulativeAmountMinor: amount,
        currency: 'USD',
      }),
      accountId,
      gatewayReference: 'ref_contract_only',
      factType,
      cumulativeAmountMinor: amount,
      currency: 'USD',
    }
  }
}

const webhookBody = Buffer.from(
  JSON.stringify({ merchant: MERCHANT_REF, event: 'captured' }),
  'utf8',
)

/* ------------------------------------------------------------------ */
/* The shared harness, unmodified, against an adapter it has never seen */
/* ------------------------------------------------------------------ */

runProviderConformance({
  gateway: CONTRACT_ONLY,
  build: () => new ContractOnlyAdapter(),
  validCredentials: { api_key: 'key' },
  invalidCredentials: {},
  failure: {
    build: () => new ContractOnlyAdapter(true),
    expectedCode: 'provider_unavailable',
  },
  webhook: {
    rawBody: webhookBody,
    headers: { 'x-contract-signature': 'shared-secret' },
    signingSecret: 'shared-secret',
  },
})

describe('adding a provider that is unlike the ones we ship', () => {
  it('registers through the real registry with no core change', () => {
    const registry = new ProviderRegistry([new ContractOnlyAdapter()])
    registry.onModuleInit()

    expect(registry.has(CONTRACT_ONLY)).toBe(true)
    expect(registry.capabilities(CONTRACT_ONLY).webhookResolution).toBe(
      'payload_scoped',
    )
  })

  it('is refused if it declares payload-scoped routing without the extractor', () => {
    // Declaring the strategy is a claim about code that must exist:
    // without the extractor, ingestion has no way to find the account and
    // the failure would first appear on a live callback.
    const incomplete: IPaymentProvider = {
      capabilities: new ContractOnlyAdapter().capabilities,
      validateCredentials: async () => ({ valid: true }),
      initializePayment: async () => ({
        kind: 'pending',
        pollAfterSeconds: 5,
        refs: { gatewayReference: 'ref' },
      }),
      fetchStatus: async () => [],
      parseWebhook: async () => [],
      capture: async () => [],
      voidAuthorization: async () => [],
      refund: async () => [],
    }

    expect(() => new ProviderRegistry([incomplete]).onModuleInit()).toThrow(
      /payload_scoped webhook resolution but does not implement/,
    )
  })

  it('routes its callbacks by the merchant reference in the body', () => {
    const adapter = new ContractOnlyAdapter()

    const outcome = resolveWebhookAccountRef({
      strategy: adapter.capabilities.webhookResolution,
      request: {
        gateway: CONTRACT_ONLY,
        // No account in the URL: one shared endpoint, as payload-scoped
        // providers use.
        rawBody: webhookBody,
        headers: {},
      },
      extract: (input) => adapter.extractWebhookAccountRef(input),
    })

    expect(outcome).toEqual({
      kind: 'ref',
      ref: { kind: 'provider_account', providerAccountRef: MERCHANT_REF },
    })
  })

  it('reshapes the outbound key without inventing one', () => {
    const adapter = new ContractOnlyAdapter()
    const registry = new ProviderRegistry([adapter])
    registry.onModuleInit()

    const key = registry.outboundIdempotencyKey({
      gateway: CONTRACT_ONLY,
      operation: 'capture',
      base: 'psp:1:77:1:capture:5000',
    })

    // Truncated to the provider's limit — a pure function of the base,
    // not a fresh value.
    expect(key).toBe('psp:1:77:1:capture:5000'.slice(0, 20))
    expect(key).toBe(
      registry.outboundIdempotencyKey({
        gateway: CONTRACT_ONLY,
        operation: 'capture',
        base: 'psp:1:77:1:capture:5000',
      }),
    )
  })

  it('sends the key core supplied, through the shared helper', async () => {
    const adapter = new ContractOnlyAdapter()

    await adapter.initializePayment(
      conformanceContext({
        credentials: { api_key: 'key' },
        idempotencyKey: 'psp:core:supplied',
      }),
    )

    expect(adapter.sentKeys).toEqual(['psp:core:supplied'])
  })

  it('is caught by the parity check for having no catalog entry', async () => {
    // The other half of the guarantee: an adapter a merchant could never
    // configure must not reach production silently.
    const registry = new ProviderRegistry([new ContractOnlyAdapter()])
    registry.onModuleInit()

    const report = registry.parity()

    expect(report.adaptersWithoutCatalogEntry).toEqual([CONTRACT_ONLY])
    expect(parityFailures(report).length).toBeGreaterThan(0)
    expect(() => new GatewayParityCheck(registry).onModuleInit()).toThrow(
      /catalog\/registry mismatch/,
    )
  })
})

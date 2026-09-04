import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { PaymentMethodKey } from '@prisma/client'
import {
  IPaymentProvider,
  PAYMENT_PROVIDERS,
  outboundIdempotencyKey,
} from './payment-provider.interface'
import {
  ProviderError,
  capabilityContradictions,
  supportsCurrency,
  supportsMethod,
  type GatewayCapabilities,
  type PaymentOperation,
} from './provider.types'
import { listGateways } from '../gateway-catalog'
import { checkGatewayParity, type ParityReport } from './gateway-parity'

/** Capability flags that require a matching optional method. */
const CAPABILITY_METHODS: ReadonlyArray<{
  flag: keyof GatewayCapabilities
  method: keyof IPaymentProvider
}> = [
  { flag: 'webhooks', method: 'parseWebhook' },
  { flag: 'manualCapture', method: 'capture' },
  { flag: 'voidSupported', method: 'voidAuthorization' },
  { flag: 'refundSupported', method: 'refund' },
]

/** Methods a resolution strategy cannot work without. */
const RESOLUTION_METHODS: Readonly<
  Partial<Record<GatewayCapabilities['webhookResolution'], keyof IPaymentProvider>>
> = {
  payload_scoped: 'extractWebhookAccountRef',
}

/**
 * ==================================================================
 * Gateway adapter registry
 * ==================================================================
 *
 * Resolves a gateway key to its adapter. Adding a provider means adding
 * a class to the module's provider array; nothing here changes, and no
 * switch statement grows. That is the Open/Closed property the design
 * depends on.
 *
 * On boot it checks that every declared capability has the method
 * backing it. A capability matrix nobody enforces becomes a lie, and the
 * lie is only discovered when a customer's payment fails.
 *
 * Agreement with the *catalog* is reported here (`parity()`) but
 * enforced by `GatewayParityCheck`, which runs over the real catalog at
 * application boot. Keeping the two apart is what lets a test register a
 * synthetic adapter — the registry's own invariants do not depend on a
 * gateway being one a merchant can buy.
 */
@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistry.name)
  private readonly byGateway = new Map<string, IPaymentProvider>()

  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly providers: IPaymentProvider[],
  ) {}

  onModuleInit(): void {
    for (const provider of this.providers) {
      const key = provider.capabilities.gateway

      if (this.byGateway.has(key)) {
        throw new Error(`Two adapters registered for gateway "${key}".`)
      }

      this.assertCapabilitiesAreBacked(provider)
      this.byGateway.set(key, provider)
    }

    this.logger.log(
      `Payment adapters registered: ${[...this.byGateway.keys()].sort().join(', ') || 'none'}`,
    )
  }

  /**
   * How the catalog and the registered adapters disagree.
   *
   * Exposed as well as enforced so a diagnostic endpoint or a test can
   * read the same report the boot check acts on, rather than a second
   * comparison written by hand.
   */
  parity(): ParityReport {
    return checkGatewayParity({
      catalog: listGateways(),
      adapters: [...this.byGateway.values()].map((p) => p.capabilities),
    })
  }

  /** Adapter for a gateway, or a configuration error. */
  get(gateway: string): IPaymentProvider {
    const provider = this.byGateway.get(gateway)

    if (!provider) {
      throw new ProviderError(
        'configuration_error',
        `No adapter is registered for gateway "${gateway}". ` +
          `Registered: [${[...this.byGateway.keys()].sort().join(', ')}].`,
      )
    }

    return provider
  }

  has(gateway: string): boolean {
    return this.byGateway.has(gateway)
  }

  registeredGateways(): string[] {
    return [...this.byGateway.keys()].sort()
  }

  capabilities(gateway: string): GatewayCapabilities {
    return this.get(gateway).capabilities
  }

  /**
   * Checks the adapter can actually serve this method and currency.
   *
   * Called before the adapter, so an impossible request is rejected in
   * one place instead of once per adapter.
   */
  assertCanHandle(input: {
    gateway: string
    method: PaymentMethodKey
    currency: string
  }): IPaymentProvider {
    const provider = this.get(input.gateway)
    const capabilities = provider.capabilities

    if (!supportsMethod(capabilities, input.method)) {
      throw new ProviderError(
        'method_unavailable',
        `Gateway "${input.gateway}" does not support the "${input.method}" method.`,
      )
    }

    if (!supportsCurrency(capabilities, input.currency)) {
      throw new ProviderError(
        'currency_unsupported',
        `Gateway "${input.gateway}" does not support ${input.currency}.`,
      )
    }

    return provider
  }

  /**
   * The idempotency key to send outbound for one operation.
   *
   * Core always derives the key — deterministically, from the intent and
   * attempt — and this is only where an adapter may *reshape* it to fit a
   * provider's length or character rules. There is no second idempotency
   * system: the base is the same value recorded on the attempt, and
   * `IdempotencyService` still governs the inbound request.
   */
  outboundIdempotencyKey(input: {
    gateway: string
    base: string
    operation: PaymentOperation
  }): string {
    return outboundIdempotencyKey(this.get(input.gateway), {
      base: input.base,
      operation: input.operation,
    })
  }

  /** Wire-format exponent for an amount, where the provider overrides ISO. */
  exponentOverride(gateway: string, currency: string): number | null {
    const overrides = this.capabilities(gateway).exponentOverrides
    const value = overrides[currency.trim().toUpperCase()]
    return value === undefined ? null : value
  }

  private assertCapabilitiesAreBacked(provider: IPaymentProvider): void {
    const capabilities = provider.capabilities

    for (const { flag, method } of CAPABILITY_METHODS) {
      if (capabilities[flag] === true && typeof provider[method] !== 'function') {
        throw new Error(
          `Adapter "${capabilities.gateway}" declares ${String(flag)} but does not ` +
            `implement ${String(method)}().`,
        )
      }
    }

    // A resolution strategy is also a claim about code that must exist:
    // payload-scoped routing without an extractor would leave ingestion
    // with no way to find the account, and the failure would only appear
    // on the first live callback.
    const required = RESOLUTION_METHODS[capabilities.webhookResolution]

    if (
      capabilities.webhooks &&
      required &&
      typeof provider[required] !== 'function'
    ) {
      throw new Error(
        `Adapter "${capabilities.gateway}" declares ${capabilities.webhookResolution} ` +
          `webhook resolution but does not implement ${String(required)}().`,
      )
    }

    // Everything a descriptor can contradict on its own, checked in one
    // place so the rules do not fork between boot and the conformance
    // suite.
    const contradictions = capabilityContradictions(capabilities)

    if (contradictions.length > 0) {
      throw new Error(
        `Adapter "${capabilities.gateway}" ${contradictions.join('; ')}.`,
      )
    }
  }

}

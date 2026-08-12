import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { PaymentMethodKey } from '@prisma/client'
import {
  IPaymentProvider,
  PAYMENT_PROVIDERS,
} from './payment-provider.interface'
import {
  ProviderError,
  supportsCurrency,
  supportsMethod,
  type GatewayCapabilities,
} from './provider.types'

/** Capability flags that require a matching optional method. */
const CAPABILITY_METHODS: ReadonlyArray<{
  flag: keyof GatewayCapabilities
  method: keyof IPaymentProvider
}> = [
  { flag: 'webhooks', method: 'parseWebhook' },
  { flag: 'manualCapture', method: 'capture' },
  { flag: 'voidSupported', method: 'voidAuthorization' },
  { flag: 'partialRefund', method: 'refund' },
]

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

    if (capabilities.methods.length === 0) {
      throw new Error(
        `Adapter "${capabilities.gateway}" declares no supported methods.`,
      )
    }

    if (capabilities.webhooks && capabilities.webhookResolution === 'none') {
      throw new Error(
        `Adapter "${capabilities.gateway}" declares webhooks but no resolution strategy.`,
      )
    }
  }
}

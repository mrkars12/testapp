import { Test } from '@nestjs/testing'
import { ProviderRegistry } from './provider-registry.service'
import { PAYMENT_PROVIDERS, IPaymentProvider } from './payment-provider.interface'
import { GatewaysModule } from './gateways.module'
import { ProviderError, type GatewayCapabilities } from './provider.types'

const caps = (over: Partial<GatewayCapabilities> = {}): GatewayCapabilities => ({
  gateway: 'spec',
  methods: ['card'],
  currencies: ['USD'],
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
  offlineCommitmentKind: null,
  ...over,
})

function stub(
  over: Partial<GatewayCapabilities> = {},
  extra: Partial<IPaymentProvider> = {},
): IPaymentProvider {
  return {
    capabilities: caps(over),
    validateCredentials: async () => ({ valid: true }),
    initializePayment: async () => ({
      kind: 'no_gateway',
      commitmentKind: 'promise_accepted',
    }),
    fetchStatus: async () => [],
    ...extra,
  } as IPaymentProvider
}

async function build(providers: IPaymentProvider[]): Promise<ProviderRegistry> {
  const mod = await Test.createTestingModule({
    providers: [{ provide: PAYMENT_PROVIDERS, useValue: providers }, ProviderRegistry],
  }).compile()
  const registry = mod.get(ProviderRegistry)
  registry.onModuleInit()
  return registry
}

describe('ProviderRegistry', () => {
  it('resolves a registered adapter', async () => {
    const registry = await build([stub({ gateway: 'alpha' })])
    expect(registry.get('alpha').capabilities.gateway).toBe('alpha')
    expect(registry.has('alpha')).toBe(true)
  })

  it('reports a configuration error for an unknown gateway', async () => {
    const registry = await build([stub({ gateway: 'alpha' })])
    expect(() => registry.get('nope')).toThrow(ProviderError)
    try {
      registry.get('nope')
    } catch (error) {
      expect((error as ProviderError).code).toBe('configuration_error')
    }
  })

  it('lists gateways in a stable order', async () => {
    const registry = await build([stub({ gateway: 'zeta' }), stub({ gateway: 'alpha' })])
    expect(registry.registeredGateways()).toEqual(['alpha', 'zeta'])
  })

  it('rejects two adapters claiming the same gateway', async () => {
    await expect(build([stub({ gateway: 'dup' }), stub({ gateway: 'dup' })])).rejects.toThrow(
      /Two adapters/,
    )
  })

  describe('capability enforcement at boot', () => {
    it('rejects a declared capability with no method behind it', async () => {
      await expect(
        build([stub({ webhooks: true, webhookResolution: 'endpoint_scoped' })]),
      ).rejects.toThrow(/parseWebhook/)
      await expect(build([stub({ manualCapture: true })])).rejects.toThrow(/capture/)
      await expect(build([stub({ partialRefund: true })])).rejects.toThrow(/refund/)
      await expect(build([stub({ voidSupported: true })])).rejects.toThrow(
        /voidAuthorization/,
      )
    })

    it('accepts a capability that is backed', async () => {
      const registry = await build([
        stub(
          { gateway: 'ok', webhooks: true, webhookResolution: 'payload_scoped' },
          { parseWebhook: async () => [] },
        ),
      ])
      expect(registry.capabilities('ok').webhooks).toBe(true)
    })

    it('rejects webhooks with no resolution strategy', async () => {
      await expect(
        build([stub({ webhooks: true }, { parseWebhook: async () => [] })]),
      ).rejects.toThrow(/resolution strategy/)
    })

    it('rejects an adapter supporting no methods', async () => {
      await expect(build([stub({ methods: [] })])).rejects.toThrow(/no supported methods/)
    })
  })

  describe('assertCanHandle', () => {
    it('passes for a supported method and currency', async () => {
      const registry = await build([stub({ gateway: 'a' })])
      expect(
        registry.assertCanHandle({ gateway: 'a', method: 'card', currency: 'USD' }),
      ).toBeDefined()
    })

    it('rejects an unsupported method before the adapter is called', async () => {
      const registry = await build([stub({ gateway: 'a' })])
      try {
        registry.assertCanHandle({ gateway: 'a', method: 'knet', currency: 'USD' })
        throw new Error('should have thrown')
      } catch (error) {
        expect((error as ProviderError).code).toBe('method_unavailable')
      }
    })

    it('rejects an unsupported currency', async () => {
      const registry = await build([stub({ gateway: 'a' })])
      try {
        registry.assertCanHandle({ gateway: 'a', method: 'card', currency: 'KWD' })
        throw new Error('should have thrown')
      } catch (error) {
        expect((error as ProviderError).code).toBe('currency_unsupported')
      }
    })
  })

  it('exposes exponent overrides', async () => {
    const registry = await build([stub({ gateway: 'a', exponentOverrides: { KWD: 3 } })])
    expect(registry.exponentOverride('a', 'kwd')).toBe(3)
    expect(registry.exponentOverride('a', 'USD')).toBeNull()
  })
})

describe('GatewaysModule wiring', () => {
  it('registers the shipped adapters through real DI', async () => {
    const mod = await Test.createTestingModule({ imports: [GatewaysModule] }).compile()
    await mod.init()

    const registry = mod.get(ProviderRegistry)
    expect(registry.registeredGateways()).toEqual(['bank_transfer', 'cod', 'stripe'])

    await mod.close()
  })
})
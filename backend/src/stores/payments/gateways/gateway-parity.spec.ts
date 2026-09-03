import { Test } from '@nestjs/testing'
import { checkGatewayParity, parityFailures } from './gateway-parity'
import { GatewayParityCheck } from './gateway-parity.check'
import { GatewaysModule } from './gateways.module'
import { ProviderRegistry } from './provider-registry.service'
import { PAYMENT_PROVIDERS, type IPaymentProvider } from './payment-provider.interface'
import { listGateways } from '../gateway-catalog'
import type { GatewayCapabilities } from './provider.types'

const caps = (over: Partial<GatewayCapabilities> = {}): GatewayCapabilities => ({
  gateway: 'spec',
  methods: ['card'],
  currencies: ['USD'],
  exponentOverrides: {},
  automaticCapture: true,
  manualCapture: false,
  partialCapture: false,
  multiCapture: false,
  refundSupported: false,
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
  nextActionKinds: [],
  offlineCommitmentKind: null,
  ...over,
})

const entry = (over: Partial<Parameters<typeof checkGatewayParity>[0]['catalog'][number]> = {}) => ({
  key: 'spec',
  methods: ['card'],
  requires_credentials: true,
  credential_fields: [{ key: 'secret_key' }],
  ...over,
})

describe('catalog / registry parity', () => {
  it('is satisfied when the two describe the same thing', () => {
    const report = checkGatewayParity({
      catalog: [entry()],
      adapters: [caps()],
    })

    expect(parityFailures(report)).toEqual([])
  })

  it('fails an adapter the catalog has never heard of', () => {
    // The gateway could take a payment but no merchant can configure it,
    // so the adapter is dead code that reads as live.
    const report = checkGatewayParity({
      catalog: [],
      adapters: [caps({ gateway: 'ghost' })],
    })

    expect(report.adaptersWithoutCatalogEntry).toEqual(['ghost'])
    expect(parityFailures(report)).toEqual([
      expect.stringContaining('registered but absent from the gateway catalog'),
    ])
  })

  it('reports, but does not fail, a catalog entry still awaiting its adapter', () => {
    // The normal state of every provider not yet built. Failing here
    // would mean the catalog could never describe planned work.
    const report = checkGatewayParity({
      catalog: [entry(), entry({ key: 'future' })],
      adapters: [caps()],
    })

    expect(report.catalogEntriesWithoutAdapter).toEqual(['future'])
    expect(parityFailures(report)).toEqual([])
  })

  it('fails a capability the merchant can never reach', () => {
    const report = checkGatewayParity({
      catalog: [entry({ methods: ['card'] })],
      adapters: [caps({ methods: ['card', 'wallet'] })],
    })

    expect(report.methodMismatches[0].adapterOnly).toEqual(['wallet'])
    expect(parityFailures(report)).toEqual([
      expect.stringContaining('but the catalog does not offer them'),
    ])
  })

  it('fails a method the merchant can enable but the adapter cannot serve', () => {
    // The worse direction: this one only surfaces at a customer's
    // checkout, after the merchant has switched it on.
    const report = checkGatewayParity({
      catalog: [entry({ methods: ['card', 'knet'] })],
      adapters: [caps({ methods: ['card'] })],
    })

    expect(report.methodMismatches[0].catalogOnly).toEqual(['knet'])
    expect(parityFailures(report)).toEqual([
      expect.stringContaining('but the adapter cannot serve them'),
    ])
  })

  it('fails an online adapter with nowhere for the merchant to enter keys', () => {
    const report = checkGatewayParity({
      catalog: [entry({ requires_credentials: false, credential_fields: [] })],
      adapters: [caps()],
    })

    expect(report.credentialGaps).toEqual(['spec'])
    expect(parityFailures(report)).toEqual([
      expect.stringContaining('declares no credential fields'),
    ])
  })

  it('exempts an offline adapter from needing credential fields', () => {
    // Cash on delivery has no account to reach and nothing to enter.
    const report = checkGatewayParity({
      catalog: [entry({ requires_credentials: false, credential_fields: [], methods: ['cod'] })],
      adapters: [
        caps({
          methods: ['cod'],
          automaticCapture: false,
          offlineCommitmentKind: 'promise_accepted',
        }),
      ],
    })

    expect(parityFailures(report)).toEqual([])
  })
})

describe('the shipped catalog and the shipped adapters', () => {
  it('agree', async () => {
    const mod = await Test.createTestingModule({ imports: [GatewaysModule] }).compile()
    await mod.init()

    const report = mod.get(ProviderRegistry).parity()

    expect(parityFailures(report)).toEqual([])
    expect(report.adaptersWithoutCatalogEntry).toEqual([])

    // The gateways the catalog offers with no adapter yet — the queue of
    // providers still to be built. Asserted as a set rather than a count
    // so adding an adapter shows up here as an intentional change.
    expect(report.catalogEntriesWithoutAdapter).toEqual(
      listGateways()
        .map((g) => g.key)
        .filter(
          (key) =>
            !['bank_transfer', 'cod', 'moyasar', 'paymob', 'stripe', 'tap'].includes(
              key,
            ),
        )
        .sort(),
    )

    await mod.close()
  })

  it('fails the boot when an adapter has no catalog entry', async () => {
    const orphan: IPaymentProvider = {
      capabilities: caps({ gateway: 'not_in_catalog' }),
      validateCredentials: async () => ({ valid: true }),
      initializePayment: async () => ({
        kind: 'pending',
        pollAfterSeconds: 5,
        refs: { gatewayReference: 'ref' },
      }),
      fetchStatus: async () => [],
    }

    const mod = await Test.createTestingModule({
      providers: [
        { provide: PAYMENT_PROVIDERS, useValue: [orphan] },
        ProviderRegistry,
        GatewayParityCheck,
      ],
    }).compile()

    await expect(mod.init()).rejects.toThrow(/catalog\/registry mismatch/)
  })
})

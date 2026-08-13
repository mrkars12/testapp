import { StripeAdapter } from './stripe.adapter'
import type { StripeClientLike } from './stripe-client'
import { ProviderError, type PaymentCallContext } from '../../provider.types'

/** Records what was sent to Stripe so the calls can be asserted. */
function stubClient(overrides: Partial<Record<string, any>> = {}) {
  const calls: Record<string, any[]> = {
    create: [],
    retrieve: [],
    capture: [],
    cancel: [],
    refund: [],
    constructEvent: [],
  }

  const client: StripeClientLike = {
    paymentIntents: {
      create: async (params, options) => {
        calls.create.push({ params, options })
        return (
          overrides.create ?? {
            id: 'pi_1',
            status: 'requires_action',
            currency: 'usd',
            amount: 10000,
            client_secret: 'pi_1_secret',
          }
        )
      },
      retrieve: async (id) => {
        calls.retrieve.push(id)
        return (
          overrides.retrieve ?? {
            id: 'pi_1',
            status: 'succeeded',
            currency: 'usd',
            amount: 10000,
            amount_received: 10000,
          }
        )
      },
      capture: async (id, params, options) => {
        calls.capture.push({ id, params, options })
        return (
          overrides.capture ?? {
            id: 'pi_1',
            status: 'succeeded',
            currency: 'usd',
            amount: 10000,
            amount_received: 6000,
          }
        )
      },
      cancel: async (id, params, options) => {
        calls.cancel.push({ id, params, options })
        return { id: 'pi_1', status: 'canceled', currency: 'usd', amount: 10000 }
      },
    },
    refunds: {
      create: async (params, options) => {
        calls.refund.push({ params, options })
        return overrides.refund ?? { id: 're_1', status: 'succeeded', amount: 2500 }
      },
    },
    balance: {
      retrieve: async () => {
        if (overrides.balanceError) throw overrides.balanceError
        return { object: 'balance' }
      },
    },
    webhooks: {
      constructEvent: (payload, header, secret) => {
        calls.constructEvent.push({ header, secret })
        if (overrides.verifyError) throw overrides.verifyError
        return (
          overrides.event ?? {
            id: 'evt_1',
            type: 'payment_intent.succeeded',
            created: 1_700_000_000,
            data: {
              object: {
                id: 'pi_1',
                status: 'succeeded',
                currency: 'usd',
                amount: 10000,
                amount_received: 10000,
              },
            },
          }
        )
      },
    },
  }

  return { client, calls }
}

const context = (over: Partial<PaymentCallContext> = {}): PaymentCallContext => ({
  storeId: 1n,
  mode: 'live',
  accountId: 7n,
  offeringId: 3n,
  method: 'card',
  gatewayMethodConfig: '',
  intentId: 42n,
  attemptId: null,
  attemptSequence: 1,
  amountMinor: 10000n,
  currency: 'USD',
  credentials: { secret_key: 'sk_test_x', publishable_key: 'pk_test_x' },
  ...over,
})

describe('StripeAdapter capabilities', () => {
  const adapter = new StripeAdapter(() => stubClient().client)

  it('declares every capability it implements', () => {
    const c = adapter.capabilities
    expect(c.gateway).toBe('stripe')
    expect(c.webhooks).toBe(true)
    expect(c.statusPolling).toBe(true)
    expect(c.manualCapture).toBe(true)
    expect(c.partialRefund).toBe(true)
    expect(c.voidSupported).toBe(true)
  })

  it('backs each declared capability with a method', () => {
    expect(typeof adapter.parseWebhook).toBe('function')
    expect(typeof adapter.capture).toBe('function')
    expect(typeof adapter.refund).toBe('function')
    expect(typeof adapter.voidAuthorization).toBe('function')
  })

  it('does not claim multicapture or settlement reports', () => {
    expect(adapter.capabilities.multiCapture).toBe(false)
    expect(adapter.capabilities.settlementReports).toBe(false)
  })
})

describe('validateCredentials', () => {
  it('rejects a missing secret key without calling Stripe', async () => {
    const adapter = new StripeAdapter(() => {
      throw new Error('should not build a client')
    })
    const result = await adapter.validateCredentials({ credentials: {} })
    expect(result).toMatchObject({ valid: false, errorCode: 'configuration_error' })
  })

  it('accepts a key that can read the balance', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)
    await expect(
      adapter.validateCredentials({ credentials: { secret_key: 'sk_test_x' } }),
    ).resolves.toEqual({ valid: true })
  })

  it('maps a rejected key to a configuration error', async () => {
    const adapter = new StripeAdapter(
      () => stubClient({ balanceError: { type: 'authentication_error' } }).client,
    )
    const result = await adapter.validateCredentials({
      credentials: { secret_key: 'sk_bad' },
    })
    expect(result).toMatchObject({ valid: false, errorCode: 'configuration_error' })
  })
})

describe('initializePayment', () => {
  it('returns a client secret for the customer to complete', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    const result = await adapter.initializePayment(context())

    expect(result).toMatchObject({
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'pi_1_secret' },
      refs: { gatewayReference: 'pi_1' },
    })
  })

  it('sends a deterministic idempotency key, not a random one', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context())
    await adapter.initializePayment(context())

    const [first, second] = stub.calls.create
    expect(first.options.idempotencyKey).toBe('psp:1:42:1:initialize')
    expect(second.options.idempotencyKey).toBe(first.options.idempotencyKey)
  })

  it('sends the amount and lower-cased currency', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context())

    expect(stub.calls.create[0].params).toMatchObject({ amount: 10000, currency: 'usd' })
  })

  it('reports an immediate success without a client secret', async () => {
    const adapter = new StripeAdapter(
      () =>
        stubClient({
          create: {
            id: 'pi_2',
            status: 'succeeded',
            currency: 'usd',
            amount: 10000,
            amount_received: 10000,
          },
        }).client,
    )

    await expect(adapter.initializePayment(context())).resolves.toMatchObject({
      kind: 'succeeded',
      capturedAmountMinor: 10000n,
    })
  })

  it('reports an authorization awaiting capture', async () => {
    const adapter = new StripeAdapter(
      () =>
        stubClient({
          create: {
            id: 'pi_3',
            status: 'requires_capture',
            currency: 'usd',
            amount: 10000,
            amount_capturable: 10000,
          },
        }).client,
    )

    await expect(adapter.initializePayment(context())).resolves.toMatchObject({
      kind: 'authorized',
      authorizedAmountMinor: 10000n,
    })
  })

  it('refuses to run without a secret key', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)
    await expect(
      adapter.initializePayment(context({ credentials: {} })),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it('translates a Stripe decline into a ProviderError code', async () => {
    const adapter = new StripeAdapter(() => ({
      ...stubClient().client,
      paymentIntents: {
        ...stubClient().client.paymentIntents,
        create: async () => {
          throw { type: 'card_error', decline_code: 'insufficient_funds' }
        },
      },
    }))

    try {
      await adapter.initializePayment(context())
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError)
      expect((error as ProviderError).code).toBe('declined_insufficient_funds')
    }
  })
})

describe('fetchStatus', () => {
  it('returns facts from the retrieved intent', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.fetchStatus({
      accountId: 7n,
      gatewayReference: 'pi_1',
      credentials: { secret_key: 'sk_test_x' },
      mode: 'live',
    })

    expect(stub.calls.retrieve).toEqual(['pi_1'])
    expect(facts[0]).toMatchObject({ factType: 'attempt_captured', accountId: 7n })
  })
})

describe('parseWebhook', () => {
  const base = {
    accountId: 7n,
    rawBody: Buffer.from('{"id":"evt_1"}'),
    signingSecret: 'whsec_x',
    mode: 'live' as const,
  }

  it('verifies the signature against the raw bytes', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.parseWebhook({
      ...base,
      headers: { 'stripe-signature': 't=1,v1=abc' },
    })

    expect(stub.calls.constructEvent[0]).toMatchObject({
      header: 't=1,v1=abc',
      secret: 'whsec_x',
    })
    expect(facts[0]).toMatchObject({ factType: 'attempt_captured' })
  })

  it('rejects a missing signature header', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)
    await expect(
      adapter.parseWebhook({ ...base, headers: {} }),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it('treats a bad signature as an authentication failure, not a server fault', async () => {
    const adapter = new StripeAdapter(
      () => stubClient({ verifyError: new Error('no signatures found') }).client,
    )

    try {
      await adapter.parseWebhook({ ...base, headers: { 'stripe-signature': 'bad' } })
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as ProviderError).code).toBe('authentication_failed')
    }
  })

  it('reads the signature header case-insensitively', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)
    await expect(
      adapter.parseWebhook({ ...base, headers: { 'Stripe-Signature': 'sig' } }),
    ).resolves.toHaveLength(1)
  })
})

describe('capture, void and refund', () => {
  it('captures a partial amount and reports the running total', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.capture!({
      accountId: 7n,
      gatewayReference: 'pi_1',
      amountMinor: 6000n,
      currency: 'USD',
      credentials: { secret_key: 'sk_test_x' },
      idempotencyKey: 'psp:1:42:1:capture',
      mode: 'live',
    })

    expect(stub.calls.capture[0].params).toEqual({ amount_to_capture: 6000 })
    expect(stub.calls.capture[0].options.idempotencyKey).toBe('psp:1:42:1:capture')
    expect(facts[0]).toMatchObject({ cumulativeAmountMinor: 6000n })
  })

  it('voids an authorization', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)

    const facts = await adapter.voidAuthorization!({
      accountId: 7n,
      gatewayReference: 'pi_1',
      credentials: { secret_key: 'sk_test_x' },
      idempotencyKey: 'psp:1:42:1:void',
      mode: 'live',
    })

    expect(facts[0]).toMatchObject({ factType: 'attempt_voided' })
  })

  it('refunds and reports a refund fact', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.refund!({
      accountId: 7n,
      gatewayReference: 'pi_1',
      gatewayCaptureRef: 'ch_1',
      amountMinor: 2500n,
      currency: 'USD',
      credentials: { secret_key: 'sk_test_x' },
      idempotencyKey: 'psp:1:42:1:refund',
      mode: 'live',
    })

    expect(stub.calls.refund[0].params).toMatchObject({
      payment_intent: 'pi_1',
      amount: 2500,
    })
    expect(facts[0]).toMatchObject({
      factType: 'refund_succeeded',
      cumulativeAmountMinor: 2500n,
    })
  })

  it('reports a failed refund distinctly', async () => {
    const adapter = new StripeAdapter(
      () => stubClient({ refund: { id: 're_2', status: 'failed', amount: 2500 } }).client,
    )

    const facts = await adapter.refund!({
      accountId: 7n,
      gatewayReference: 'pi_1',
      gatewayCaptureRef: null,
      amountMinor: 2500n,
      currency: 'USD',
      credentials: { secret_key: 'sk_test_x' },
      idempotencyKey: 'k',
      mode: 'live',
    })

    expect(facts[0].factType).toBe('refund_failed')
  })
})
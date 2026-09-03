import { StripeAdapter } from './stripe.adapter'
import type { StripeClientLike } from './stripe-client'
import { ProviderError, type PaymentCallContext } from '../../provider.types'

/** Records what was sent to Stripe so the calls can be asserted. */
function stubClient(overrides: Partial<Record<string, any>> = {}) {
  const calls: Record<string, any[]> = {
    create: [],
    checkoutSessionCreate: [],
    checkoutSessionRetrieve: [],
    retrieve: [],
    capture: [],
    cancel: [],
    refund: [],
    constructEvent: [],
  }

  const client: StripeClientLike = {
    checkout: {
      sessions: {
        create: async (params, options) => {
          calls.checkoutSessionCreate.push({ params, options })
          return (
            overrides.checkoutSession ?? {
              id: 'cs_1',
              url: 'https://checkout.stripe.com/c/pay/cs_1',
              payment_intent: 'pi_1',
            }
          )
        },
        retrieve: async (id, params) => {
          calls.checkoutSessionRetrieve.push({ id, params })
          if (overrides.sessionRetrieveError) throw overrides.sessionRetrieveError
          return (
            overrides.sessionRetrieve ?? {
              id: 'cs_1',
              url: 'https://checkout.stripe.com/c/pay/cs_1',
              payment_intent: 'pi_1',
              status: 'complete',
              currency: 'usd',
            }
          )
        },
      },
    },
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
  returnUrl: 'https://shop.example/checkout/success',
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

  /**
   * The mode guard.
   *
   * `balance.retrieve()` succeeds for a test key exactly as it does for
   * a live one, so without this check a test key activates a live
   * account and live orders are recorded as funded against Stripe test
   * intents. The same guard exists on Paymob, Moyasar and Tap.
   */
  it('rejects a test key saved against a live account, without calling Stripe', async () => {
    const adapter = new StripeAdapter(() => {
      throw new Error('should not build a client')
    })

    const result = await adapter.validateCredentials({
      credentials: { secret_key: 'sk_test_x', publishable_key: 'pk_test_x' },
      mode: 'live',
    })

    expect(result).toMatchObject({ valid: false, errorCode: 'mode_mismatch' })
    expect(result.message).toContain('sk_live_')
  })

  it('rejects a live key saved against a test account', async () => {
    const adapter = new StripeAdapter(() => {
      throw new Error('should not build a client')
    })

    expect(
      await adapter.validateCredentials({
        credentials: { secret_key: 'sk_live_x' },
        mode: 'test',
      }),
    ).toMatchObject({ valid: false, errorCode: 'mode_mismatch' })
  })

  it('rejects a restricted key from the wrong mode too', async () => {
    // Stripe mints rk_test_ / rk_live_ alongside sk_.
    const adapter = new StripeAdapter(() => {
      throw new Error('should not build a client')
    })

    expect(
      await adapter.validateCredentials({
        credentials: { secret_key: 'rk_test_x' },
        mode: 'live',
      }),
    ).toMatchObject({ valid: false, errorCode: 'mode_mismatch' })
  })

  it('accepts a key whose mode matches', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)

    expect(
      await adapter.validateCredentials({
        credentials: { secret_key: 'sk_live_x' },
        mode: 'live',
      }),
    ).toEqual({ valid: true })

    expect(
      await adapter.validateCredentials({
        credentials: { secret_key: 'sk_test_x' },
        mode: 'test',
      }),
    ).toEqual({ valid: true })
  })

  it('accepts a key shape it does not recognise', async () => {
    // Only an unambiguous contradiction is worth failing on; Stripe has
    // changed key formats before.
    const adapter = new StripeAdapter(() => stubClient().client)

    expect(
      await adapter.validateCredentials({
        credentials: { secret_key: 'sk_x_legacy' },
        mode: 'live',
      }),
    ).toEqual({ valid: true })
  })

  it('still validates when no mode is supplied', async () => {
    // Nothing that worked before changes.
    const adapter = new StripeAdapter(() => stubClient().client)

    expect(
      await adapter.validateCredentials({ credentials: { secret_key: 'sk_test_x' } }),
    ).toEqual({ valid: true })
  })
})

describe('initializePayment (Checkout Sessions)', () => {
  it('returns a redirect to the hosted Checkout Session, keyed on the underlying PaymentIntent', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    const result = await adapter.initializePayment(context())

    expect(result).toMatchObject({
      kind: 'requires_action',
      nextAction: {
        kind: 'redirect',
        url: 'https://checkout.stripe.com/c/pay/cs_1',
        method: 'GET',
      },
      // gatewayReference stays the PaymentIntent id — capture/void/refund/
      // fetchStatus all key on it unchanged from the pre-migration
      // integration. gatewayPaymentId carries the session id.
      refs: { gatewayReference: 'pi_1', gatewayPaymentId: 'cs_1' },
    })
  })

  it('sends a deterministic idempotency key, not a random one', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context())
    await adapter.initializePayment(context())

    const [first, second] = stub.calls.checkoutSessionCreate
    expect(first.options.idempotencyKey).toBe('psp:1:42:1:initialize')
    expect(second.options.idempotencyKey).toBe(first.options.idempotencyKey)
  })

  it('sends the amount and lower-cased currency as a single line item', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context())

    expect(stub.calls.checkoutSessionCreate[0].params).toMatchObject({
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'usd', unit_amount: 10000 }, quantity: 1 },
      ],
    })
  })

  it('captures automatically when the merchant configured automatic', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context({ captureMethod: 'automatic' }))

    expect(stub.calls.checkoutSessionCreate[0].params.payment_intent_data).toMatchObject({
      capture_method: 'automatic',
    })
  })

  it('authorises without taking the money when the merchant configured manual', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context({ captureMethod: 'manual' }))

    expect(stub.calls.checkoutSessionCreate[0].params.payment_intent_data).toMatchObject({
      capture_method: 'manual',
    })
  })

  it('defaults to automatic when no capture mode is supplied', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context())

    expect(stub.calls.checkoutSessionCreate[0].params.payment_intent_data).toMatchObject({
      capture_method: 'automatic',
    })
  })

  it('sends the return URL as success_url and a cancel-flagged variant as cancel_url', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(
      context({ returnUrl: 'https://shop.example/checkout/success?token=abc' }),
    )

    const { params } = stub.calls.checkoutSessionCreate[0]
    expect(params.success_url).toBe('https://shop.example/checkout/success?token=abc')
    const cancelUrl = new URL(params.cancel_url)
    expect(cancelUrl.searchParams.get('token')).toBe('abc')
    expect(cancelUrl.searchParams.get('stripe_cancelled')).toBe('1')
  })

  it('does not hardcode payment methods — Stripe decides eligibility', async () => {
    const stub = stubClient()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context())

    expect(stub.calls.checkoutSessionCreate[0].params.payment_method_types).toBeUndefined()
  })

  it('refuses to run without a secret key', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)
    await expect(
      adapter.initializePayment(context({ credentials: {} })),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it('refuses to run without a return URL — Checkout Sessions require success/cancel URLs', async () => {
    const adapter = new StripeAdapter(() => stubClient().client)
    await expect(
      adapter.initializePayment(context({ returnUrl: undefined })),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('rejects a session created with no hosted URL', async () => {
    const adapter = new StripeAdapter(
      () => stubClient({ checkoutSession: { id: 'cs_2', url: null, payment_intent: 'pi_2' } }).client,
    )
    await expect(adapter.initializePayment(context())).rejects.toBeInstanceOf(ProviderError)
  })

  it('falls back to the Checkout Session id when Stripe has not created a PaymentIntent yet', async () => {
    // Verified against the live Stripe TEST API: `payment_intent` is
    // routinely `null` right after session creation — the customer has
    // not submitted payment yet. This must not fail the whole attempt;
    // it used to (`ProviderError('unknown', ...)` on every single
    // Stripe TEST payment), before the customer ever reached Stripe's
    // hosted page.
    const adapter = new StripeAdapter(
      () =>
        stubClient({
          checkoutSession: { id: 'cs_3', url: 'https://checkout.stripe.com/c/pay/cs_3', payment_intent: null },
        }).client,
    )
    const result = await adapter.initializePayment(context())
    expect(result).toMatchObject({
      kind: 'requires_action',
      nextAction: { kind: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_3' },
      refs: { gatewayReference: 'cs_3', gatewayPaymentId: 'cs_3' },
    })
  })

  it('translates a Stripe API error from session creation into a ProviderError code', async () => {
    const adapter = new StripeAdapter(() => ({
      ...stubClient().client,
      checkout: {
        sessions: {
          create: async () => {
            throw { type: 'card_error', decline_code: 'insufficient_funds' }
          },
          retrieve: async () => {
            throw new Error('not used in this test')
          },
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

  it('resolves a Checkout Session reference and keys the fact on the session id, not the PaymentIntent id', async () => {
    // The reference stored on the attempt when initializePayment had no
    // PaymentIntent yet — see stripe.adapter.ts's initializePayment.
    const stub = stubClient({
      sessionRetrieve: {
        id: 'cs_1',
        status: 'complete',
        currency: 'usd',
        payment_intent: { id: 'pi_1', status: 'succeeded', currency: 'usd', amount: 10000, amount_received: 10000 },
      },
    })
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.fetchStatus({
      accountId: 7n,
      gatewayReference: 'cs_1',
      credentials: { secret_key: 'sk_test_x' },
      mode: 'test',
    })

    expect(stub.calls.checkoutSessionRetrieve[0].id).toBe('cs_1')
    expect(facts[0]).toMatchObject({ factType: 'attempt_captured', gatewayReference: 'cs_1' })
  })

  it('emits nothing for a Checkout Session still open with no PaymentIntent yet', async () => {
    const stub = stubClient({
      sessionRetrieve: { id: 'cs_1', status: 'open', currency: 'usd', payment_intent: null },
    })
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.fetchStatus({
      accountId: 7n,
      gatewayReference: 'cs_1',
      credentials: { secret_key: 'sk_test_x' },
      mode: 'test',
    })

    expect(facts).toEqual([])
  })

  it('reports an expired Checkout Session as attempt_expired, keyed on the session id', async () => {
    const stub = stubClient({
      sessionRetrieve: { id: 'cs_1', status: 'expired', currency: 'usd', payment_intent: null },
    })
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.fetchStatus({
      accountId: 7n,
      gatewayReference: 'cs_1',
      credentials: { secret_key: 'sk_test_x' },
      mode: 'test',
    })

    expect(facts).toMatchObject([{ factType: 'attempt_expired', gatewayReference: 'cs_1' }])
  })
})

describe('parseWebhook', () => {
  const base = {
    accountId: 7n,
    rawBody: Buffer.from('{"id":"evt_1"}'),
    // Stripe signs in a header; the query is present and ignored.
    query: {},
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
      gatewayPaymentId: 'pi_1',
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
      gatewayPaymentId: 'pi_1',
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

  it('resolves a Checkout Session reference to a real PaymentIntent id before capturing', async () => {
    const stub = stubClient({
      sessionRetrieve: { id: 'cs_1', payment_intent: 'pi_1' },
    })
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.capture!({
      accountId: 7n,
      gatewayReference: 'cs_1',
      gatewayPaymentId: 'cs_1',
      amountMinor: 6000n,
      currency: 'USD',
      credentials: { secret_key: 'sk_test_x' },
      idempotencyKey: 'psp:1:42:1:capture',
      mode: 'live',
    })

    expect(stub.calls.checkoutSessionRetrieve[0].id).toBe('cs_1')
    expect(stub.calls.capture[0].id).toBe('pi_1')
    // The fact must still be keyed on the reference actually stored on
    // the attempt (cs_1), or the applier can never find it.
    expect(facts[0]).toMatchObject({ gatewayReference: 'cs_1' })
  })

  it('refuses to capture when the Checkout Session still has no PaymentIntent', async () => {
    const stub = stubClient({
      sessionRetrieve: { id: 'cs_1', payment_intent: null },
    })
    const adapter = new StripeAdapter(() => stub.client)

    await expect(
      adapter.capture!({
        accountId: 7n,
        gatewayReference: 'cs_1',
        gatewayPaymentId: 'cs_1',
        amountMinor: 6000n,
        currency: 'USD',
        credentials: { secret_key: 'sk_test_x' },
        idempotencyKey: 'k',
        mode: 'live',
      }),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it('resolves a Checkout Session reference before refunding, but keys the fact on it', async () => {
    const stub = stubClient({
      sessionRetrieve: { id: 'cs_1', payment_intent: 'pi_1' },
    })
    const adapter = new StripeAdapter(() => stub.client)

    const facts = await adapter.refund!({
      accountId: 7n,
      gatewayReference: 'cs_1',
      gatewayPaymentId: 'cs_1',
      gatewayCaptureRef: 'ch_1',
      amountMinor: 2500n,
      currency: 'USD',
      credentials: { secret_key: 'sk_test_x' },
      idempotencyKey: 'psp:1:42:1:refund',
      mode: 'live',
    })

    expect(stub.calls.refund[0].params).toMatchObject({ payment_intent: 'pi_1' })
    expect(facts[0]).toMatchObject({ gatewayReference: 'cs_1' })
  })

  it('reports a failed refund distinctly', async () => {
    const adapter = new StripeAdapter(
      () => stubClient({ refund: { id: 're_2', status: 'failed', amount: 2500 } }).client,
    )

    const facts = await adapter.refund!({
      accountId: 7n,
      gatewayReference: 'pi_1',
      gatewayPaymentId: 'pi_1',
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
describe('describeWebhook', () => {
  const adapter = new StripeAdapter(() => stubClient().client)

  it('reads the event id and type from the body', () => {
    const body = Buffer.from(
      JSON.stringify({ id: 'evt_9', type: 'payment_intent.succeeded' }),
      'utf8',
    )

    expect(adapter.describeWebhook({ rawBody: body })).toEqual({
      eventId: 'evt_9',
      eventType: 'payment_intent.succeeded',
      recognised: true,
    })
  })

  it('marks an event type it has no mapping for as unrecognised', () => {
    const body = Buffer.from(
      JSON.stringify({ id: 'evt_9', type: 'invoice.paid' }),
      'utf8',
    )

    expect(adapter.describeWebhook({ rawBody: body })?.recognised).toBe(false)
  })

  it('returns null for a body that is not an event', () => {
    expect(
      adapter.describeWebhook({ rawBody: Buffer.from('not json', 'utf8') }),
    ).toBeNull()

    expect(
      adapter.describeWebhook({ rawBody: Buffer.from('{"id":1}', 'utf8') }),
    ).toBeNull()
  })
})

import { createHmac } from 'crypto'
import { PaymobAdapter } from './paymob.adapter'
import { ProviderError } from '../../provider.types'
import type { IPaymentProvider } from '../../payment-provider.interface'
import type { PaymentCallContext } from '../../provider.types'
import type { PaymobHttp, PaymobRequest, PaymobResponse } from './paymob-client'
import {
  CREATE_INTENTION_RESPONSE,
  DOCUMENTED_ERRORS,
  DOCUMENTED_HMAC_STRING,
  PROCESSED_CALLBACK,
} from './paymob-fixtures'

/**
 * Paymob adapter, against the documented request and response shapes.
 *
 * Entirely offline: the transport is a recording stub, and every payload
 * is either quoted from Paymob's documentation (`paymob-fixtures.ts`) or
 * derived from one. No live Paymob call is made anywhere in this suite.
 */

const HMAC_SECRET = 'hmac_secret_for_spec'

const CREDENTIALS = {
  secret_key: 'egy_sk_test_spec',
  public_key: 'egy_pk_test_spec',
  api_key: 'api_key_spec_value',
  hmac_secret: HMAC_SECRET,
}

interface Stub {
  http: PaymobHttp
  calls: PaymobRequest[]
}

/** A transport that answers each path from a table, recording what it saw. */
function stub(
  responses: Record<string, PaymobResponse | (() => PaymobResponse)> = {},
): Stub {
  const calls: PaymobRequest[] = []

  const http: PaymobHttp = async (request) => {
    calls.push(request)

    for (const [fragment, answer] of Object.entries(responses)) {
      if (request.url.includes(fragment)) {
        return typeof answer === 'function' ? answer() : answer
      }
    }

    return { status: 200, body: {} }
  }

  return { http, calls }
}

const ok = (body: unknown): PaymobResponse => ({ status: 200, body })

const authOk = ok({ token: 'auth_token_value' })

function context(over: Partial<PaymentCallContext> = {}): PaymentCallContext {
  return {
    storeId: 1n,
    mode: 'test',
    accountId: 9n,
    offeringId: 2n,
    method: 'card',
    gatewayMethodConfig: '4345907',
    intentId: 77n,
    attemptId: null,
    attemptSequence: 1,
    amountMinor: 100_000n,
    currency: 'EGP',
    credentials: CREDENTIALS,
    ...over,
  }
}

function signedQuery(transaction: unknown = PROCESSED_CALLBACK.obj) {
  const payload =
    transaction === PROCESSED_CALLBACK.obj
      ? DOCUMENTED_HMAC_STRING
      : undefined

  // The documented string for the documented payload; otherwise let the
  // module compute it, which the HMAC spec has already pinned.
  const hmac = createHmac('sha512', HMAC_SECRET)
    .update(payload ?? '', 'utf8')
    .digest('hex')

  return { hmac }
}

const callbackBody = (obj: unknown = PROCESSED_CALLBACK.obj) =>
  Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8')

/* ------------------------------------------------------------------ */

describe('capabilities', () => {
  it('declares the gateway the catalog knows', () => {
    expect(new PaymobAdapter(stub().http).capabilities.gateway).toBe('paymob')
  })

  it('claims only what the documentation backs', () => {
    const c = new PaymobAdapter(stub().http).capabilities

    // Documented and implemented.
    expect(c.manualCapture).toBe(true)
    expect(c.partialCapture).toBe(true)
    expect(c.multiCapture).toBe(true)
    expect(c.refundSupported).toBe(true)
    expect(c.partialRefund).toBe(true)
    expect(c.voidSupported).toBe(true)
    expect(c.webhooks).toBe(true)
    expect(c.statusPolling).toBe(true)

    // Documented features we have not implemented, so not claimed.
    expect(c.vaulting).toBe(false)
    expect(c.merchantInitiated).toBe(false)
    // Not documented in the pages this adapter is built from.
    expect(c.authorizationExpiry).toBe(false)
    expect(c.settlementReports).toBe(false)
  })

  it('is endpoint-scoped, so no unverified body is parsed to route it', () => {
    const adapter: IPaymentProvider = new PaymobAdapter(stub().http)

    // The merchant sets a per-account callback URL on the integration ID,
    // so the account comes from the path and nothing in the unverified
    // body is read to route it.
    expect(adapter.capabilities.webhookResolution).toBe('endpoint_scoped')
    expect(adapter.extractWebhookAccountRef).toBeUndefined()
  })

  it('names the credential field its signing secret lives in', () => {
    // Paymob's dashboard calls it the HMAC secret; ingestion reads the
    // adapter's declaration rather than assuming Stripe's spelling.
    expect(new PaymobAdapter(stub().http).capabilities.webhookSecretField).toBe(
      'hmac_secret',
    )
  })

  it('is scoped to Egypt and EGP', () => {
    expect(new PaymobAdapter(stub().http).capabilities.currencies).toEqual(['EGP'])
  })
})

describe('validateCredentials', () => {
  it('authenticates the API key against the documented endpoint', async () => {
    const s = stub({ '/api/auth/tokens': authOk })

    const result = await new PaymobAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result).toEqual({ valid: true })
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].url).toBe('https://accept.paymob.com/api/auth/tokens')
    expect(s.calls[0].method).toBe('POST')
    expect(s.calls[0].body).toEqual({ api_key: CREDENTIALS.api_key })
  })

  it('reports a missing field without calling out', async () => {
    const s = stub({ '/api/auth/tokens': authOk })

    const result = await new PaymobAdapter(s.http).validateCredentials({
      credentials: { ...CREDENTIALS, secret_key: '' },
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    expect(result.message).toContain('secret_key')
    expect(s.calls).toHaveLength(0)
  })

  it('catches a live key pasted into a test account', async () => {
    // The most common way a merchant breaks their own checkout, and one
    // the provider would only report as a vague authorization failure.
    const s = stub({ '/api/auth/tokens': authOk })

    const result = await new PaymobAdapter(s.http).validateCredentials({
      credentials: { ...CREDENTIALS, secret_key: 'egy_sk_live_spec' },
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('mode_mismatch')
    expect(s.calls).toHaveLength(0)
  })

  it('reports a rejected key rather than throwing', async () => {
    // A merchant's typo must not become a 500 at the settings screen.
    const s = stub({
      '/api/auth/tokens': { status: 401, body: { detail: 'Invalid token.' } },
    })

    const result = await new PaymobAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
  })

  it('never puts a credential value in the message', async () => {
    const s = stub({
      '/api/auth/tokens': { status: 401, body: { detail: 'Invalid token.' } },
    })

    const result = await new PaymobAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    for (const secret of Object.values(CREDENTIALS)) {
      expect(result.message ?? '').not.toContain(secret)
    }
  })
})

describe('initializePayment', () => {
  const intentionOk = ok(CREATE_INTENTION_RESPONSE)

  it('creates an intention with the documented request shape', async () => {
    const s = stub({ '/v1/intention/': intentionOk })

    await new PaymobAdapter(s.http).initializePayment(context())

    const call = s.calls[0]

    expect(call.url).toBe('https://accept.paymob.com/v1/intention/')
    expect(call.headers.authorization).toBe(`Token ${CREDENTIALS.secret_key}`)
    expect(call.body).toMatchObject({
      // "expressed in cents" — the same minor units we hold.
      amount: 100000,
      currency: 'EGP',
      payment_methods: [4345907],
    })
  })

  it('sends the integration ID from the offering, as a number when numeric', async () => {
    const s = stub({ '/v1/intention/': intentionOk })

    await new PaymobAdapter(s.http).initializePayment(
      context({ gatewayMethodConfig: '999' }),
    )

    expect((s.calls[0].body as { payment_methods: unknown[] }).payment_methods).toEqual([999])
  })

  it('accepts a named integration, which the docs also allow', async () => {
    const s = stub({ '/v1/intention/': intentionOk })

    await new PaymobAdapter(s.http).initializePayment(
      context({ gatewayMethodConfig: 'card' }),
    )

    expect((s.calls[0].body as { payment_methods: unknown[] }).payment_methods).toEqual(['card'])
  })

  it('returns a Unified Checkout redirect carrying the client secret', async () => {
    const result = await new PaymobAdapter(
      stub({ '/v1/intention/': intentionOk }).http,
    ).initializePayment(context())

    expect(result.kind).toBe('requires_action')

    if (result.kind !== 'requires_action') return

    expect(result.nextAction).toEqual({
      kind: 'redirect',
      url:
        'https://eg.checkout.paymob.com/?publicKey=egy_pk_test_spec' +
        `&clientSecret=${CREATE_INTENTION_RESPONSE.client_secret}`,
      method: 'GET',
    })
  })

  it('correlates on the Paymob order id, not the intention id', async () => {
    // The order id is what every callback carries as order.id. Using the
    // intention id here would leave every callback unmatched.
    const result = await new PaymobAdapter(
      stub({ '/v1/intention/': intentionOk }).http,
    ).initializePayment(context())

    if (result.kind !== 'requires_action') throw new Error('wrong kind')

    expect(result.refs?.gatewayReference).toBe(
      String(CREATE_INTENTION_RESPONSE.intention_order_id),
    )
    expect(result.refs?.gatewayReference).not.toBe(CREATE_INTENTION_RESPONSE.id)
  })

  it('refuses an offering with no integration ID', async () => {
    await expect(
      new PaymobAdapter(stub().http).initializePayment(
        context({ gatewayMethodConfig: '' }),
      ),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('maps the documented unknown-integration error', async () => {
    const s = stub({
      '/v1/intention/': { status: 404, body: DOCUMENTED_ERRORS.unknownIntegration },
    })

    await expect(
      new PaymobAdapter(s.http).initializePayment(context()),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('turns a transport failure into a retryable error', async () => {
    const http: PaymobHttp = async () => {
      throw new Error('socket hang up')
    }

    const error = await new PaymobAdapter(http)
      .initializePayment(context())
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe('provider_timeout')
  })
})

describe('outbound idempotency', () => {
  it('sends the deterministic key core derived as special_reference', async () => {
    const s = stub({ '/v1/intention/': ok(CREATE_INTENTION_RESPONSE) })

    await new PaymobAdapter(s.http).initializePayment(
      context({ idempotencyKey: 'psp:1:77:1:initialize' }),
    )

    // Paymob documents no idempotency header. The deterministic
    // reference is what correlates a retry to the attempt it belongs to,
    // and it comes back on the callback as merchant_order_id.
    expect((s.calls[0].body as { special_reference: string }).special_reference).toBe(
      'psp:1:77:1:initialize',
    )
  })

  it('sends the same reference for the same call twice', async () => {
    const s = stub({ '/v1/intention/': ok(CREATE_INTENTION_RESPONSE) })
    const adapter = new PaymobAdapter(s.http)

    await adapter.initializePayment(context())
    await adapter.initializePayment(context())

    const references = s.calls.map(
      (call) => (call.body as { special_reference: string }).special_reference,
    )

    // Derived, never random: a retry carrying a fresh reference is how a
    // customer gets charged twice.
    expect(new Set(references).size).toBe(1)
  })
})

describe('parseWebhook', () => {
  const base = {
    accountId: 7n,
    signingSecret: HMAC_SECRET,
    mode: 'test' as const,
    headers: {},
  }

  it('accepts a correctly signed callback and maps it to a fact', async () => {
    const facts = await new PaymobAdapter(stub().http).parseWebhook({
      ...base,
      rawBody: callbackBody(),
      query: signedQuery(),
    })

    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      accountId: 7n,
      // The order id, which is what the attempt was recorded against.
      gatewayReference: '217503754',
      factType: 'attempt_captured',
      cumulativeAmountMinor: 100000n,
      currency: 'EGP',
    })
    expect(facts[0].refs?.gatewayPaymentId).toBe('192036465')
  })

  it('reads the signature from the query string, where Paymob puts it', async () => {
    // Not a header: an adapter looking only at headers would reject every
    // real Paymob callback.
    await expect(
      new PaymobAdapter(stub().http).parseWebhook({
        ...base,
        rawBody: callbackBody(),
        headers: { hmac: signedQuery().hmac },
        query: {},
      }),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('rejects a callback with no signature', async () => {
    await expect(
      new PaymobAdapter(stub().http).parseWebhook({
        ...base,
        rawBody: callbackBody(),
        query: {},
      }),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('rejects a forged signature', async () => {
    await expect(
      new PaymobAdapter(stub().http).parseWebhook({
        ...base,
        rawBody: callbackBody(),
        query: { hmac: 'f'.repeat(128) },
      }),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('rejects a body altered after signing', async () => {
    // The attack that matters: a real callback edited to a larger amount.
    const tampered = { ...PROCESSED_CALLBACK.obj, amount_cents: 999_999 }

    await expect(
      new PaymobAdapter(stub().http).parseWebhook({
        ...base,
        rawBody: callbackBody(tampered),
        query: signedQuery(),
      }),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('rejects a body that is not JSON, with a ProviderError', async () => {
    // Arrives from an unauthenticated endpoint; a bare throw here would
    // be a 500 anyone could trigger.
    const error = await new PaymobAdapter(stub().http)
      .parseWebhook({
        ...base,
        rawBody: Buffer.from('<html>nope</html>', 'utf8'),
        query: signedQuery(),
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProviderError)
  })
})

describe('describeWebhook', () => {
  it('identifies a callback by transaction and change time', () => {
    const descriptor = new PaymobAdapter(stub().http).describeWebhook({
      rawBody: callbackBody(),
    })

    // Paymob sends no event id. Keying on the transaction alone would
    // make a later refund callback look like a duplicate of the original
    // payment and be dropped.
    expect(descriptor).toEqual({
      eventId: '192036465:2024-06-13T11:34:07.272638',
      eventType: 'TRANSACTION',
      recognised: true,
    })
  })

  it('gives a later state of the same transaction a different identity', () => {
    const adapter = new PaymobAdapter(stub().http)

    const first = adapter.describeWebhook({ rawBody: callbackBody() })
    const refunded = adapter.describeWebhook({
      rawBody: callbackBody({
        ...PROCESSED_CALLBACK.obj,
        is_refunded: true,
        refunded_amount_cents: 100000,
        updated_at: '2024-06-14T09:00:00.000000',
      }),
    })

    expect(first?.eventId).not.toBe(refunded?.eventId)
  })

  it('does not throw on garbage', () => {
    const adapter = new PaymobAdapter(stub().http)

    for (const body of ['not json', '', '{}', '{"obj":{}}']) {
      expect(() =>
        adapter.describeWebhook({ rawBody: Buffer.from(body, 'utf8') }),
      ).not.toThrow()
    }
  })
})

describe('capture, void and refund', () => {
  const captured = {
    ...PROCESSED_CALLBACK.obj,
    id: 590506,
    is_capture: true,
    captured_amount: 60_000,
  }

  it('captures against the documented endpoint and transaction id', async () => {
    const s = stub({ '/api/acceptance/capture': ok(captured) })

    const facts = await new PaymobAdapter(s.http).capture({
      accountId: 9n,
      gatewayReference: '217503754',
      gatewayPaymentId: '192036465',
      amountMinor: 60_000n,
      currency: 'EGP',
      credentials: CREDENTIALS,
      idempotencyKey: 'psp:1:77:1:capture:60000',
      mode: 'test',
    })

    expect(s.calls[0].url).toBe('https://accept.paymob.com/api/acceptance/capture')
    expect(s.calls[0].body).toEqual({
      // The transaction id, not the order id.
      transaction_id: '192036465',
      amount_cents: 60000,
    })
    expect(facts[0]).toMatchObject({
      factType: 'attempt_captured',
      // captured_amount is documented as the cumulative total.
      cumulativeAmountMinor: 60_000n,
    })
  })

  it('voids against the documented endpoint', async () => {
    const s = stub({
      '/void': ok({ ...PROCESSED_CALLBACK.obj, id: 579405, is_voided: true }),
    })

    const facts = await new PaymobAdapter(s.http).voidAuthorization({
      accountId: 9n,
      gatewayReference: '217503754',
      gatewayPaymentId: '192036465',
      credentials: CREDENTIALS,
      idempotencyKey: 'psp:1:77:1:void',
      mode: 'test',
    })

    expect(s.calls[0].url).toBe(
      'https://accept.paymob.com/api/acceptance/void_refund/void',
    )
    expect(s.calls[0].body).toEqual({ transaction_id: '192036465' })
    expect(facts[0].factType).toBe('attempt_voided')
  })

  it('refunds a partial amount against the documented endpoint', async () => {
    const s = stub({
      '/refund': ok({
        ...PROCESSED_CALLBACK.obj,
        id: 579305,
        is_refunded: true,
        refunded_amount_cents: 25_000,
      }),
    })

    const facts = await new PaymobAdapter(s.http).refund({
      accountId: 9n,
      gatewayReference: '217503754',
      gatewayPaymentId: '192036465',
      gatewayCaptureRef: null,
      amountMinor: 25_000n,
      currency: 'EGP',
      credentials: CREDENTIALS,
      idempotencyKey: 'psp:1:77:1:refund:25000',
      mode: 'test',
    })

    expect(s.calls[0].url).toBe(
      'https://accept.paymob.com/api/acceptance/void_refund/refund',
    )
    expect(s.calls[0].body).toEqual({
      transaction_id: '192036465',
      amount_cents: 25000,
    })
    expect(facts[0]).toMatchObject({
      factType: 'refund_succeeded',
      // refunded_amount_cents is the documented cumulative total.
      cumulativeAmountMinor: 25_000n,
    })
  })

  it('refuses to act when no transaction id is known yet', async () => {
    // Before the callback there is no Paymob transaction to act on.
    // Sending the order id in its place would be a guess about which
    // record the provider should touch.
    const s = stub()

    await expect(
      new PaymobAdapter(s.http).capture({
        accountId: 9n,
        gatewayReference: '217503754',
        gatewayPaymentId: null,
        amountMinor: 60_000n,
        currency: 'EGP',
        credentials: CREDENTIALS,
        idempotencyKey: 'k',
        mode: 'test',
      }),
    ).rejects.toMatchObject({ code: 'configuration_error' })

    expect(s.calls).toHaveLength(0)
  })

  it('maps the documented over-refund and over-capture errors', async () => {
    const overRefund = stub({
      '/refund': { status: 400, body: DOCUMENTED_ERRORS.refundTooLarge },
    })

    await expect(
      new PaymobAdapter(overRefund.http).refund({
        accountId: 9n,
        gatewayReference: '1',
        gatewayPaymentId: '2',
        gatewayCaptureRef: null,
        amountMinor: 1n,
        currency: 'EGP',
        credentials: CREDENTIALS,
        idempotencyKey: 'k',
        mode: 'test',
      }),
    ).rejects.toMatchObject({ code: 'amount_limit' })

    const overCapture = stub({
      '/capture': { status: 400, body: DOCUMENTED_ERRORS.captureTooLarge },
    })

    await expect(
      new PaymobAdapter(overCapture.http).capture({
        accountId: 9n,
        gatewayReference: '1',
        gatewayPaymentId: '2',
        amountMinor: 1n,
        currency: 'EGP',
        credentials: CREDENTIALS,
        idempotencyKey: 'k',
        mode: 'test',
      }),
    ).rejects.toMatchObject({ code: 'amount_limit' })
  })
})

describe('fetchStatus', () => {
  it('authenticates with the API key, then inquires by order id', async () => {
    const s = stub({
      '/api/auth/tokens': authOk,
      '/transaction_inquiry': ok(PROCESSED_CALLBACK.obj),
    })

    const facts = await new PaymobAdapter(s.http).fetchStatus({
      accountId: 9n,
      gatewayReference: '217503754',
      credentials: CREDENTIALS,
      mode: 'test',
    })

    // Inquiry takes a Bearer auth token, not the secret key. Two
    // schemes, because Paymob documents two.
    expect(s.calls[0].url).toContain('/api/auth/tokens')
    expect(s.calls[1].url).toBe(
      'https://accept.paymob.com/api/ecommerce/orders/transaction_inquiry',
    )
    expect(s.calls[1].headers.authorization).toBe('Bearer auth_token_value')
    expect(s.calls[1].body).toMatchObject({ order_id: '217503754' })

    expect(facts[0]).toMatchObject({
      gatewayReference: '217503754',
      factType: 'attempt_captured',
    })
  })

  it('refuses without an API key rather than guessing another credential', async () => {
    await expect(
      new PaymobAdapter(stub().http).fetchStatus({
        accountId: 9n,
        gatewayReference: '1',
        credentials: { ...CREDENTIALS, api_key: '' },
        mode: 'test',
      }),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('returns facts, never null', async () => {
    const s = stub({ '/api/auth/tokens': authOk, '/transaction_inquiry': ok({}) })

    await expect(
      new PaymobAdapter(s.http).fetchStatus({
        accountId: 9n,
        gatewayReference: '1',
        credentials: CREDENTIALS,
        mode: 'test',
      }),
    ).resolves.toEqual([])
  })
})

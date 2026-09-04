import { TapAdapter } from './tap.adapter'
import { ProviderError } from '../../provider.types'
import type { PaymentCallContext } from '../../provider.types'
import type { IPaymentProvider } from '../../payment-provider.interface'
import type { TapHttp, TapRequest, TapResponse } from './tap-client'
import { tapHash, tapHashFields } from './tap-hash'
import {
  AUTHORIZED_CALLBACK,
  CANCELLED_CHARGE,
  CAPTURED_CHARGE_CALLBACK,
  CREATE_CHARGE_RESPONSE,
  DOCUMENTED_ERRORS,
  REFUND_RESPONSE,
} from './tap-fixtures'

/**
 * Tap adapter, against the documented request and response shapes.
 *
 * Entirely offline: the transport is a recording stub and every payload
 * comes from `tap-fixtures.ts`, which is transcribed from Tap's own
 * documentation. No live Tap call is made anywhere.
 */

/*
 * A DETERMINISTIC, NON-CREDENTIAL TEST SECRET.
 *
 * This used to be the sample key printed in Tap's own API
 * documentation. It was not a live credential and never was one, but
 * it had the shape of a provider test secret key, so GitHub Push
 * Protection refused any push containing it and every secret scanner
 * looking at this repository flagged it, forever. The literal is
 * deliberately not repeated here — quoting it would reintroduce
 * exactly the string that has to stay out of this history.
 *
 * Nothing depends on the SUFFIX: every hash in these specs is recomputed
 * at runtime with Node's own HMAC from whatever this string is, so the
 * assertions pin the ALGORITHM, not a transcribed digest.
 *
 * The `sk_test_` PREFIX is load-bearing and must stay — `TapAdapter`
 * derives test/live mode from it (`key.startsWith(own)`), which is what
 * the `mode_mismatch` specs exercise. What was removed is the 24
 * characters of key-shaped entropy after it, which is the only part a
 * scanner reacts to; the short, obviously-fake `sk_test_` values that
 * were already in this file have never been flagged.
 */
const SECRET = 'sk_test_fixture'

const CREDENTIALS = {
  secret_key: SECRET,
  merchant_id: '599424',
  redirect_url: 'https://store.example/checkout/return',
  post_url: 'https://api.example/payments/webhooks/tap/9',
}

interface Stub {
  http: TapHttp
  calls: TapRequest[]
}

function stub(responses: Record<string, TapResponse> = {}): Stub {
  const calls: TapRequest[] = []

  const http: TapHttp = async (request) => {
    calls.push(request)

    for (const [fragment, answer] of Object.entries(responses)) {
      if (request.url.includes(fragment)) return answer
    }

    if (request.url.endsWith('/charges/list')) {
      return { status: 200, body: { object_type: 'list', charges: [] } }
    }

    if (request.url.endsWith('/charges')) {
      return { status: 200, body: CREATE_CHARGE_RESPONSE }
    }

    if (request.url.endsWith('/refunds')) {
      return { status: 200, body: REFUND_RESPONSE }
    }

    return { status: 200, body: CAPTURED_CHARGE_CALLBACK }
  }

  return { http, calls }
}

const ok = (body: unknown): TapResponse => ({ status: 200, body })

/** The payer identity Tap requires, carried on the call metadata. */
const CUSTOMER = {
  customer_first_name: 'Sara',
  customer_last_name: 'Ahmed',
  customer_email: 'sara@example.com',
  customer_phone_country_code: '965',
  customer_phone_number: '51234567',
}

function context(over: Partial<PaymentCallContext> = {}): PaymentCallContext {
  return {
    storeId: 1n,
    mode: 'test',
    accountId: 9n,
    offeringId: 2n,
    method: 'card',
    gatewayMethodConfig: '',
    intentId: 77n,
    attemptId: null,
    attemptSequence: 1,
    amountMinor: 10_000n,
    currency: 'KWD',
    credentials: CREDENTIALS,
    metadata: CUSTOMER,
    ...over,
  }
}

const body = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8')

/** A callback signed the way Tap documents, in the given mode. */
function signed(payload: Record<string, unknown>, secret = SECRET) {
  return {
    rawBody: body(payload),
    headers: { hashstring: tapHash(tapHashFields(payload)!, secret) },
  }
}

const testModeCallback = { ...CAPTURED_CHARGE_CALLBACK, live_mode: false }

const webhookInput = (over: Record<string, unknown> = {}) => ({
  accountId: 7n,
  ...signed(testModeCallback),
  query: {},
  signingSecret: SECRET,
  mode: 'test' as const,
  ...over,
})

/* ------------------------------------------------------------------ */

describe('capabilities', () => {
  it('declares the gateway the catalog knows', () => {
    expect(new TapAdapter(stub().http).capabilities.gateway).toBe('tap')
  })

  it('claims only what is documented and reachable', () => {
    const c = new TapAdapter(stub().http).capabilities

    // Documented and implemented.
    expect(c.automaticCapture).toBe(true)
    expect(c.refundSupported).toBe(true)
    expect(c.partialRefund).toBe(true)
    expect(c.webhooks).toBe(true)
    expect(c.statusPolling).toBe(true)
    expect(c.threeDSecure).toBe(true)

    // Documented at the API level but unreachable through the redirect
    // flow: capture needs an Authorize ID, and an authorize needs a
    // Token ID from the Card SDK.
    expect(c.manualCapture).toBe(false)
    expect(c.partialCapture).toBe(false)
    expect(c.multiCapture).toBe(false)

    // Tap documents no manual void endpoint at all — only a scheduled
    // auto-void set when an authorize is created.
    expect(c.voidSupported).toBe(false)

    // Documented features not implemented here.
    expect(c.vaulting).toBe(false)
    expect(c.merchantInitiated).toBe(false)
    expect(c.settlementReports).toBe(false)
  })

  it('carries no method for a capability it disclaims', () => {
    const adapter: IPaymentProvider = new TapAdapter(stub().http)

    expect(adapter.capture).toBeUndefined()
    expect(adapter.voidAuthorization).toBeUndefined()
  })

  it('names the secret key as the webhook signing secret', () => {
    // Tap issues no separate signing secret: the hashstring is an HMAC
    // keyed by the merchant's Secret API Key.
    expect(new TapAdapter(stub().http).capabilities.webhookSecretField).toBe(
      'secret_key',
    )
  })

  it('routes callbacks by the endpoint, never by the unverified body', () => {
    expect(new TapAdapter(stub().http).capabilities.webhookResolution).toBe(
      'endpoint_scoped',
    )
    expect(
      (new TapAdapter(stub().http) as IPaymentProvider).extractWebhookAccountRef,
    ).toBeUndefined()
  })

  it('offers only the redirect next action', () => {
    expect(new TapAdapter(stub().http).capabilities.nextActionKinds).toEqual([
      'redirect',
    ])
  })
})

/* ------------------------------------------------------------------ */

describe('validateCredentials', () => {
  it('accepts a key the documented read endpoint answers for', async () => {
    const s = stub()

    const result = await new TapAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result.valid).toBe(true)
    // POST /v2/charges/list — an authenticated read that creates nothing.
    expect(s.calls[0].url).toBe('https://api.tap.company/v2/charges/list')
    expect(s.calls[0].method).toBe('POST')
    expect(s.calls[0].apiKey).toBe(SECRET)
  })

  it('rejects a missing key without calling out', async () => {
    const s = stub()

    const result = await new TapAdapter(s.http).validateCredentials({
      credentials: {},
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    expect(s.calls).toHaveLength(0)
  })

  it('rejects a live key saved against a test account', async () => {
    const result = await new TapAdapter(stub().http).validateCredentials({
      credentials: { ...CREDENTIALS, secret_key: 'sk_live_something' },
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('mode_mismatch')
  })

  it('rejects a test key saved against a live account', async () => {
    const result = await new TapAdapter(stub().http).validateCredentials({
      credentials: { ...CREDENTIALS, secret_key: 'sk_test_something' },
      mode: 'live',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('mode_mismatch')
  })

  it('accepts a key whose prefix it does not recognise', async () => {
    // Only an unambiguous contradiction is worth failing on; Tap is free
    // to mint a key format we have not seen.
    const result = await new TapAdapter(stub().http).validateCredentials({
      credentials: { ...CREDENTIALS, secret_key: 'some_other_shape' },
      mode: 'live',
    })

    expect(result.valid).toBe(true)
  })

  it('reports rather than throws when Tap rejects the key', async () => {
    const s = stub({
      '/charges/list': {
        status: 401,
        body: DOCUMENTED_ERRORS.missingAuthorization,
      },
    })

    const result = await new TapAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    // A merchant's typo must not become a 500 on the settings screen.
    expect(result.message).toContain('7022')
  })

  it('never puts the key in the message it returns', async () => {
    const s = stub({
      '/charges/list': { status: 401, body: DOCUMENTED_ERRORS.missingAuthorization },
    })

    const result = await new TapAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result.message ?? '').not.toContain(SECRET)
  })
})

/* ------------------------------------------------------------------ */

describe('initializePayment', () => {
  it('creates a charge and returns Tap’s hosted payment URL', async () => {
    const s = stub()

    const result = await new TapAdapter(s.http).initializePayment(context())

    expect(result).toEqual({
      kind: 'requires_action',
      nextAction: {
        kind: 'redirect',
        url: 'https://checkout.payments.tap.company?mode=page&token=6318405da53ea40ebd4da0c0',
        method: 'GET',
      },
      refs: {
        gatewayReference: 'chg_TS012520220955Rr950709475',
        gatewayPaymentId: 'chg_TS012520220955Rr950709475',
      },
    })

    expect(s.calls[0].url).toBe('https://api.tap.company/v2/charges')
    expect(s.calls[0].method).toBe('POST')
  })

  it('sends the amount as a decimal in the major unit', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(
      context({ amountMinor: 10_000n, currency: 'KWD' }),
    )

    // 10.000 KWD, not 10000.
    expect((s.calls[0].body as { amount: number }).amount).toBe(10)
    expect((s.calls[0].body as { currency: string }).currency).toBe('KWD')
  })

  it('converts a two-decimal currency correctly too', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(
      context({ amountMinor: 10_050n, currency: 'SAR' }),
    )

    expect((s.calls[0].body as { amount: number }).amount).toBe(100.5)
  })

  it('picks the documented source id for the offering’s method', async () => {
    for (const [method, source] of [
      ['card', 'src_card'],
      ['mada', 'src_sa.mada'],
      ['knet', 'src_kw.knet'],
      ['benefit', 'src_bh.benefit'],
      ['apple_pay', 'src_apple_pay'],
    ] as const) {
      const s = stub()

      await new TapAdapter(s.http).initializePayment(context({ method }))

      expect((s.calls[0].body as { source: { id: string } }).source.id).toBe(source)
    }
  })

  it('refuses a method Tap publishes no source for', async () => {
    await expect(
      new TapAdapter(stub().http).initializePayment(context({ method: 'kiosk' })),
    ).rejects.toMatchObject({ code: 'method_unavailable' })
  })

  it('sends the payer Tap requires, from the call metadata', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(context())

    expect((s.calls[0].body as { customer: unknown }).customer).toEqual({
      first_name: 'Sara',
      last_name: 'Ahmed',
      email: 'sara@example.com',
      // "The Country Code of the Phone Number. Do not add +."
      phone: { country_code: '965', number: '51234567' },
    })
  })

  it('sends only the customer id when one is known', async () => {
    // "If ID is passed, no need to pass the other parameters of this
    // object."
    const s = stub()

    await new TapAdapter(s.http).initializePayment(
      context({ metadata: { ...CUSTOMER, customer_id: 'cus_123' } }),
    )

    expect((s.calls[0].body as { customer: unknown }).customer).toEqual({
      id: 'cus_123',
    })
  })

  it('refuses rather than inventing a payer', async () => {
    // first_name and email are required by Create a Charge. A charge
    // carrying a placeholder name reaches the receipt, Tap's dashboard
    // and the merchant's reconciliation.
    const s = stub()

    await expect(
      new TapAdapter(s.http).initializePayment(context({ metadata: {} })),
    ).rejects.toMatchObject({ code: 'configuration_error' })

    expect(s.calls).toHaveLength(0)
  })

  it('sends the merchant’s configured redirect URL', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(context())

    expect((s.calls[0].body as { redirect: { url: string } }).redirect).toEqual({
      url: 'https://store.example/checkout/return',
    })
  })

  it('prefers the call context’s return URL when core supplies one', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(
      context({ returnUrl: 'https://store.example/orders/77' }),
    )

    expect((s.calls[0].body as { redirect: { url: string } }).redirect.url).toBe(
      'https://store.example/orders/77',
    )
  })

  it('refuses when no redirect URL exists at all', async () => {
    // `redirect` is a required field of Create a Charge.
    const { redirect_url, ...withoutRedirect } = CREDENTIALS

    await expect(
      new TapAdapter(stub().http).initializePayment(
        context({ credentials: withoutRedirect }),
      ),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('sends the webhook URL so Tap has somewhere to post', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(context())

    expect((s.calls[0].body as { post: { url: string } }).post).toEqual({
      url: 'https://api.example/payments/webhooks/tap/9',
    })
  })

  it('sends the merchant id and the statement descriptor when configured', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(
      context({ statementDescriptor: 'DART STORE' }),
    )

    const sent = s.calls[0].body as {
      merchant: { id: string }
      statement_descriptor: string
    }

    expect(sent.merchant).toEqual({ id: '599424' })
    expect(sent.statement_descriptor).toBe('DART STORE')
  })

  it('sends the references Tap recommends for reconciliation', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(context())

    const reference = (s.calls[0].body as { reference: Record<string, string> })
      .reference

    expect(reference.order).toBe('77')
    expect(reference.transaction).toBe('psp:1:77:1:initialize')
  })

  it('enables 3DS and marks the transaction customer-initiated', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(context())

    const sent = s.calls[0].body as Record<string, unknown>

    expect(sent.threeDSecure).toBe(true)
    expect(sent.customer_initiated).toBe(true)
    expect(sent.save_card).toBe(false)
  })

  it('reports a charge Tap captured outright as succeeded', async () => {
    const s = stub({
      '/charges': ok({ ...CAPTURED_CHARGE_CALLBACK, currency: 'SAR' }),
    })

    const result = await new TapAdapter(s.http).initializePayment(
      context({ currency: 'SAR' }),
    )

    expect(result).toEqual({
      kind: 'succeeded',
      capturedAmountMinor: 100n,
      refs: {
        gatewayReference: 'chg_TS05A4120230736x9K22710693',
        gatewayPaymentId: 'chg_TS05A4120230736x9K22710693',
      },
    })
  })

  it('reports a charge Tap refused as a failure with its published reason', async () => {
    const s = stub({
      '/charges': ok({
        ...CANCELLED_CHARGE,
        transaction: { timezone: 'UTC+03:00', created: '1632651545003' },
      }),
    })

    const result = await new TapAdapter(s.http).initializePayment(
      context({ currency: 'BHD' }),
    )

    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      // Response code 302 — "Canceled".
      expect(result.errorCode).toBe('unknown')
      expect(result.raw).toContain('CANCELLED')
    }
  })

  it('refuses a charge with neither a payment URL nor an outcome', async () => {
    const s = stub({
      '/charges': ok({
        id: 'chg_1',
        object: 'charge',
        status: 'INITIATED',
        amount: 10,
        currency: 'KWD',
      }),
    })

    await expect(
      new TapAdapter(s.http).initializePayment(context()),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it('maps a rejected request into the closed taxonomy', async () => {
    const s = stub({
      '/charges': { status: 400, body: DOCUMENTED_ERRORS.unableToProcess },
    })

    await expect(
      new TapAdapter(s.http).initializePayment(context()),
    ).rejects.toMatchObject({ code: 'declined_card_invalid' })
  })

  it('maps a transport failure to a retryable code', async () => {
    const http: TapHttp = async () => {
      throw new Error('socket hang up')
    }

    await expect(
      new TapAdapter(http).initializePayment(context()),
    ).rejects.toMatchObject({ code: 'provider_timeout' })
  })

  it('refuses without the secret key', async () => {
    await expect(
      new TapAdapter(stub().http).initializePayment(
        context({ credentials: { redirect_url: 'https://x.example' } }),
      ),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })
})

/* ------------------------------------------------------------------ */

describe('idempotency', () => {
  it('sends the key core derived, in the field Tap documents', async () => {
    const s = stub()

    await new TapAdapter(s.http).initializePayment(
      context({ idempotencyKey: 'psp:1:77:1:initialize' }),
    )

    // "An idempotent string is a unique identifier included in the
    // payment request to restrict duplicate actions."
    expect(
      (s.calls[0].body as { reference: { idempotent: string } }).reference
        .idempotent,
    ).toBe('psp:1:77:1:initialize')
  })

  it('sends the same key when the same call is retried', async () => {
    const s = stub()
    const adapter = new TapAdapter(s.http)

    await adapter.initializePayment(context())
    await adapter.initializePayment(context())

    const keys = s.calls.map(
      (call) => (call.body as { reference: { idempotent: string } }).reference.idempotent,
    )

    // Derived, never random: a retry carrying a fresh key is how a
    // customer gets charged twice.
    expect(new Set(keys).size).toBe(1)
  })

  it('carries the refund’s own key on a refund', async () => {
    const s = stub()

    await new TapAdapter(s.http).refund({
      accountId: 9n,
      gatewayReference: 'chg_1',
      gatewayPaymentId: 'chg_1',
      gatewayCaptureRef: null,
      amountMinor: 300n,
      currency: 'AED',
      credentials: CREDENTIALS,
      idempotencyKey: 'psp:1:77:1:refund:300',
      mode: 'test',
    })

    expect(
      (s.calls[0].body as { reference: { idempotent: string } }).reference.idempotent,
    ).toBe('psp:1:77:1:refund:300')
  })

  it('reshapes nothing, because Tap imposes no format', () => {
    expect(
      (new TapAdapter(stub().http) as IPaymentProvider).idempotencyKeyFor,
    ).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */

describe('fetchStatus', () => {
  it('reads the charge back from the documented retrieve endpoint', async () => {
    const s = stub()

    const facts = await new TapAdapter(s.http).fetchStatus({
      accountId: 9n,
      gatewayReference: 'chg_TS05A4120230736x9K22710693',
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(s.calls[0].method).toBe('GET')
    expect(s.calls[0].url).toBe(
      'https://api.tap.company/v2/charges/chg_TS05A4120230736x9K22710693',
    )

    expect(facts).toHaveLength(1)
    expect(facts[0].factType).toBe('attempt_captured')
    expect(facts[0].cumulativeAmountMinor).toBe(100n)
  })

  it('escapes the reference it was given', async () => {
    const s = stub()

    await new TapAdapter(s.http).fetchStatus({
      accountId: 9n,
      gatewayReference: 'chg /1',
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(s.calls[0].url).toBe('https://api.tap.company/v2/charges/chg%20%2F1')
  })

  it('returns nothing for a charge still awaiting the payer', async () => {
    const s = stub({ '/charges/': ok(CREATE_CHARGE_RESPONSE) })

    const facts = await new TapAdapter(s.http).fetchStatus({
      accountId: 9n,
      gatewayReference: 'chg_1',
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(facts).toEqual([])
  })
})

/* ------------------------------------------------------------------ */

describe('refund', () => {
  const refundInput = (over: Record<string, unknown> = {}) => ({
    accountId: 9n,
    gatewayReference: 'chg_TS05A4120230736x9K22710693',
    gatewayPaymentId: 'chg_TS05A4120230736x9K22710693',
    gatewayCaptureRef: null,
    amountMinor: 300n,
    currency: 'AED',
    credentials: CREDENTIALS,
    idempotencyKey: 'psp:1:77:1:refund:300',
    mode: 'test' as const,
    ...over,
  })

  it('posts to the documented refunds endpoint, keyed on the charge', async () => {
    const s = stub()

    await new TapAdapter(s.http).refund(refundInput())

    expect(s.calls[0].url).toBe('https://api.tap.company/v2/refunds')
    expect(s.calls[0].method).toBe('POST')

    const sent = s.calls[0].body as Record<string, unknown>

    expect(sent.charge_id).toBe('chg_TS05A4120230736x9K22710693')
    expect(sent.amount).toBe(3)
    expect(sent.currency).toBe('AED')
  })

  it('always names the amount rather than relying on a default', async () => {
    const s = stub()

    // A partial refund: "A partial refund returns a portion of the
    // transaction amount."
    await new TapAdapter(s.http).refund(refundInput({ amountMinor: 150n }))

    expect((s.calls[0].body as { amount: number }).amount).toBe(1.5)
  })

  it('converts a three-decimal refund correctly', async () => {
    const s = stub()

    await new TapAdapter(s.http).refund(
      refundInput({ amountMinor: 1_500n, currency: 'KWD' }),
    )

    expect((s.calls[0].body as { amount: number }).amount).toBe(1.5)
  })

  it('sends the reason Tap requires, defaulting to its own sample value', async () => {
    const s = stub()

    await new TapAdapter(s.http).refund(refundInput())
    expect((s.calls[0].body as { reason: string }).reason).toBe(
      'requested_by_customer',
    )

    const s2 = stub()
    await new TapAdapter(s2.http).refund(refundInput({ reason: 'Out of stock' }))
    expect((s2.calls[0].body as { reason: string }).reason).toBe('Out of stock')
  })

  it('sends the webhook URL so a later completion is heard', async () => {
    const s = stub()

    await new TapAdapter(s.http).refund(refundInput())

    expect((s.calls[0].body as { post: { url: string } }).post).toEqual({
      url: 'https://api.example/payments/webhooks/tap/9',
    })
  })

  it('returns a refund fact correlated on the charge', async () => {
    const facts = await new TapAdapter(stub().http).refund(refundInput())

    expect(facts).toHaveLength(1)
    expect(facts[0].factType).toBe('refund_succeeded')
    expect(facts[0].gatewayReference).toBe('chg_TS05A4120230736x9K22710693')
    expect(facts[0].cumulativeAmountMinor).toBe(300n)
  })

  it('returns nothing to apply while Tap is still processing', async () => {
    const s = stub({
      '/refunds': ok({ ...REFUND_RESPONSE, status: 'ACCEPTED' }),
    })

    expect(await new TapAdapter(s.http).refund(refundInput())).toEqual([])
  })

  it('records a refused refund as a failed refund', async () => {
    const s = stub({
      '/refunds': ok({ ...REFUND_RESPONSE, status: 'DECLINED' }),
    })

    const facts = await new TapAdapter(s.http).refund(refundInput())

    expect(facts[0].factType).toBe('refund_failed')
  })

  it('refuses without a charge id', async () => {
    await expect(
      new TapAdapter(stub().http).refund(refundInput({ gatewayReference: '' })),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })
})

/* ------------------------------------------------------------------ */

describe('parseWebhook', () => {
  it('accepts a callback whose hashstring matches', async () => {
    const facts = await new TapAdapter(stub().http).parseWebhook(webhookInput())

    expect(facts).toHaveLength(1)
    expect(facts[0].factType).toBe('attempt_captured')
    expect(facts[0].accountId).toBe(7n)
    expect(facts[0].gatewayReference).toBe('chg_TS05A4120230736x9K22710693')
  })

  it('refuses a callback whose hashstring does not match', async () => {
    const error = await new TapAdapter(stub().http)
      .parseWebhook(
        webhookInput({ headers: { hashstring: 'f'.repeat(64) } }),
      )
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe('authentication_failed')
  })

  it('refuses a callback signed with a different secret', async () => {
    await expect(
      new TapAdapter(stub().http).parseWebhook(
        webhookInput({ ...signed(testModeCallback, 'sk_test_someone_else') }),
      ),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('refuses a callback with no hashstring header at all', async () => {
    await expect(
      new TapAdapter(stub().http).parseWebhook(webhookInput({ headers: {} })),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('reads the header however it is cased or repeated', async () => {
    const hash = tapHash(tapHashFields(testModeCallback)!, SECRET)

    for (const headers of [
      { HashString: hash },
      { HASHSTRING: hash },
      { hashstring: [hash] },
    ]) {
      await expect(
        new TapAdapter(stub().http).parseWebhook(webhookInput({ headers })),
      ).resolves.toHaveLength(1)
    }
  })

  it('refuses a body that is not JSON, without a bare Error', async () => {
    const error = await new TapAdapter(stub().http)
      .parseWebhook(webhookInput({ rawBody: Buffer.from('not json', 'utf8') }))
      .catch((caught: unknown) => caught)

    // A bare Error would turn a forged callback into a 500.
    expect(error).toBeInstanceOf(ProviderError)
  })

  it('refuses a body with nothing verifiable in it', async () => {
    await expect(
      new TapAdapter(stub().http).parseWebhook(
        webhookInput({
          rawBody: body({ object: 'charge' }),
          headers: { hashstring: 'a'.repeat(64) },
        }),
      ),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('refuses a live callback delivered to a test account', async () => {
    // Applying it would mix real and simulated money.
    const live = { ...CAPTURED_CHARGE_CALLBACK, live_mode: true }

    await expect(
      new TapAdapter(stub().http).parseWebhook(
        webhookInput({ ...signed(live), mode: 'test' }),
      ),
    ).rejects.toMatchObject({ code: 'mode_mismatch' })
  })

  it('refuses a test callback delivered to a live account', async () => {
    await expect(
      new TapAdapter(stub().http).parseWebhook(
        webhookInput({ mode: 'live' }),
      ),
    ).rejects.toMatchObject({ code: 'mode_mismatch' })
  })

  it('verifies before it maps', async () => {
    // A body that fails verification must produce no facts at all, not
    // facts the caller is trusted to discard.
    const facts = await new TapAdapter(stub().http)
      .parseWebhook(webhookInput({ headers: { hashstring: 'f'.repeat(64) } }))
      .catch(() => [])

    expect(facts).toEqual([])
  })

  it('accepts a verified authorize and deliberately applies nothing', async () => {
    const authorize = { ...AUTHORIZED_CALLBACK, live_mode: false }

    expect(
      await new TapAdapter(stub().http).parseWebhook(
        webhookInput({ ...signed(authorize) }),
      ),
    ).toEqual([])
  })

  it('never leaks the secret in a rejection', async () => {
    const error = await new TapAdapter(stub().http)
      .parseWebhook(webhookInput({ headers: {} }))
      .catch((caught: unknown) => caught)

    expect((error as ProviderError).message).not.toContain(SECRET)
  })
})

/* ------------------------------------------------------------------ */

describe('describeWebhook', () => {
  it('synthesises an identity from the fields the hash covers', () => {
    // Tap sends no event id and no event type — only the object.
    expect(
      new TapAdapter(stub().http).describeWebhook({
        rawBody: body(CAPTURED_CHARGE_CALLBACK),
      }),
    ).toEqual({
      eventId: 'chg_TS05A4120230736x9K22710693:CAPTURED',
      eventType: 'charge.CAPTURED',
      recognised: true,
    })
  })

  it('distinguishes two outcomes for the same object', () => {
    const adapter = new TapAdapter(stub().http)

    const captured = adapter.describeWebhook({
      rawBody: body(CAPTURED_CHARGE_CALLBACK),
    })
    const voided = adapter.describeWebhook({
      rawBody: body({ ...CAPTURED_CHARGE_CALLBACK, status: 'VOID' }),
    })

    expect(captured!.eventId).not.toBe(voided!.eventId)
  })

  it('marks an undocumented status as unrecognised', () => {
    expect(
      new TapAdapter(stub().http).describeWebhook({
        rawBody: body({ ...CAPTURED_CHARGE_CALLBACK, status: 'MADE_UP' }),
      })?.recognised,
    ).toBe(false)
  })

  it('returns null rather than throwing on rubbish', () => {
    const adapter = new TapAdapter(stub().http)

    expect(adapter.describeWebhook({ rawBody: Buffer.from('not json') })).toBeNull()
    expect(adapter.describeWebhook({ rawBody: Buffer.alloc(0) })).toBeNull()
    expect(adapter.describeWebhook({ rawBody: body({ object: 'charge' }) })).toBeNull()
  })
})

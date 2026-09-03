import { MoyasarAdapter } from './moyasar.adapter'
import { ProviderError } from '../../provider.types'
import type { PaymentCallContext } from '../../provider.types'
import type { IPaymentProvider } from '../../payment-provider.interface'
import type {
  MoyasarHttp,
  MoyasarRequest,
  MoyasarResponse,
} from './moyasar-client'
import {
  CREATE_INVOICE_RESPONSE,
  DOCUMENTED_ERRORS,
  PAID_PAYMENT,
  webhookEvent,
} from './moyasar-fixtures'

/**
 * Moyasar adapter, against the documented request and response shapes.
 *
 * Entirely offline: the transport is a recording stub and every payload
 * comes from `moyasar-fixtures.ts`, which is transcribed from Moyasar's
 * own documentation. No live Moyasar call is made anywhere.
 */

const SECRET = 'moyasar-webhook-secret'

const CREDENTIALS = { secret_key: 'sk_test_spec', webhook_secret: SECRET }

interface Stub {
  http: MoyasarHttp
  calls: MoyasarRequest[]
}

function stub(
  responses: Record<string, MoyasarResponse> = {},
): Stub {
  const calls: MoyasarRequest[] = []

  const http: MoyasarHttp = async (request) => {
    calls.push(request)

    for (const [fragment, answer] of Object.entries(responses)) {
      if (request.url.includes(fragment)) return answer
    }

    return { status: 200, body: {} }
  }

  return { http, calls }
}

const ok = (body: unknown): MoyasarResponse => ({ status: 200, body })

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
    currency: 'SAR',
    credentials: CREDENTIALS,
    ...over,
  }
}

const body = (event: unknown) => Buffer.from(JSON.stringify(event), 'utf8')

const webhookInput = (over: Record<string, unknown> = {}) => ({
  accountId: 7n,
  rawBody: body(webhookEvent()),
  headers: {},
  query: {},
  signingSecret: SECRET,
  mode: 'test' as const,
  ...over,
})

/* ------------------------------------------------------------------ */

describe('capabilities', () => {
  it('declares the gateway the catalog knows', () => {
    expect(new MoyasarAdapter(stub().http).capabilities.gateway).toBe('moyasar')
  })

  it('claims only what is documented and reachable', () => {
    const c = new MoyasarAdapter(stub().http).capabilities

    // Documented and implemented.
    expect(c.automaticCapture).toBe(true)
    expect(c.refundSupported).toBe(true)
    expect(c.partialRefund).toBe(true)
    expect(c.webhooks).toBe(true)
    expect(c.statusPolling).toBe(true)
    expect(c.threeDSecure).toBe(true)

    // Documented at the API level but unreachable through the invoice
    // flow: an invoice has no `manual` option, so a payment created here
    // can never reach `authorized`.
    expect(c.manualCapture).toBe(false)
    expect(c.partialCapture).toBe(false)
    expect(c.voidSupported).toBe(false)

    // Documented features not implemented here.
    expect(c.vaulting).toBe(false)
    expect(c.merchantInitiated).toBe(false)
    expect(c.settlementReports).toBe(false)
  })

  it('carries no method for a capability it disclaims', () => {
    const adapter: IPaymentProvider = new MoyasarAdapter(stub().http)

    // A method present while the flag is false reads as supported to
    // anyone grepping, and is never reachable.
    expect(adapter.capture).toBeUndefined()
    expect(adapter.voidAuthorization).toBeUndefined()
    expect(typeof adapter.refund).toBe('function')
  })

  it('is endpoint-scoped, so no unverified body is parsed to route it', () => {
    const adapter: IPaymentProvider = new MoyasarAdapter(stub().http)

    expect(adapter.capabilities.webhookResolution).toBe('endpoint_scoped')
    expect(adapter.extractWebhookAccountRef).toBeUndefined()
  })

  it('does not narrow the currency set beyond what the docs state', () => {
    // The docs say "ISO-4217 three-letter currency code" with no
    // restriction, and give SAR, KWD and JPY as examples.
    expect(new MoyasarAdapter(stub().http).capabilities.currencies).toBe('all')
  })
})

describe('validateCredentials', () => {
  it('authenticates with Basic auth against a read the key may make', async () => {
    const s = stub({ '/payments': ok({ payments: [] }) })

    const result = await new MoyasarAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result).toEqual({ valid: true })
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].url).toBe('https://api.moyasar.com/v1/payments')
    expect(s.calls[0].method).toBe('GET')
    // The key travels as the Basic-auth username; the transport encodes
    // it so no call site can log an assembled credential.
    expect(s.calls[0].apiKey).toBe(CREDENTIALS.secret_key)
  })

  it('reports a missing secret key without calling out', async () => {
    const s = stub()

    const result = await new MoyasarAdapter(s.http).validateCredentials({
      credentials: {},
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    expect(s.calls).toHaveLength(0)
  })

  it('catches a live key saved against a test account', async () => {
    const s = stub()

    const result = await new MoyasarAdapter(s.http).validateCredentials({
      credentials: { secret_key: 'sk_live_spec' },
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('mode_mismatch')
    expect(result.message).toContain('sk_test_')
    expect(s.calls).toHaveLength(0)
  })

  it('catches a test key saved against a live account', async () => {
    const result = await new MoyasarAdapter(stub().http).validateCredentials({
      credentials: { secret_key: 'sk_test_spec' },
      mode: 'live',
    })

    expect(result.errorCode).toBe('mode_mismatch')
  })

  it('maps the documented authentication error rather than throwing', async () => {
    // A merchant's typo must not become a 500 at the settings screen.
    const s = stub({ '/payments': { status: 401, body: DOCUMENTED_ERRORS.invalidKey } })

    const result = await new MoyasarAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    expect(result.message).toContain('Invalid authorization credentials')
  })

  it('never puts a credential value in the message', async () => {
    const s = stub({ '/payments': { status: 401, body: DOCUMENTED_ERRORS.invalidKey } })

    const result = await new MoyasarAdapter(s.http).validateCredentials({
      credentials: CREDENTIALS,
      mode: 'test',
    })

    for (const secret of Object.values(CREDENTIALS)) {
      expect(result.message ?? '').not.toContain(secret)
    }
  })
})

describe('initializePayment', () => {
  const invoiceOk = ok(CREATE_INVOICE_RESPONSE)

  it('creates an invoice with the documented request shape', async () => {
    const s = stub({ '/invoices': invoiceOk })

    await new MoyasarAdapter(s.http).initializePayment(context())

    expect(s.calls[0].url).toBe('https://api.moyasar.com/v1/invoices')
    expect(s.calls[0].method).toBe('POST')
    expect(s.calls[0].body).toMatchObject({
      // "the smallest currency unit" — the same units we hold.
      amount: 10000,
      currency: 'SAR',
    })
    // description is required by the API.
    expect(
      (s.calls[0].body as { description: string }).description.length,
    ).toBeGreaterThan(0)
  })

  it('returns a redirect to the hosted checkout page', async () => {
    const result = await new MoyasarAdapter(
      stub({ '/invoices': invoiceOk }).http,
    ).initializePayment(context())

    expect(result.kind).toBe('requires_action')

    if (result.kind !== 'requires_action') return

    expect(result.nextAction).toEqual({
      kind: 'redirect',
      url: CREATE_INVOICE_RESPONSE.url,
      method: 'GET',
    })
  })

  it('correlates on the invoice id', async () => {
    const result = await new MoyasarAdapter(
      stub({ '/invoices': invoiceOk }).http,
    ).initializePayment(context())

    if (result.kind !== 'requires_action') throw new Error('wrong kind')

    expect(result.refs?.gatewayReference).toBe(CREATE_INVOICE_RESPONSE.id)
  })

  it('sends the return URL as success_url, not as callback_url', async () => {
    // The docs stress that callback_url "is not used to redirect the
    // user, this is only used to send a notification".
    const s = stub({ '/invoices': invoiceOk })

    await new MoyasarAdapter(s.http).initializePayment(
      context({ returnUrl: 'https://shop.example/return' }),
    )

    const sent = s.calls[0].body as Record<string, unknown>

    expect(sent.success_url).toBe('https://shop.example/return')
    expect(sent.callback_url).toBeUndefined()
  })

  it('refuses without a secret key', async () => {
    await expect(
      new MoyasarAdapter(stub().http).initializePayment(
        context({ credentials: {} }),
      ),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('maps a documented validation error', async () => {
    const s = stub({
      '/invoices': { status: 400, body: DOCUMENTED_ERRORS.validationFailed },
    })

    await expect(
      new MoyasarAdapter(s.http).initializePayment(context()),
    ).rejects.toMatchObject({ code: 'configuration_error' })
  })

  it('turns a transport failure into a retryable error', async () => {
    const http: MoyasarHttp = async () => {
      throw new Error('socket hang up')
    }

    const error = await new MoyasarAdapter(http)
      .initializePayment(context())
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe('provider_timeout')
  })

  it('refuses an invoice returned without a checkout URL', async () => {
    const s = stub({ '/invoices': ok({ id: 'inv_1' }) })

    await expect(
      new MoyasarAdapter(s.http).initializePayment(context()),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('outbound idempotency', () => {
  it('carries the deterministic reference in invoice metadata', async () => {
    const s = stub({ '/invoices': ok(CREATE_INVOICE_RESPONSE) })

    await new MoyasarAdapter(s.http).initializePayment(
      context({ idempotencyKey: 'psp:1:77:1:initialize' }),
    )

    // Moyasar's documented `given_id` idempotency belongs to the
    // Payments API; invoices have no equivalent. Metadata is documented
    // to come back "in responses and webhook messages", which is what
    // makes a retry traceable.
    expect(
      (s.calls[0].body as { metadata: Record<string, string> }).metadata.reference,
    ).toBe('psp:1:77:1:initialize')
  })

  it('sends the same reference for the same call twice', async () => {
    const s = stub({ '/invoices': ok(CREATE_INVOICE_RESPONSE) })
    const adapter = new MoyasarAdapter(s.http)

    await adapter.initializePayment(context())
    await adapter.initializePayment(context())

    const references = s.calls.map(
      (call) => (call.body as { metadata: Record<string, string> }).metadata.reference,
    )

    expect(new Set(references).size).toBe(1)
  })
})

describe('parseWebhook', () => {
  it('accepts a callback carrying the right secret token', async () => {
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(webhookInput())

    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      accountId: 7n,
      gatewayReference: PAID_PAYMENT.invoice_id,
      factType: 'attempt_captured',
      cumulativeAmountMinor: 100n,
      currency: 'SAR',
    })
    expect(facts[0].refs?.gatewayPaymentId).toBe(PAID_PAYMENT.id)
  })

  it('rejects a callback with the wrong secret token', async () => {
    await expect(
      new MoyasarAdapter(stub().http).parseWebhook(
        webhookInput({
          rawBody: body(webhookEvent({ secretToken: 'not-the-secret' })),
        }),
      ),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('rejects a callback with no secret token at all', async () => {
    const { secret_token, ...withoutToken } = webhookEvent()

    await expect(
      new MoyasarAdapter(stub().http).parseWebhook(
        webhookInput({ rawBody: body(withoutToken) }),
      ),
    ).rejects.toMatchObject({ code: 'authentication_failed' })
  })

  it('rejects a body that is not JSON, with a ProviderError', async () => {
    // Arrives from an unauthenticated endpoint; a bare throw would be a
    // 500 anyone could trigger.
    const error = await new MoyasarAdapter(stub().http)
      .parseWebhook(webhookInput({ rawBody: Buffer.from('<html>no</html>', 'utf8') }))
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProviderError)
  })

  it('refuses a live event delivered to a test account', async () => {
    // Applying it would mix real and simulated money.
    await expect(
      new MoyasarAdapter(stub().http).parseWebhook(
        webhookInput({ rawBody: body(webhookEvent({ live: true })) }),
      ),
    ).rejects.toMatchObject({ code: 'mode_mismatch' })
  })

  it('refuses a test event delivered to a live account', async () => {
    await expect(
      new MoyasarAdapter(stub().http).parseWebhook(
        webhookInput({ mode: 'live', rawBody: body(webhookEvent({ live: false })) }),
      ),
    ).rejects.toMatchObject({ code: 'mode_mismatch' })
  })

  it('ignores a card authentication event rather than mis-parsing it', async () => {
    // Its data payload is a card authentication, not a payment.
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({
        rawBody: body(
          webhookEvent({
            type: 'card_auth_authenticated',
            data: { id: 'ca_1', status: 'authenticated' },
          }),
        ),
      }),
    )

    expect(facts).toEqual([])
  })

  /* ---------------------------------------------------------------
     Embedded (Moyasar Payment Form) webhooks.

     A payment the browser form created has NO invoice — nothing created
     one — so the invoice-correlated mapping cannot see it. Before these,
     every embedded webhook was dropped with zero facts, and the embedded
     checkout could only ever settle through the customer's own browser
     calling /confirm. Verified against this deployment's real
     `webhook_events`: 23 signature-verified Moyasar callbacks recorded
     `status = ignored, fact_count = 0`.
     --------------------------------------------------------------- */

  const EMBEDDED_PAID = {
    id: 'pay_embedded_1',
    status: 'paid',
    amount: 5000,
    currency: 'SAR',
    captured: 5000,
    invoice_id: null,
    metadata: { intent_id: '166', store_id: '9', mode: 'test' },
    source: { type: 'creditcard', company: 'visa', message: 'APPROVED' },
  }

  it('maps an embedded payment_paid webhook that carries no invoice', async () => {
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({ rawBody: body(webhookEvent({ data: EMBEDDED_PAID })) }),
    )

    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      factType: 'attempt_captured',
      // The payment's own id is the reference; there is no invoice.
      gatewayReference: 'pay_embedded_1',
      // Correlation runs through the metadata the form echoed back.
      internalIntentRef: '166',
      cumulativeAmountMinor: 5000n,
    })
  })

  it('maps an embedded payment_failed webhook that carries no invoice', async () => {
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({
        rawBody: body(
          webhookEvent({
            type: 'payment_failed',
            data: { ...EMBEDDED_PAID, status: 'failed' },
          }),
        ),
      }),
    )

    expect(facts[0]).toMatchObject({
      factType: 'attempt_failed',
      gatewayReference: 'pay_embedded_1',
      internalIntentRef: '166',
    })
  })

  it('still refuses an invoice-less payment that names no intent', async () => {
    // Not ours: a dashboard payment or someone else's API call. Guessing
    // which attempt it belonged to is the mistake the taxonomy prevents.
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({
        rawBody: body(
          webhookEvent({ data: { ...EMBEDDED_PAID, metadata: {} } }),
        ),
      }),
    )

    expect(facts).toEqual([])
  })

  it('prefers the invoice mapping when an invoice id is present', async () => {
    // The verified redirect/invoice flow must be bit-for-bit unchanged:
    // the fallback is reached only when the invoice mapping yields nothing.
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({
        rawBody: body(
          webhookEvent({
            data: { ...EMBEDDED_PAID, invoice_id: 'inv_123' },
          }),
        ),
      }),
    )

    expect(facts[0]).toMatchObject({ gatewayReference: 'inv_123' })
  })

  it('produces nothing for a payment that has not resolved', async () => {
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({
        rawBody: body(
          webhookEvent({ data: { ...PAID_PAYMENT, status: 'initiated' } }),
        ),
      }),
    )

    expect(facts).toEqual([])
  })

  it('maps a refund event to a refund fact with the running total', async () => {
    const facts = await new MoyasarAdapter(stub().http).parseWebhook(
      webhookInput({
        rawBody: body(
          webhookEvent({
            type: 'payment_refunded',
            data: { ...PAID_PAYMENT, status: 'refunded', amount: 10000, refunded: 2500 },
          }),
        ),
      }),
    )

    expect(facts[0]).toMatchObject({
      factType: 'refund_succeeded',
      cumulativeAmountMinor: 2500n,
    })
  })
})

describe('describeWebhook', () => {
  it("uses Moyasar's own event id and type", () => {
    const descriptor = new MoyasarAdapter(stub().http).describeWebhook({
      rawBody: body(webhookEvent()),
    })

    expect(descriptor).toEqual({
      eventId: 'aaf1e0b6-1d0e-4a6a-9d64-2e6c0a17c1de',
      eventType: 'payment_paid',
      recognised: true,
    })
  })

  it('gives a later event on the same payment a different identity', () => {
    // The id is per event, not per payment, so a refund of a paid
    // payment is a distinct delivery rather than a redelivery.
    const adapter = new MoyasarAdapter(stub().http)

    const paid = adapter.describeWebhook({ rawBody: body(webhookEvent()) })
    const refunded = adapter.describeWebhook({
      rawBody: body(webhookEvent({ id: 'evt_2', type: 'payment_refunded' })),
    })

    expect(paid?.eventId).not.toBe(refunded?.eventId)
  })

  it('flags an event type nobody documented', () => {
    const descriptor = new MoyasarAdapter(stub().http).describeWebhook({
      rawBody: body(webhookEvent({ type: 'payment_exploded' })),
    })

    expect(descriptor?.recognised).toBe(false)
  })

  it('does not throw on garbage', () => {
    const adapter = new MoyasarAdapter(stub().http)

    for (const raw of ['not json', '', '{}', '[]']) {
      expect(() =>
        adapter.describeWebhook({ rawBody: Buffer.from(raw, 'utf8') }),
      ).not.toThrow()
    }
  })
})

describe('refund', () => {
  const refundInput = (over: Record<string, unknown> = {}) => ({
    accountId: 9n,
    gatewayReference: PAID_PAYMENT.invoice_id,
    gatewayPaymentId: PAID_PAYMENT.id,
    gatewayCaptureRef: null,
    amountMinor: 2_500n,
    currency: 'SAR',
    credentials: CREDENTIALS,
    idempotencyKey: 'psp:1:77:1:refund:2500',
    mode: 'test' as const,
    ...over,
  })

  it('refunds a partial amount against the documented endpoint', async () => {
    const s = stub({
      '/refund': ok({ ...PAID_PAYMENT, status: 'refunded', refunded: 2500 }),
    })

    const facts = await new MoyasarAdapter(s.http).refund(refundInput())

    expect(s.calls[0].url).toBe(
      `https://api.moyasar.com/v1/payments/${PAID_PAYMENT.id}/refund`,
    )
    expect(s.calls[0].body).toEqual({ amount: 2500 })
    expect(facts[0]).toMatchObject({
      factType: 'refund_succeeded',
      cumulativeAmountMinor: 2500n,
      gatewayReference: PAID_PAYMENT.invoice_id,
    })
  })

  it('always sends the amount rather than letting a full refund be implied', async () => {
    // "If this field is missing, then the full amount will be refunded."
    // Our caller has already decided the amount.
    const s = stub({ '/refund': ok({ ...PAID_PAYMENT, status: 'refunded' }) })

    await new MoyasarAdapter(s.http).refund(refundInput({ amountMinor: 100n }))

    expect(s.calls[0].body).toEqual({ amount: 100 })
  })

  it('refuses when no Moyasar payment id is known yet', async () => {
    // Before the callback there is no payment to refund; sending the
    // invoice id would target a different record.
    const s = stub()

    await expect(
      new MoyasarAdapter(s.http).refund(refundInput({ gatewayPaymentId: null })),
    ).rejects.toMatchObject({ code: 'configuration_error' })

    expect(s.calls).toHaveLength(0)
  })

  it('keeps our invoice reference even if the response omits it', async () => {
    const s = stub({
      '/refund': ok({ ...PAID_PAYMENT, invoice_id: undefined, status: 'refunded' }),
    })

    const facts = await new MoyasarAdapter(s.http).refund(refundInput())

    expect(facts[0].gatewayReference).toBe(PAID_PAYMENT.invoice_id)
  })
})

describe('fetchStatus', () => {
  it('fetches the invoice and maps its payments', async () => {
    const s = stub({
      '/invoices/': ok({
        ...CREATE_INVOICE_RESPONSE,
        payments: [PAID_PAYMENT],
      }),
    })

    const facts = await new MoyasarAdapter(s.http).fetchStatus({
      accountId: 9n,
      gatewayReference: CREATE_INVOICE_RESPONSE.id,
      credentials: CREDENTIALS,
      mode: 'test',
    })

    // The invoice id is what we hold from the moment the attempt exists;
    // the payment id only becomes known once a webhook has arrived, which
    // is the case this call exists to cover.
    expect(s.calls[0].url).toBe(
      `https://api.moyasar.com/v1/invoices/${CREATE_INVOICE_RESPONSE.id}`,
    )
    expect(s.calls[0].method).toBe('GET')
    expect(facts[0]).toMatchObject({
      gatewayReference: CREATE_INVOICE_RESPONSE.id,
      factType: 'attempt_captured',
    })
  })

  it('returns facts, never null, for an unpaid invoice', async () => {
    const s = stub({ '/invoices/': ok(CREATE_INVOICE_RESPONSE) })

    await expect(
      new MoyasarAdapter(s.http).fetchStatus({
        accountId: 9n,
        gatewayReference: CREATE_INVOICE_RESPONSE.id,
        credentials: CREDENTIALS,
        mode: 'test',
      }),
    ).resolves.toEqual([])
  })
})

/**
 * ==================================================================
 * The embedded form is ONE form with a set of methods
 * ==================================================================
 *
 * Every expectation here is read out of the pinned bundle we actually
 * ship (cdn.moyasar.com/mpf/1.19.0/moyasar.js): its method vocabulary is
 * `creditcard | applepay | stcpay`, its `supported_networks` default is
 * `["amex","mada","visa","mastercard"]` and belongs to the card
 * component, and Apple Pay inside the form additionally demands
 * `apple_pay_label`, `apple_pay_validate_merchant_url`,
 * `apple_pay_country` and `apple_pay_supported_countries`.
 */
describe('Moyasar embedded form — method mapping', () => {
  const EMBEDDED = {
    ...CREDENTIALS,
    publishable_key: 'pk_test_spec',
  }
  const RETURN_URL = 'https://shop.example/stores/dartpay/checkout?token=abc'

  /**
   * The next action, narrowed.
   *
   * `InitializeResult` is a union and only its `requires_action` arm
   * carries an action; an initialize that returned anything else here
   * would be the failure under test, so it is asserted rather than
   * optional-chained away.
   */
  type Action = { kind: string; config: Record<string, unknown> }

  async function initialize(over: Partial<PaymentCallContext> = {}) {
    const { http, calls } = stub({ '/invoices': ok(CREATE_INVOICE_RESPONSE) })
    const adapter = new MoyasarAdapter(http)
    const result = await adapter.initializePayment(
      context({ credentials: EMBEDDED, returnUrl: RETURN_URL, ...over }),
    )
    expect(result.kind).toBe('requires_action')
    const action = (result as { nextAction: Action }).nextAction
    return { result, action, calls }
  }

  it('mounts the SAME card form for card and for mada', async () => {
    const card = await initialize({ method: 'card', formMethods: ['card'] })
    const mada = await initialize({ method: 'mada', formMethods: ['mada'] })

    expect(card.action.kind).toBe('client_sdk')
    expect(mada.action.kind).toBe('client_sdk')

    // `creditcard` both times — mada is a network of this form, so there
    // is no second provider page to create for it.
    expect(card.action.config.methods).toEqual(['creditcard'])
    expect(mada.action.config.methods).toEqual(['creditcard'])
  })

  /**
   * ================================================================
   * Apple Pay, inside the same embedded form
   * ================================================================
   *
   * Read out of the pinned bundle rather than assumed:
   *   - `apple_pay_label` must be a non-empty string, else the form
   *     throws "Apple Pay label is required";
   *   - `apple_pay_country` must match /^[A-Z]{2}$/, else "Country is
   *     required for Apple Pay" / "Invalid country";
   *   - `apple_pay_validate_merchant_url` must match /^https?:\/\/.+/,
   *     else "Validate Merchat URL is required for Apple Pay";
   *   - `apple_pay_supported_countries` defaults to ["SA"] and
   *     `apple_pay_merchant_capabilities` to
   *     ["supports3DS","supportsCredit","supportsDebit"].
   *
   * A throw is not a degraded Apple Pay button — it is a checkout with
   * no card fields in it, because the whole form fails to mount. That is
   * why every case below is about NOT sending `applepay` unless the
   * options that go with it are complete and valid.
   */
  const APPLE_PAY = {
    ...EMBEDDED,
    apple_pay_label: 'Dart Store',
    apple_pay_country: 'SA',
  }

  it('renders Apple Pay INSIDE the embedded form when configured', async () => {
    const { action } = await initialize({
      credentials: APPLE_PAY,
      formMethods: ['card', 'mada', 'apple_pay'],
    })

    // One surface, both provider methods. Not a second form, not a
    // redirect, not an iframe around a hosted invoice.
    expect(action.kind).toBe('client_sdk')
    expect(action.config.methods).toEqual(['creditcard', 'applepay'])
  })

  it('sends every Apple Pay option the form has no default for', async () => {
    const { action } = await initialize({
      credentials: APPLE_PAY,
      formMethods: ['card', 'apple_pay'],
    })

    expect(action.config.apple_pay_label).toBe('Dart Store')
    expect(action.config.apple_pay_country).toBe('SA')
    // Moyasar's own endpoint: Apple requires the merchant session to be
    // signed with a merchant identity certificate, which they hold and
    // we deliberately do not.
    expect(action.config.apple_pay_validate_merchant_url).toBe(
      'https://api.moyasar.com/v1/applepay/initiate',
    )
  })

  it('leaves the optional Apple Pay lists to the provider default', async () => {
    const { action } = await initialize({
      credentials: APPLE_PAY,
      formMethods: ['card', 'apple_pay'],
    })

    // Restating ["SA"] and the three capability flags would be us
    // duplicating a provider default we would then have to maintain.
    expect(action.config).not.toHaveProperty('apple_pay_supported_countries')
    expect(action.config).not.toHaveProperty('apple_pay_merchant_capabilities')
  })

  it('passes the merchant lists through when they were configured', async () => {
    const { action } = await initialize({
      credentials: {
        ...APPLE_PAY,
        apple_pay_supported_countries: 'sa, ae',
        apple_pay_merchant_capabilities: 'supports3DS, supportsDebit',
      },
      formMethods: ['card', 'apple_pay'],
    })

    expect(action.config.apple_pay_supported_countries).toEqual(['SA', 'AE'])
    expect(action.config.apple_pay_merchant_capabilities).toEqual([
      'supports3DS',
      'supportsDebit',
    ])
  })

  it('never sends applepay without its options', async () => {
    // The merchant enabled Apple Pay but configured none of it. Sending
    // `applepay` here is the mount-time throw that would take the card
    // component with it, so the card form must come back alone.
    const { action } = await initialize({
      formMethods: ['card', 'mada', 'apple_pay'],
    })

    expect(action.config.methods).toEqual(['creditcard'])
    expect(action.config).not.toHaveProperty('apple_pay_label')
  })

  it('refuses a country the provider form would reject', async () => {
    // "Invalid country" is a throw, exactly like a missing one, so a
    // half-valid configuration must read as unconfigured rather than be
    // forwarded and hope.
    const { action } = await initialize({
      credentials: { ...APPLE_PAY, apple_pay_country: 'Saudi Arabia' },
      formMethods: ['card', 'apple_pay'],
    })

    expect(action.config.methods).toEqual(['creditcard'])
    expect(action.config).not.toHaveProperty('apple_pay_label')
  })

  it('falls back to the hosted invoice for an unconfigured Apple Pay', async () => {
    // An apple_pay payment on an account that never configured it still
    // has to work — on Moyasar's own page, where Moyasar does the
    // merchant validation. Redirect, and labelled redirect.
    const { http, calls } = stub({ '/invoices': ok(CREATE_INVOICE_RESPONSE) })
    const result = await new MoyasarAdapter(http).initializePayment(
      context({
        credentials: EMBEDDED,
        returnUrl: RETURN_URL,
        method: 'apple_pay',
        formMethods: ['apple_pay'],
      }),
    )

    expect(result.kind).toBe('requires_action')
    expect((result as { nextAction: Action }).nextAction.kind).toBe('redirect')
    expect(calls.some((call) => call.url.includes('/invoices'))).toBe(true)
  })

  it('puts STC Pay in the SAME embedded form, needing no configuration', async () => {
    // `stcpay` is one of the pinned bundle's three method names, on the
    // same form as the card component — not a second surface and not a
    // second radio button. The merchant enables it like any other
    // method and the payer chooses it inside the provider's own form.
    const { action, calls } = await initialize({
      method: 'stc_pay',
      formMethods: ['card', 'mada', 'stc_pay'],
    })

    expect(action.kind).toBe('client_sdk')
    expect(action.config.methods).toEqual(['creditcard', 'stcpay'])
    // No credential of its own was needed to get there: unlike Apple
    // Pay, there is nothing the account could have been missing.
    expect(calls).toHaveLength(0)
  })

  it('renders STC Pay alone for a merchant who enabled only it', async () => {
    const { action } = await initialize({
      method: 'stc_pay',
      formMethods: ['stc_pay'],
    })

    expect(action.config.methods).toEqual(['stcpay'])
    // `supported_networks` belongs to the card component; a form with no
    // card component must not carry a card-network list.
    expect('supported_networks' in action.config).toBe(false)
  })

  it('hosts card, Apple Pay and STC Pay on one form for a configured account', async () => {
    const { action } = await initialize({
      credentials: { ...EMBEDDED, ...APPLE_PAY },
      formMethods: ['card', 'mada', 'apple_pay', 'stc_pay'],
    })

    // The whole point of the grouping: one mount, one radio, every
    // method the merchant switched on — and Apple Pay's options beside
    // them, because this account configured it.
    expect(action.config.methods).toEqual(['creditcard', 'applepay', 'stcpay'])
    expect(action.config).toHaveProperty('apple_pay_label')
  })

  it('keeps STC Pay when Apple Pay is dropped for want of options', async () => {
    // The Apple Pay narrowing must remove `applepay` and nothing else.
    const { action } = await initialize({
      formMethods: ['card', 'apple_pay', 'stc_pay'],
    })

    expect(action.config.methods).toEqual(['creditcard', 'stcpay'])
  })

  it('creates no invoice for an embedded payment', async () => {
    const { calls } = await initialize({ formMethods: ['card', 'mada'] })
    // The form creates the payment itself, in the browser, against the
    // publishable key. A server-side invoice here would be a second
    // provider object nothing would ever pay.
    expect(calls).toHaveLength(0)
  })

  it('names the networks the merchant actually enabled', async () => {
    const both = await initialize({ formMethods: ['card', 'mada'] })
    const cardOnly = await initialize({ formMethods: ['card'] })
    const madaOnly = await initialize({ method: 'mada', formMethods: ['mada'] })

    expect(both.action.config.supported_networks).toEqual([
      'visa',
      'mastercard',
      'amex',
      'mada',
    ])
    // A merchant who did not enable mada must not be shown a mada badge.
    expect(cardOnly.action.config.supported_networks).toEqual([
      'visa',
      'mastercard',
      'amex',
    ])
    expect(madaOnly.action.config.supported_networks).toEqual(['mada'])
  })

  it('leaves the provider default alone when the caller does not group', async () => {
    // The merchant Test Payment tool passes no `formMethods`; nothing
    // about its behaviour may change.
    const { action } = await initialize({ formMethods: undefined })

    expect('supported_networks' in action.config).toBe(false)
  })

  it('sends Apple Pay to the hosted invoice, not the embedded form', async () => {
    const { action, calls } = await initialize({
      method: 'apple_pay',
      formMethods: ['apple_pay'],
    })

    // Not a workaround: we do not have the merchant-validation
    // configuration the form's Apple Pay needs, so we do not claim to
    // host it. Moyasar performs that validation on their own page.
    expect(action.kind).toBe('redirect')
    expect(calls.some((call) => call.url.includes('/invoices'))).toBe(true)
  })

  it('declares the same mapping in its capabilities', async () => {
    const forms = new MoyasarAdapter().capabilities.providerForms ?? []

    // What the checkout groups by must be the same fact as what
    // initialize() does, or the customer is shown one thing and given
    // another.
    const cardForm = forms.find((form) => form.methods.includes('card'))
    // ONE embedded surface hosting every method the pinned bundle's form
    // has: creditcard (card + mada as networks of it), applepay, stcpay.
    expect(cardForm?.methods).toEqual(['card', 'mada', 'apple_pay', 'stc_pay'])
    expect(cardForm?.nextActionKind).toBe('client_sdk')

    // Apple Pay is a CONDITIONAL member: the provider's form throws on
    // mount without the merchant's Apple Pay options, so an account that
    // configured none of them must not be given this surface.
    expect(cardForm?.methodCredentialKeys?.apple_pay).toEqual([
      'apple_pay_label',
      'apple_pay_country',
    ])

    // STC Pay is an UNCONDITIONAL member, and that is a fact about the
    // provider rather than a shortcut: nothing in the pinned bundle
    // reads an `stc_pay_*` option, so there is no configuration an
    // account can be missing that would make the form throw. Requiring
    // one would refuse accounts Moyasar would happily serve.
    expect(cardForm?.methodCredentialKeys?.stc_pay).toBeUndefined()

    // ...and the unconditional surface it falls through to is the hosted
    // invoice, honestly declared as a redirect.
    const fallback = forms.find(
      (form) =>
        form.methods.includes('apple_pay') &&
        !form.methodCredentialKeys?.apple_pay,
    )
    expect(fallback?.nextActionKind).toBe('redirect')
  })

  it('still falls back to the invoice without a publishable key', async () => {
    const { http } = stub({ '/invoices': ok(CREATE_INVOICE_RESPONSE) })
    const result = await new MoyasarAdapter(http).initializePayment(
      context({ returnUrl: RETURN_URL, formMethods: ['card', 'mada'] }),
    )

    expect((result as { nextAction: Action }).nextAction.kind).toBe('redirect')
  })
})

import { createHmac } from 'crypto'
import { CodAdapter } from '../adapters/cod.adapter'
import { BankTransferAdapter } from '../adapters/bank-transfer.adapter'
import { StripeAdapter } from '../adapters/stripe/stripe.adapter'
import { PaymobAdapter } from '../adapters/paymob/paymob.adapter'
import { MoyasarAdapter } from '../adapters/moyasar/moyasar.adapter'
import { TapAdapter } from '../adapters/tap/tap.adapter'
import type { MoyasarHttp } from '../adapters/moyasar/moyasar-client'
import {
  CREATE_INVOICE_RESPONSE,
  PAID_PAYMENT,
  webhookEvent,
} from '../adapters/moyasar/moyasar-fixtures'
import type { PaymobHttp, PaymobResponse } from '../adapters/paymob/paymob-client'
import {
  CREATE_INTENTION_RESPONSE,
  DOCUMENTED_HMAC_STRING,
  PROCESSED_CALLBACK,
} from '../adapters/paymob/paymob-fixtures'
import type { TapHttp, TapResponse } from '../adapters/tap/tap-client'
import {
  CAPTURED_CHARGE_CALLBACK,
  CREATE_CHARGE_RESPONSE,
  REFUND_RESPONSE,
} from '../adapters/tap/tap-fixtures'
import { tapHash, tapHashFields } from '../adapters/tap/tap-hash'
import type { StripeClientLike } from '../adapters/stripe/stripe-client'
import { ProviderRegistry } from '../provider-registry.service'
import type { IPaymentProvider } from '../payment-provider.interface'
import type { GatewayCapabilities, PaymentCallContext } from '../provider.types'
import { conformanceContext, runProviderConformance } from './provider-conformance'

/**
 * The conformance suite, run against every adapter the module registers.
 *
 * These are the real adapters, not stand-ins: `gateways.module.ts` wires
 * exactly `CodAdapter`, `BankTransferAdapter` and `StripeAdapter`, and
 * that list is asserted below so a new adapter cannot be shipped without
 * appearing here.
 *
 * Stripe is given the same client stub its own unit spec uses. That
 * keeps the suite offline while still exercising the adapter's real
 * translation logic — the thing the contract is about.
 */

const STRIPE_SECRET = 'whsec_conformance'

/** Records outbound calls so the idempotency assertion can read them. */
function stripeStub(
  overrides: { createError?: unknown } = {},
): { client: StripeClientLike; createCalls: Record<string, any>[] } {
  const createCalls: Record<string, any>[] = []

  const intent = {
    id: 'pi_conformance',
    status: 'requires_action',
    currency: 'usd',
    amount: 10000,
    client_secret: 'pi_conformance_secret',
  }

  const client: StripeClientLike = {
    checkout: {
      sessions: {
        create: async (params, options) => {
          createCalls.push({ params, options })
          if (overrides.createError) throw overrides.createError
          return {
            id: 'cs_conformance',
            url: 'https://checkout.stripe.com/c/pay/cs_conformance',
            payment_intent: intent.id,
          }
        },
        retrieve: async () => ({
          id: 'cs_conformance',
          url: 'https://checkout.stripe.com/c/pay/cs_conformance',
          payment_intent: intent.id,
        }),
      },
    },
    paymentIntents: {
      create: async () => intent,
      retrieve: async () => ({
        id: 'pi_conformance',
        status: 'succeeded',
        currency: 'usd',
        amount: 10000,
        amount_received: 10000,
      }),
      capture: async () => ({
        id: 'pi_conformance',
        status: 'succeeded',
        currency: 'usd',
        amount: 10000,
        amount_received: 5000,
      }),
      cancel: async () => ({
        id: 'pi_conformance',
        status: 'canceled',
        currency: 'usd',
        amount: 10000,
      }),
    },
    refunds: {
      create: async () => ({ id: 're_conformance', status: 'succeeded', amount: 2500 }),
    },
    balance: {
      retrieve: async () => {
        return { object: 'balance' }
      },
    },
    webhooks: {
      constructEvent: (payload, header, secret) => {
        const raw = Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(String(payload), 'utf8')

        const parts = new Map(
          String(header)
            .split(',')
            .map((piece) => piece.split('=') as [string, string]),
        )

        const timestamp = parts.get('t')
        const provided = parts.get('v1')

        if (!timestamp || !provided) {
          throw new Error('No signatures found matching the expected signature')
        }

        const expected = createHmac('sha256', secret)
          .update(`${timestamp}.${raw.toString('utf8')}`, 'utf8')
          .digest('hex')

        if (expected !== provided) {
          throw new Error('No signatures found matching the expected signature')
        }

        return JSON.parse(raw.toString('utf8'))
      },
    },
  }

  return { client, createCalls }
}

/** A rejecting balance call, so validateCredentials has something to reject. */
function stripeRejectingKey(): StripeClientLike {
  const { client } = stripeStub()

  return {
    ...client,
    balance: {
      retrieve: async () => {
        throw { type: 'authentication_error', message: 'Invalid API Key provided' }
      },
    },
  }
}

const stripeWebhookBody = Buffer.from(
  JSON.stringify({
    id: 'evt_conformance',
    type: 'payment_intent.succeeded',
    created: 1_700_000_000,
    data: {
      object: {
        id: 'pi_conformance',
        status: 'succeeded',
        currency: 'usd',
        amount: 10000,
        amount_received: 10000,
      },
    },
  }),
  'utf8',
)

function signStripe(body: Buffer, secret: string): string {
  const t = 1_700_000_000
  const v1 = createHmac('sha256', secret)
    .update(`${t}.${body.toString('utf8')}`, 'utf8')
    .digest('hex')
  return `t=${t},v1=${v1}`
}

/* ------------------------------------------------------------------ */
/* The registered adapters                                             */
/* ------------------------------------------------------------------ */

runProviderConformance({
  gateway: 'cod',
  build: () => new CodAdapter(),
  validCredentials: {},
  // Cash on delivery has no account to reach, so there is nothing that
  // could be invalid. Asserting a rejection would mean inventing one.
})

runProviderConformance({
  gateway: 'bank_transfer',
  build: () => new BankTransferAdapter(),
  validCredentials: {
    bank_name: 'Test Bank',
    account_holder: 'Store Owner',
    iban: 'EG000000000000000000000000',
  },
  invalidCredentials: { iban: 'EG000000000000000000000000' },
})

runProviderConformance({
  gateway: 'stripe',
  build: () => new StripeAdapter(() => stripeStub().client),
  // Live-shaped, because the suite validates credentials in live mode
  // and the adapter refuses a test key on a live account — the same
  // guard Paymob, Moyasar and Tap apply.
  validCredentials: { secret_key: 'sk_live_conformance', publishable_key: 'pk_live_conformance' },
  invalidCredentials: {},
  // Checkout Sessions cannot be created without success/cancel URLs —
  // unlike Paymob/Moyasar/Tap, Stripe has no merchant-configured fallback
  // redirect field to fall back to, so the suite must supply one.
  context: { returnUrl: 'https://shop.example/checkout/success' },
  failure: {
    build: () =>
      new StripeAdapter(
        () =>
          stripeStub({
            // `api_error` is what the existing error map turns into
            // provider_unavailable. The assertion is that a provider
            // failure lands in the closed taxonomy at all — not that
            // Stripe's map is exhaustive, which is settled work.
            createError: { type: 'api_error', message: 'stripe is down' },
          }).client,
      ),
    expectedCode: 'provider_unavailable',
  },
  outboundIdempotencyKeys: async (context: PaymentCallContext) => {
    const stub = stripeStub()
    const adapter = new StripeAdapter(() => stub.client)

    await adapter.initializePayment(context)
    await adapter.initializePayment(context)

    return stub.createCalls.map(
      (call) => call.options?.idempotencyKey as string | undefined,
    )
  },
  webhook: {
    rawBody: stripeWebhookBody,
    headers: {
      'stripe-signature': signStripe(stripeWebhookBody, STRIPE_SECRET),
    },
    signingSecret: STRIPE_SECRET,
  },
})

/* ------------------------------------------------------------------ */
/* Paymob                                                              */
/* ------------------------------------------------------------------ */

const PAYMOB_HMAC_SECRET = 'whsec_paymob_conformance'

const PAYMOB_CREDENTIALS = {
  secret_key: 'egy_sk_live_conformance',
  public_key: 'egy_pk_live_conformance',
  api_key: 'api_key_conformance',
  hmac_secret: PAYMOB_HMAC_SECRET,
}

/**
 * Paymob's transport, answering each documented path.
 *
 * Offline, like every other case here: the payloads are the ones quoted
 * from Paymob's documentation, so what is under test is the adapter's
 * translation and its honesty about its capabilities.
 */
function paymobHttp(
  overrides: { intentionStatus?: number } = {},
): { http: PaymobHttp; calls: { url: string; body?: unknown }[] } {
  const calls: { url: string; body?: unknown }[] = []

  const http: PaymobHttp = async (request) => {
    calls.push({ url: request.url, body: request.body })

    const answer = (status: number, body: unknown): PaymobResponse => ({ status, body })

    if (request.url.includes('/api/auth/tokens')) {
      return answer(200, { token: 'auth_token_conformance' })
    }

    if (request.url.includes('/v1/intention/')) {
      return overrides.intentionStatus
        ? answer(overrides.intentionStatus, { detail: 'paymob is unwell' })
        : answer(200, CREATE_INTENTION_RESPONSE)
    }

    if (request.url.includes('/transaction_inquiry')) {
      return answer(200, PROCESSED_CALLBACK.obj)
    }

    // capture, void and refund all answer with a transaction object.
    return answer(200, { ...PROCESSED_CALLBACK.obj, id: 590506 })
  }

  return { http, calls }
}

const paymobWebhookBody = Buffer.from(
  JSON.stringify({ type: 'TRANSACTION', obj: PROCESSED_CALLBACK.obj }),
  'utf8',
)

runProviderConformance({
  gateway: 'paymob',
  build: () => new PaymobAdapter(paymobHttp().http),
  validCredentials: PAYMOB_CREDENTIALS,
  invalidCredentials: {},
  // Paymob issues an integration id per payment method; the merchant
  // stores one per offering. Without it there is no payment to create.
  context: { gatewayMethodConfig: '4345907', currency: 'EGP' },
  failure: {
    build: () => new PaymobAdapter(paymobHttp({ intentionStatus: 502 }).http),
    expectedCode: 'provider_unavailable',
  },
  outboundIdempotencyKeys: async (context: PaymentCallContext) => {
    const stub = paymobHttp()
    const adapter = new PaymobAdapter(stub.http)

    await adapter.initializePayment(context)
    await adapter.initializePayment(context)

    // Paymob documents no idempotency header. The deterministic
    // reference core derived is what goes on the wire, and it comes back
    // on the callback as merchant_order_id.
    return stub.calls
      .filter((call) => call.url.includes('/v1/intention/'))
      .map((call) => (call.body as { special_reference?: string }).special_reference)
  },
  webhook: {
    rawBody: paymobWebhookBody,
    headers: {},
    // Paymob signs in the query string, not a header.
    query: {
      hmac: createHmac('sha512', PAYMOB_HMAC_SECRET)
        .update(DOCUMENTED_HMAC_STRING, 'utf8')
        .digest('hex'),
    },
    signingSecret: PAYMOB_HMAC_SECRET,
  },
})

/* ------------------------------------------------------------------ */
/* Moyasar                                                             */
/* ------------------------------------------------------------------ */

const MOYASAR_SECRET = 'whsec_moyasar_conformance'

const MOYASAR_CREDENTIALS = {
  secret_key: 'sk_live_conformance',
  webhook_secret: MOYASAR_SECRET,
}

/**
 * Moyasar's transport, answering each documented path.
 *
 * Offline like every other case here: the payloads are the ones
 * transcribed from Moyasar's documentation, so what is under test is the
 * adapter's translation and its honesty about its capabilities.
 */
function moyasarHttp(
  overrides: { invoiceStatus?: number } = {},
): { http: MoyasarHttp } {
  const http: MoyasarHttp = async (request) => {
    if (request.url.endsWith('/invoices')) {
      return overrides.invoiceStatus
        ? { status: overrides.invoiceStatus, body: { type: 'api_error' } }
        : { status: 200, body: CREATE_INVOICE_RESPONSE }
    }

    if (request.url.includes('/invoices/')) {
      return {
        status: 200,
        body: { ...CREATE_INVOICE_RESPONSE, payments: [PAID_PAYMENT] },
      }
    }

    if (request.url.includes('/refund')) {
      return {
        status: 200,
        body: { ...PAID_PAYMENT, status: 'refunded', refunded: 2500 },
      }
    }

    // GET /payments — the read validateCredentials makes.
    return { status: 200, body: { payments: [] } }
  }

  return { http }
}

runProviderConformance({
  gateway: 'moyasar',
  build: () => new MoyasarAdapter(moyasarHttp().http),
  validCredentials: MOYASAR_CREDENTIALS,
  invalidCredentials: {},
  failure: {
    build: () => new MoyasarAdapter(moyasarHttp({ invoiceStatus: 503 }).http),
    expectedCode: 'provider_unavailable',
  },
  webhook: {
    // Moyasar authenticates with a shared secret token in the body
    // rather than a signature, so there is nothing in the headers or the
    // query for the suite to strip — the unsigned case is a body whose
    // token is absent, which the adapter refuses.
    rawBody: Buffer.from(
      JSON.stringify(webhookEvent({ secretToken: MOYASAR_SECRET, live: true })),
      'utf8',
    ),
    headers: {},
    // The same event with its secret token absent, which is what
    // "unauthenticated" means for a body-authenticated provider.
    unsignedRawBody: Buffer.from(
      JSON.stringify({ ...webhookEvent({ live: true }), secret_token: undefined }),
      'utf8',
    ),
    signingSecret: MOYASAR_SECRET,
  },
})

/* ------------------------------------------------------------------ */
/* Tap                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tap issues no separate webhook secret: the `hashstring` header is an
 * HMAC keyed by the merchant's Secret API Key, so the signing secret and
 * the API key are deliberately the same value here.
 */
const TAP_SECRET_KEY = 'sk_live_conformance'

const TAP_CREDENTIALS = {
  secret_key: TAP_SECRET_KEY,
  merchant_id: '599424',
  redirect_url: 'https://store.example/checkout/return',
  post_url: 'https://api.example/payments/webhooks/tap/9',
}

/**
 * Tap's transport, answering each documented path.
 *
 * Offline like every other case here: the payloads are the ones
 * transcribed from Tap's documentation, so what is under test is the
 * adapter's translation and its honesty about its capabilities.
 */
function tapHttp(
  overrides: { chargeStatus?: number } = {},
): { http: TapHttp; calls: { url: string; body?: unknown }[] } {
  const calls: { url: string; body?: unknown }[] = []

  const http: TapHttp = async (request) => {
    calls.push({ url: request.url, body: request.body })

    const answer = (status: number, body: unknown): TapResponse => ({ status, body })

    // Checked before `/charges`, which is a prefix of it.
    if (request.url.endsWith('/charges/list')) {
      return answer(200, { object_type: 'list', count: 0, charges: [] })
    }

    if (request.url.endsWith('/charges')) {
      return overrides.chargeStatus
        ? answer(overrides.chargeStatus, {
            errors: [{ code: '9999', description: 'tap is unwell' }],
          })
        : answer(200, CREATE_CHARGE_RESPONSE)
    }

    if (request.url.endsWith('/refunds')) {
      return answer(200, REFUND_RESPONSE)
    }

    // GET /v2/charges/{charge_id}
    return answer(200, CAPTURED_CHARGE_CALLBACK)
  }

  return { http, calls }
}

/** The documented callback, in the mode the suite runs adapters in. */
const tapCallback = { ...CAPTURED_CHARGE_CALLBACK, live_mode: true }
const tapCallbackBody = Buffer.from(JSON.stringify(tapCallback), 'utf8')

runProviderConformance({
  gateway: 'tap',
  build: () => new TapAdapter(tapHttp().http),
  validCredentials: TAP_CREDENTIALS,
  invalidCredentials: {},
  // `customer.first_name` and `customer.email` are required by Create a
  // Charge, and `PaymentCallContext` has no payer identity of its own —
  // the adapter reads them from the call metadata and refuses without
  // them, which is the correct behaviour rather than something to work
  // around.
  context: {
    metadata: {
      customer_first_name: 'Conformance',
      customer_email: 'conformance@example.com',
    },
  },
  failure: {
    build: () => new TapAdapter(tapHttp({ chargeStatus: 503 }).http),
    expectedCode: 'provider_unavailable',
  },
  outboundIdempotencyKeys: async (context: PaymentCallContext) => {
    const stub = tapHttp()
    const adapter = new TapAdapter(stub.http)

    await adapter.initializePayment(context)
    await adapter.initializePayment(context)

    // Tap documents no idempotency header: the key travels in the body
    // as `reference.idempotent`.
    return stub.calls
      .filter((call) => call.url.endsWith('/charges'))
      .map(
        (call) =>
          (call.body as { reference?: { idempotent?: string } }).reference
            ?.idempotent,
      )
  },
  webhook: {
    rawBody: tapCallbackBody,
    headers: {
      hashstring: tapHash(tapHashFields(tapCallback)!, TAP_SECRET_KEY),
    },
    signingSecret: TAP_SECRET_KEY,
  },
})

/* ------------------------------------------------------------------ */
/* Suite-level guarantees                                              */
/* ------------------------------------------------------------------ */

describe('the adapter set as a whole', () => {
  const adapters: IPaymentProvider[] = [
    new CodAdapter(),
    new BankTransferAdapter(),
    new StripeAdapter(() => stripeStub().client),
    new PaymobAdapter(paymobHttp().http),
    new MoyasarAdapter(moyasarHttp().http),
    new TapAdapter(tapHttp().http),
  ]

  it('covers exactly the adapters the module registers', () => {
    // Mirrors the `adapters` array in gateways.module.ts. If a provider
    // is added there and not here, this fails rather than the new
    // adapter quietly going unverified.
    const registry = new ProviderRegistry(adapters)
    registry.onModuleInit()

    expect(registry.registeredGateways()).toEqual([
      'bank_transfer',
      'cod',
      'moyasar',
      'paymob',
      'stripe',
      'tap',
    ])
  })

  it('gives every adapter a distinct gateway key', () => {
    const keys = adapters.map((adapter) => adapter.capabilities.gateway)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('refuses two adapters claiming one gateway', () => {
    expect(() =>
      new ProviderRegistry([new CodAdapter(), new CodAdapter()]).onModuleInit(),
    ).toThrow(/Two adapters registered/)
  })

  it('refuses an adapter that claims a capability it does not implement', () => {
    // Not a gateway anyone could use — a deliberately dishonest
    // descriptor, present only to prove the boot check actually fires.
    // Without this, "capabilities are enforced" is an untested claim.
    const liar: IPaymentProvider = {
      capabilities: {
        ...new CodAdapter().capabilities,
        gateway: 'liar',
        manualCapture: true,
      } as GatewayCapabilities,
      validateCredentials: async () => ({ valid: true }),
      initializePayment: async () => ({
        kind: 'no_gateway',
        commitmentKind: 'promise_accepted',
      }),
      fetchStatus: async () => [],
    }

    expect(() => new ProviderRegistry([liar]).onModuleInit()).toThrow(
      /declares manualCapture but does not implement capture/,
    )
  })

  it('refuses an adapter that supports no payment method', () => {
    const empty: IPaymentProvider = {
      capabilities: {
        ...new CodAdapter().capabilities,
        gateway: 'empty',
        methods: [],
      } as GatewayCapabilities,
      validateCredentials: async () => ({ valid: true }),
      initializePayment: async () => ({
        kind: 'no_gateway',
        commitmentKind: 'promise_accepted',
      }),
      fetchStatus: async () => [],
    }

    expect(() => new ProviderRegistry([empty]).onModuleInit()).toThrow(
      /declares no supported methods/,
    )
  })

  it('exposes a shared context builder that satisfies the call contract', () => {
    const context = conformanceContext()

    expect(typeof context.amountMinor).toBe('bigint')
    expect(typeof context.storeId).toBe('bigint')
    expect(context.currency).toHaveLength(3)
  })
})

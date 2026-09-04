import { payerMetadata, splitCustomerName } from './checkout.service'
import { CodAdapter } from '../payments/gateways/adapters/cod.adapter'
import { BankTransferAdapter } from '../payments/gateways/adapters/bank-transfer.adapter'
import { StripeAdapter } from '../payments/gateways/adapters/stripe/stripe.adapter'
import { PaymobAdapter } from '../payments/gateways/adapters/paymob/paymob.adapter'
import { MoyasarAdapter } from '../payments/gateways/adapters/moyasar/moyasar.adapter'
import type { StripeClientLike } from '../payments/gateways/adapters/stripe/stripe-client'
import type { PaymobHttp } from '../payments/gateways/adapters/paymob/paymob-client'
import type { MoyasarHttp } from '../payments/gateways/adapters/moyasar/moyasar-client'
import { CREATE_INTENTION_RESPONSE } from '../payments/gateways/adapters/paymob/paymob-fixtures'
import { CREATE_INVOICE_RESPONSE } from '../payments/gateways/adapters/moyasar/moyasar-fixtures'
import type { PaymentCallContext } from '../payments/gateways/provider.types'

/**
 * The payer details core hands to an adapter.
 *
 * These are pure functions on purpose: what a provider is told about a
 * customer is exactly the kind of thing that must be readable without a
 * database, and the rule they encode — *never substitute what the
 * shopper did not give* — is easier to hold to when it is asserted
 * directly.
 */

describe('splitCustomerName', () => {
  it('treats a single word as the first name', () => {
    expect(splitCustomerName('Sara')).toEqual({ firstName: 'Sara' })
  })

  it('splits two words into first and last', () => {
    // No middle name is invented for a two-part name.
    expect(splitCustomerName('Sara Ahmed')).toEqual({
      firstName: 'Sara',
      lastName: 'Ahmed',
    })
  })

  it('puts everything between the ends into the middle name', () => {
    expect(splitCustomerName('Sara Ahmed Ali Hassan')).toEqual({
      firstName: 'Sara',
      middleName: 'Ahmed Ali',
      lastName: 'Hassan',
    })
  })

  it('collapses irregular whitespace rather than producing empty parts', () => {
    expect(splitCustomerName('  Sara   Ahmed  ')).toEqual({
      firstName: 'Sara',
      lastName: 'Ahmed',
    })
  })

  it('yields nothing at all for an absent or blank name', () => {
    // A provider that requires a name must refuse, not receive a blank.
    expect(splitCustomerName(undefined)).toEqual({})
    expect(splitCustomerName(null)).toEqual({})
    expect(splitCustomerName('')).toEqual({})
    expect(splitCustomerName('   ')).toEqual({})
  })

  it('keeps a non-Latin name intact', () => {
    expect(splitCustomerName('سارة أحمد')).toEqual({
      firstName: 'سارة',
      lastName: 'أحمد',
    })
  })
})

describe('payerMetadata', () => {
  it('emits the keys an adapter reads, from what the shopper gave', () => {
    expect(
      payerMetadata({
        customerName: 'Sara Ahmed Ali',
        customerEmail: 'sara@example.com',
      }),
    ).toEqual({
      customer_first_name: 'Sara',
      customer_middle_name: 'Ahmed',
      customer_last_name: 'Ali',
      customer_email: 'sara@example.com',
    })
  })

  it('omits the email when the checkout has none', () => {
    // Email is optional at checkout. Absent means absent — a placeholder
    // address would reach the customer's receipt and the merchant's
    // reconciliation.
    const metadata = payerMetadata({ customerName: 'Sara Ahmed' })

    expect(metadata).toEqual({
      customer_first_name: 'Sara',
      customer_last_name: 'Ahmed',
    })
    expect(metadata.customer_email).toBeUndefined()
  })

  it('treats a blank email as absent rather than sending an empty string', () => {
    expect(
      payerMetadata({ customerName: 'Sara', customerEmail: '   ' }),
    ).toEqual({ customer_first_name: 'Sara' })
  })

  it('trims the email it was given', () => {
    expect(
      payerMetadata({ customerName: 'Sara', customerEmail: ' sara@example.com ' })
        .customer_email,
    ).toBe('sara@example.com')
  })

  it('never emits a phone, because the checkout has no country code', () => {
    // The checkout stores one phone string. Splitting it into a dialling
    // code and a subscriber number needs a country table, and a wrong
    // country code is worse than no phone at all.
    const metadata = payerMetadata({
      customerName: 'Sara Ahmed',
      customerEmail: 'sara@example.com',
    })

    expect(metadata.customer_phone_country_code).toBeUndefined()
    expect(metadata.customer_phone_number).toBeUndefined()
  })

  it('never emits a provider-side customer id', () => {
    // The checkout has never seen one.
    expect(
      payerMetadata({ customerName: 'Sara', customerEmail: 'sara@example.com' })
        .customer_id,
    ).toBeUndefined()
  })

  it('is empty when the checkout knows nothing about the payer', () => {
    // Core emits nothing rather than something wrong; the adapter that
    // needs a payer refuses, which is the correct outcome.
    expect(payerMetadata({})).toEqual({})
  })

  it('emits only the documented key names', () => {
    // Drift here is silent: an adapter reads exact keys, so a renamed one
    // becomes "the customer was not supplied" with no error anywhere.
    const allowed = [
      'customer_first_name',
      'customer_middle_name',
      'customer_last_name',
      'customer_email',
    ]

    for (const key of Object.keys(
      payerMetadata({
        customerName: 'A B C D',
        customerEmail: 'a@example.com',
      }),
    )) {
      expect(allowed).toContain(key)
    }
  })
})

/* ------------------------------------------------------------------ */

/**
 * The providers that were already shipping must not notice this change.
 *
 * `metadata` is a field they never read, so filling it in cannot alter
 * what they send. That is asserted here directly rather than argued,
 * because "no adapter reads it" is the kind of claim that quietly stops
 * being true.
 */

const PAYER = {
  customer_first_name: 'Sara',
  customer_last_name: 'Ahmed',
  customer_email: 'sara@example.com',
}

function context(over: Partial<PaymentCallContext> = {}): PaymentCallContext {
  return {
    storeId: 1n,
    mode: 'live',
    accountId: 9n,
    offeringId: 2n,
    method: 'card',
    gatewayMethodConfig: '4345907',
    intentId: 77n,
    attemptId: null,
    attemptSequence: 1,
    amountMinor: 10_000n,
    currency: 'USD',
    credentials: {},
    ...over,
  }
}

describe('existing adapters are unaffected by payer metadata', () => {
  it('Stripe sends the same intent with and without it', async () => {
    const calls: unknown[] = []

    const client: StripeClientLike = {
      checkout: {
        sessions: {
          retrieve: async () => ({
            id: 'cs_1',
            url: 'https://checkout.stripe.com/c/pay/cs_1',
            payment_intent: 'pi_1',
          }),
          create: async (params) => {
            calls.push(params)
            return {
              id: 'cs_1',
              url: 'https://checkout.stripe.com/c/pay/cs_1',
              payment_intent: 'pi_1',
            }
          },
        },
      },
      paymentIntents: {
        create: async () => ({
          id: 'pi_1',
          status: 'requires_action',
          currency: 'usd',
          amount: 10_000,
          client_secret: 'pi_1_secret',
        }),
        retrieve: async () => ({ id: 'pi_1', status: 'succeeded', currency: 'usd', amount: 0 }),
        capture: async () => ({ id: 'pi_1', status: 'succeeded', currency: 'usd', amount: 0 }),
        cancel: async () => ({ id: 'pi_1', status: 'canceled', currency: 'usd', amount: 0 }),
      },
      refunds: { create: async () => ({ id: 're_1', status: 'succeeded', amount: 0 }) },
      balance: { retrieve: async () => ({ object: 'balance' }) },
      webhooks: { constructEvent: () => ({}) },
    }

    const adapter = new StripeAdapter(() => client)
    const credentials = { secret_key: 'sk_test_x', publishable_key: 'pk_test_x' }

    await adapter.initializePayment(
      context({ credentials, returnUrl: 'https://shop.example/checkout/success' }),
    )
    await adapter.initializePayment(
      context({ credentials, metadata: PAYER, returnUrl: 'https://shop.example/checkout/success' }),
    )

    expect(calls[0]).toEqual(calls[1])
  })

  it('Paymob sends the same intention with and without it', async () => {
    const bodies: unknown[] = []

    const http: PaymobHttp = async (request) => {
      if (request.url.includes('/v1/intention/')) {
        bodies.push(request.body)
        return { status: 200, body: CREATE_INTENTION_RESPONSE }
      }
      return { status: 200, body: { token: 't' } }
    }

    const adapter = new PaymobAdapter(http)
    const credentials = {
      secret_key: 'egy_sk_live_x',
      public_key: 'egy_pk_live_x',
      api_key: 'api_x',
      hmac_secret: 'hmac_x',
    }

    await adapter.initializePayment(context({ credentials, currency: 'EGP' }))
    await adapter.initializePayment(
      context({ credentials, currency: 'EGP', metadata: PAYER }),
    )

    expect(bodies[0]).toEqual(bodies[1])
  })

  it('Moyasar sends the same invoice with and without it', async () => {
    const bodies: unknown[] = []

    const http: MoyasarHttp = async (request) => {
      if (request.url.endsWith('/invoices')) bodies.push(request.body)
      return { status: 200, body: CREATE_INVOICE_RESPONSE }
    }

    const adapter = new MoyasarAdapter(http)
    const credentials = { secret_key: 'sk_live_x', webhook_secret: 'w' }

    await adapter.initializePayment(context({ credentials, currency: 'SAR' }))
    await adapter.initializePayment(
      context({ credentials, currency: 'SAR', metadata: PAYER }),
    )

    expect(bodies[0]).toEqual(bodies[1])
  })

  it('the offline adapters return the same commitment with and without it', async () => {
    for (const adapter of [new CodAdapter(), new BankTransferAdapter()]) {
      const bare = await adapter.initializePayment(
        context({
          method: 'cod',
          credentials: { bank_name: 'B', account_holder: 'H' },
        }),
      )
      const withPayer = await adapter.initializePayment(
        context({
          method: 'cod',
          credentials: { bank_name: 'B', account_holder: 'H' },
          metadata: PAYER,
        }),
      )

      expect(bare).toEqual(withPayer)
    }
  })
})

describe('a checkout without a return URL leaves redirecting adapters unchanged', () => {
  it('Paymob sends no redirection_url when the checkout carries none', async () => {
    // Core only forwards returnUrl when the checkout actually has one, so
    // every existing client keeps producing exactly the request it did
    // before.
    const bodies: Record<string, unknown>[] = []

    const http: PaymobHttp = async (request) => {
      if (request.url.includes('/v1/intention/')) {
        bodies.push(request.body as Record<string, unknown>)
        return { status: 200, body: CREATE_INTENTION_RESPONSE }
      }
      return { status: 200, body: { token: 't' } }
    }

    await new PaymobAdapter(http).initializePayment(
      context({
        currency: 'EGP',
        credentials: {
          secret_key: 'egy_sk_live_x',
          public_key: 'egy_pk_live_x',
          api_key: 'api_x',
          hmac_secret: 'hmac_x',
        },
        metadata: PAYER,
      }),
    )

    expect(bodies[0].redirection_url).toBeUndefined()
  })

  it('Moyasar sends no success_url when the checkout carries none', async () => {
    const bodies: Record<string, unknown>[] = []

    const http: MoyasarHttp = async (request) => {
      if (request.url.endsWith('/invoices')) {
        bodies.push(request.body as Record<string, unknown>)
      }
      return { status: 200, body: CREATE_INVOICE_RESPONSE }
    }

    await new MoyasarAdapter(http).initializePayment(
      context({
        currency: 'SAR',
        credentials: { secret_key: 'sk_live_x', webhook_secret: 'w' },
        metadata: PAYER,
      }),
    )

    expect(bodies[0].success_url).toBeUndefined()
    expect(bodies[0].back_url).toBeUndefined()
  })
})

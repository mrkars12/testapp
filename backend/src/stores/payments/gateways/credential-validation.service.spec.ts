import {
  CredentialValidationPipeline,
  missingRequiredFields,
  redactSecrets,
} from './credential-validation.service'
import { ProviderRegistry } from './provider-registry.service'
import { CodAdapter } from './adapters/cod.adapter'
import { BankTransferAdapter } from './adapters/bank-transfer.adapter'
import { StripeAdapter } from './adapters/stripe/stripe.adapter'
import type { StripeClientLike } from './adapters/stripe/stripe-client'
import type { IPaymentProvider } from './payment-provider.interface'
import type { CredentialValidationResult } from './provider.types'

function stripeClient(over: { balanceError?: unknown } = {}): StripeClientLike {
  return {
    checkout: {
      sessions: {
        create: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/c/pay/cs', payment_intent: 'pi' }),
        retrieve: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/c/pay/cs', payment_intent: 'pi' }),
      },
    },
    paymentIntents: {
      create: async () => ({ id: 'pi', status: 'requires_action', currency: 'usd', amount: 1 }),
      retrieve: async () => ({ id: 'pi', status: 'succeeded', currency: 'usd', amount: 1 }),
      capture: async () => ({ id: 'pi', status: 'succeeded', currency: 'usd', amount: 1 }),
      cancel: async () => ({ id: 'pi', status: 'canceled', currency: 'usd', amount: 1 }),
    },
    refunds: { create: async () => ({ id: 're', status: 'succeeded', amount: 1 }) },
    balance: {
      retrieve: async () => {
        if (over.balanceError) throw over.balanceError
        return { object: 'balance' }
      },
    },
    webhooks: { constructEvent: () => ({}) as never },
  }
}

function pipeline(extra: IPaymentProvider[] = []): CredentialValidationPipeline {
  const registry = new ProviderRegistry([
    new CodAdapter(),
    new BankTransferAdapter(),
    new StripeAdapter(() => stripeClient()),
    ...extra,
  ])
  registry.onModuleInit()
  return new CredentialValidationPipeline(registry)
}

/**
 * A minimal adapter whose only interesting behaviour is its credential
 * check. Built explicitly rather than spread from a real adapter: a
 * spread copies fields but not prototype methods, which produces an
 * object that type-checks and is missing half its contract.
 */
function adapterValidating(
  validateCredentials: IPaymentProvider['validateCredentials'],
): IPaymentProvider {
  return {
    capabilities: new CodAdapter().capabilities,
    validateCredentials,
    initializePayment: async () => ({
      kind: 'no_gateway',
      commitmentKind: 'promise_accepted',
    }),
    fetchStatus: async () => [],
  }
}

describe('structural stage', () => {
  it('rejects a blank required field from the catalog, without calling the adapter', async () => {
    let called = false

    const registry = new ProviderRegistry([
      new StripeAdapter(() => {
        called = true
        return stripeClient()
      }),
    ])
    registry.onModuleInit()

    const result = await new CredentialValidationPipeline(registry).validate({
      gateway: 'stripe',
      credentials: { publishable_key: 'pk_test_x' },
      mode: 'test',
    })

    expect(result.stage).toBe('structural')
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    expect(result.message).toContain('secret_key')
    // Cheaper and more precise than any provider's "unauthorized".
    expect(called).toBe(false)
  })

  it('reads the required set from the catalog, not from core', () => {
    // Core never names a provider's fields; the same place the merchant's
    // form is built from decides what is mandatory.
    expect(missingRequiredFields('stripe', {})).toEqual([
      'publishable_key',
      'secret_key',
    ])
    expect(missingRequiredFields('stripe', { publishable_key: ' ' })).toContain(
      'publishable_key',
    )
    expect(missingRequiredFields('cod', {})).toEqual([])
    expect(missingRequiredFields('not_a_gateway', {})).toEqual([])
  })

  it('treats an optional field as optional', () => {
    // webhook_secret is not required to save a Stripe account.
    expect(
      missingRequiredFields('stripe', {
        publishable_key: 'pk',
        secret_key: 'sk',
      }),
    ).toEqual([])
  })
})

describe('provider stage', () => {
  it('accepts credentials the adapter is happy with', async () => {
    const result = await pipeline().validate({
      gateway: 'stripe',
      credentials: { publishable_key: 'pk_test_x', secret_key: 'sk_test_x' },
      mode: 'test',
    })

    expect(result).toEqual({ stage: 'provider', valid: true })
  })

  it('maps an adapter rejection into the closed taxonomy', async () => {
    const registry = new ProviderRegistry([
      new StripeAdapter(() =>
        stripeClient({
          balanceError: { type: 'authentication_error', message: 'Invalid API Key' },
        }),
      ),
    ])
    registry.onModuleInit()

    const result = await new CredentialValidationPipeline(registry).validate({
      gateway: 'stripe',
      credentials: { publishable_key: 'pk_test_x', secret_key: 'sk_bad' },
      mode: 'test',
    })

    expect(result.stage).toBe('provider')
    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('configuration_error')
    expect(result.message).not.toHaveLength(0)
  })

  it('uses provider-specific logic, which core knows nothing about', async () => {
    // Bank transfer's required pair is its own business: the pipeline
    // asks and reports, it does not decide.
    const result = await pipeline().validate({
      gateway: 'bank_transfer',
      credentials: { bank_name: 'Test Bank', account_holder: '' },
      mode: 'live',
    })

    expect(result.valid).toBe(false)
    expect(result.message).toContain('account_holder')
  })

  it('reports rather than throws when an adapter throws', async () => {
    // A merchant's typo must not become a 500 on the settings screen.
    const throwing = adapterValidating(async () => {
      throw new Error('socket hang up')
    })

    const registry = new ProviderRegistry([throwing])
    registry.onModuleInit()

    const result = await new CredentialValidationPipeline(registry).validate({
      gateway: 'cod',
      credentials: {},
      mode: 'live',
    })

    expect(result.valid).toBe(false)
    expect(result.errorCode).toBe('provider_unavailable')
  })

  it('always gives the merchant something to act on', async () => {
    const silent = adapterValidating(
      async (): Promise<CredentialValidationResult> => ({ valid: false }),
    )

    const registry = new ProviderRegistry([silent])
    registry.onModuleInit()

    const result = await new CredentialValidationPipeline(registry).validate({
      gateway: 'cod',
      credentials: {},
      mode: 'live',
    })

    expect(result.errorCode).toBe('unknown')
    expect(result.message ?? '').not.toHaveLength(0)
  })
})

describe('secrets', () => {
  it('never lets a credential value out in the message', () => {
    // last_error is persisted and returned by the settings API, so an
    // adapter echoing a provider response is one hop from exposing a key.
    expect(
      redactSecrets('Invalid API key sk_live_abcdef123456 provided', {
        secret_key: 'sk_live_abcdef123456',
      }),
    ).toBe('Invalid API key [redacted] provided')
  })

  it('leaves short values alone rather than mangling ordinary words', () => {
    expect(redactSecrets('the bank rejected it', { merchant_id: 'bank' })).toBe(
      'the bank rejected it',
    )
  })

  it('redacts through the pipeline, not just in the helper', async () => {
    const leaky = adapterValidating(
      async (input): Promise<CredentialValidationResult> => ({
        valid: false,
        errorCode: 'configuration_error',
        message: `rejected key ${input.credentials.api_key}`,
      }),
    )

    const registry = new ProviderRegistry([leaky])
    registry.onModuleInit()

    const result = await new CredentialValidationPipeline(registry).validate({
      gateway: 'cod',
      credentials: { api_key: 'super-secret-value' },
      mode: 'live',
    })

    expect(result.message).toBe('rejected key [redacted]')
  })
})

describe('a gateway with no adapter yet', () => {
  // MyFatoorah is in the catalog and has no adapter. Paymob, Moyasar and
  // then Tap each played this role and no longer can — all three ship
  // one now.
  const PENDING = 'my_fatoorah'

  it('is skipped rather than failed', async () => {
    // A merchant may legitimately save a draft before the adapter ships;
    // enabling it is refused elsewhere.
    const result = await pipeline().validate({
      gateway: PENDING,
      credentials: { api_token: 'y'.repeat(20) },
      mode: 'test',
    })

    expect(result).toEqual({ stage: 'skipped', valid: true })
  })

  it('is still held to the structural rules of the catalog', async () => {
    const result = await pipeline().validate({
      gateway: PENDING,
      credentials: {},
      mode: 'test',
    })

    expect(result.stage).toBe('structural')
    expect(result.valid).toBe(false)
  })
})

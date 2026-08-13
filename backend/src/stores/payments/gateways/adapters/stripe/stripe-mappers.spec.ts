import { ProviderError } from '../../provider.types'
import { fromStripeAmount, isThreeDecimal, isZeroDecimal, toStripeAmount } from './stripe-amount'
import { mapStripeError, stripeErrorMessage } from './stripe-error-map'
import { factsFromEvent, factsFromIntent, type StripeIntentLike } from './stripe-fact-map'

const ACCOUNT = 7n

const intent = (over: Partial<StripeIntentLike> = {}): StripeIntentLike => ({
  id: 'pi_1',
  status: 'succeeded',
  currency: 'usd',
  amount: 10000,
  amount_received: 10000,
  ...over,
})

describe('amount conversion', () => {
  it('classifies currencies the way Stripe does', () => {
    expect(isZeroDecimal('JPY')).toBe(true)
    expect(isZeroDecimal('jpy')).toBe(true)
    expect(isZeroDecimal('USD')).toBe(false)
    expect(isThreeDecimal('KWD')).toBe(true)
    expect(isThreeDecimal('USD')).toBe(false)
  })

  it('passes two-decimal amounts through unchanged', () => {
    expect(toStripeAmount(10500n, 'USD')).toBe(10500)
  })

  it('does not multiply zero-decimal currencies', () => {
    // 1000 yen is 1000, not 100000. Getting this wrong overcharges 100x.
    expect(toStripeAmount(1000n, 'JPY')).toBe(1000)
  })

  it('accepts a three-decimal amount ending in zero', () => {
    expect(toStripeAmount(1230n, 'KWD')).toBe(1230)
  })

  it('refuses a three-decimal amount Stripe cannot settle', () => {
    expect(() => toStripeAmount(1234n, 'KWD')).toThrow(ProviderError)
    try {
      toStripeAmount(1234n, 'BHD')
    } catch (error) {
      expect((error as ProviderError).code).toBe('amount_limit')
    }
  })

  it('refuses negative and unsafe amounts', () => {
    expect(() => toStripeAmount(-1n, 'USD')).toThrow(ProviderError)
    expect(() => toStripeAmount(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'USD')).toThrow(
      ProviderError,
    )
  })

  it('converts back to minor units', () => {
    expect(fromStripeAmount(10500, 'USD')).toBe(10500n)
    expect(() => fromStripeAmount(10.5, 'USD')).toThrow(ProviderError)
  })
})

describe('error mapping', () => {
  it('prefers decline_code over code and type', () => {
    expect(
      mapStripeError({ type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' }),
    ).toBe('declined_insufficient_funds')
  })

  it('maps risk declines distinctly from ordinary ones', () => {
    expect(mapStripeError({ decline_code: 'stolen_card' })).toBe('declined_risk')
    expect(mapStripeError({ decline_code: 'do_not_honor' })).toBe('declined_do_not_honor')
  })

  it('maps invalid card details', () => {
    for (const decline_code of ['expired_card', 'incorrect_cvc', 'invalid_number']) {
      expect(mapStripeError({ decline_code })).toBe('declined_card_invalid')
    }
  })

  it('maps authentication outcomes', () => {
    expect(mapStripeError({ decline_code: 'authentication_required' })).toBe(
      'authentication_required',
    )
    expect(mapStripeError({ code: 'payment_intent_authentication_failure' })).toBe(
      'authentication_failed',
    )
  })

  it('maps mode mismatch, which is otherwise mistaken for a decline', () => {
    expect(mapStripeError({ code: 'testmode_charges_only' })).toBe('mode_mismatch')
  })

  it('maps rate limits and outages to retryable codes', () => {
    expect(mapStripeError({ type: 'rate_limit_error' })).toBe('rate_limited')
    expect(mapStripeError({ statusCode: 429 })).toBe('rate_limited')
    expect(mapStripeError({ type: 'api_error' })).toBe('provider_unavailable')
    expect(mapStripeError({ statusCode: 503 })).toBe('provider_unavailable')
  })

  it('maps network failures to a timeout', () => {
    expect(mapStripeError({ code: 'ETIMEDOUT' })).toBe('provider_timeout')
    expect(mapStripeError({ type: 'StripeConnectionError' })).toBe('provider_timeout')
  })

  it('reads the nested raw shape', () => {
    expect(mapStripeError({ raw: { decline_code: 'insufficient_funds' } })).toBe(
      'declined_insufficient_funds',
    )
  })

  it('falls back to unknown rather than guessing', () => {
    expect(mapStripeError({})).toBe('unknown')
    expect(mapStripeError(null)).toBe('unknown')
    expect(mapStripeError('boom')).toBe('unknown')
  })

  it('extracts a message safely', () => {
    expect(stripeErrorMessage({ message: 'nope' })).toBe('nope')
    expect(stripeErrorMessage(null)).toContain('Stripe')
  })
})

describe('fact mapping from an intent', () => {
  it('reports a capture with the cumulative amount received', () => {
    const [fact] = factsFromIntent({ accountId: ACCOUNT, intent: intent() })
    expect(fact).toMatchObject({
      factType: 'attempt_captured',
      cumulativeAmountMinor: 10000n,
      currency: 'USD',
      gatewayReference: 'pi_1',
    })
  })

  it('reports a partial capture as the running total, not a delta', () => {
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({ amount_received: 4000 }),
    })
    expect(fact.cumulativeAmountMinor).toBe(4000n)
  })

  it('reports an authorization awaiting capture', () => {
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({ status: 'requires_capture', amount_capturable: 10000 }),
    })
    expect(fact).toMatchObject({
      factType: 'attempt_authorized',
      cumulativeAmountMinor: 10000n,
    })
  })

  it('reports a cancellation', () => {
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({ status: 'canceled' }),
    })
    expect(fact.factType).toBe('attempt_voided')
  })

  it('emits nothing for in-flight states', () => {
    for (const status of [
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'processing',
    ]) {
      expect(factsFromIntent({ accountId: ACCOUNT, intent: intent({ status }) })).toEqual([])
    }
  })

  it('carries charge and customer references', () => {
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({ latest_charge: 'ch_1', customer: { id: 'cus_1' } }),
    })
    expect(fact.refs).toMatchObject({
      gatewayCaptureRef: 'ch_1',
      gatewayCustomerId: 'cus_1',
    })
  })

  it('produces a dedupe key that advances with the amount', () => {
    const [first] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({ amount_received: 4000 }),
    })
    const [second] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({ amount_received: 10000 }),
    })
    expect(first.dedupeKey).not.toBe(second.dedupeKey)
  })

  it('produces the same dedupe key for a redelivered fact', () => {
    const [a] = factsFromIntent({ accountId: ACCOUNT, intent: intent() })
    const [b] = factsFromIntent({ accountId: ACCOUNT, intent: intent() })
    expect(a.dedupeKey).toBe(b.dedupeKey)
  })

  it('scopes the dedupe key to the account', () => {
    const [a] = factsFromIntent({ accountId: 1n, intent: intent() })
    const [b] = factsFromIntent({ accountId: 2n, intent: intent() })
    expect(a.dedupeKey).not.toBe(b.dedupeKey)
  })
})

describe('fact mapping from an event', () => {
  const event = (type: string, object: Record<string, unknown>) => ({
    id: 'evt_1',
    type,
    created: 1_700_000_000,
    data: { object },
  })

  it('maps a succeeded payment intent', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('payment_intent.succeeded', intent() as unknown as Record<string, unknown>),
    })
    expect(facts[0]).toMatchObject({ factType: 'attempt_captured' })
  })

  it('maps a failure without needing an amount', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('payment_intent.payment_failed', {
        id: 'pi_2',
        currency: 'usd',
        last_payment_error: { message: 'card declined' },
      }),
    })
    expect(facts[0]).toMatchObject({ factType: 'attempt_failed', gatewayReference: 'pi_2' })
  })

  it('maps disputes to the reference of the payment, not the dispute', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('charge.dispute.created', {
        id: 'dp_1',
        payment_intent: 'pi_3',
        currency: 'usd',
        status: 'needs_response',
      }),
    })
    expect(facts[0]).toMatchObject({ factType: 'dispute_opened', gatewayReference: 'pi_3' })
  })

  it('ignores events it does not handle', () => {
    expect(
      factsFromEvent({ accountId: ACCOUNT, event: event('customer.created', { id: 'cus_1' }) }),
    ).toEqual([])
  })

  it('uses the event timestamp as the occurrence time', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('payment_intent.succeeded', intent() as unknown as Record<string, unknown>),
    })
    expect(facts[0].occurredAt?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })
})
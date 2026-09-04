import { ProviderError } from '../../provider.types'
import { fromStripeAmount, isThreeDecimal, isZeroDecimal, toStripeAmount } from './stripe-amount'
import { mapStripeError, stripeErrorMessage } from './stripe-error-map'
import {
  factsFromEvent,
  factsFromIntent,
  isRecognisedEventType,
  type StripeIntentLike,
} from './stripe-fact-map'

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

  it('maps the TEST "Simulate scan → reject" flow to a real reason, not unknown', () => {
    // A non-card (redirect/QR/wallet) payment method reports its decline
    // through `code`, not `decline_code` — this used to fall through
    // every table here to `unknown`.
    expect(mapStripeError({ code: 'payment_method_customer_decline' })).toBe(
      'declined_do_not_honor',
    )
    expect(mapStripeError({ code: 'payment_method_provider_decline' })).toBe(
      'declined_do_not_honor',
    )
  })

  it('maps payment-method availability and timeout codes', () => {
    expect(mapStripeError({ code: 'payment_method_not_available' })).toBe('method_unavailable')
    expect(mapStripeError({ code: 'payment_method_provider_timeout' })).toBe('provider_timeout')
    expect(mapStripeError({ code: 'authentication_failure' })).toBe('authentication_failed')
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

  it('reports a failure when a declined confirmation returns the intent to requires_payment_method', () => {
    // Stripe has no distinct terminal "failed" PaymentIntent status: a
    // declined card (or a rejected TEST "Simulate scan") sends the
    // intent back to requires_payment_method with last_payment_error
    // set. Without this, a sync/poll can never resolve such an attempt.
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({
        status: 'requires_payment_method',
        last_payment_error: { message: 'Your card was declined.' },
      }),
    })
    expect(fact).toMatchObject({ factType: 'attempt_failed', gatewayReference: 'pi_1' })
  })

  it('classifies a declined confirmation into a structured failure code', () => {
    // This is the bug that made a merchant TEST failure show "سبب الفشل:
    // unknown": the mapper used to read only last_payment_error.message,
    // never its decline_code — so nothing downstream had a code to show.
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({
        status: 'requires_payment_method',
        last_payment_error: {
          decline_code: 'insufficient_funds',
          code: 'card_declined',
          message: 'Your card has insufficient funds.',
        },
      }),
    })
    expect(fact.failureCode).toBe('declined_insufficient_funds')
  })

  it('classifies the real TEST "Simulate scan → reject" flow, not as unknown', () => {
    // This is the exact shape a rejected non-card TEST confirmation
    // (Cash App Pay / PayNow / similar QR-based method's "Simulate
    // scan" → Fail button) reports: `code` set, no `decline_code`.
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({
        status: 'requires_payment_method',
        last_payment_error: {
          code: 'payment_method_customer_decline',
          message: 'The customer did not approve the payment.',
        },
      }),
    })
    expect(fact.failureCode).toBe('declined_do_not_honor')
  })

  it('falls back to unknown when last_payment_error carries no classifiable code', () => {
    const [fact] = factsFromIntent({
      accountId: ACCOUNT,
      intent: intent({
        status: 'requires_payment_method',
        last_payment_error: { message: 'Something went wrong.' },
      }),
    })
    expect(fact.failureCode).toBe('unknown')
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

  it('maps a Checkout Session expiry to attempt_expired on its PaymentIntent', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('checkout.session.expired', {
        id: 'cs_1',
        currency: 'usd',
        payment_intent: 'pi_4',
      }),
    })
    expect(facts[0]).toMatchObject({ factType: 'attempt_expired', gatewayReference: 'pi_4' })
  })

  it('keys an abandoned Checkout Session expiry on the session id when no PaymentIntent was ever created', () => {
    // This is the common case, not the edge case: Stripe defers creating
    // a PaymentIntent until the customer submits payment, so a session
    // that expires unused (the whole reason this event fires) almost
    // always has none. `initializePayment` stores the session's own id
    // as the attempt's gatewayReference in exactly that situation, so
    // this fact must be keyed on it too, or it can never be matched to
    // the attempt it belongs to.
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('checkout.session.expired', { id: 'cs_2', currency: 'usd', payment_intent: null }),
    })
    expect(facts).toMatchObject([{ factType: 'attempt_expired', gatewayReference: 'cs_2' }])
  })

  it('treats Checkout Session completed/async_payment_* as recognised no-ops — the PaymentIntent event is authoritative', () => {
    for (const type of [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
    ]) {
      expect(isRecognisedEventType(type)).toBe(true)
      const facts = factsFromEvent({
        accountId: ACCOUNT,
        event: event(type, { id: 'cs_3', payment_status: 'paid' }),
      })
      expect(facts).toEqual([])
    }
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

  it('maps a refunded charge using the cumulative refunded total', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('charge.refunded', {
        id: 'ch_1',
        payment_intent: 'pi_1',
        currency: 'usd',
        amount: 5000,
        amount_refunded: 2000,
        refunded: false,
      }),
    })

    // amount_refunded, not amount: the applier reconciles refunds
    // cumulatively, so a second partial and a redelivered first differ.
    expect(facts[0]).toMatchObject({
      factType: 'refund_succeeded',
      gatewayReference: 'pi_1',
      cumulativeAmountMinor: 2000n,
    })
  })

  it('ignores a refunded charge with no payment intent to attach to', () => {
    expect(
      factsFromEvent({
        accountId: ACCOUNT,
        event: event('charge.refunded', {
          id: 'ch_1',
          currency: 'usd',
          amount_refunded: 2000,
        }),
      }),
    ).toEqual([])
  })

  it('maps a failed refund update', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('refund.updated', {
        id: 're_9',
        payment_intent: 'pi_1',
        currency: 'usd',
        amount: 2000,
        status: 'failed',
      }),
    })

    expect(facts[0]).toMatchObject({
      factType: 'refund_failed',
      gatewayReference: 'pi_1',
    })
    // Keyed per refund, so two refunds failing on one payment are two facts.
    expect(facts[0].dedupeKey).toContain('re_9')
  })

  it('produces no fact for a succeeded refund update', () => {
    // A single Refund carries its own amount, not the running total, and
    // treating it as cumulative would erase an earlier partial refund.
    // charge.refunded is the authoritative source for a successful refund.
    expect(
      factsFromEvent({
        accountId: ACCOUNT,
        event: event('refund.updated', {
          id: 're_9',
          payment_intent: 'pi_1',
          currency: 'usd',
          amount: 2000,
          status: 'succeeded',
        }),
      }),
    ).toEqual([])
  })

  it('recognises requires_action without producing a fact', () => {
    expect(isRecognisedEventType('payment_intent.requires_action')).toBe(true)
    expect(
      factsFromEvent({
        accountId: ACCOUNT,
        event: event('payment_intent.requires_action', {
          id: 'pi_1',
          status: 'requires_action',
          currency: 'usd',
          amount: 5000,
        }),
      }),
    ).toEqual([])
  })

  it('does not recognise an event type it has no mapping for', () => {
    expect(isRecognisedEventType('invoice.payment_succeeded')).toBe(false)
  })

  it('uses the event timestamp as the occurrence time', () => {
    const facts = factsFromEvent({
      accountId: ACCOUNT,
      event: event('payment_intent.succeeded', intent() as unknown as Record<string, unknown>),
    })
    expect(facts[0].occurredAt?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })
})
describe('dispute mapping', () => {
  const disputeEvent = (type: string, object: Record<string, unknown>) => ({
    id: 'evt_d',
    type,
    created: 1_700_000_000,
    data: { object },
  })

  const dispute = (over: Record<string, unknown> = {}) => ({
    id: 'dp_1',
    payment_intent: 'pi_1',
    currency: 'usd',
    amount: 5000,
    status: 'needs_response',
    reason: 'fraudulent',
    ...over,
  })

  it('maps an opened dispute with its amount', () => {
    const [fact] = factsFromEvent({
      accountId: ACCOUNT,
      event: disputeEvent('charge.dispute.created', dispute()),
    })

    expect(fact).toMatchObject({
      factType: 'dispute_opened',
      gatewayReference: 'pi_1',
      cumulativeAmountMinor: 5000n,
      currency: 'USD',
    })
    // The dispute id keys the fact, so one payment can be disputed twice.
    expect(fact.dedupeKey).toContain('dp_1')
    expect(fact.refs?.gatewayCaptureRef).toBe('dp_1')
  })

  it('maps a won dispute', () => {
    const [fact] = factsFromEvent({
      accountId: ACCOUNT,
      event: disputeEvent('charge.dispute.closed', dispute({ status: 'won' })),
    })

    expect(fact.factType).toBe('dispute_won')
  })

  it('maps a lost dispute', () => {
    const [fact] = factsFromEvent({
      accountId: ACCOUNT,
      event: disputeEvent('charge.dispute.closed', dispute({ status: 'lost' })),
    })

    expect(fact.factType).toBe('dispute_lost')
  })

  it('maps a close with no winner to an audit-only fact', () => {
    const [fact] = factsFromEvent({
      accountId: ACCOUNT,
      event: disputeEvent(
        'charge.dispute.closed',
        dispute({ status: 'warning_closed' }),
      ),
    })

    // Not won and not lost: recorded, but nothing to post.
    expect(fact.factType).toBe('dispute_closed')
  })

  it('gives won and lost different dedupe keys', () => {
    const [won] = factsFromEvent({
      accountId: ACCOUNT,
      event: disputeEvent('charge.dispute.closed', dispute({ status: 'won' })),
    })
    const [lost] = factsFromEvent({
      accountId: ACCOUNT,
      event: disputeEvent('charge.dispute.closed', dispute({ status: 'lost' })),
    })

    expect(won.dedupeKey).not.toBe(lost.dedupeKey)
  })
})

import {
  classify,
  factsFromTransaction,
  isRecognisedCallbackType,
  orderReference,
  transactionId,
} from './paymob-fact-map'
import { PROCESSED_CALLBACK } from './paymob-fixtures'

const base = PROCESSED_CALLBACK.obj

const facts = (over: Record<string, unknown> = {}) =>
  factsFromTransaction({ accountId: 5n, transaction: { ...base, ...over } })

describe('classification', () => {
  it('files a successful standalone payment as captured', () => {
    // The documented example: no auth/capture split, money taken in one
    // step.
    expect(classify(base)).toBe('attempt_captured')
  })

  it('files an authorisation as authorized, not captured', () => {
    // Auth/Cap reserves funds; treating it as captured would post
    // revenue for money nobody has taken yet.
    expect(classify({ ...base, is_auth: true })).toBe('attempt_authorized')
  })

  it('files a capture as captured', () => {
    expect(classify({ ...base, is_capture: true })).toBe('attempt_captured')
    expect(classify({ ...base, is_captured: true })).toBe('attempt_captured')
  })

  it('files a void as voided', () => {
    expect(classify({ ...base, is_voided: true })).toBe('attempt_voided')
    expect(classify({ ...base, is_void: true })).toBe('attempt_voided')
  })

  it('files a refund as refunded even though the parent still says success', () => {
    // Paymob delivers refund callbacks *for the parent transaction*,
    // which still carries success: true from the original payment.
    // Checking success first would file a refund as a second payment.
    expect(classify({ ...base, success: true, is_refunded: true })).toBe(
      'refund_succeeded',
    )
    expect(classify({ ...base, success: true, is_refund: true })).toBe(
      'refund_succeeded',
    )
  })

  it('separates a failed refund from a failed payment', () => {
    expect(classify({ ...base, success: false, is_refund: true })).toBe(
      'refund_failed',
    )
    expect(classify({ ...base, success: false })).toBe('attempt_failed')
  })

  it('files a declined authorisation as a failure, not an authorisation', () => {
    expect(classify({ ...base, is_auth: true, success: false })).toBe(
      'attempt_failed',
    )
  })
})

describe('amounts', () => {
  it('treats Paymob cents as our minor units, as bigint', () => {
    const [fact] = facts()

    expect(fact.cumulativeAmountMinor).toBe(100000n)
    expect(typeof fact.cumulativeAmountMinor).toBe('bigint')
  })

  it('prefers the documented cumulative total for a capture', () => {
    // "captured_amount ⇒ The total of the captured amount. (The payment
    // transaction can have more than one partial capture transaction)"
    const [fact] = facts({ is_capture: true, amount_cents: 40000, captured_amount: 90000 })

    expect(fact.cumulativeAmountMinor).toBe(90000n)
  })

  it('prefers the documented cumulative total for a refund', () => {
    const [fact] = facts({
      is_refunded: true,
      amount_cents: 100000,
      refunded_amount_cents: 30000,
    })

    expect(fact.cumulativeAmountMinor).toBe(30000n)
  })

  it("falls back to the transaction's own amount when no total is sent", () => {
    // Paymob sends null for both totals on a plain payment, where the
    // amount is the total.
    const [fact] = facts({ captured_amount: null, refunded_amount_cents: null })

    expect(fact.cumulativeAmountMinor).toBe(100000n)
  })

  it('survives amounts sent as strings', () => {
    const [fact] = facts({ amount_cents: '250000' })

    expect(fact.cumulativeAmountMinor).toBe(250000n)
  })
})

describe('correlation', () => {
  it('references the order, which exists from the moment the intention does', () => {
    const [fact] = facts()

    expect(fact.gatewayReference).toBe('217503754')
    expect(orderReference(base)).toBe('217503754')
  })

  it('carries the transaction id, which the manage-payment APIs key on', () => {
    const [fact] = facts()

    expect(fact.refs?.gatewayPaymentId).toBe('192036465')
    expect(transactionId(base)).toBe('192036465')
  })

  it('produces nothing when there is no order to correlate against', () => {
    expect(factsFromTransaction({ accountId: 5n, transaction: { id: 1 } })).toEqual([])
  })

  it('dedupes on content, so a redelivery collapses to one fact', () => {
    expect(facts()[0].dedupeKey).toBe(facts()[0].dedupeKey)
  })

  it('gives a larger cumulative refund a different dedupe key', () => {
    // A "refunded 30 of 100" fact and a later "refunded 100 of 100" are
    // different facts, not a redelivery.
    const first = facts({ is_refunded: true, refunded_amount_cents: 30000 })[0]
    const second = facts({ is_refunded: true, refunded_amount_cents: 100000 })[0]

    expect(first.dedupeKey).not.toBe(second.dedupeKey)
  })
})

describe('pending and shape', () => {
  it('produces nothing for a pending transaction', () => {
    // Filing a pending transaction as a failure would cancel a payment
    // that is still in flight.
    expect(facts({ pending: true })).toEqual([])
  })

  it('records when the change happened', () => {
    const [fact] = facts()

    expect(fact.occurredAt?.toISOString()).toContain('2024-06-13')
  })

  it('ignores an unparseable timestamp rather than producing an invalid date', () => {
    const [fact] = facts({ updated_at: 'not a date', created_at: 'not a date' })

    expect(fact.occurredAt).toBeUndefined()
  })

  it('redacts what it keeps of the raw transaction', () => {
    const [fact] = facts()

    const raw = JSON.stringify(fact.rawRedacted)

    // No PAN, no customer, no raw body.
    expect(raw).not.toContain('2346')
    expect(raw).toContain('192036465')
  })
})

describe('callback envelope', () => {
  it('recognises the one documented type', () => {
    expect(isRecognisedCallbackType('TRANSACTION')).toBe(true)
    expect(isRecognisedCallbackType('transaction')).toBe(true)
    expect(isRecognisedCallbackType('SOMETHING_ELSE')).toBe(false)
    expect(isRecognisedCallbackType(undefined)).toBe(false)
  })
})

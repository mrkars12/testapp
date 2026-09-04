import {
  classify,
  factsFromInvoice,
  factsFromPayment,
  isPaymentEvent,
  isRecognisedEvent,
  MOYASAR_EVENTS,
} from './moyasar-fact-map'
import { AVAILABLE_EVENTS, PAID_PAYMENT } from './moyasar-fixtures'

const facts = (over: Record<string, unknown> = {}) =>
  factsFromPayment({ accountId: 5n, payment: { ...PAID_PAYMENT, ...over } })

describe('status classification', () => {
  it('files a paid payment as captured', () => {
    // The invoice flow settles in one step; `paid` is money taken.
    expect(classify('paid')).toBe('attempt_captured')
  })

  it('distinguishes an authorisation from a capture', () => {
    // Treating `authorized` as captured would post revenue for money
    // nobody has taken yet.
    expect(classify('authorized')).toBe('attempt_authorized')
    expect(classify('captured')).toBe('attempt_captured')
  })

  it('files failures, voids and refunds', () => {
    expect(classify('failed')).toBe('attempt_failed')
    expect(classify('voided')).toBe('attempt_voided')
    expect(classify('refunded')).toBe('refund_succeeded')
  })

  it('produces nothing for a payment that has not resolved', () => {
    // `initiated` means the cardholder has not paid. Filing it either
    // way would create an order nobody paid for, or cancel a payment
    // still in flight.
    expect(classify('initiated')).toBeNull()
  })

  it('produces nothing for a card verification', () => {
    // "verified: the cardholder verifies his card in the tokenization
    // process" — a card check, not a charge.
    expect(classify('verified')).toBeNull()
  })

  it('does not guess at a status it has never seen', () => {
    expect(classify('something_new')).toBeNull()
    expect(classify(undefined)).toBeNull()
  })
})

describe('amounts', () => {
  it('treats Moyasar amounts as our minor units, as bigint', () => {
    const [fact] = facts()

    expect(fact.cumulativeAmountMinor).toBe(100n)
    expect(typeof fact.cumulativeAmountMinor).toBe('bigint')
  })

  it('prefers the documented running total for a refund', () => {
    // "refunded: Refunded amount. Less than or equal to the payment
    // amount" — a total, which is what ObservedFact wants.
    const [fact] = facts({ status: 'refunded', amount: 10000, refunded: 2500 })

    expect(fact.factType).toBe('refund_succeeded')
    expect(fact.cumulativeAmountMinor).toBe(2500n)
  })

  it('prefers the documented running total for a capture', () => {
    const [fact] = facts({ status: 'captured', amount: 10000, captured: 6000 })

    expect(fact.cumulativeAmountMinor).toBe(6000n)
  })

  it("falls back to the payment's own amount when no total is sent", () => {
    const [fact] = facts({ status: 'refunded', amount: 10000, refunded: 0 })

    expect(fact.cumulativeAmountMinor).toBe(10000n)
  })

  it('handles a three-decimal currency without rescaling', () => {
    // 1.000 KWD = 1000 in both Moyasar's units and ours, so a conversion
    // here would be the bug rather than the fix.
    const [fact] = facts({ currency: 'KWD', amount: 1000 })

    expect(fact.cumulativeAmountMinor).toBe(1000n)
    expect(fact.currency).toBe('KWD')
  })
})

describe('correlation', () => {
  it('references the invoice, which exists before any payment does', () => {
    const [fact] = facts()

    expect(fact.gatewayReference).toBe(PAID_PAYMENT.invoice_id)
  })

  it('carries the payment id, which the refund endpoint keys on', () => {
    const [fact] = facts()

    expect(fact.refs?.gatewayPaymentId).toBe(PAID_PAYMENT.id)
  })

  it('produces nothing for a payment with no invoice', () => {
    // A dashboard or direct-API payment was not created by this adapter
    // and nothing downstream could match it.
    expect(facts({ invoice_id: null })).toEqual([])
  })

  it('gives a larger cumulative refund a different dedupe key', () => {
    const first = facts({ status: 'refunded', refunded: 2500 })[0]
    const second = facts({ status: 'refunded', refunded: 10000 })[0]

    expect(first.dedupeKey).not.toBe(second.dedupeKey)
  })

  it('collapses a redelivery of the same fact', () => {
    expect(facts()[0].dedupeKey).toBe(facts()[0].dedupeKey)
  })
})

describe('shape', () => {
  it('records when the change happened', () => {
    const [fact] = facts()

    expect(fact.occurredAt?.toISOString()).toContain('2026-05-20')
  })

  it('ignores an unparseable timestamp', () => {
    const [fact] = facts({ updated_at: 'not a date', created_at: 'not a date' })

    expect(fact.occurredAt).toBeUndefined()
  })

  it('keeps no card or payer data in the redacted payload', () => {
    const [fact] = facts()

    const raw = JSON.stringify(fact.rawRedacted)

    expect(raw).not.toContain('4111')
    expect(raw).not.toContain('John Doe')
    expect(raw).toContain(PAID_PAYMENT.id)
  })
})

describe('invoice fetch', () => {
  it('maps every payment on the invoice', () => {
    const mapped = factsFromInvoice({
      accountId: 5n,
      invoice: {
        id: 'inv_1',
        payments: [
          { ...PAID_PAYMENT, id: 'p1', invoice_id: undefined, status: 'failed' },
          { ...PAID_PAYMENT, id: 'p2', invoice_id: undefined, status: 'paid' },
        ],
      },
    })

    expect(mapped).toHaveLength(2)
    // The invoice we asked about is authoritative when a payment does
    // not echo invoice_id back.
    expect(mapped.every((f) => f.gatewayReference === 'inv_1')).toBe(true)
    expect(mapped.map((f) => f.factType)).toEqual([
      'attempt_failed',
      'attempt_captured',
    ])
  })

  it('returns nothing for an invoice with no payments', () => {
    expect(
      factsFromInvoice({ accountId: 5n, invoice: { id: 'inv_1', payments: [] } }),
    ).toEqual([])
  })

  it('survives an invoice with no payments array at all', () => {
    expect(factsFromInvoice({ accountId: 5n, invoice: { id: 'inv_1' } })).toEqual([])
  })

  it('falls back to the invoice’s own status when the customer never submitted a payment', () => {
    // An abandoned Moyasar invoice — the customer closed the hosted page,
    // or the payment window closed — has an empty `payments` array
    // forever. Moyasar documents no webhook for this; fetchStatus()/sync
    // is the only way it is ever discoverable, and it is discoverable
    // only from the invoice's own status, not from any payment object.
    const expired = factsFromInvoice({
      accountId: 5n,
      invoice: { id: 'inv_2', status: 'expired', currency: 'sar', payments: [] },
    })
    expect(expired).toEqual([
      expect.objectContaining({ factType: 'attempt_expired', gatewayReference: 'inv_2' }),
    ])

    const canceled = factsFromInvoice({
      accountId: 5n,
      invoice: { id: 'inv_3', status: 'canceled', payments: [] },
    })
    expect(canceled).toEqual([
      expect.objectContaining({ factType: 'attempt_voided', gatewayReference: 'inv_3' }),
    ])
  })

  it('does not use the invoice status when a real payment fact already exists', () => {
    // The invoice's own status can legitimately say "paid" too, but the
    // payment-derived fact (with its real amount) must win — never a
    // second, amount-less fact for the same outcome.
    const mapped = factsFromInvoice({
      accountId: 5n,
      invoice: {
        id: 'inv_4',
        status: 'paid',
        payments: [{ ...PAID_PAYMENT, id: 'p4', invoice_id: undefined }],
      },
    })
    expect(mapped).toHaveLength(1)
    expect(mapped[0].factType).toBe('attempt_captured')
  })

  it('ignores an invoice still genuinely in flight (initiated/on_hold)', () => {
    for (const status of ['initiated', 'on_hold', undefined]) {
      expect(
        factsFromInvoice({ accountId: 5n, invoice: { id: 'inv_5', status, payments: [] } }),
      ).toEqual([])
    }
  })
})

describe('event names', () => {
  it('recognises every event Moyasar publishes', () => {
    for (const event of AVAILABLE_EVENTS) {
      expect(isRecognisedEvent(event)).toBe(true)
    }
  })

  it("also recognises the docs' alternate spelling of the failure event", () => {
    // The webhook reference and dashboard guide say `payment_faild`
    // while the API's available-events response says `payment_failed`.
    // Both are documented, so neither should be filed as unknown.
    expect(isRecognisedEvent('payment_faild')).toBe(true)
    expect(MOYASAR_EVENTS).toContain('payment_failed')
  })

  it('does not recognise an event nobody documented', () => {
    expect(isRecognisedEvent('payment_exploded')).toBe(false)
    expect(isRecognisedEvent(undefined)).toBe(false)
  })

  it('separates payment events from card authentication events', () => {
    expect(isPaymentEvent('payment_paid')).toBe(true)
    // These carry a card_auth, not a payment, and move no money.
    expect(isPaymentEvent('card_auth_authenticated')).toBe(false)
  })
})

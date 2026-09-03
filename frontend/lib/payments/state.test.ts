import { describe, it, expect } from 'vitest'
import {
  normalizePaymentStatus,
  normalizeAttemptStatus,
  resolvePaymentState,
  isTerminalState,
} from './state'

describe('normalizePaymentStatus maps backend statuses onto the UI vocabulary', () => {
  it('treats every funds-secured status as success', () => {
    // `authorized` counts: it is the point at which the backend creates an
    // Order, so anything less would render a real paid order as pending.
    for (const s of ['authorized', 'captured', 'partially_captured']) {
      expect(normalizePaymentStatus(s)).toBe('SUCCESS')
    }
  })

  it('keeps refunds on the success side — a refund is not a failed payment', () => {
    expect(normalizePaymentStatus('refunded')).toBe('SUCCESS')
    expect(normalizePaymentStatus('partially_refunded')).toBe('SUCCESS')
  })

  it('separates failure, cancellation and expiry rather than flattening them', () => {
    expect(normalizePaymentStatus('failed')).toBe('FAILED')
    expect(normalizePaymentStatus('cancelled')).toBe('CANCELLED')
    expect(normalizePaymentStatus('expired')).toBe('EXPIRED')
  })

  it('maps in-flight statuses to REQUIRES_ACTION or PROCESSING', () => {
    expect(normalizePaymentStatus('requires_action')).toBe('REQUIRES_ACTION')
    expect(normalizePaymentStatus('requires_payment_method')).toBe('REQUIRES_ACTION')
    expect(normalizePaymentStatus('processing')).toBe('PROCESSING')
    expect(normalizePaymentStatus('created')).toBe('PROCESSING')
  })

  it('maps an unknown status to PROCESSING, never to a terminal state', () => {
    // If the backend grows a status this build doesn't know, the failure
    // mode must be "keep asking", not "declare an outcome we invented".
    expect(normalizePaymentStatus('some_future_status')).toBe('PROCESSING')
    expect(isTerminalState(normalizePaymentStatus('some_future_status'))).toBe(false)
  })

  it('returns null for a missing status', () => {
    expect(normalizePaymentStatus(null)).toBeNull()
    expect(normalizePaymentStatus(undefined)).toBeNull()
  })
})

describe('isTerminalState gates when polling may stop', () => {
  it('is true only for the four settled outcomes', () => {
    expect(isTerminalState('SUCCESS')).toBe(true)
    expect(isTerminalState('FAILED')).toBe(true)
    expect(isTerminalState('CANCELLED')).toBe(true)
    expect(isTerminalState('EXPIRED')).toBe(true)
    expect(isTerminalState('PROCESSING')).toBe(false)
    expect(isTerminalState('REQUIRES_ACTION')).toBe(false)
    expect(isTerminalState(null)).toBe(false)
  })
})

describe('resolvePaymentState combines the order and intent views', () => {
  it("lets the order's own PAID verdict settle it", () => {
    expect(
      resolvePaymentState({ intentStatus: 'processing', orderPaymentStatus: 'PAID', hasOrder: true }),
    ).toBe('SUCCESS')
  })

  it("lets the order's own FAILED verdict settle it", () => {
    expect(
      resolvePaymentState({ intentStatus: 'processing', orderPaymentStatus: 'FAILED', hasOrder: true }),
    ).toBe('FAILED')
  })

  it('reports a decline that produced no order', () => {
    // The common Moyasar/3DS decline: no Order is ever created, so the
    // intent status is the only evidence there is.
    expect(resolvePaymentState({ intentStatus: 'failed', hasOrder: false })).toBe('FAILED')
  })

  it('treats an existing order as success when the intent status lags behind', () => {
    // No gateway creates an Order for a payment that never secured funds,
    // so the row's existence IS the evidence — without this the checkout
    // renders "processing" forever because the intent row trails by a beat.
    expect(
      resolvePaymentState({ intentStatus: 'processing', orderPaymentStatus: 'UNPAID', hasOrder: true }),
    ).toBe('SUCCESS')
  })

  it('treats an existing order as success when the intent status is unrecognized', () => {
    expect(
      resolvePaymentState({ intentStatus: 'something_new', hasOrder: true }),
    ).toBe('SUCCESS')
  })

  it('still reports a terminal failure that arrived alongside an order row', () => {
    // A terminal intent status outranks the order's mere existence, so a
    // stale order row can never mask a real decline.
    expect(resolvePaymentState({ intentStatus: 'failed', hasOrder: true })).toBe('FAILED')
    expect(resolvePaymentState({ intentStatus: 'cancelled', hasOrder: true })).toBe('CANCELLED')
  })

  it('stays non-terminal while the customer still has something to do', () => {
    const state = resolvePaymentState({ intentStatus: 'requires_action', hasOrder: false })
    expect(state).toBe('REQUIRES_ACTION')
    expect(isTerminalState(state)).toBe(false)
  })

  it('returns null when nothing is known yet', () => {
    expect(resolvePaymentState({})).toBeNull()
  })
})

/* ══════════════════════════════════════════════════════════════════════
   The retry lifecycle.

   A declined attempt deliberately leaves the INTENT payable (backend
   payment-intent.state.ts's recovery rule), so the attempt's own status
   is what tells this page a try is over. Without it a declined card
   renders as "جارٍ معالجة الدفع" forever with no retry offered — which
   is the exact dead end these tests exist to prevent regressing.
   ══════════════════════════════════════════════════════════════════════ */
describe('normalizeAttemptStatus', () => {
  it('maps only the terminal attempt statuses', () => {
    expect(normalizeAttemptStatus('succeeded')).toBe('SUCCESS')
    expect(normalizeAttemptStatus('failed')).toBe('FAILED')
    expect(normalizeAttemptStatus('cancelled')).toBe('CANCELLED')
    expect(normalizeAttemptStatus('expired')).toBe('EXPIRED')
  })

  it('leaves an in-flight attempt undecided so a poll cannot end early', () => {
    for (const s of ['initialized', 'requires_action', 'processing']) {
      expect(normalizeAttemptStatus(s)).toBeNull()
    }
    expect(normalizeAttemptStatus(null)).toBeNull()
    expect(normalizeAttemptStatus(undefined)).toBeNull()
  })
})

describe('resolvePaymentState is attempt-aware', () => {
  it('reports FAILED for a declined attempt on a still-payable intent', () => {
    expect(
      resolvePaymentState({
        intentStatus: 'requires_payment_method',
        attemptStatus: 'failed',
        hasOrder: false,
      }),
    ).toBe('FAILED')
  })

  it('reports CANCELLED for a voided attempt on a still-payable intent', () => {
    expect(
      resolvePaymentState({
        intentStatus: 'processing',
        attemptStatus: 'cancelled',
        hasOrder: false,
      }),
    ).toBe('CANCELLED')
  })

  it('keeps waiting while the attempt is still in flight', () => {
    const state = resolvePaymentState({
      intentStatus: 'processing',
      attemptStatus: 'requires_action',
      hasOrder: false,
    })
    expect(state).toBe('PROCESSING')
    expect(isTerminalState(state)).toBe(false)
  })

  it('never lets a stale failed attempt unpay a paid checkout', () => {
    // The new attempt succeeded and the order exists; a reading that
    // still carries the OLD attempt's failure must not win.
    expect(
      resolvePaymentState({
        intentStatus: 'captured',
        orderPaymentStatus: 'PAID',
        attemptStatus: 'failed',
        hasOrder: true,
      }),
    ).toBe('SUCCESS')

    expect(
      resolvePaymentState({
        intentStatus: 'processing',
        attemptStatus: 'failed',
        hasOrder: true,
      }),
    ).toBe('SUCCESS')
  })

  it('reports success from a succeeded attempt without contradicting the order', () => {
    expect(
      resolvePaymentState({
        intentStatus: 'captured',
        attemptStatus: 'succeeded',
        hasOrder: true,
      }),
    ).toBe('SUCCESS')
  })
})

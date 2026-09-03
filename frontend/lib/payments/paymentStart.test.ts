import { describe, it, expect } from 'vitest'
import { hasRealPaymentAttempt, readServerAttemptStarted } from './paymentStart'

const evidence = (over: Partial<Parameters<typeof hasRealPaymentAttempt>[0]> = {}) => ({
  submittedHere: false,
  providerPaymentRef: null,
  serverStarted: null,
  ...over,
})

describe('mounting a form is not submitting a payment', () => {
  it('is false when the server says nothing was submitted', () => {
    // The idle embedded form: mounted, untouched, and the server knows
    // it. Nothing here may put the checkout into a payment lifecycle.
    expect(hasRealPaymentAttempt(evidence({ serverStarted: false }))).toBe(false)
  })

  it('stays false however many browser events occurred', () => {
    // Focus, visibility, pageshow and a cross-tab ping all arrive as the
    // same call with the same evidence — none of them is a witness.
    const idle = evidence({ serverStarted: false })
    for (let i = 0; i < 10; i += 1) {
      expect(hasRealPaymentAttempt(idle)).toBe(false)
    }
  })

  it('is true the moment the provider says the payer submitted', () => {
    // Moyasar's `on_initiating`, before any provider object exists —
    // which is precisely the window the server cannot see.
    expect(
      hasRealPaymentAttempt(evidence({ submittedHere: true, serverStarted: false })),
    ).toBe(true)
  })

  it('is true when the provider returned a payment id', () => {
    expect(
      hasRealPaymentAttempt(
        evidence({ providerPaymentRef: 'pay_123', serverStarted: false }),
      ),
    ).toBe(true)
  })

  it('is true when the server says a payment was submitted', () => {
    expect(hasRealPaymentAttempt(evidence({ serverStarted: true }))).toBe(true)
  })

  it('treats an unknown server answer as "keep reconciling"', () => {
    // An older backend does not publish the field. Reading its absence
    // as "no" would silently switch off the reconciliation every
    // redirect flow depends on, which is the opposite failure.
    expect(hasRealPaymentAttempt(evidence({ serverStarted: null }))).toBe(true)
  })
})

describe('reading the server verdict', () => {
  it('reads a real boolean', () => {
    expect(readServerAttemptStarted({ payment_attempt_started: true })).toBe(true)
    expect(readServerAttemptStarted({ payment_attempt_started: false })).toBe(false)
  })

  it('reads anything else as unknown, never as no', () => {
    expect(readServerAttemptStarted({})).toBeNull()
    expect(readServerAttemptStarted(null)).toBeNull()
    expect(readServerAttemptStarted(undefined)).toBeNull()
    // A proxy that stringified the JSON must not be read as a verdict.
    expect(readServerAttemptStarted({ payment_attempt_started: 'false' })).toBeNull()
    expect(readServerAttemptStarted({ payment_attempt_started: 0 })).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { classifyRetryFailure } from './retryFailure'

/* ══════════════════════════════════════════════════════════════════════
   A failed retry must name the action that actually works.

   The failure this guards against is not a wrong message — it is a right
   message under a dead button. A customer whose chosen method has been
   disabled can press "المحاولة مرة أخرى" forever; the server will refuse
   it every time, and nothing on the screen says so.
   ══════════════════════════════════════════════════════════════════════ */

describe('classifying why a retry could not start', () => {
  it('a request that never completed stays retryable', () => {
    const failure = classifyRetryFailure({ status: null, error: new Error('offline') })
    expect(failure.action).toBe('retry')
    expect(failure.kind).toBe('network')
    // Nothing is known to be wrong with the checkout itself.
    expect(failure.message).not.toMatch(/طريقة دفع أخرى/)
  })

  it('a 5xx stays retryable — the checkout is not the problem', () => {
    expect(classifyRetryFailure({ status: 500 }).action).toBe('retry')
    expect(classifyRetryFailure({ status: 503 }).action).toBe('retry')
  })

  it('a 409 is "already in flight", not a failure to act on', () => {
    const failure = classifyRetryFailure({ status: 409, body: {} })
    expect(failure.action).toBe('retry')
    expect(failure.kind).toBe('in_flight')
    expect(failure.message).toMatch(/قيد المعالجة/)
  })

  it('a disabled offering sends the customer to the chooser', () => {
    const failure = classifyRetryFailure({
      status: 400,
      body: { message: 'Selected payment method is not available.' },
    })
    expect(failure.action).toBe('change_method')
    expect(failure.kind).toBe('offering_unavailable')
  })

  it('a published method code sends them to the chooser too', () => {
    for (const code of ['method_unavailable', 'currency_unsupported', 'amount_limit']) {
      expect(classifyRetryFailure({ status: 400, body: { code } }).action).toBe('change_method')
    }
  })

  it('a snapshot the server will no longer price says start over', () => {
    for (const message of [
      'Not enough stock for "Test product".',
      'Product variant 9 is unavailable.',
      'Cart total must be greater than zero.',
    ]) {
      const failure = classifyRetryFailure({ status: 400, body: { message } })
      expect(failure.action).toBe('restart_checkout')
      expect(failure.kind).toBe('snapshot_invalid')
    }
  })

  it('a checkout that is gone says start over, not "try again"', () => {
    for (const status of [404, 410]) {
      const failure = classifyRetryFailure({ status })
      expect(failure.action).toBe('restart_checkout')
      expect(failure.kind).toBe('checkout_gone')
    }
  })

  it('an unrecognised failure defaults to something safe', () => {
    // Conservative on purpose: a retry left on offer costs nothing (the
    // server is idempotent and re-prices from scratch), while wrongly
    // telling someone to start over loses the sale.
    expect(classifyRetryFailure({ status: 418, body: {} }).action).toBe('retry')
  })

  it('never surfaces a provider payload or a secret', () => {
    const failure = classifyRetryFailure({
      status: 400,
      body: { message: 'publishable_key pk_live_abc123 rejected by upstream' },
    })
    expect(failure.message).not.toContain('pk_live_abc123')
    expect(failure.message).not.toContain('publishable_key')
  })
})

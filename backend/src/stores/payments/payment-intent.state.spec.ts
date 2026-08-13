import {
  IllegalTransitionError,
  assertAttemptTransition,
  assertIntentTransition,
  canTransitionAttempt,
  canTransitionIntent,
  deriveStatusFromAmounts,
  evaluateOrdering,
  isTerminalAttempt,
  isTerminalIntent,
} from './payment-intent.state'

describe('intent transitions', () => {
  it('allows the happy path', () => {
    expect(canTransitionIntent('created', 'processing')).toBe(true)
    expect(canTransitionIntent('processing', 'authorized')).toBe(true)
    expect(canTransitionIntent('authorized', 'captured')).toBe(true)
    expect(canTransitionIntent('captured', 'refunded')).toBe(true)
  })

  it('allows partial capture to repeat', () => {
    expect(canTransitionIntent('partially_captured', 'partially_captured')).toBe(true)
    expect(canTransitionIntent('partially_captured', 'captured')).toBe(true)
  })

  it('never leaves a terminal state', () => {
    for (const terminal of ['failed', 'cancelled', 'expired', 'refunded'] as const) {
      expect(canTransitionIntent(terminal, 'processing')).toBe(false)
      expect(canTransitionIntent(terminal, 'captured')).toBe(false)
    }
  })

  it('treats a same-state event as legal', () => {
    expect(canTransitionIntent('failed', 'failed')).toBe(true)
  })

  it('rejects skipping backwards', () => {
    expect(canTransitionIntent('captured', 'authorized')).toBe(false)
    expect(canTransitionIntent('authorized', 'created')).toBe(false)
  })

  it('throws on an illegal transition', () => {
    expect(() => assertIntentTransition('captured', 'processing')).toThrow(
      IllegalTransitionError,
    )
    expect(() => assertIntentTransition('created', 'processing')).not.toThrow()
  })

  it('identifies terminal states', () => {
    expect(isTerminalIntent('captured')).toBe(true)
    expect(isTerminalIntent('processing')).toBe(false)
  })
})

describe('attempt transitions', () => {
  it('allows the happy path', () => {
    expect(canTransitionAttempt('initialized', 'requires_action')).toBe(true)
    expect(canTransitionAttempt('requires_action', 'authorized')).toBe(true)
    expect(canTransitionAttempt('authorized', 'succeeded')).toBe(true)
  })

  it('never leaves a terminal state', () => {
    for (const terminal of ['succeeded', 'failed', 'expired', 'cancelled'] as const) {
      expect(canTransitionAttempt(terminal, 'processing')).toBe(false)
    }
    expect(isTerminalAttempt('succeeded')).toBe(true)
  })

  it('throws on an illegal transition', () => {
    expect(() => assertAttemptTransition('succeeded', 'processing')).toThrow(
      IllegalTransitionError,
    )
  })
})

describe('ordering guards', () => {
  const snapshot = (
    status: Parameters<typeof evaluateOrdering>[0]['status'],
    captured = 0n,
    refunded = 0n,
  ) => ({ status, capturedTotalMinor: captured, refundedTotalMinor: refunded })

  it('applies a forward event', () => {
    expect(evaluateOrdering(snapshot('processing'), { status: 'authorized' })).toEqual({
      apply: true,
    })
  })

  it('rejects an event arriving after a terminal state', () => {
    expect(
      evaluateOrdering(snapshot('failed'), { status: 'processing' }),
    ).toEqual({ apply: false, reason: 'terminal_state' })
  })

  it('allows a refund to continue from captured', () => {
    expect(
      evaluateOrdering(snapshot('captured', 1000n), {
        status: 'partially_refunded',
        cumulativeRefundedMinor: 400n,
      }),
    ).toEqual({ apply: true })
  })

  it('rejects a captured-amount regression without needing a clock', () => {
    expect(
      evaluateOrdering(snapshot('partially_captured', 1000n), {
        status: 'partially_captured',
        cumulativeCapturedMinor: 600n,
      }),
    ).toEqual({ apply: false, reason: 'captured_regression' })
  })

  it('accepts an equal cumulative amount as a duplicate, not a regression', () => {
    expect(
      evaluateOrdering(snapshot('partially_captured', 1000n), {
        status: 'partially_captured',
        cumulativeCapturedMinor: 1000n,
      }),
    ).toEqual({ apply: true })
  })

  it('rejects a refunded-amount regression', () => {
    expect(
      evaluateOrdering(snapshot('partially_refunded', 1000n, 500n), {
        status: 'partially_refunded',
        cumulativeRefundedMinor: 200n,
      }),
    ).toEqual({ apply: false, reason: 'refunded_regression' })
  })

  it('rejects an illegal transition even when amounts look fine', () => {
    expect(
      evaluateOrdering(snapshot('authorized'), { status: 'created' }),
    ).toEqual({ apply: false, reason: 'illegal_transition' })
  })
})

describe('deriveStatusFromAmounts', () => {
  it('derives capture states', () => {
    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 1000n, refundedMinor: 0n, authorized: true,
      }),
    ).toBe('captured')

    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 400n, refundedMinor: 0n, authorized: true,
      }),
    ).toBe('partially_captured')
  })

  it('derives refund states', () => {
    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 1000n, refundedMinor: 1000n, authorized: true,
      }),
    ).toBe('refunded')

    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 1000n, refundedMinor: 250n, authorized: true,
      }),
    ).toBe('partially_refunded')
  })

  it('falls back to authorized or processing', () => {
    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 0n, refundedMinor: 0n, authorized: true,
      }),
    ).toBe('authorized')

    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 0n, refundedMinor: 0n, authorized: false,
      }),
    ).toBe('processing')
  })

  it('treats over-capture as fully captured', () => {
    expect(
      deriveStatusFromAmounts({
        amountMinor: 1000n, capturedMinor: 1200n, refundedMinor: 0n, authorized: true,
      }),
    ).toBe('captured')
  })
})
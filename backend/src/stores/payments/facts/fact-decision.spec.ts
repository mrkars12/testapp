import { decideFact, type DecisionInput } from './fact-decision'

const input = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  snapshot: {
    status: 'processing',
    capturedTotalMinor: 0n,
    refundedTotalMinor: 0n,
  },
  amountMinor: 10000n,
  factType: 'attempt_captured',
  cumulativeAmountMinor: 10000n,
  ...over,
})

describe('audit-only facts', () => {
  it('records dispute status changes that carry no outcome', () => {
    // A dispute moving to "under review", or closing with no winner,
    // changes nothing financially. Only opened/won/lost move money.
    for (const factType of ['dispute_updated', 'dispute_closed'] as const) {
      expect(decideFact(input({ factType })).kind).toBe('record_only')
    }
  })

  it('records settlement lines', () => {
    // Settlement is not implemented: there is no rule for reconciling
    // provider fees against estimates and no provider integration to
    // supply a payout, so acting on this would be guesswork.
    expect(decideFact(input({ factType: 'settlement_line' })).kind).toBe('record_only')
  })

  it('no longer discards disputes', () => {
    // Until this milestone these were record_only, so a chargeback never
    // reached the ledger and the receivable stayed overstated.
    for (const factType of ['dispute_opened', 'dispute_won', 'dispute_lost'] as const) {
      expect(decideFact(input({ factType })).kind).toBe('apply_dispute')
    }
  })

  it('refuses a dispute with no amount', () => {
    expect(
      decideFact(
        input({ factType: 'dispute_opened', cumulativeAmountMinor: undefined }),
      ),
    ).toEqual({ kind: 'ignore', reason: 'amount_missing' })
  })

  it('no longer discards refunds', () => {
    // Until this milestone these were record_only, which meant a refund
    // issued in the provider dashboard silently desynchronised the ledger.
    expect(decideFact(input({ factType: 'refund_succeeded' })).kind).not.toBe(
      'record_only',
    )
  })
})

describe('capture', () => {
  it('applies a full capture', () => {
    const decision = decideFact(input())
    expect(decision).toMatchObject({
      kind: 'apply',
      intentStatus: 'captured',
      attemptStatus: 'succeeded',
      capturedTotalMinor: 10000n,
      newCaptureMinor: 10000n,
      terminal: true,
    })
  })

  it('applies a partial capture', () => {
    const decision = decideFact(input({ cumulativeAmountMinor: 4000n }))
    expect(decision).toMatchObject({
      kind: 'apply',
      intentStatus: 'partially_captured',
      newCaptureMinor: 4000n,
    })
  })

  it('treats the second partial as a delta, not a total', () => {
    const decision = decideFact(
      input({
        snapshot: {
          status: 'partially_captured',
          capturedTotalMinor: 4000n,
          refundedTotalMinor: 0n,
        },
        cumulativeAmountMinor: 10000n,
      }),
    )
    expect(decision).toMatchObject({
      kind: 'apply',
      intentStatus: 'captured',
      newCaptureMinor: 6000n,
    })
  })

  it('reports a redelivered capture as already applied, not a regression', () => {
    const decision = decideFact(
      input({
        snapshot: {
          status: 'partially_captured',
          capturedTotalMinor: 4000n,
          refundedTotalMinor: 0n,
        },
        cumulativeAmountMinor: 4000n,
      }),
    )
    expect(decision).toEqual({ kind: 'ignore', reason: 'already_applied' })
  })

  it('ignores a capture reporting less than already captured', () => {
    const decision = decideFact(
      input({
        snapshot: {
          status: 'partially_captured',
          capturedTotalMinor: 8000n,
          refundedTotalMinor: 0n,
        },
        cumulativeAmountMinor: 3000n,
      }),
    )
    expect(decision).toEqual({ kind: 'ignore', reason: 'captured_regression' })
  })

  it('refuses a capture with no amount rather than guessing', () => {
    const decision = decideFact(input({ cumulativeAmountMinor: undefined }))
    expect(decision).toEqual({ kind: 'ignore', reason: 'amount_missing' })
  })

  it('treats an over-capture as fully captured', () => {
    expect(decideFact(input({ cumulativeAmountMinor: 12000n }))).toMatchObject({
      intentStatus: 'captured',
    })
  })
})

describe('other attempt facts', () => {
  it('applies authorization', () => {
    expect(
      decideFact(input({ factType: 'attempt_authorized', cumulativeAmountMinor: undefined })),
    ).toMatchObject({
      kind: 'apply',
      intentStatus: 'authorized',
      attemptStatus: 'authorized',
      newCaptureMinor: null,
      terminal: false,
    })
  })

  it('applies failure, expiry and void', () => {
    const cases = [
      ['attempt_failed', 'failed', 'failed'],
      ['attempt_expired', 'expired', 'expired'],
      ['attempt_voided', 'cancelled', 'cancelled'],
    ] as const

    for (const [factType, intentStatus, attemptStatus] of cases) {
      expect(
        decideFact(input({ factType, cumulativeAmountMinor: undefined })),
      ).toMatchObject({ kind: 'apply', intentStatus, attemptStatus, terminal: true })
    }
  })
})

describe('ordering guards', () => {
  it('ignores a non-funded outcome arriving after a terminal state', () => {
    // failed -> cancelled. Neither carries money, so there is nothing to
    // prefer the newer one for; a re-report of the SAME status is a
    // same-state no-op and stays legal.
    const decision = decideFact(
      input({
        snapshot: { status: 'failed', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
        factType: 'attempt_voided',
        cumulativeAmountMinor: undefined,
      }),
    )
    expect(decision).toEqual({ kind: 'ignore', reason: 'terminal_state' })
  })

  /*
   * The retry regression. A declined attempt must not poison the intent
   * against a later, genuine payment for the same order.
   *
   * Reproduced against the real Moyasar test account: the payer's card
   * was declined, they paid again on the same invoice, and the capture
   * was recorded `applied = false, superseded_reason = terminal_state` —
   * Moyasar had the money and this system had no order.
   */
  it('applies an authorization that arrives after a failed attempt', () => {
    const decision = decideFact(
      input({
        snapshot: { status: 'failed', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
        factType: 'attempt_authorized',
        cumulativeAmountMinor: undefined,
      }),
    )
    expect(decision.kind).toBe('apply')
  })

  it('applies a capture that arrives after a failed attempt', () => {
    const decision = decideFact(
      input({
        snapshot: { status: 'failed', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
        factType: 'attempt_captured',
        cumulativeAmountMinor: 10_000n,
      }),
    )
    expect(decision).toMatchObject({
      kind: 'apply',
      intentStatus: 'captured',
      attemptStatus: 'succeeded',
      capturedTotalMinor: 10_000n,
    })
  })

  it('applies a capture that arrives after an expired intent', () => {
    expect(
      decideFact(
        input({
          snapshot: { status: 'expired', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
          factType: 'attempt_captured',
          cumulativeAmountMinor: 10_000n,
        }),
      ).kind,
    ).toBe('apply')
  })

  /*
   * The other direction must stay shut: recovery is one-way. A late
   * failure for an older attempt cannot unpay an order that was paid.
   */
  it('still refuses a failure arriving after a capture', () => {
    expect(
      decideFact(
        input({
          snapshot: { status: 'captured', capturedTotalMinor: 10_000n, refundedTotalMinor: 0n },
          factType: 'attempt_failed',
          cumulativeAmountMinor: undefined,
        }),
      ),
    ).toEqual({ kind: 'ignore', reason: 'terminal_state' })
  })

  it('still refuses a void arriving after a capture', () => {
    expect(
      decideFact(
        input({
          snapshot: { status: 'captured', capturedTotalMinor: 10_000n, refundedTotalMinor: 0n },
          factType: 'attempt_voided',
          cumulativeAmountMinor: undefined,
        }),
      ),
    ).toEqual({ kind: 'ignore', reason: 'terminal_state' })
  })

  it('still refuses an expiry arriving after a capture', () => {
    expect(
      decideFact(
        input({
          snapshot: { status: 'captured', capturedTotalMinor: 10_000n, refundedTotalMinor: 0n },
          factType: 'attempt_expired',
          cumulativeAmountMinor: undefined,
        }),
      ),
    ).toEqual({ kind: 'ignore', reason: 'terminal_state' })
  })

  it('reports a redelivered capture on a recovered intent as already applied', () => {
    expect(
      decideFact(
        input({
          snapshot: { status: 'captured', capturedTotalMinor: 10_000n, refundedTotalMinor: 0n },
          factType: 'attempt_captured',
          cumulativeAmountMinor: 10_000n,
        }),
      ),
    ).toEqual({ kind: 'ignore', reason: 'already_applied' })
  })

  it('ignores an illegal backwards transition', () => {
    const decision = decideFact(
      input({
        snapshot: { status: 'authorized', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
        factType: 'attempt_authorized',
        cumulativeAmountMinor: undefined,
      }),
    )
    // authorized -> authorized is a same-state no-op, so it applies
    expect(decision.kind).toBe('apply')
  })

  it('allows capture after authorization', () => {
    expect(
      decideFact(
        input({
          snapshot: { status: 'authorized', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
        }),
      ).kind,
    ).toBe('apply')
  })

  it('applies a capture arriving after the intent was cancelled', () => {
    // Cancellation is not funded, so money arriving afterwards is the
    // stronger fact. The payer cancelled at the gateway, came back, and
    // paid — the order is theirs.
    expect(
      decideFact(
        input({
          snapshot: { status: 'cancelled', capturedTotalMinor: 0n, refundedTotalMinor: 0n },
        }),
      ).kind,
    ).toBe('apply')
  })
})

describe('monotonic money guard', () => {
  // Regression: the guard reads cumulativeCapturedMinor. Passing the fact's
  // own field name instead disabled it silently, and only the local delta
  // check caught regressions.
  it('rejects a capture regression through evaluateOrdering, not just the delta check', () => {
    const decision = decideFact(
      input({
        snapshot: {
          status: 'partially_captured',
          capturedTotalMinor: 9000n,
          refundedTotalMinor: 0n,
        },
        amountMinor: 10000n,
        cumulativeAmountMinor: 9500n,
      }),
    )
    // Forward: 9500 > 9000, so it applies with a 500 delta.
    expect(decision).toMatchObject({ kind: 'apply', newCaptureMinor: 500n })
  })

  it('rejects a lower cumulative amount as a regression', () => {
    expect(
      decideFact(
        input({
          snapshot: {
            status: 'partially_captured',
            capturedTotalMinor: 9000n,
            refundedTotalMinor: 0n,
          },
          amountMinor: 10000n,
          cumulativeAmountMinor: 100n,
        }),
      ),
    ).toEqual({ kind: 'ignore', reason: 'captured_regression' })
  })
})

describe('refunds', () => {
  const captured = (capturedMinor: bigint, refundedMinor = 0n) => ({
    snapshot: {
      status: 'captured' as const,
      capturedTotalMinor: capturedMinor,
      refundedTotalMinor: refundedMinor,
    },
    amountMinor: capturedMinor,
    factType: 'refund_succeeded' as const,
  })

  it('applies a full refund', () => {
    expect(
      decideFact({ ...captured(10000n), cumulativeAmountMinor: 10000n }),
    ).toMatchObject({
      kind: 'apply_refund',
      intentStatus: 'refunded',
      newRefundMinor: 10000n,
      refundedTotalMinor: 10000n,
    })
  })

  it('applies a partial refund', () => {
    expect(
      decideFact({ ...captured(10000n), cumulativeAmountMinor: 4000n }),
    ).toMatchObject({
      kind: 'apply_refund',
      intentStatus: 'partially_refunded',
      newRefundMinor: 4000n,
    })
  })

  it('treats the cumulative amount as a running total, not a delta', () => {
    expect(
      decideFact({ ...captured(10000n, 4000n), cumulativeAmountMinor: 10000n }),
    ).toMatchObject({ kind: 'apply_refund', newRefundMinor: 6000n })
  })

  it('reports a redelivered refund as already applied', () => {
    expect(
      decideFact({ ...captured(10000n, 4000n), cumulativeAmountMinor: 4000n }),
    ).toEqual({ kind: 'ignore', reason: 'already_applied' })
  })

  it('rejects a refund regression', () => {
    expect(
      decideFact({ ...captured(10000n, 8000n), cumulativeAmountMinor: 2000n }),
    ).toEqual({ kind: 'ignore', reason: 'refunded_regression' })
  })

  it('refuses to refund more than was captured', () => {
    // Posting this would drive the ledger negative and hand back money
    // the merchant never took.
    expect(
      decideFact({ ...captured(10000n), cumulativeAmountMinor: 15000n }),
    ).toEqual({ kind: 'ignore', reason: 'refund_exceeds_capture' })
  })

  it('refuses a refund with no amount rather than guessing', () => {
    expect(
      decideFact({ ...captured(10000n), cumulativeAmountMinor: undefined }),
    ).toEqual({ kind: 'ignore', reason: 'amount_missing' })
  })

  it('does not move state on a failed refund', () => {
    expect(
      decideFact({
        ...captured(10000n),
        factType: 'refund_failed',
        cumulativeAmountMinor: 4000n,
      }).kind,
    ).toBe('ignore')
  })
})

describe('currency verification — what the gateway settled vs what we priced', () => {
  const priced = (over: Partial<DecisionInput> = {}): DecisionInput =>
    input({ currency: 'SAR', ...over })

  it('applies a capture in the currency the order was priced in', () => {
    expect(priced({ factCurrency: 'SAR' }).currency).toBe('SAR')
    expect(decideFact(priced({ factCurrency: 'SAR' })).kind).toBe('apply')
  })

  it('refuses a capture the provider settled in another currency', () => {
    // 100 of something else is not 100 of what the customer agreed to
    // pay. The fact is still recorded by the applier; it just may not
    // move money or the order.
    expect(decideFact(priced({ factCurrency: 'USD' }))).toEqual({
      kind: 'ignore',
      reason: 'currency_mismatch',
    })
  })

  it('ignores case and padding rather than failing a real payment on them', () => {
    expect(decideFact(priced({ factCurrency: ' sar ' })).kind).toBe('apply')
  })

  it('refuses a refund, an authorization and a dispute in the wrong currency too', () => {
    for (const factType of ['refund_succeeded', 'attempt_authorized', 'dispute_opened'] as const) {
      expect(
        decideFact(priced({ factType, factCurrency: 'USD', cumulativeAmountMinor: 5000n })),
      ).toEqual({ kind: 'ignore', reason: 'currency_mismatch' })
    }
  })

  it('treats a currency the provider did not report as unreported, not as different', () => {
    // ObservedFact.currency is optional on the contract and several
    // adapters legitimately omit it. Refusing those would break every
    // payment they make.
    expect(decideFact(priced({ factCurrency: undefined })).kind).toBe('apply')
    expect(decideFact(input({ currency: undefined, factCurrency: 'USD' })).kind).toBe('apply')
  })
})

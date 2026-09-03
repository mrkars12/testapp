import {
  PAYMENT_ERROR_CODES,
  ProviderError,
  buildFactDedupeKey,
  callContextIdempotencyKey,
  capabilityContradictions,
  classifyPaymentError,
  isOfflineGateway,
  isPaymentErrorCode,
  normalizeProviderError,
  isCustomerActionable,
  isRetryable,
  nextActionKindName,
  nextActionPayload,
  pspIdempotencyKey,
  safeFailureMessage,
  shouldFailover,
  supportsCurrency,
  supportsMethod,
  type GatewayCapabilities,
  type NextAction,
} from './provider.types'

const caps = (over: Partial<GatewayCapabilities> = {}): GatewayCapabilities => ({
  gateway: 'spec',
  methods: ['card'],
  currencies: ['USD', 'EGP'],
  exponentOverrides: {},
  automaticCapture: true,
  manualCapture: false,
  partialCapture: false,
  multiCapture: false,
  refundSupported: false,
  partialRefund: false,
  voidSupported: false,
  authorizationExpiry: false,
  vaulting: false,
  merchantInitiated: false,
  threeDSecure: false,
  webhooks: false,
  statusPolling: false,
  settlementReports: false,
  webhookResolution: 'none',
  nextActionKinds: [],
  offlineCommitmentKind: null,
  ...over,
})

describe('safeFailureMessage', () => {
  it('maps every code in the closed taxonomy to a real sentence', () => {
    for (const code of PAYMENT_ERROR_CODES) {
      const message = safeFailureMessage(code)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('never returns the bare code name, even for unknown', () => {
    // This is the exact bug: a merchant TEST failure showing the literal
    // string "unknown" instead of a human sentence.
    for (const code of PAYMENT_ERROR_CODES) {
      expect(safeFailureMessage(code)).not.toBe(code)
    }
    expect(safeFailureMessage('unknown')).not.toBe('unknown')
  })
})

describe('error taxonomy', () => {
  it('retries transport failures only', () => {
    expect(isRetryable('provider_timeout')).toBe(true)
    expect(isRetryable('provider_unavailable')).toBe(true)
    expect(isRetryable('rate_limited')).toBe(true)
    expect(isRetryable('declined_insufficient_funds')).toBe(false)
    expect(isRetryable('authentication_required')).toBe(false)
  })

  it('fails over on provider and configuration problems', () => {
    expect(shouldFailover('provider_unavailable')).toBe(true)
    expect(shouldFailover('configuration_error')).toBe(true)
    expect(shouldFailover('declined_do_not_honor')).toBe(false)
  })

  it('flags what the customer can act on', () => {
    expect(isCustomerActionable('declined_insufficient_funds')).toBe(true)
    expect(isCustomerActionable('declined_card_invalid')).toBe(true)
    expect(isCustomerActionable('provider_timeout')).toBe(false)
    expect(isCustomerActionable('configuration_error')).toBe(false)
  })

  it('never both retries and asks the customer to act', () => {
    const codes = [
      'declined_insufficient_funds', 'declined_do_not_honor', 'declined_card_invalid',
      'declined_risk', 'authentication_required', 'authentication_failed',
      'amount_limit', 'currency_unsupported', 'method_unavailable',
      'duplicate_request', 'provider_unavailable', 'provider_timeout',
      'rate_limited', 'configuration_error', 'mode_mismatch', 'unknown',
    ] as const

    for (const code of codes) {
      expect(isRetryable(code) && isCustomerActionable(code)).toBe(false)
    }
  })

  it('carries the code on the error', () => {
    const error = new ProviderError('rate_limited', 'slow down', 'raw')
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.code).toBe('rate_limited')
    expect(error.raw).toBe('raw')
  })
})

describe('next action', () => {
  it('reports its kind', () => {
    expect(nextActionKindName({ kind: 'none' })).toBe('none')
    expect(nextActionKindName({ kind: 'poll', pollAfterSeconds: 5 })).toBe('poll')
  })

  it('stores nothing for none', () => {
    expect(nextActionPayload({ kind: 'none' })).toBeNull()
  })

  it('serialises every variant', () => {
    const cases: NextAction[] = [
      { kind: 'redirect', url: 'https://x', method: 'GET' },
      { kind: 'iframe', url: 'https://x' },
      { kind: 'client_sdk', clientSecret: 'cs_1' },
      { kind: 'reference_code', code: 'ABC', expiresAt: new Date('2026-01-01T00:00:00Z') },
      { kind: 'bank_instructions', fields: { iban: 'EG1' } },
      { kind: 'poll', pollAfterSeconds: 30 },
    ]
    for (const action of cases) {
      expect(nextActionPayload(action)).not.toBeNull()
    }
  })

  it('serialises a reference code with an ISO expiry', () => {
    const payload = nextActionPayload({
      kind: 'reference_code',
      code: 'ABC',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    })
    expect(payload).toMatchObject({ code: 'ABC', expires_at: '2026-01-01T00:00:00.000Z' })
  })

  it('flattens bank instruction fields', () => {
    expect(
      nextActionPayload({ kind: 'bank_instructions', fields: { iban: 'EG1', swift: null } }),
    ).toEqual({ iban: 'EG1', swift: null })
  })
})

describe('fact dedupe keys', () => {
  const base = {
    accountId: 7n,
    gatewayReference: 'ref_1',
    factType: 'attempt_captured' as const,
    cumulativeAmountMinor: 1000n,
    currency: 'USD',
  }

  it('is stable for the same fact', () => {
    expect(buildFactDedupeKey(base)).toBe(buildFactDedupeKey({ ...base }))
  })

  it('differs when the cumulative amount advances', () => {
    expect(buildFactDedupeKey(base)).not.toBe(
      buildFactDedupeKey({ ...base, cumulativeAmountMinor: 2000n }),
    )
  })

  it('differs across accounts, so two stores sharing a provider cannot collide', () => {
    expect(buildFactDedupeKey(base)).not.toBe(
      buildFactDedupeKey({ ...base, accountId: 8n }),
    )
  })

  it('differs across fact types', () => {
    expect(buildFactDedupeKey(base)).not.toBe(
      buildFactDedupeKey({ ...base, factType: 'refund_succeeded' }),
    )
  })

  it('handles a missing amount', () => {
    expect(
      buildFactDedupeKey({ accountId: 1n, gatewayReference: 'r', factType: 'attempt_failed' }),
    ).toContain(':-:-')
  })
})

describe('psp idempotency keys', () => {
  const base = { storeId: 1n, intentId: 2n, attemptSequence: 1, operation: 'initialize' }

  it('is deterministic, so a retry sends the same key', () => {
    expect(pspIdempotencyKey(base)).toBe(pspIdempotencyKey({ ...base }))
  })

  it('differs per attempt and per operation', () => {
    expect(pspIdempotencyKey(base)).not.toBe(
      pspIdempotencyKey({ ...base, attemptSequence: 2 }),
    )
    expect(pspIdempotencyKey(base)).not.toBe(
      pspIdempotencyKey({ ...base, operation: 'capture' }),
    )
  })

  it('differs per store', () => {
    expect(pspIdempotencyKey(base)).not.toBe(pspIdempotencyKey({ ...base, storeId: 9n }))
  })
})

describe('capability checks', () => {
  it('matches supported methods', () => {
    expect(supportsMethod(caps(), 'card')).toBe(true)
    expect(supportsMethod(caps(), 'knet')).toBe(false)
  })

  it('matches currencies case-insensitively', () => {
    expect(supportsCurrency(caps(), 'usd')).toBe(true)
    expect(supportsCurrency(caps(), ' EGP ')).toBe(true)
    expect(supportsCurrency(caps(), 'KWD')).toBe(false)
  })

  it('accepts anything when currencies is "all"', () => {
    expect(supportsCurrency(caps({ currencies: 'all' }), 'KWD')).toBe(true)
  })
})

describe('error classification', () => {
  it('is the whole of what core is told about a failure', () => {
    expect(classifyPaymentError('provider_timeout')).toEqual({
      code: 'provider_timeout',
      retryable: true,
      customerActionable: false,
      failover: true,
    })

    expect(classifyPaymentError('declined_card_invalid')).toEqual({
      code: 'declined_card_invalid',
      retryable: false,
      customerActionable: true,
      failover: false,
    })
  })

  it('classifies every code in the taxonomy', () => {
    for (const code of PAYMENT_ERROR_CODES) {
      const classification = classifyPaymentError(code)
      expect(classification.code).toBe(code)
      expect(typeof classification.retryable).toBe('boolean')
      expect(typeof classification.customerActionable).toBe('boolean')
      expect(typeof classification.failover).toBe('boolean')
    }
  })

  it('recognises its own codes and nothing else', () => {
    expect(isPaymentErrorCode('rate_limited')).toBe(true)
    // A provider's own taxonomy must never be mistaken for ours.
    expect(isPaymentErrorCode('card_declined')).toBe(false)
    expect(isPaymentErrorCode(undefined)).toBe(false)
  })
})

describe('normalizeProviderError', () => {
  it('passes a ProviderError through untouched', () => {
    const original = new ProviderError('rate_limited', 'slow down')
    expect(normalizeProviderError(original)).toBe(original)
  })

  it('classifies a bare exception rather than letting it escape unclassified', () => {
    // A driver-level failure reaching orchestration with no code is
    // retried, or not, by accident.
    const normalized = normalizeProviderError(
      new Error('socket hang up'),
      'provider_unavailable',
    )

    expect(normalized).toBeInstanceOf(ProviderError)
    expect(normalized.code).toBe('provider_unavailable')
    expect(normalized.message).toBe('socket hang up')
  })

  it('defaults to unknown, never to something actionable', () => {
    // Guessing "insufficient funds" from an unreadable throw would tell
    // the customer to try another card for a fault that is ours.
    expect(normalizeProviderError({ weird: true }).code).toBe('unknown')
  })
})

describe('capability coherence', () => {
  it('accepts a descriptor that contradicts nothing', () => {
    expect(capabilityContradictions(caps())).toEqual([])
  })

  it('rejects a narrowing capability without its base', () => {
    expect(caps({ partialCapture: true })).toBeDefined()
    expect(capabilityContradictions(caps({ partialCapture: true }))).toEqual([
      'declares partialCapture without manualCapture',
    ])
    expect(capabilityContradictions(caps({ multiCapture: true }))).toEqual([
      'declares multiCapture without manualCapture',
    ])
    expect(capabilityContradictions(caps({ partialRefund: true }))).toEqual([
      'declares partialRefund without refundSupported',
    ])
  })

  it('rejects a webhook declaration that cannot be routed', () => {
    expect(capabilityContradictions(caps({ webhooks: true }))).toEqual([
      'declares webhooks but no resolution strategy',
    ])
    expect(
      capabilityContradictions(caps({ webhookResolution: 'payload_scoped' })),
    ).toEqual(['declares webhookResolution "payload_scoped" without webhooks'])
  })

  it('rejects an online adapter that can take money no way at all', () => {
    expect(
      capabilityContradictions(caps({ automaticCapture: false })),
    ).toEqual(['declares neither automaticCapture nor manualCapture'])
  })

  it('rejects an offline adapter claiming anything a provider would do', () => {
    const problems = capabilityContradictions(
      caps({
        automaticCapture: false,
        offlineCommitmentKind: 'promise_accepted',
        statusPolling: true,
        webhooks: true,
        webhookResolution: 'endpoint_scoped',
      }),
    )

    expect(problems).toContain('settles offline but declares webhooks')
    expect(problems).toContain('settles offline but declares statusPolling')
  })

  it('names the offline adapters as offline', () => {
    expect(isOfflineGateway(caps())).toBe(false)
    expect(
      isOfflineGateway(
        caps({ automaticCapture: false, offlineCommitmentKind: 'promise_accepted' }),
      ),
    ).toBe(true)
  })
})

describe('outbound idempotency keys', () => {
  const context = {
    storeId: 3n,
    mode: 'live' as const,
    accountId: 9n,
    offeringId: 2n,
    method: 'card' as const,
    gatewayMethodConfig: '',
    intentId: 88n,
    attemptId: null,
    attemptSequence: 2,
    amountMinor: 100n,
    currency: 'USD',
    credentials: {},
  }

  it('derives the same key core recorded, given no explicit one', () => {
    expect(callContextIdempotencyKey(context, 'initialize')).toBe(
      pspIdempotencyKey({
        storeId: 3n,
        intentId: 88n,
        attemptSequence: 2,
        operation: 'initialize',
      }),
    )
  })

  it('prefers the key core supplied over deriving a second one', () => {
    // Two derivations of one rule agree until one of them changes, and
    // the symptom of them disagreeing is a double charge.
    expect(
      callContextIdempotencyKey(
        { ...context, idempotencyKey: 'psp:supplied' },
        'initialize',
      ),
    ).toBe('psp:supplied')
  })

  it('is stable across calls and distinct per operation', () => {
    expect(callContextIdempotencyKey(context, 'capture')).toBe(
      callContextIdempotencyKey(context, 'capture'),
    )
    expect(callContextIdempotencyKey(context, 'capture')).not.toBe(
      callContextIdempotencyKey(context, 'refund'),
    )
  })
})

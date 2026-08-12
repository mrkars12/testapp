import {
  ProviderError,
  buildFactDedupeKey,
  isCustomerActionable,
  isRetryable,
  nextActionKindName,
  nextActionPayload,
  pspIdempotencyKey,
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
  manualCapture: false,
  partialCapture: false,
  multiCapture: false,
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
  offlineCommitmentKind: null,
  ...over,
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
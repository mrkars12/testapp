import {
  EMPTY_POLICY,
  OfferingPolicyError,
  checkPolicy,
  computeFeeMinor,
  describePolicy,
  feeLabel,
  parseOfferingPolicy,
} from './offering-policy'

const ctx = (overrides: Partial<Parameters<typeof checkPolicy>[1]> = {}) => ({
  subtotalMinor: 10000n,
  currency: 'USD',
  city: 'Cairo',
  ...overrides,
})

describe('parseOfferingPolicy', () => {
  it('treats null and undefined as no policy', () => {
    expect(parseOfferingPolicy(null)).toEqual(EMPTY_POLICY)
    expect(parseOfferingPolicy(undefined)).toEqual(EMPTY_POLICY)
    expect(parseOfferingPolicy({})).toEqual(EMPTY_POLICY)
  })

  it('parses amounts from strings, numbers and bigints', () => {
    expect(parseOfferingPolicy({ min_amount_minor: '1000' }).minAmountMinor).toBe(1000n)
    expect(parseOfferingPolicy({ min_amount_minor: 1000 }).minAmountMinor).toBe(1000n)
    expect(parseOfferingPolicy({ min_amount_minor: 1000n }).minAmountMinor).toBe(1000n)
  })

  it('rejects malformed amounts rather than ignoring them', () => {
    expect(() => parseOfferingPolicy({ min_amount_minor: '10.50' })).toThrow(OfferingPolicyError)
    expect(() => parseOfferingPolicy({ min_amount_minor: 'abc' })).toThrow(OfferingPolicyError)
    expect(() => parseOfferingPolicy({ min_amount_minor: 1.5 })).toThrow(OfferingPolicyError)
    expect(() => parseOfferingPolicy({ min_amount_minor: -5 })).toThrow(OfferingPolicyError)
    expect(() => parseOfferingPolicy({ min_amount_minor: true })).toThrow(OfferingPolicyError)
  })

  it('rejects a non-object policy', () => {
    expect(() => parseOfferingPolicy('nope')).toThrow(OfferingPolicyError)
    expect(() => parseOfferingPolicy([1, 2])).toThrow(OfferingPolicyError)
  })

  it('rejects an inverted range', () => {
    expect(() =>
      parseOfferingPolicy({ min_amount_minor: '900', max_amount_minor: '100' }),
    ).toThrow(OfferingPolicyError)
  })

  it('normalises currency and city lists', () => {
    const policy = parseOfferingPolicy({
      allowed_currencies: [' usd ', 'egp'],
      allowed_cities: ['  Cairo ', 'GIZA'],
    })
    expect(policy.allowedCurrencies).toEqual(['USD', 'EGP'])
    expect(policy.allowedCities).toEqual(['cairo', 'giza'])
  })

  it('treats an empty list as no restriction', () => {
    expect(parseOfferingPolicy({ allowed_cities: [] }).allowedCities).toBeNull()
    expect(parseOfferingPolicy({ allowed_cities: ['  '] }).allowedCities).toBeNull()
  })

  it('rejects a non-array or non-string list', () => {
    expect(() => parseOfferingPolicy({ allowed_cities: 'Cairo' })).toThrow(OfferingPolicyError)
    expect(() => parseOfferingPolicy({ allowed_cities: [1] })).toThrow(OfferingPolicyError)
  })

  describe('fee', () => {
    it('parses a fixed fee', () => {
      const fee = parseOfferingPolicy({
        fee: { kind: 'fixed', amount_minor: '2000', label_en: 'COD fee' },
      }).fee
      expect(fee).toMatchObject({ kind: 'fixed', amountMinor: 2000n, labelEn: 'COD fee' })
    })

    it('parses a percent fee', () => {
      const fee = parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 250 } }).fee
      expect(fee).toMatchObject({ kind: 'percent', basisPoints: 250 })
    })

    it('rejects an unknown kind', () => {
      expect(() => parseOfferingPolicy({ fee: { kind: 'weird' } })).toThrow(OfferingPolicyError)
    })

    it('rejects a fixed fee with no amount', () => {
      expect(() => parseOfferingPolicy({ fee: { kind: 'fixed' } })).toThrow(OfferingPolicyError)
      expect(() => parseOfferingPolicy({ fee: { kind: 'fixed', amount_minor: '0' } })).toThrow(
        OfferingPolicyError,
      )
    })

    it('rejects a bad percent fee', () => {
      expect(() => parseOfferingPolicy({ fee: { kind: 'percent' } })).toThrow(OfferingPolicyError)
      expect(() => parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 0 } })).toThrow(
        OfferingPolicyError,
      )
      expect(() => parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 2.5 } })).toThrow(
        OfferingPolicyError,
      )
    })

    it('rejects an absurd percent as a likely typo', () => {
      expect(() =>
        parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 9000 } }),
      ).toThrow(OfferingPolicyError)
    })

    it('rejects a non-object fee', () => {
      expect(() => parseOfferingPolicy({ fee: 'free' })).toThrow(OfferingPolicyError)
    })
  })
})

describe('checkPolicy', () => {
  it('allows anything with an empty policy', () => {
    expect(checkPolicy(EMPTY_POLICY, ctx())).toBeNull()
  })

  it('enforces the minimum', () => {
    const policy = parseOfferingPolicy({ min_amount_minor: '20000' })
    expect(checkPolicy(policy, ctx())?.code).toBe('below_min')
    expect(checkPolicy(policy, ctx({ subtotalMinor: 20000n }))).toBeNull()
  })

  it('enforces the maximum', () => {
    const policy = parseOfferingPolicy({ max_amount_minor: '5000' })
    expect(checkPolicy(policy, ctx())?.code).toBe('above_max')
    expect(checkPolicy(policy, ctx({ subtotalMinor: 5000n }))).toBeNull()
  })

  it('enforces allowed currencies, case-insensitively', () => {
    const policy = parseOfferingPolicy({ allowed_currencies: ['EGP'] })
    expect(checkPolicy(policy, ctx())?.code).toBe('currency_not_allowed')
    expect(checkPolicy(policy, ctx({ currency: 'egp' }))).toBeNull()
  })

  it('enforces allowed cities, case-insensitively', () => {
    const policy = parseOfferingPolicy({ allowed_cities: ['Cairo'] })
    expect(checkPolicy(policy, ctx({ city: '  cairo ' }))).toBeNull()
    expect(checkPolicy(policy, ctx({ city: 'Alexandria' }))?.code).toBe('city_not_allowed')
  })

  it('reports the first violation only', () => {
    const policy = parseOfferingPolicy({
      min_amount_minor: '99999',
      allowed_cities: ['Giza'],
    })
    expect(checkPolicy(policy, ctx())?.code).toBe('below_min')
  })
})

describe('computeFeeMinor', () => {
  it('is zero with no fee', () => {
    expect(computeFeeMinor(EMPTY_POLICY, 10000n)).toBe(0n)
  })

  it('returns a fixed fee regardless of subtotal', () => {
    const policy = parseOfferingPolicy({ fee: { kind: 'fixed', amount_minor: '2000' } })
    expect(computeFeeMinor(policy, 10000n)).toBe(2000n)
    expect(computeFeeMinor(policy, 999999n)).toBe(2000n)
  })

  it('computes a percent fee', () => {
    const policy = parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 250 } })
    // 2.5% of 100.00
    expect(computeFeeMinor(policy, 10000n)).toBe(250n)
  })

  it('rounds a percent fee half up', () => {
    const policy = parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 1 } })
    // 0.01% of 4999 = 0.4999 -> 0
    expect(computeFeeMinor(policy, 4999n)).toBe(0n)
    // 0.01% of 5000 = 0.5 -> 1
    expect(computeFeeMinor(policy, 5000n)).toBe(1n)
  })

  it('is zero for a non-positive subtotal', () => {
    const policy = parseOfferingPolicy({ fee: { kind: 'fixed', amount_minor: '2000' } })
    expect(computeFeeMinor(policy, 0n)).toBe(0n)
  })

  it('handles very large subtotals without precision loss', () => {
    const policy = parseOfferingPolicy({ fee: { kind: 'percent', basis_points: 250 } })
    expect(computeFeeMinor(policy, 10n ** 15n)).toBe(25n * 10n ** 12n)
  })
})

describe('presentation helpers', () => {
  it('falls back to a neutral fee label', () => {
    expect(feeLabel(EMPTY_POLICY)).toBe('Payment fee')
    expect(
      feeLabel(parseOfferingPolicy({ fee: { kind: 'fixed', amount_minor: '1', label_ar: 'رسوم' } })),
    ).toBe('رسوم')
  })

  it('serialises a policy for the storefront', () => {
    const described = describePolicy(
      parseOfferingPolicy({
        max_amount_minor: '5000',
        fee: { kind: 'percent', basis_points: 250, label_en: 'COD fee' },
      }),
    )
    expect(described.max_amount_minor).toBe('5000')
    expect(described.min_amount_minor).toBeNull()
    expect(described.fee).toMatchObject({ kind: 'percent', basis_points: 250 })
  })
})

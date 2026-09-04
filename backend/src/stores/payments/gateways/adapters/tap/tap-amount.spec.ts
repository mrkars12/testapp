import {
  formatTapAmount,
  fromTapAmount,
  hashAmount,
  tapDecimals,
  toTapAmount,
} from './tap-amount'
import { ProviderError } from '../../provider.types'

/**
 * Amount conversion, against the decimal rules Tap publishes.
 *
 * The worked values come from Tap's own documentation: the webhook
 * page's decimal table (AED 2.00, KWD 3.000, …) and the refund
 * endpoint's "For currencies BHD, KWD, and OMR, amount should be
 * specified with up to 3 decimal places. For others … up to 2".
 */

describe('tapDecimals', () => {
  it('uses the ISO exponent Tap documents per currency', () => {
    // The three-decimal set Tap names explicitly.
    expect(tapDecimals('KWD')).toBe(3)
    expect(tapDecimals('BHD')).toBe(3)
    expect(tapDecimals('OMR')).toBe(3)
    // And the two-decimal default.
    expect(tapDecimals('SAR')).toBe(2)
    expect(tapDecimals('AED')).toBe(2)
    expect(tapDecimals('usd')).toBe(2)
  })

  it('refuses a currency whose exponent is unknown', () => {
    // Guessing is how a three-decimal dinar becomes a hundredfold
    // overcharge.
    expect(() => tapDecimals('ZZZ')).toThrow(ProviderError)
  })
})

describe('toTapAmount', () => {
  it('sends the major unit, not our minor units', () => {
    // 100.00 SAR, held as 10000 minor units.
    expect(toTapAmount(10_000n, 'SAR')).toBe(100)
    // 1.000 KWD, held as 1000 minor units — not 1000 on the wire.
    expect(toTapAmount(1_000n, 'KWD')).toBe(1)
    // A zero-decimal currency passes through unchanged.
    expect(toTapAmount(500n, 'JPY')).toBe(500)
  })

  it('keeps the fraction Tap allows', () => {
    expect(toTapAmount(1_234n, 'KWD')).toBe(1.234)
    expect(toTapAmount(1_050n, 'SAR')).toBe(10.5)
  })

  it('refuses a negative amount', () => {
    expect(() => toTapAmount(-1n, 'SAR')).toThrow(ProviderError)
  })

  it('refuses an amount beyond the safe integer range', () => {
    expect(() =>
      toTapAmount(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'SAR'),
    ).toThrow(ProviderError)
  })
})

describe('formatTapAmount', () => {
  it('renders the standard decimal places for the currency', () => {
    // Exactly the table on Tap's webhook page.
    expect(formatTapAmount(100n, 'SAR')).toBe('1.00')
    expect(formatTapAmount(1_000n, 'KWD')).toBe('1.000')
    expect(formatTapAmount(1_000n, 'BHD')).toBe('1.000')
    expect(formatTapAmount(1_000n, 'OMR')).toBe('1.000')
    expect(formatTapAmount(200n, 'AED')).toBe('2.00')
    expect(formatTapAmount(3_000n, 'JOD')).toBe('3.000')
  })

  it('pads an amount smaller than one major unit', () => {
    expect(formatTapAmount(5n, 'SAR')).toBe('0.05')
    expect(formatTapAmount(5n, 'KWD')).toBe('0.005')
  })

  it('omits the point entirely for a zero-decimal currency', () => {
    expect(formatTapAmount(500n, 'JPY')).toBe('500')
  })
})

describe('fromTapAmount', () => {
  it('reads back what Tap sent, whatever its JSON rendering', () => {
    // JSON gives 1.0 for an amount Tap hashed as "1.00".
    expect(fromTapAmount(1.0, 'SAR')).toBe(100n)
    expect(fromTapAmount(1, 'KWD')).toBe(1_000n)
    expect(fromTapAmount('1.000', 'KWD')).toBe(1_000n)
    expect(fromTapAmount(10.5, 'SAR')).toBe(1_050n)
    expect(fromTapAmount(3, 'AED')).toBe(300n)
  })

  it('returns null rather than throwing on an unreadable amount', () => {
    // This runs over unverified callback bodies: a throw here is a 500
    // an attacker can trigger at will.
    expect(fromTapAmount(undefined, 'SAR')).toBeNull()
    expect(fromTapAmount(null, 'SAR')).toBeNull()
    expect(fromTapAmount('not a number', 'SAR')).toBeNull()
    expect(fromTapAmount({}, 'SAR')).toBeNull()
    expect(fromTapAmount(Number.NaN, 'SAR')).toBeNull()
    expect(fromTapAmount(1, 'ZZZ')).toBeNull()
  })
})

describe('hashAmount', () => {
  it('re-renders the callback amount to the documented decimals', () => {
    // "Amount should be rounded with standard decimal value. This needs
    // to be an additional step after receiving the webhook response."
    expect(hashAmount(1.0, 'SAR')).toBe('1.00')
    expect(hashAmount(100.0, 'SAR')).toBe('100.00')
    expect(hashAmount(1, 'KWD')).toBe('1.000')
    expect(hashAmount(3, 'AED')).toBe('3.00')
  })

  it('is empty when there is nothing to hash', () => {
    // The adapter turns this into a rejected callback rather than a
    // signature computed over a guess.
    expect(hashAmount(undefined, 'SAR')).toBe('')
    expect(hashAmount(1, 'ZZZ')).toBe('')
  })
})

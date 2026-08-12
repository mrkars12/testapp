import { ProviderError } from '../../provider.types'

/**
 * ==================================================================
 * Stripe amount conversion
 * ==================================================================
 *
 * Our internal amounts are ISO minor units. Stripe mostly agrees, but
 * has two documented exceptions that quietly corrupt totals if ignored.
 *
 *   Zero-decimal currencies (JPY, KRW, VND, ...): Stripe expects the
 *   whole unit. ISO says exponent 0, so our minor unit already IS the
 *   whole unit. No conversion, but a ×100 "just to be safe" would
 *   charge a customer a hundred times too much.
 *
 *   Three-decimal currencies (KWD, BHD, OMR, JOD, TND): Stripe accepts
 *   the amount in thousandths but requires the last digit to be zero,
 *   because it settles in hundredths. 1.234 KWD must be sent as 1230,
 *   not 1234.
 */

/** Stripe treats these as having no minor unit. */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])

/** Stripe requires the last digit of these to be zero. */
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has(normalize(currency))
}

export function isThreeDecimal(currency: string): boolean {
  return THREE_DECIMAL.has(normalize(currency))
}

/**
 * Converts an internal minor-unit amount into what Stripe expects.
 *
 * Throws rather than silently rounding a three-decimal amount: losing a
 * fraction of a dinar without telling anyone is how ledgers drift.
 */
export function toStripeAmount(amountMinor: bigint, currency: string): number {
  if (amountMinor < 0n) {
    throw new ProviderError(
      'unknown',
      `Cannot send a negative amount to Stripe (${amountMinor}).`,
    )
  }

  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderError(
      'amount_limit',
      `Amount ${amountMinor} exceeds the safe integer range.`,
    )
  }

  if (isThreeDecimal(currency) && amountMinor % 10n !== 0n) {
    throw new ProviderError(
      'amount_limit',
      `${normalize(currency)} amounts must end in 0 for Stripe; received ${amountMinor}.`,
    )
  }

  // Zero-decimal and two-decimal currencies both pass through unchanged:
  // our minor unit is already Stripe's unit in each case.
  return Number(amountMinor)
}

/** Converts a Stripe amount back into internal minor units. */
export function fromStripeAmount(amount: number, currency: string): bigint {
  if (!Number.isInteger(amount)) {
    throw new ProviderError(
      'unknown',
      `Stripe returned a non-integer amount (${amount}) for ${normalize(currency)}.`,
    )
  }

  return BigInt(amount)
}

function normalize(currency: string): string {
  return currency.trim().toUpperCase()
}

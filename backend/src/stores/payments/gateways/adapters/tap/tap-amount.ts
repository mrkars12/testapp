import { getExponent, isSupportedCurrency } from '../../../../../common/money/currency.registry'
import { ProviderError } from '../../provider.types'

/**
 * ==================================================================
 * Tap amount conversion
 * ==================================================================
 *
 * The one place this adapter crosses between our representation and
 * Tap's, and the only place a rounding decision is allowed to live.
 *
 * We hold money as **ISO minor units in a bigint**. Tap holds it as a
 * **decimal in the major unit**:
 *
 *   "The amount to be collected by this payment, in ISO standard decimal
 *    places. A positive decimal representing how much to charge in the
 *    currency unit (e.g: 100 to charge $100 and 100.5 to charge
 *    $100.50)"
 *
 * and, on the refund endpoint, states the decimal places explicitly:
 *
 *   "For currencies BHD, KWD, and OMR, amount should be specified with
 *    up to 3 decimal places. For others, amount should be specified with
 *    up to 2 decimal places."
 *
 * Both agree with ISO-4217, so the exponent comes from the currency
 * registry rather than a second table maintained here — one table is
 * already the reason three-decimal currencies work everywhere else in
 * this codebase.
 *
 * The webhook hash needs the *string* form and is fussy about it:
 *
 *   "Amount should be rounded with standard decimal value. …
 *    (Ex: AED - 2.00, BHD - 3.000, KWD - 3.000, OMR - 3.000, QAR - 2.00,
 *    SAR - 2.00, USD - 2.00, EUR - 2.00, GBP - 2.00, EGP - 2.00,
 *    JOD - 3.000)"
 *
 * so `formatTapAmount` exists separately from `toTapAmount`: JSON gives
 * back `1.0` for an amount Tap hashed as `1.00`, and hashing the
 * JavaScript rendering instead of the documented one is how a correct
 * signature is rejected.
 *
 * Sources, accessed 2026-08-19:
 *   https://developers.tap.company/reference/create-a-charge
 *   https://developers.tap.company/reference/create-a-refund
 *   https://developers.tap.company/docs/webhook
 */

/** Decimal places Tap expects for a currency, from ISO-4217. */
export function tapDecimals(currency: string): number {
  const code = normalise(currency)

  if (!isSupportedCurrency(code)) {
    // Guessing an exponent is how a three-decimal dinar becomes a
    // hundredfold overcharge. Refusing is the cheaper failure.
    throw new ProviderError(
      'currency_unsupported',
      `No ISO decimal exponent is known for "${code}", so a Tap amount cannot be built.`,
    )
  }

  return getExponent(code)
}

/**
 * Minor units → the decimal string Tap documents.
 *
 * Built by string arithmetic on the bigint rather than by dividing,
 * because a float division loses the exact value the ledger holds and
 * the loss is invisible until a total is short by a fils.
 */
export function formatTapAmount(amountMinor: bigint, currency: string): string {
  if (amountMinor < 0n) {
    throw new ProviderError(
      'unknown',
      `Cannot send a negative amount to Tap (${amountMinor}).`,
    )
  }

  const decimals = tapDecimals(currency)

  if (decimals === 0) return amountMinor.toString()

  const digits = amountMinor.toString().padStart(decimals + 1, '0')
  const major = digits.slice(0, digits.length - decimals)
  const minor = digits.slice(digits.length - decimals)

  return `${major}.${minor}`
}

/**
 * Minor units → the JSON number Tap's request bodies carry.
 *
 * `amount` is typed `number` in Tap's schema, so a string would be a
 * different wire type. The decimal string is produced first and parsed
 * once, which keeps the rounding decision in a single function.
 */
export function toTapAmount(amountMinor: bigint, currency: string): number {
  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderError(
      'amount_limit',
      `Amount ${amountMinor} exceeds the safe integer range.`,
    )
  }

  return Number(formatTapAmount(amountMinor, currency))
}

/**
 * A Tap amount → minor units, or null when it is not a number at all.
 *
 * Returns null rather than throwing: this runs over provider payloads,
 * including webhook bodies, where an unreadable field must produce "no
 * fact" and never a 500.
 */
export function fromTapAmount(value: unknown, currency: string): bigint | null {
  const text = decimalText(value)
  if (text === null) return null

  let decimals: number

  try {
    decimals = tapDecimals(currency)
  } catch {
    return null
  }

  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text

  const [whole, fraction = ''] = unsigned.split('.')

  // Half-up on the digit after the last one Tap should have sent. Tap
  // documents its amounts as already carrying the standard number of
  // places, so this only ever fires on a payload that broke that rule.
  const kept = fraction.slice(0, decimals).padEnd(decimals, '0')
  const next = fraction.charAt(decimals)

  let minor = BigInt(`${whole}${kept}` || '0')

  if (next !== '' && Number(next) >= 5) minor += 1n

  return negative ? -minor : minor
}

/**
 * The amount as the webhook hash must spell it.
 *
 * Takes what Tap sent — `1.0`, `"1.000"`, `1` — and re-renders it to the
 * currency's standard decimals, which is the documented "additional step
 * after receiving the webhook response".
 */
export function hashAmount(value: unknown, currency: string): string {
  const minor = fromTapAmount(value, currency)

  if (minor === null) {
    // Nothing to hash. The caller turns this into a rejected callback
    // rather than a signature computed over a guess.
    return ''
  }

  return formatTapAmount(minor < 0n ? -minor : minor, currency)
}

/** Only finite numbers and plain decimal strings are amounts. */
function decimalText(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // `toFixed` rather than `String`, so 1e-7 does not arrive as
    // exponent notation the parser below cannot read.
    return value.toFixed(10)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null
  }

  return null
}

function normalise(currency: string): string {
  return currency.trim().toUpperCase()
}

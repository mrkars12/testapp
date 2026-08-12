/**
 * ==================================================================
 * Payment method policy
 * ==================================================================
 *
 * PaymentMethodOffering.constraints is a free-form JSON column that the
 * merchant fills in and that nothing read until now. A merchant could
 * set "cash on delivery only under 5000" or "COD costs 20 extra" and
 * checkout would silently ignore both.
 *
 * This module gives that column a schema, validates it, and derives the
 * fee. Pure functions, no Nest, no Prisma: unit-testable without a
 * database.
 *
 * Expected shape (every field optional):
 *
 *   {
 *     "min_amount_minor": "1000",
 *     "max_amount_minor": "500000",
 *     "allowed_currencies": ["EGP", "USD"],
 *     "allowed_cities": ["Cairo", "Giza"],
 *     "fee": {
 *       "kind": "fixed",          // or "percent"
 *       "amount_minor": "2000",   // for "fixed"
 *       "basis_points": 250,      // for "percent" (2.5%)
 *       "label_ar": "رسوم الدفع عند الاستلام",
 *       "label_en": "Cash on delivery fee"
 *     }
 *   }
 *
 * Amounts are strings on purpose: JSON numbers are IEEE doubles and
 * cannot carry large minor-unit values exactly.
 */

export type FeeKind = 'fixed' | 'percent'

export interface OfferingFee {
  readonly kind: FeeKind
  /** Used when kind is 'fixed'. */
  readonly amountMinor: bigint
  /** Used when kind is 'percent'. 250 = 2.5%. */
  readonly basisPoints: number
  readonly labelAr: string | null
  readonly labelEn: string | null
}

export interface OfferingPolicy {
  readonly minAmountMinor: bigint | null
  readonly maxAmountMinor: bigint | null
  /** Uppercase ISO codes. null means no restriction. */
  readonly allowedCurrencies: readonly string[] | null
  /** Lowercased, trimmed. null means no restriction. */
  readonly allowedCities: readonly string[] | null
  readonly fee: OfferingFee | null
}

export const EMPTY_POLICY: OfferingPolicy = {
  minAmountMinor: null,
  maxAmountMinor: null,
  allowedCurrencies: null,
  allowedCities: null,
  fee: null,
}

export type PolicyViolationCode =
  | 'below_min'
  | 'above_max'
  | 'currency_not_allowed'
  | 'city_not_allowed'

export interface PolicyViolation {
  readonly code: PolicyViolationCode
  readonly message: string
}

export class OfferingPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfferingPolicyError'
    Object.setPrototypeOf(this, OfferingPolicyError.prototype)
  }
}

/** Maximum percent fee accepted, as a guard against a mistyped value. */
const MAX_BASIS_POINTS = 5000 // 50%

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAmount(raw: unknown, field: string): bigint | null {
  if (raw === undefined || raw === null || raw === '') return null

  if (typeof raw === 'bigint') return assertNonNegative(raw, field)

  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      throw new OfferingPolicyError(
        `${field} must be an integer number of minor units.`,
      )
    }
    return assertNonNegative(BigInt(raw), field)
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) {
      throw new OfferingPolicyError(
        `${field} must be a whole number of minor units, received "${raw}".`,
      )
    }
    return assertNonNegative(BigInt(trimmed), field)
  }

  throw new OfferingPolicyError(`${field} has an unsupported type.`)
}

function assertNonNegative(value: bigint, field: string): bigint {
  if (value < 0n) {
    throw new OfferingPolicyError(`${field} cannot be negative.`)
  }
  return value
}

function readStringList(
  raw: unknown,
  field: string,
  normalize: (value: string) => string,
): readonly string[] | null {
  if (raw === undefined || raw === null) return null

  if (!Array.isArray(raw)) {
    throw new OfferingPolicyError(`${field} must be an array of strings.`)
  }

  const values = raw
    .map((entry) => {
      if (typeof entry !== 'string') {
        throw new OfferingPolicyError(`${field} must contain strings only.`)
      }
      return normalize(entry)
    })
    .filter((entry) => entry.length > 0)

  // An empty array would block everything, which is never what a merchant
  // means; treat it as "no restriction".
  return values.length > 0 ? values : null
}

function readFee(raw: unknown): OfferingFee | null {
  if (raw === undefined || raw === null) return null

  if (!isRecord(raw)) {
    throw new OfferingPolicyError('fee must be an object.')
  }

  const kind = raw.kind

  if (kind !== 'fixed' && kind !== 'percent') {
    throw new OfferingPolicyError(`fee.kind must be "fixed" or "percent".`)
  }

  const labelAr = typeof raw.label_ar === 'string' ? raw.label_ar : null
  const labelEn = typeof raw.label_en === 'string' ? raw.label_en : null

  if (kind === 'fixed') {
    const amountMinor = readAmount(raw.amount_minor, 'fee.amount_minor')

    if (amountMinor === null || amountMinor === 0n) {
      throw new OfferingPolicyError(
        'fee.amount_minor is required and must be greater than zero for a fixed fee.',
      )
    }

    return { kind, amountMinor, basisPoints: 0, labelAr, labelEn }
  }

  const basisPoints = raw.basis_points

  if (
    typeof basisPoints !== 'number' ||
    !Number.isInteger(basisPoints) ||
    basisPoints <= 0
  ) {
    throw new OfferingPolicyError(
      'fee.basis_points must be a positive integer for a percent fee.',
    )
  }

  if (basisPoints > MAX_BASIS_POINTS) {
    throw new OfferingPolicyError(
      `fee.basis_points is above the ${MAX_BASIS_POINTS} limit (${
        MAX_BASIS_POINTS / 100
      }%).`,
    )
  }

  return { kind, amountMinor: 0n, basisPoints, labelAr, labelEn }
}

/**
 * Parses the constraints column.
 *
 * Throws on a malformed policy rather than ignoring it: silently
 * dropping a merchant's "max 5000" rule is worse than refusing the
 * checkout and surfacing the misconfiguration.
 */
export function parseOfferingPolicy(raw: unknown): OfferingPolicy {
  if (raw === undefined || raw === null) return EMPTY_POLICY

  if (!isRecord(raw)) {
    throw new OfferingPolicyError('Payment method constraints must be an object.')
  }

  const minAmountMinor = readAmount(raw.min_amount_minor, 'min_amount_minor')
  const maxAmountMinor = readAmount(raw.max_amount_minor, 'max_amount_minor')

  if (
    minAmountMinor !== null &&
    maxAmountMinor !== null &&
    minAmountMinor > maxAmountMinor
  ) {
    throw new OfferingPolicyError(
      'min_amount_minor cannot be greater than max_amount_minor.',
    )
  }

  return {
    minAmountMinor,
    maxAmountMinor,
    allowedCurrencies: readStringList(
      raw.allowed_currencies,
      'allowed_currencies',
      (value) => value.trim().toUpperCase(),
    ),
    allowedCities: readStringList(raw.allowed_cities, 'allowed_cities', (value) =>
      value.trim().toLowerCase(),
    ),
    fee: readFee(raw.fee),
  }
}

export interface PolicyContext {
  /** Cart subtotal, before any payment fee. */
  readonly subtotalMinor: bigint
  readonly currency: string
  readonly city: string
}

/**
 * Checks the cart against the policy.
 *
 * The amount tested is the subtotal, not the total: a merchant setting
 * "max 5000" means the goods, not the goods plus the fee they added.
 */
export function checkPolicy(
  policy: OfferingPolicy,
  context: PolicyContext,
): PolicyViolation | null {
  if (
    policy.minAmountMinor !== null &&
    context.subtotalMinor < policy.minAmountMinor
  ) {
    return {
      code: 'below_min',
      message: 'Order total is below the minimum for this payment method.',
    }
  }

  if (
    policy.maxAmountMinor !== null &&
    context.subtotalMinor > policy.maxAmountMinor
  ) {
    return {
      code: 'above_max',
      message: 'Order total is above the maximum for this payment method.',
    }
  }

  if (
    policy.allowedCurrencies !== null &&
    !policy.allowedCurrencies.includes(context.currency.trim().toUpperCase())
  ) {
    return {
      code: 'currency_not_allowed',
      message: 'This payment method is not available for this currency.',
    }
  }

  if (
    policy.allowedCities !== null &&
    !policy.allowedCities.includes(context.city.trim().toLowerCase())
  ) {
    return {
      code: 'city_not_allowed',
      message: 'This payment method is not available in the selected city.',
    }
  }

  return null
}

/**
 * Fee in minor units for a given subtotal.
 *
 * Percent fees round half up. Rounding down would let a merchant lose a
 * minor unit on every order; rounding half up is the conventional retail
 * choice and is applied consistently.
 */
export function computeFeeMinor(
  policy: OfferingPolicy,
  subtotalMinor: bigint,
): bigint {
  if (policy.fee === null) return 0n
  if (subtotalMinor <= 0n) return 0n

  if (policy.fee.kind === 'fixed') return policy.fee.amountMinor

  const numerator = subtotalMinor * BigInt(policy.fee.basisPoints)
  return (numerator + 5000n) / 10000n
}

/** Label for the fee line, falling back to a neutral default. */
export function feeLabel(policy: OfferingPolicy): string {
  return policy.fee?.labelEn ?? policy.fee?.labelAr ?? 'Payment fee'
}

/** Serialisable view of the policy, for the storefront. */
export function describePolicy(policy: OfferingPolicy) {
  return {
    min_amount_minor:
      policy.minAmountMinor === null ? null : policy.minAmountMinor.toString(),
    max_amount_minor:
      policy.maxAmountMinor === null ? null : policy.maxAmountMinor.toString(),
    allowed_currencies: policy.allowedCurrencies ?? null,
    allowed_cities: policy.allowedCities ?? null,
    fee:
      policy.fee === null
        ? null
        : {
            kind: policy.fee.kind,
            amount_minor: policy.fee.amountMinor.toString(),
            basis_points: policy.fee.basisPoints,
            label_ar: policy.fee.labelAr,
            label_en: policy.fee.labelEn,
          },
  }
}

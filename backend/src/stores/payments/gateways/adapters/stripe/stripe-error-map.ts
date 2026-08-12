import type { PaymentErrorCode } from '../../provider.types'

/**
 * ==================================================================
 * Stripe error mapping
 * ==================================================================
 *
 * Translates Stripe's error shape into our closed taxonomy. Nothing
 * downstream ever sees a Stripe string, which is what lets retry,
 * failover and customer messaging stay provider-agnostic.
 *
 * decline_code is checked before code, and code before type, because
 * Stripe reports the most specific reason in the innermost field.
 */

const DECLINE_CODE: Readonly<Record<string, PaymentErrorCode>> = {
  insufficient_funds: 'declined_insufficient_funds',
  card_velocity_exceeded: 'amount_limit',
  withdrawal_count_limit_exceeded: 'amount_limit',
  do_not_honor: 'declined_do_not_honor',
  generic_decline: 'declined_do_not_honor',
  transaction_not_allowed: 'declined_do_not_honor',
  service_not_allowed: 'declined_do_not_honor',
  stolen_card: 'declined_risk',
  lost_card: 'declined_risk',
  pickup_card: 'declined_risk',
  fraudulent: 'declined_risk',
  merchant_blacklist: 'declined_risk',
  incorrect_number: 'declined_card_invalid',
  invalid_number: 'declined_card_invalid',
  invalid_expiry_month: 'declined_card_invalid',
  invalid_expiry_year: 'declined_card_invalid',
  invalid_cvc: 'declined_card_invalid',
  incorrect_cvc: 'declined_card_invalid',
  expired_card: 'declined_card_invalid',
  authentication_required: 'authentication_required',
}

const ERROR_CODE: Readonly<Record<string, PaymentErrorCode>> = {
  card_declined: 'declined_do_not_honor',
  expired_card: 'declined_card_invalid',
  incorrect_cvc: 'declined_card_invalid',
  processing_error: 'provider_unavailable',
  authentication_required: 'authentication_required',
  payment_intent_authentication_failure: 'authentication_failed',
  amount_too_large: 'amount_limit',
  amount_too_small: 'amount_limit',
  balance_insufficient: 'declined_insufficient_funds',
  idempotency_key_in_use: 'duplicate_request',
  rate_limit: 'rate_limited',
  api_key_expired: 'configuration_error',
  testmode_charges_only: 'mode_mismatch',
  livemode_mismatch: 'mode_mismatch',
}

const ERROR_TYPE: Readonly<Record<string, PaymentErrorCode>> = {
  card_error: 'declined_do_not_honor',
  rate_limit_error: 'rate_limited',
  authentication_error: 'configuration_error',
  invalid_request_error: 'configuration_error',
  api_error: 'provider_unavailable',
  idempotency_error: 'duplicate_request',
}

/** Shape we read from a Stripe error, without depending on its classes. */
export interface StripeErrorLike {
  type?: string
  code?: string
  decline_code?: string
  message?: string
  statusCode?: number
  raw?: { type?: string; code?: string; decline_code?: string; message?: string }
}

export function mapStripeError(error: unknown): PaymentErrorCode {
  const shape = normalizeError(error)

  if (shape.decline_code && DECLINE_CODE[shape.decline_code]) {
    return DECLINE_CODE[shape.decline_code]
  }

  if (shape.code && ERROR_CODE[shape.code]) {
    return ERROR_CODE[shape.code]
  }

  if (shape.type && ERROR_TYPE[shape.type]) {
    return ERROR_TYPE[shape.type]
  }

  // Network-level failures reach us without a Stripe shape at all.
  if (isTimeout(error)) return 'provider_timeout'
  if (shape.statusCode === 429) return 'rate_limited'
  if (shape.statusCode !== undefined && shape.statusCode >= 500) {
    return 'provider_unavailable'
  }

  return 'unknown'
}

export function stripeErrorMessage(error: unknown): string {
  const shape = normalizeError(error)
  return shape.message ?? 'Stripe request failed.'
}

function normalizeError(error: unknown): StripeErrorLike {
  if (typeof error !== 'object' || error === null) return {}

  const candidate = error as StripeErrorLike
  const raw = candidate.raw ?? {}

  return {
    type: candidate.type ?? raw.type,
    code: candidate.code ?? raw.code,
    decline_code: candidate.decline_code ?? raw.decline_code,
    message: candidate.message ?? raw.message,
    statusCode: candidate.statusCode,
  }
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: string }).code
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    (error as { type?: string }).type === 'StripeConnectionError'
  )
}

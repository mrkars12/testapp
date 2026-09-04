import type { PaymentErrorCode } from '../../provider.types'

/**
 * ==================================================================
 * Moyasar error mapping
 * ==================================================================
 *
 * Moyasar's taxonomy stops here. Two documented layers feed it:
 *
 *   The `type` field. Moyasar publishes a closed set of error types
 *   with meanings, which is the most precise signal available and is
 *   checked first.
 *
 *   The HTTP status. Moyasar publishes what each status means, including
 *   two that are not generic — 403 is "credentials not enough to access
 *   resources" and 405 is "Entity not activated to use live account",
 *   which is a merchant-configuration problem rather than a method
 *   error.
 *
 * ⚠️ One documented behaviour shapes everything downstream: "When a
 * request is valid but does not complete successfully (e.g., a credit
 * card is declined by the bank), we return the normal 201 success code
 * with a response message detailing the error." A decline is therefore
 * **not** an error response at all — it arrives as a 2xx payment whose
 * status is `failed`, and it becomes an `attempt_failed` fact rather
 * than a ProviderError. Nothing here tries to classify declines.
 *
 * Sources, accessed 2026-08-19:
 *   https://docs.moyasar.com/api/errors
 */

/** The documented `type` values and what each means for us. */
const BY_TYPE: Readonly<Record<string, PaymentErrorCode>> = {
  // "The request included invalid parameters." Ours to fix, or the
  // merchant's configuration — never the customer's card.
  invalid_request_error: 'configuration_error',
  invalid_request: 'configuration_error',
  // "You didn't authenticate yourself correctly."
  authentication_error: 'configuration_error',
  // "Too many requests hit the API too quickly."
  rate_limit_error: 'rate_limited',
  // "Failure to connect to Moyasar's API."
  api_connection_error: 'provider_unavailable',
  // "Your Account hasn't been activated to accept real payments."
  account_inactive_error: 'configuration_error',
  // "API errors cover any other type of problem (e.g. resource is not
  // found). API errors should be rare."
  api_error: 'provider_unavailable',
  // "The credit card payment transaction failed due unauthorized
  // attempt by the cardholder." The customer can act on this.
  '3ds_auth_error': 'authentication_failed',
}

/** Reads Moyasar's documented error body: `{type, message, errors}`. */
export function moyasarErrorType(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''

  const value = (body as Record<string, unknown>).type

  return typeof value === 'string' ? value : ''
}

export function moyasarErrorMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''

  const record = body as Record<string, unknown>

  const message = record.message
  const parts: string[] = []

  if (typeof message === 'string' && message.length > 0) parts.push(message)

  // `errors` is "string-array pair representing a field and list of
  // validation errors" — flattened so the merchant sees which field.
  const errors = record.errors

  if (typeof errors === 'object' && errors !== null) {
    for (const [field, reasons] of Object.entries(
      errors as Record<string, unknown>,
    )) {
      parts.push(
        `${field}: ${Array.isArray(reasons) ? reasons.join(' ') : String(reasons)}`,
      )
    }
  }

  return parts.join('; ')
}

export function mapMoyasarError(input: {
  status: number
  body: unknown
}): PaymentErrorCode {
  const mapped = BY_TYPE[moyasarErrorType(input.body)]
  if (mapped) return mapped

  // No documented type: fall back to the documented status meanings.
  if (input.status === 401 || input.status === 403) return 'configuration_error'
  // "Method Not Allowed – Entity not activated to use live account."
  if (input.status === 405) return 'configuration_error'
  if (input.status === 404) return 'configuration_error'
  if (input.status === 400) return 'configuration_error'
  if (input.status === 429) return 'rate_limited'
  // 500 "Internal Server Error" and 503 "Service Unavailable".
  if (input.status >= 500) return 'provider_unavailable'

  // A response Moyasar does not document. Deliberately not guessed at as
  // a decline — declines do not arrive here at all.
  return 'unknown'
}

/**
 * A safe message for logs and for the merchant.
 *
 * Only ever Moyasar's own error text, truncated: the request body
 * carries customer data and the credential is in the Authorization
 * header.
 */
export function moyasarErrorText(input: {
  status: number
  body: unknown
}): string {
  const message = moyasarErrorMessage(input.body)

  return message.length > 0
    ? `Moyasar returned ${input.status}: ${message.slice(0, 300)}`
    : `Moyasar returned ${input.status}.`
}

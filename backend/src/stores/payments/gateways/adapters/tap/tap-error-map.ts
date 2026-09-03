import type { PaymentErrorCode } from '../../provider.types'

/**
 * ==================================================================
 * Tap error mapping
 * ==================================================================
 *
 * Tap's taxonomy stops here. Two documented layers feed it, and they
 * answer different questions:
 *
 *   The **error response**. A rejected *request* comes back as
 *   `{"errors":[{"code":"…","description":"…"}]}`. The codes are
 *   published in the Error Handling & Testing reference — 7022
 *   `Invalid_Data`, 7017 `Not_Found` — plus the 1125 shown on the
 *   Create-a-Charge 400 example.
 *
 *   The **charge response code**. A rejected *payment* is not an error
 *   response at all: it arrives as a 2xx charge whose `status` is
 *   DECLINED, FAILED, RESTRICTED or TIMEDOUT and whose `response.code`
 *   names the reason. Tap publishes the whole table, and it is
 *   translated below into the closed taxonomy so retry, failover and
 *   customer messaging key off our codes rather than Tap's strings.
 *
 * ⚠️ The split matters. A decline reaching `mapTapError` would be
 * classified as a transport problem and retried against an issuer that
 * has already said no; a transport failure reaching
 * `mapTapResponseCode` would be shown to a customer as a card problem.
 * The adapter keeps them apart: HTTP failures become ProviderErrors,
 * charge statuses become ObservedFacts.
 *
 * Sources, accessed 2026-08-19:
 *   https://developers.tap.company/docs/error-handling-testing
 *   https://developers.tap.company/reference/charge-response-codes
 *   https://developers.tap.company/reference/create-a-charge (400 example)
 */

/** The documented `errors[].code` values. */
const BY_ERROR_CODE: Readonly<Record<string, PaymentErrorCode>> = {
  // "Invalid_Data" — missing authorization header, null body, bad field
  // format. Every one of them is ours or the merchant's to fix.
  '7022': 'configuration_error',
  // "Not_Found" — merchant public key not found, no matching invoice or
  // order for the id given.
  '7017': 'configuration_error',
  // "We were unable to process your payment. Please verify your payment
  // method or card details and try again."
  '1125': 'declined_card_invalid',
}

/**
 * The published charge response codes.
 *
 * Every entry is a translation of Tap's own message into the closed set;
 * none is an inference about a code Tap does not describe.
 */
const BY_RESPONSE_CODE: Readonly<Record<string, PaymentErrorCode>> = {
  '301': 'unknown', // Abandoned
  '302': 'unknown', // Canceled
  '303': 'unknown', // Deferred
  '304': 'unknown', // Expired
  '401': 'unknown', // Failed
  '402': 'configuration_error', // Failed, Invalid Parameter
  '403': 'duplicate_request', // Failed, Duplicate
  '404': 'declined_do_not_honor', // Failed, Locked
  '405': 'declined_card_invalid', // Failed, Invalid Card No
  '406': 'declined_card_invalid', // Failed, Invalid Expiry
  '407': 'declined_card_invalid', // Failed, Expired Card
  '408': 'unknown', // Failed, Unspecified Failure
  '501': 'declined_do_not_honor', // Declined
  '502': 'declined_card_invalid', // Declined, Incorrect CSC/CVV
  '503': 'authentication_failed', // Declined, 3D Security - Incorrect
  '504': 'authentication_required', // Declined, 3D Security - Card not Enrolled
  '505': 'declined_insufficient_funds', // Declined, Insufficient Funds
  '506': 'method_unavailable', // Declined, Transaction Type Not Supported
  '507': 'declined_do_not_honor', // Declined, Card Issuer
  '508': 'provider_timeout', // Declined, Card Issuer - No Reply
  '509': 'declined_do_not_honor', // Declined, Card Issuer - Do not Contact
  '510': 'declined_do_not_honor', // Declined, Card Issuer - Referral Response
  '511': 'declined_do_not_honor', // Declined, Card Issuer - Error
  '512': 'authentication_failed', // Declined, Not Authenticated
  '513': 'provider_unavailable', // Declined, Card Acquirer - Error
  '514': 'declined_risk', // Declined, Card Issuer - Risk Check
  '515': 'declined_risk', // Declined, Tap
  '516': 'authentication_failed', // Declined, Authentication Failed
  '701': 'declined_risk', // Restricted
  '702': 'rate_limited', // Restricted, Retry Limit Exceeded
  '703': 'declined_do_not_honor', // Restricted, Bank
  '704': 'declined_risk', // Restricted, Tap
  '801': 'provider_timeout', // Timed Out
  '901': 'unknown', // Unknown
}

interface TapErrorEntry {
  readonly code?: unknown
  readonly description?: unknown
  readonly message?: unknown
}

/** The `errors` array Tap documents on a rejected request. */
export function tapErrors(body: unknown): TapErrorEntry[] {
  if (typeof body !== 'object' || body === null) return []

  const errors = (body as { errors?: unknown }).errors

  return Array.isArray(errors) ? (errors as TapErrorEntry[]) : []
}

/** The first documented error code in the body, or ''. */
export function tapErrorCode(body: unknown): string {
  const first = tapErrors(body)[0]

  return first === undefined ? '' : String(first.code ?? '')
}

/**
 * A safe message for logs and for the merchant.
 *
 * Only ever Tap's own error text, truncated: the request body carries
 * customer data and the key is in the Authorization header.
 */
export function tapErrorMessage(body: unknown): string {
  const parts = tapErrors(body)
    .map((entry) => {
      const code = String(entry.code ?? '').trim()
      const description = String(entry.description ?? entry.message ?? '').trim()

      if (code && description) return `${code}: ${description}`

      return description || code
    })
    .filter((part) => part.length > 0)

  return parts.join('; ')
}

/** A rejected *request* → the closed taxonomy. */
export function mapTapError(input: {
  status: number
  body: unknown
}): PaymentErrorCode {
  const mapped = BY_ERROR_CODE[tapErrorCode(input.body)]
  if (mapped) return mapped

  // No documented error code: fall back to the HTTP status.
  if (input.status === 401 || input.status === 403) return 'configuration_error'
  if (input.status === 400 || input.status === 404 || input.status === 422) {
    return 'configuration_error'
  }
  if (input.status === 429) return 'rate_limited'
  if (input.status >= 500) return 'provider_unavailable'

  // A response Tap does not document. Deliberately not guessed at as a
  // decline — declines do not arrive here at all.
  return 'unknown'
}

export function tapErrorText(input: { status: number; body: unknown }): string {
  const message = tapErrorMessage(input.body)

  return message.length > 0
    ? `Tap returned ${input.status}: ${message.slice(0, 300)}`
    : `Tap returned ${input.status}.`
}

/**
 * A declined or failed *payment* → the closed taxonomy.
 *
 * `000` (Captured) and `100` (Initiated) are successes and never reach
 * here; an unpublished code becomes `unknown` rather than a guess.
 */
export function mapTapResponseCode(code: unknown): PaymentErrorCode {
  const key = String(code ?? '').trim()

  return BY_RESPONSE_CODE[key] ?? 'unknown'
}

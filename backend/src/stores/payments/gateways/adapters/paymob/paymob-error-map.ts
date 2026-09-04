import type { PaymentErrorCode } from '../../provider.types'

/**
 * ==================================================================
 * Paymob error mapping
 * ==================================================================
 *
 * Paymob's taxonomy stops here. Everything downstream — retry policy,
 * failover, what the customer is told — keys off `PaymentErrorCode`,
 * never off a Paymob string.
 *
 * Two sources feed the mapping, kept separate on purpose:
 *
 *   The documented bodies. Paymob's "Common Errors" panels quote exact
 *   response bodies for the Intention, Capture, Void and Refund APIs.
 *   Those are matched on their documented text.
 *
 *   The HTTP status. Where Paymob documents no body for a condition,
 *   the status is used — 401/403 means the key is wrong, 429 means slow
 *   down, 5xx means the gateway is unwell. That is ordinary HTTP
 *   semantics rather than a claim about Paymob, and it is why an
 *   undocumented failure lands on `unknown` rather than on a guess at a
 *   decline reason.
 *
 * Sources, accessed 2026-08-19:
 *   .../developers/intention-apis/create-intention  (404, 400 panels)
 *   .../developers/manage-payment-apis/capture      (400, 404 panels)
 *   .../developers/manage-payment-apis/refund       (400 panel)
 *   .../developers/manage-payment-apis/void         (400 panel)
 */

/** Documented message fragments, each quoted from a "Common Errors" panel. */
const DOCUMENTED: ReadonlyArray<{
  readonly fragment: string
  readonly code: PaymentErrorCode
}> = [
  // Create Intention, 404. The merchant's integration ID is wrong, is for
  // the other mode, or is not configured — all merchant configuration.
  {
    fragment: 'integration id/name does not exist',
    code: 'configuration_error',
  },
  // Create Intention, 400. A required field we failed to send.
  { fragment: 'this field is required', code: 'configuration_error' },
  // Refund and Void, 400.
  {
    fragment: 'requested refund amount is greater than the maximum refund amount',
    code: 'amount_limit',
  },
  // Capture, 400.
  { fragment: 'capture amount cannot exceed auth amount', code: 'amount_limit' },
  // Capture, 404.
  { fragment: 'invalid transaction id', code: 'configuration_error' },
]

/**
 * Pulls the human-readable part out of a Paymob error body.
 *
 * The four documented shapes are `{detail}`, `{message}`, and the
 * DRF-style field maps `{items: {name: [...]}}` and
 * `{billing_data: {phone_number: [...]}}`. The last two are flattened so
 * one matcher covers all of them.
 */
export function paymobErrorMessage(body: unknown): string {
  if (typeof body === 'string') return body
  if (typeof body !== 'object' || body === null) return ''

  const record = body as Record<string, unknown>

  for (const key of ['detail', 'message']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  // Field-error maps: collect "field: reason" pairs, one level deep,
  // which is as deep as the documented examples go.
  const parts: string[] = []

  for (const [field, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      parts.push(`${field}: ${value.join(' ')}`)
      continue
    }

    if (typeof value === 'object' && value !== null) {
      for (const [inner, reasons] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (Array.isArray(reasons)) {
          parts.push(`${field}.${inner}: ${reasons.join(' ')}`)
        }
      }
    }
  }

  return parts.join('; ')
}

export function mapPaymobError(input: {
  status: number
  body: unknown
}): PaymentErrorCode {
  const message = paymobErrorMessage(input.body).toLowerCase()

  for (const { fragment, code } of DOCUMENTED) {
    if (message.includes(fragment)) return code
  }

  // Undocumented bodies fall through to HTTP semantics.
  if (input.status === 401 || input.status === 403) return 'configuration_error'
  if (input.status === 404) return 'configuration_error'
  if (input.status === 429) return 'rate_limited'
  if (input.status >= 500) return 'provider_unavailable'

  // A 4xx we have no documentation for. Deliberately not guessed at as a
  // decline: telling a customer to try another card for a fault of ours
  // is worse than admitting we do not know.
  return 'unknown'
}

/**
 * A safe message for logs and for the merchant.
 *
 * Truncated, and never assembled from anything but the provider's own
 * error text — request bodies carry customer data and headers carry the
 * secret key.
 */
export function paymobErrorText(input: {
  status: number
  body: unknown
}): string {
  const message = paymobErrorMessage(input.body)

  return message.length > 0
    ? `Paymob returned ${input.status}: ${message.slice(0, 300)}`
    : `Paymob returned ${input.status}.`
}

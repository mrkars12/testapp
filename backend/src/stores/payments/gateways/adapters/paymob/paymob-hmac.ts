import { createHmac, timingSafeEqual } from 'crypto'

/**
 * ==================================================================
 * Paymob callback HMAC
 * ==================================================================
 *
 * The security boundary for inbound Paymob callbacks. Everything about
 * it is dictated by Paymob's documentation and nothing is inferred:
 *
 *   1. Take twenty specific fields, in the documented order — which is
 *      lexicographic by key, but the order is transcribed from the docs
 *      rather than produced by sorting, because two of the keys are
 *      spelled differently in the two callback shapes and sorting the
 *      *actual* payload keys would silently reorder them.
 *   2. Concatenate the values, with nothing between them.
 *   3. HMAC-SHA512 with the merchant's HMAC secret.
 *   4. Compare with the `hmac` query parameter.
 *
 * Source:
 * https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac
 * → HMAC → HMAC for transaction callback, accessed 2026-08-19.
 *
 * The doc's worked example is reproduced verbatim in the unit spec, so
 * this implementation is pinned to Paymob's own sample string rather
 * than to our reading of the prose.
 */

/**
 * The documented key order, for the transaction-processed (POST)
 * callback.
 *
 * Scoped to the POST shape deliberately. The docs describe a second,
 * GET-shaped "response callback" that redirects the *customer's browser*
 * back to the merchant's site — a frontend concern, and one this backend
 * never receives, since the webhook route only accepts POST.
 *
 * It is also the shape whose contract is ambiguous: the HMAC page names
 * the key `order_id`, while the response-callback sample on the
 * transaction-callbacks page sends `order=378804`. Rather than guess
 * which is authoritative, the GET shape is left unimplemented and noted
 * as a limitation. Nothing here depends on resolving it.
 */
export const HMAC_FIELDS: readonly {
  readonly processed: readonly string[]
}[] = [
  { processed: ['amount_cents'] },
  { processed: ['created_at'] },
  { processed: ['currency'] },
  { processed: ['error_occured'] },
  { processed: ['has_parent_transaction'] },
  { processed: ['id'] },
  { processed: ['integration_id'] },
  { processed: ['is_3d_secure'] },
  { processed: ['is_auth'] },
  { processed: ['is_capture'] },
  { processed: ['is_refunded'] },
  { processed: ['is_standalone_payment'] },
  { processed: ['is_voided'] },
  { processed: ['order', 'id'] },
  { processed: ['owner'] },
  { processed: ['pending'] },
  { processed: ['source_data', 'pan'] },
  { processed: ['source_data', 'sub_type'] },
  { processed: ['source_data', 'type'] },
  { processed: ['success'] },
]

/**
 * Renders one value the way Paymob's example renders it.
 *
 * Booleans are the JSON spellings `true`/`false`, numbers are their
 * plain decimal form, and a missing value contributes nothing. The last
 * rule matters: `source_data.pan` is absent for a wallet transaction,
 * and treating absence as the string "undefined" would make every such
 * callback fail verification.
 */
function render(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function read(source: unknown, path: readonly string[]): unknown {
  let cursor: unknown = source

  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  return cursor
}

/**
 * The string Paymob signs.
 *
 * `source` is the transaction object — the `obj` member of the callback
 * envelope, never the envelope itself.
 */
export function hmacPayload(source: unknown): string {
  return HMAC_FIELDS.map((field) => render(read(source, field.processed))).join('')
}

export function computeHmac(source: unknown, secret: string): string {
  return createHmac('sha512', secret)
    .update(hmacPayload(source), 'utf8')
    .digest('hex')
}

/**
 * Constant-time comparison of the expected and received digests.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are
 * checked first — and a wrong-length signature is simply invalid, not an
 * exception for the caller to handle.
 */
export function verifyHmac(input: {
  source: unknown
  secret: string
  received: string
}): boolean {
  if (input.received.length === 0) return false

  const expected = computeHmac(input.source, input.secret)

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(input.received.trim().toLowerCase(), 'utf8')

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

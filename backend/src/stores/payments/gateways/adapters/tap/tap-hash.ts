import { createHmac, timingSafeEqual } from 'crypto'
import { hashAmount } from './tap-amount'

/**
 * ==================================================================
 * Tap webhook authentication — the `hashstring` header
 * ==================================================================
 *
 * Tap posts its callbacks with a `hashstring` header and documents
 * exactly how to reproduce it:
 *
 *   $toBeHashedString = 'x_id' . $id . 'x_amount' . $amount .
 *     'x_currency' . $currency . 'x_gateway_reference' . $gateway_reference .
 *     'x_payment_reference' . $payment_reference . 'x_status' . $status .
 *     'x_created' . $created . '';
 *
 *   $myHashString = hash_hmac('sha256', $toBeHashedString, $SecretAPIKey);
 *
 * with the fields taken from the posted object:
 *
 *   id                  charge.id / authorize.id / refund.id
 *   amount              charge.amount / authorize.amount / refund.amount,
 *                       "rounded with standard decimal value"
 *   currency            …currency
 *   gateway_reference   …reference.gateway — "If value is not available,
 *                       please pass empty value."
 *   payment_reference   …reference.payment
 *   status              …status
 *   created             charge.transaction.created /
 *                       authorize.transaction.created / refund.created
 *
 * Three properties of this scheme shape the code below and are worth
 * naming, because each is a way to get it wrong:
 *
 *   The key is the merchant's **Secret API Key** — the same credential
 *   used to authenticate outbound calls. Tap issues no separate signing
 *   secret, which is why the adapter's `webhookSecretField` names
 *   `secret_key` rather than the default `webhook_secret`.
 *
 *   The hash covers *seven named fields*, not the raw body. A field the
 *   scheme does not cover can be altered without breaking the hash, so
 *   nothing outside those fields may be treated as authenticated. The
 *   fact mapper therefore reads only id, amount, currency, status and
 *   the references — never an unsigned field — to decide what moved.
 *
 *   The comparison must be constant-time. A byte-at-a-time compare on a
 *   hex digest is a practical oracle for forging one.
 *
 * Source, accessed 2026-08-19:
 *   https://developers.tap.company/docs/webhook
 */

/** The seven fields the documented string is built from. */
export interface TapHashFields {
  readonly id: string
  /** Already rendered to the currency's standard decimal places. */
  readonly amount: string
  readonly currency: string
  readonly gatewayReference: string
  readonly paymentReference: string
  readonly status: string
  readonly created: string
}

/**
 * The `toBeHashedString`, exactly as documented.
 *
 * Charges, authorizes, voids and refunds all share this form — Tap's own
 * sample assigns the identical concatenation four times, once per object
 * type, and only invoices differ. This adapter never creates an invoice,
 * so the invoice variant is deliberately absent rather than written
 * speculatively.
 */
export function tapHashString(fields: TapHashFields): string {
  return (
    `x_id${fields.id}` +
    `x_amount${fields.amount}` +
    `x_currency${fields.currency}` +
    `x_gateway_reference${fields.gatewayReference}` +
    `x_payment_reference${fields.paymentReference}` +
    `x_status${fields.status}` +
    `x_created${fields.created}`
  )
}

/** HMAC-SHA256 of the documented string, keyed by the Secret API Key. */
export function tapHash(fields: TapHashFields, secretApiKey: string): string {
  return createHmac('sha256', secretApiKey)
    .update(tapHashString(fields), 'utf8')
    .digest('hex')
}

/**
 * Reads the seven fields out of a posted charge, authorize or refund.
 *
 * Returns null when the object carries no id or no readable amount:
 * without them there is nothing to hash, and hashing a partial view
 * would authenticate a body we cannot actually verify.
 *
 * ⚠️ Runs on unverified bytes. It must not throw.
 */
export function tapHashFields(payload: unknown): TapHashFields | null {
  if (typeof payload !== 'object' || payload === null) return null

  const object = payload as Record<string, unknown>

  const id = text(object.id)
  if (id.length === 0) return null

  const currency = text(object.currency)
  const amount = hashAmount(object.amount, currency)

  if (amount.length === 0) return null

  const reference = asRecord(object.reference)

  return {
    id,
    amount,
    currency,
    // "If value is not available, please pass empty value."
    gatewayReference: text(reference?.gateway),
    paymentReference: text(reference?.payment),
    status: text(object.status),
    created: createdOf(object),
  }
}

/**
 * `created`, from wherever this object type keeps it.
 *
 * A charge and an authorize carry `transaction.created`; a refund
 * carries a top-level `created`. Tap's own sample spells out both, and
 * reading the wrong one produces a hash that never matches.
 */
function createdOf(object: Record<string, unknown>): string {
  const transaction = asRecord(object.transaction)
  const nested = text(transaction?.created)

  return nested.length > 0 ? nested : text(object.created)
}

/** Constant-time comparison; a length mismatch is simply a mismatch. */
export function hashMatches(received: string, expected: string): boolean {
  if (received.length === 0 || expected.length === 0) return false

  const a = Buffer.from(received, 'utf8')
  const b = Buffer.from(expected, 'utf8')

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

import {
  buildFactDedupeKey,
  type ObservedFact,
  type ObservedFactType,
} from '../../provider.types'

/**
 * ==================================================================
 * Paymob transaction → ObservedFact
 * ==================================================================
 *
 * Paymob does not send an event *name*. Every callback is
 * `{"type": "TRANSACTION", "obj": {...}}`, and what happened is encoded
 * in the transaction's boolean flags. So this file reads flags, not
 * event strings, and turns them into the closed `ObservedFactType` set
 * orchestration switches on.
 *
 * Two documented facts shape almost all of the logic:
 *
 *   "captured_amount ⇒ The total of the captured amount. (The payment
 *    transaction can have more than one partial capture transaction)"
 *
 *   "refunded_amount_cents ⇒ The total of the refunded amount. (The
 *    payment transaction can have more than one partial refund
 *    transaction)"
 *
 * Both are *totals*, which is exactly what `ObservedFact` wants — its
 * amounts are cumulative as the provider sees them, never deltas. Where
 * a total is absent (Paymob sends `null` on a plain payment) the
 * transaction's own `amount_cents` is the total.
 *
 * Correlation: facts carry the Paymob **order** id as
 * `gatewayReference`, because that is what exists from the moment the
 * intention is created and is what the docs tell merchants to correlate
 * on. The **transaction** id travels as `refs.gatewayPaymentId`, since
 * the capture, void and refund APIs key on it and it does not exist
 * until a customer has paid.
 *
 * Sources, accessed 2026-08-19:
 *   .../developers/webhook-callbacks-and-hmac → Transaction callbacks
 *   .../developers/manage-payment-apis/{capture,void,refund}
 */

/** The transaction object: the `obj` member of a callback envelope. */
export interface PaymobTransaction {
  readonly id?: unknown
  readonly pending?: unknown
  readonly success?: unknown
  readonly amount_cents?: unknown
  readonly currency?: unknown
  readonly is_auth?: unknown
  readonly is_capture?: unknown
  readonly is_captured?: unknown
  readonly is_voided?: unknown
  readonly is_void?: unknown
  readonly is_refunded?: unknown
  readonly is_refund?: unknown
  readonly captured_amount?: unknown
  readonly refunded_amount_cents?: unknown
  readonly created_at?: unknown
  readonly updated_at?: unknown
  readonly error_occured?: unknown
  readonly order?: { readonly id?: unknown; readonly merchant_order_id?: unknown }
  readonly data?: { readonly message?: unknown; readonly txn_response_code?: unknown }
  readonly source_data?: { readonly type?: unknown; readonly sub_type?: unknown }
}

export interface PaymobCallbackEnvelope {
  readonly type?: unknown
  readonly obj?: PaymobTransaction
}

/** The one callback type Paymob documents. */
export const PAYMOB_TRANSACTION_TYPE = 'TRANSACTION'

function flag(value: unknown): boolean {
  // Paymob sends JSON booleans in callbacks. The GET shape and some
  // clients stringify them, so the string spellings are accepted too —
  // anything else is absence, not truth.
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

function amount(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.round(value))
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim())
  }

  return null
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Paymob's "cents" are our minor units.
 *
 * Both are the currency's smallest unit, so there is no conversion —
 * only a widening from JSON number to bigint, which is where precision
 * would otherwise be lost above 2^53.
 */
export function orderReference(transaction: PaymobTransaction): string {
  return text(transaction.order?.id)
}

export function transactionId(transaction: PaymobTransaction): string {
  return text(transaction.id)
}

/**
 * What this transaction says happened.
 *
 * Order matters. A refund or void callback is delivered *for the parent
 * transaction*, which still carries `success: true` from the original
 * payment — so checking `success` first would file a refund as a second
 * payment.
 */
export function classify(
  transaction: PaymobTransaction,
): ObservedFactType | null {
  const succeeded = flag(transaction.success)

  if (flag(transaction.is_refunded) || flag(transaction.is_refund)) {
    return succeeded ? 'refund_succeeded' : 'refund_failed'
  }

  if (flag(transaction.is_voided) || flag(transaction.is_void)) {
    return 'attempt_voided'
  }

  if (flag(transaction.is_capture) || flag(transaction.is_captured)) {
    return succeeded ? 'attempt_captured' : 'attempt_failed'
  }

  if (flag(transaction.is_auth)) {
    return succeeded ? 'attempt_authorized' : 'attempt_failed'
  }

  if (!succeeded) return 'attempt_failed'

  // A standalone payment: authorised and captured in one step, which is
  // what a non-Auth/Cap integration produces.
  return 'attempt_captured'
}

/**
 * The cumulative amount for a fact type, as Paymob reports it.
 *
 * Falls back to the transaction's own amount when Paymob sends no total
 * — it does for a plain payment, where the amount *is* the total.
 */
function cumulativeFor(
  factType: ObservedFactType,
  transaction: PaymobTransaction,
): bigint | null {
  const own = amount(transaction.amount_cents)

  if (factType === 'refund_succeeded' || factType === 'refund_failed') {
    const total = amount(transaction.refunded_amount_cents)
    return total !== null && total > 0n ? total : own
  }

  if (factType === 'attempt_captured') {
    const total = amount(transaction.captured_amount)
    return total !== null && total > 0n ? total : own
  }

  return own
}

/**
 * Turns one callback transaction into the facts it implies.
 *
 * Returns an empty array — never throws — for a transaction that has not
 * resolved yet, or one carrying no order to correlate against. An empty
 * result is how orchestration is told "recognised, nothing to apply".
 */
export function factsFromTransaction(input: {
  accountId: bigint
  transaction: PaymobTransaction
}): ObservedFact[] {
  const { transaction } = input

  const gatewayReference = orderReference(transaction)

  // Without an order id nothing downstream can match this to an attempt.
  if (gatewayReference.length === 0) return []

  // Pending means the customer has not finished. Paymob documents that
  // it "sends the transaction callback only if the transaction succeeds
  // or is declined", so this is belt-and-braces rather than a state we
  // expect — but filing a pending transaction as a failure would cancel
  // a payment that is still in flight.
  if (flag(transaction.pending)) return []

  const factType = classify(transaction)
  if (factType === null) return []

  const cumulativeAmountMinor = cumulativeFor(factType, transaction) ?? undefined
  const currency = text(transaction.currency).toUpperCase() || undefined

  const occurredAtRaw = text(transaction.updated_at) || text(transaction.created_at)
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : undefined

  return [
    {
      dedupeKey: buildFactDedupeKey({
        accountId: input.accountId,
        gatewayReference,
        factType,
        cumulativeAmountMinor,
        currency,
      }),
      accountId: input.accountId,
      gatewayReference,
      factType,
      cumulativeAmountMinor,
      currency,
      occurredAt:
        occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
      refs: {
        gatewayReference,
        // What capture, void and refund key on.
        gatewayPaymentId: transactionId(transaction) || undefined,
      },
      // Redacted by construction: a classification and the provider's own
      // response text, never the PAN, the customer or the raw body.
      rawRedacted: {
        paymob_transaction_id: transactionId(transaction),
        success: flag(transaction.success),
        source_type: text(transaction.source_data?.type) || null,
        txn_response_code: text(transaction.data?.txn_response_code) || null,
      },
    },
  ]
}

/** True for a callback envelope Paymob documents. */
export function isRecognisedCallbackType(type: unknown): boolean {
  return text(type).toUpperCase() === PAYMOB_TRANSACTION_TYPE
}

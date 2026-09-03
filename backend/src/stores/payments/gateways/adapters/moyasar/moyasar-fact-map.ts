import {
  buildFactDedupeKey,
  type ObservedFact,
  type ObservedFactType,
} from '../../provider.types'

/**
 * ==================================================================
 * Moyasar payment → ObservedFact
 * ==================================================================
 *
 * Moyasar sends a named event *and* a full payment object, so unlike
 * Paymob there are no flags to decode — the payment's `status` is the
 * authority and the event name agrees with it. This file reads the
 * status, because it is the field the status reference documents and it
 * is present on every payload (webhook, invoice fetch, refund response),
 * whereas the event name only exists on a webhook.
 *
 * Amounts need no conversion. Moyasar's are already "a positive integer
 * representing the payment amount in the smallest currency unit", with
 * the docs' own examples covering the awkward cases (1.00 SAR = 100,
 * 1.00 KWD = 1000, 1 JPY = 1) — the same representation this codebase
 * moves money in, including three-decimal and zero-decimal currencies.
 *
 * Correlation: facts carry the **invoice** id as `gatewayReference`,
 * because that is what exists when the invoice is created and what the
 * attempt was recorded against. The **payment** id travels as
 * `refs.gatewayPaymentId`, because the refund endpoint is
 * `/payments/:id/refund` and a payment does not exist until someone pays.
 * Moyasar puts `invoice_id` on the payment object precisely so this join
 * is possible.
 *
 * Sources, accessed 2026-08-19:
 *   https://docs.moyasar.com/api/payments/payment-status-reference
 *   https://docs.moyasar.com/api/other/webhooks/webhook-reference
 *   https://docs.moyasar.com/api/invoices/01-create-invoice (payment object)
 */

/** The payment object, as it appears in webhooks and API responses. */
export interface MoyasarPayment {
  readonly id?: unknown
  readonly status?: unknown
  readonly amount?: unknown
  readonly currency?: unknown
  readonly refunded?: unknown
  readonly captured?: unknown
  readonly invoice_id?: unknown
  readonly created_at?: unknown
  readonly updated_at?: unknown
  readonly description?: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly source?: {
    readonly type?: unknown
    readonly company?: unknown
    readonly message?: unknown
    readonly transaction_url?: unknown
  }
}

/** The webhook envelope. */
export interface MoyasarWebhookEvent {
  readonly id?: unknown
  readonly type?: unknown
  readonly created_at?: unknown
  readonly secret_token?: unknown
  readonly account_name?: unknown
  readonly live?: unknown
  readonly data?: MoyasarPayment
}

/**
 * Every event Moyasar publishes, from `GET /webhooks/available_events`.
 *
 * `payment_faild` is not a typo of ours: the webhook reference and the
 * dashboard guide both spell it that way while the API's own
 * available-events response says `payment_failed`. Both are documented,
 * so both are recognised — an event we file as "unknown" is one an
 * operator has to go and investigate, and Moyasar's own inconsistency is
 * not worth that.
 */
export const MOYASAR_EVENTS: readonly string[] = [
  'payment_paid',
  'payment_failed',
  'payment_faild',
  'payment_voided',
  'payment_authorized',
  'payment_captured',
  'payment_refunded',
  'payment_abandoned',
  'payment_verified',
  'card_auth_authenticated',
  'card_auth_failed',
]

export function isRecognisedEvent(type: unknown): boolean {
  return typeof type === 'string' && MOYASAR_EVENTS.includes(type)
}

/** Events whose payload is a payment rather than a card authentication. */
export function isPaymentEvent(type: unknown): boolean {
  return typeof type === 'string' && type.startsWith('payment_')
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
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

/**
 * What this payment's status says happened.
 *
 * Returns null for the statuses that are real but move no money:
 *
 *   initiated  the customer has not paid yet; filing this as anything
 *              would either create an order nobody paid for or cancel a
 *              payment still in flight.
 *   verified   "the cardholder verifies his card in the tokenization
 *              process" — a card check, not a charge.
 *
 * Source: https://docs.moyasar.com/api/payments/payment-status-reference
 */
export function classify(status: unknown): ObservedFactType | null {
  switch (text(status)) {
    case 'paid':
      // Authorised and captured in one step, which is what the invoice
      // flow produces.
      return 'attempt_captured'
    case 'captured':
      return 'attempt_captured'
    case 'authorized':
      return 'attempt_authorized'
    case 'failed':
      return 'attempt_failed'
    case 'voided':
      return 'attempt_voided'
    case 'refunded':
      return 'refund_succeeded'
    case 'initiated':
    case 'verified':
      return null
    default:
      // An unrecognised status is not guessed at. Better a fact that
      // never arrives than a wrong one that moves money.
      return null
  }
}

/**
 * What an **invoice's own** status says happened — distinct from, and not
 * to be confused with, a payment's status above.
 *
 * An invoice has its own lifecycle (`initiated`, `paid`, `failed`,
 * `refunded`, `canceled`, `on_hold`, `expired`, `voided` — see
 * https://docs.moyasar.com/api/invoices/04-show-invoice, accessed
 * 2026-08-23) independent of any payment attempted against it. The
 * customer who never submits a card at all — closes the tab, or waits
 * out the invoice's payment window — leaves `invoice.payments` empty
 * forever: no payment object, so nothing for `classify()` above to ever
 * read. Moyasar documents no webhook event for an invoice-level
 * transition either (only `payment_*`/`card_auth_*`), so `expired`/
 * `canceled`/`voided` here is the *only* place such an outcome is ever
 * discoverable — exclusively through `fetchStatus()` (the return page's
 * `/sync` call, or reconciliation), never pushed to us.
 *
 * Deliberately narrower than `classify()`: `paid`/`failed`/`refunded`
 * are not mapped here even though they're valid invoice statuses too,
 * because those cases already have a real payment object with the
 * correct amount for `classify()` to read — mapping them a second time
 * from the invoice alone would risk a fact with no amount backing it.
 */
export function classifyInvoiceOnly(status: unknown): ObservedFactType | null {
  switch (text(status)) {
    case 'expired':
      return 'attempt_expired'
    case 'canceled':
    case 'voided':
      return 'attempt_voided'
    default:
      return null
  }
}

/**
 * The cumulative amount for a fact type, as Moyasar reports it.
 *
 * `refunded` and `captured` are documented as running totals ("Refunded
 * amount. Less than or equal to the payment amount"), which is exactly
 * what ObservedFact wants — its amounts are cumulative, never deltas.
 * Where a total is absent or zero the payment's own amount is the total.
 */
function cumulativeFor(
  factType: ObservedFactType,
  payment: MoyasarPayment,
): bigint | null {
  const own = amount(payment.amount)

  if (factType === 'refund_succeeded') {
    const total = amount(payment.refunded)
    return total !== null && total > 0n ? total : own
  }

  if (factType === 'attempt_captured') {
    const total = amount(payment.captured)
    return total !== null && total > 0n ? total : own
  }

  return own
}

/**
 * Turns one Moyasar payment into the facts it implies.
 *
 * Never throws, and returns an empty array for a payment that has not
 * resolved or that cannot be correlated — an empty result is how
 * orchestration is told "recognised, nothing to apply".
 */
export function factsFromPayment(input: {
  accountId: bigint
  payment: MoyasarPayment
}): ObservedFact[] {
  const { payment } = input

  // The invoice is what the attempt was recorded against. A payment with
  // no invoice was not created by this adapter — a dashboard payment, or
  // a direct API one — and nothing downstream could match it.
  const gatewayReference = text(payment.invoice_id)
  if (gatewayReference.length === 0) return []

  const factType = classify(payment.status)
  if (factType === null) return []

  const cumulativeAmountMinor = cumulativeFor(factType, payment) ?? undefined
  const currency = text(payment.currency).toUpperCase() || undefined

  const occurredAtRaw = text(payment.updated_at) || text(payment.created_at)
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
        // What /payments/:id/refund keys on.
        gatewayPaymentId: text(payment.id) || undefined,
      },
      // Redacted by construction: a classification and Moyasar's own
      // result message, never the card, the payer or the raw body.
      rawRedacted: {
        moyasar_payment_id: text(payment.id),
        status: text(payment.status),
        source_company: text(payment.source?.company) || null,
        message: text(payment.source?.message) || null,
      },
    },
  ]
}

/**
 * A payment created by Moyasar Form in the browser.
 *
 * Distinct from `factsFromPayment` for one structural reason: an
 * embedded payment has **no invoice**. Nothing created one — the form
 * created the payment directly — so the invoice id that
 * `factsFromPayment` correlates on does not exist, and that function
 * correctly refuses such a payment as "not created by this adapter".
 *
 * Here the payment's own id is the gateway reference, and correlation
 * runs through `metadata.intent_id`, which the form echoed back onto the
 * payment. `internalIntentRef` is what `PaymentFactApplier` already uses
 * to find an attempt whose provider reference is not yet known and bind
 * it — the same path Stripe's late-resolved PaymentIntent id takes.
 *
 * A payment carrying no `intent_id` is refused for the same reason a
 * payment carrying no invoice is: nothing downstream could match it, and
 * guessing which attempt it belonged to is exactly the mistake this
 * taxonomy exists to prevent.
 */
export function factsFromEmbeddedPayment(input: {
  accountId: bigint
  payment: MoyasarPayment
}): ObservedFact[] {
  const { payment } = input

  const gatewayReference = text(payment.id)
  if (gatewayReference.length === 0) return []

  const internalIntentRef = text(payment.metadata?.intent_id)
  if (internalIntentRef.length === 0) return []

  const factType = classify(payment.status)
  if (factType === null) return []

  const cumulativeAmountMinor = cumulativeFor(factType, payment) ?? undefined
  const currency = text(payment.currency).toUpperCase() || undefined

  const occurredAtRaw = text(payment.updated_at) || text(payment.created_at)
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
      internalIntentRef,
      occurredAt:
        occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
      refs: {
        gatewayReference,
        gatewayPaymentId: gatewayReference,
      },
      rawRedacted: {
        moyasar_payment_id: gatewayReference,
        status: text(payment.status),
        source_company: text(payment.source?.company) || null,
        message: text(payment.source?.message) || null,
      },
    },
  ]
}

/**
 * Every payment on an invoice, mapped. Used by the status fallback
 * (`fetchStatus()` — the return page's `/sync` call, and reconciliation).
 *
 * Falls back to the invoice's *own* status (`classifyInvoiceOnly`) only
 * when no payment produced a fact — most commonly because `payments` is
 * empty: the customer never submitted one at all. Without this, an
 * abandoned Moyasar invoice (expired, or canceled by the merchant) could
 * never resolve to anything but "still pending" — see
 * `classifyInvoiceOnly`'s doc comment for why this is the only place
 * that outcome is ever discoverable.
 */
export function factsFromInvoice(input: {
  accountId: bigint
  invoice: {
    readonly id?: unknown
    readonly status?: unknown
    readonly currency?: unknown
    readonly payments?: readonly MoyasarPayment[]
  }
}): ObservedFact[] {
  const invoiceId = text(input.invoice?.id)
  const payments = input.invoice?.payments ?? []

  const paymentFacts = Array.isArray(payments)
    ? payments.flatMap((payment) =>
        factsFromPayment({
          accountId: input.accountId,
          // An invoice's payments do not always echo invoice_id back, so it
          // is supplied from the invoice we asked about rather than assumed.
          payment: { ...payment, invoice_id: text(payment.invoice_id) || invoiceId },
        }),
      )
    : []

  if (paymentFacts.length > 0 || invoiceId.length === 0) return paymentFacts

  const invoiceFactType = classifyInvoiceOnly(input.invoice?.status)
  if (invoiceFactType === null) return paymentFacts

  const currency = text(input.invoice?.currency).toUpperCase() || undefined

  return [
    {
      dedupeKey: buildFactDedupeKey({
        accountId: input.accountId,
        gatewayReference: invoiceId,
        factType: invoiceFactType,
        currency,
      }),
      accountId: input.accountId,
      gatewayReference: invoiceId,
      factType: invoiceFactType,
      currency,
      refs: { gatewayReference: invoiceId },
      rawRedacted: { moyasar_invoice_status: text(input.invoice?.status) },
    },
  ]
}

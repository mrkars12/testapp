import {
  buildFactDedupeKey,
  type GatewayRefs,
  type ObservedFact,
  type ObservedFactType,
} from '../../provider.types'
import { fromStripeAmount } from './stripe-amount'
import { mapStripeError } from './stripe-error-map'

/**
 * ==================================================================
 * Stripe fact mapping
 * ==================================================================
 *
 * Turns a Stripe PaymentIntent, or an event carrying one, into our
 * normalised facts.
 *
 * Amounts are reported cumulatively, exactly as Stripe reports them:
 * amount_received is the running total, not a delta. The applier relies
 * on that to tell a second partial capture from a redelivered first one.
 */

/** The parts of a Stripe PaymentIntent we read. */
export interface StripeIntentLike {
  id: string
  status: string
  currency: string
  amount: number
  amount_received?: number
  amount_capturable?: number
  latest_charge?: string | { id: string } | null
  customer?: string | { id: string } | null
  created?: number
  last_payment_error?: {
    code?: string
    decline_code?: string
    type?: string
    message?: string
  } | null
  /**
   * Round-tripped from `payment_intent_data.metadata` on the Checkout
   * Session that created it (see `stripe.adapter.ts`'s
   * `initializePayment`) — `intent_id` is our own `PaymentIntent.id`,
   * not anything Stripe assigned. Lets a `payment_intent.*` webhook that
   * arrives before the Checkout Session id has been resolved to this
   * PaymentIntent's id still be traced back to the right attempt — see
   * `ObservedFact.internalIntentRef`.
   */
  metadata?: Record<string, string> | null
}

const STATUS_TO_FACT: Readonly<Record<string, ObservedFactType | null>> = {
  requires_payment_method: null,
  requires_confirmation: null,
  requires_action: null,
  processing: null,
  requires_capture: 'attempt_authorized',
  succeeded: 'attempt_captured',
  canceled: 'attempt_voided',
}

/**
 * Facts implied by a PaymentIntent's current state.
 *
 * Returns an empty array for in-flight states: reporting "nothing has
 * happened yet" as a fact would push the intent through transitions it
 * has not actually made.
 *
 * One in-flight-looking status is not actually in-flight: Stripe has no
 * distinct terminal status for a declined/failed confirmation attempt —
 * it returns the intent to `requires_payment_method` (retriable in
 * principle) with `last_payment_error` populated. Without checking that
 * field, a customer who tried and failed (the "Simulate scan → reject"
 * TEST flow, or any declined card) is indistinguishable from one who
 * never attempted anything, and a sync/poll would report no fact for it
 * forever.
 */
export function factsFromIntent(input: {
  accountId: bigint
  intent: StripeIntentLike
  occurredAt?: Date
  providerSequence?: number
  /**
   * What the applier's (accountId, gatewayReference) lookup must match
   * against — defaults to the PaymentIntent's own id, which is correct
   * whenever that id is what got stored on the attempt at creation time.
   *
   * It is not, when the underlying Checkout Session had no PaymentIntent
   * yet at creation (Stripe defers creating one until the customer
   * actually submits payment on the hosted page — see
   * `stripe.adapter.ts`'s `initializePayment`): the attempt was stored
   * under the Checkout Session's own id instead. `fetchStatus` passes
   * that original id through here once it resolves the real
   * PaymentIntent, so the emitted fact still matches the row that's
   * actually on file, without renaming anything in the database.
   */
  lookupReference?: string
}): ObservedFact[] {
  const { accountId, intent } = input
  const lookupReference = input.lookupReference ?? intent.id
  const internalIntentRef = intent.metadata?.intent_id || undefined

  const occurredAt =
    input.occurredAt ??
    (intent.created ? new Date(intent.created * 1000) : undefined)

  if (intent.status === 'requires_payment_method' && intent.last_payment_error) {
    return [
      factFromFailure({
        accountId,
        intentId: lookupReference,
        currency: intent.currency,
        occurredAt,
        message: intent.last_payment_error.message,
        failureCode: mapStripeError(intent.last_payment_error),
        internalIntentRef,
      }),
    ]
  }

  const factType = STATUS_TO_FACT[intent.status]
  if (!factType) return []

  const refs: GatewayRefs = {
    gatewayReference: intent.id,
    gatewayPaymentId: intent.id,
    gatewayCaptureRef: idOf(intent.latest_charge),
    gatewayCustomerId: idOf(intent.customer),
  }

  const cumulativeAmountMinor = cumulativeFor(factType, intent)

  return [
    {
      dedupeKey: buildFactDedupeKey({
        accountId,
        gatewayReference: lookupReference,
        factType,
        cumulativeAmountMinor,
        currency: intent.currency.toUpperCase(),
      }),
      accountId,
      gatewayReference: lookupReference,
      factType,
      cumulativeAmountMinor,
      currency: intent.currency.toUpperCase(),
      occurredAt,
      providerSequence: input.providerSequence,
      refs,
      rawRedacted: {
        stripe_status: intent.status,
        stripe_amount: intent.amount,
        stripe_amount_received: intent.amount_received ?? null,
      },
      internalIntentRef,
    },
  ]
}

/**
 * Fact for a Checkout Session that expired with no PaymentIntent ever
 * created — the one terminal outcome reachable before Stripe creates
 * one. Shared between the `checkout.session.expired` webhook handler
 * below and `fetchStatus`'s polling path, which hits the exact same
 * shape when it retrieves an expired session directly.
 */
export function factFromExpiredSession(input: {
  accountId: bigint
  sessionId: string
  currency: string
  occurredAt?: Date
}): ObservedFact {
  const currency = input.currency.toUpperCase()

  return {
    dedupeKey: buildFactDedupeKey({
      accountId: input.accountId,
      gatewayReference: input.sessionId,
      factType: 'attempt_expired',
      currency,
    }),
    accountId: input.accountId,
    gatewayReference: input.sessionId,
    factType: 'attempt_expired',
    currency,
    occurredAt: input.occurredAt,
    rawRedacted: { reason: 'checkout_session_expired' },
  }
}

/** Fact for a payment that Stripe reports as permanently failed. */
export function factFromFailure(input: {
  accountId: bigint
  intentId: string
  currency: string
  occurredAt?: Date
  message?: string
  failureCode?: ReturnType<typeof mapStripeError>
  internalIntentRef?: string
}): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: input.accountId,
      gatewayReference: input.intentId,
      factType: 'attempt_failed',
      currency: input.currency.toUpperCase(),
    }),
    accountId: input.accountId,
    gatewayReference: input.intentId,
    factType: 'attempt_failed',
    currency: input.currency.toUpperCase(),
    occurredAt: input.occurredAt,
    rawRedacted: { message: input.message ?? null },
    failureCode: input.failureCode,
    internalIntentRef: input.internalIntentRef,
  }
}

/**
 * Events we recognise.
 *
 * Recognised is not the same as acted on: `payment_intent.requires_action`
 * is listed so it is classified as an expected, no-op event rather than
 * filed as unknown, but it produces no fact — the intent is already in
 * that state from checkout, and inventing a transition would move it
 * backwards.
 *
 * Nothing is listed here speculatively. Each entry maps to a lifecycle
 * this codebase actually implements: capture, authorisation, failure,
 * cancellation, refund, and dispute recording.
 */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment_intent.succeeded',
  'payment_intent.amount_capturable_updated',
  'payment_intent.payment_failed',
  'payment_intent.requires_action',
  'payment_intent.canceled',
  'charge.refunded',
  'refund.updated',
  'charge.dispute.created',
  'charge.dispute.closed',
  // Checkout Sessions (the final customer-facing architecture — see
  // stripe.adapter.ts). `completed`/`async_payment_succeeded`/
  // `async_payment_failed` are recognised so they classify as expected
  // no-ops rather than "unknown": the PaymentIntent this session created
  // synchronously already fires its own succeeded/payment_failed event
  // for the same transition, which is what this adapter acts on — a
  // session-level event acting too would risk applying the same outcome
  // twice through two different dedupe keys. `expired` is different: an
  // abandoned session (customer never completed or returned) may leave
  // no corresponding terminal PaymentIntent event at all, so it is acted
  // on directly below.
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
])

/** Whether this event type is one the mapper knows about at all. */
export function isRecognisedEventType(type: string): boolean {
  return HANDLED_EVENT_TYPES.has(type)
}

export interface StripeEventLike {
  id: string
  type: string
  created?: number
  data: { object: Record<string, unknown> }
}

/** Facts carried by a Stripe webhook event. */
export function factsFromEvent(input: {
  accountId: bigint
  event: StripeEventLike
}): ObservedFact[] {
  const { accountId, event } = input

  if (!HANDLED_EVENT_TYPES.has(event.type)) return []

  const occurredAt = event.created ? new Date(event.created * 1000) : undefined
  const object = event.data.object

  // See HANDLED_EVENT_TYPES: completed/async_payment_* are deliberate
  // no-ops (the PaymentIntent's own event is authoritative for those),
  // and neither carries a PaymentIntentStatus-shaped object that
  // `factsFromIntent` below could safely read anyway.
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'checkout.session.async_payment_failed'
  ) {
    return []
  }

  if (event.type === 'checkout.session.expired') {
    const paymentIntentId = idOf(
      object.payment_intent as string | { id: string } | null | undefined,
    )
    const currency = String(object.currency ?? 'usd').toUpperCase()

    // The common case now, not the edge case: Stripe only creates a
    // PaymentIntent once the customer submits payment on the hosted
    // page, so an *abandoned* session — the whole reason this event
    // fires — almost always has none. That session's own id is what
    // `initializePayment` stored as the attempt's gatewayReference in
    // that case (see `factsFromIntent`'s `lookupReference` doc above),
    // so keying the fact on it here is what makes this event findable
    // by the applier at all.
    const lookupReference = paymentIntentId ?? String(object.id)

    return [
      {
        dedupeKey: buildFactDedupeKey({
          accountId,
          gatewayReference: lookupReference,
          factType: 'attempt_expired',
          currency,
        }),
        accountId,
        gatewayReference: lookupReference,
        factType: 'attempt_expired',
        currency,
        occurredAt,
        rawRedacted: { reason: 'checkout_session_expired' },
      },
    ]
  }

  if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    return [disputeFact(accountId, event, object, occurredAt)]
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = object as unknown as StripeIntentLike
    return [
      factFromFailure({
        accountId,
        intentId: intent.id,
        currency: intent.currency,
        occurredAt,
        message: intent.last_payment_error?.message,
        failureCode: intent.last_payment_error
          ? mapStripeError(intent.last_payment_error)
          : undefined,
        internalIntentRef: intent.metadata?.intent_id || undefined,
      }),
    ]
  }

  if (event.type === 'charge.refunded') {
    return chargeRefundedFacts(accountId, object, occurredAt)
  }

  if (event.type === 'refund.updated') {
    return refundUpdatedFacts(accountId, object, occurredAt)
  }

  return factsFromIntent({
    accountId,
    intent: object as unknown as StripeIntentLike,
    occurredAt,
  })
}

/**
 * A refund reported on the charge.
 *
 * The charge carries `amount_refunded`, which is the cumulative total
 * across every refund on it — exactly the shape the applier reconciles
 * against, so a second partial refund and a redelivery of the first are
 * distinguishable.
 */
function chargeRefundedFacts(
  accountId: bigint,
  object: Record<string, unknown>,
  occurredAt?: Date,
): ObservedFact[] {
  const reference = idOf(
    object.payment_intent as string | { id: string } | null | undefined,
  )

  // Without the intent reference there is nothing to attach the refund
  // to, and guessing from the charge id would attach it to nothing.
  if (!reference) return []

  const currency = String(object.currency ?? 'usd')
  const amountRefunded = object.amount_refunded

  if (typeof amountRefunded !== 'number') return []

  const cumulativeAmountMinor = fromStripeAmount(amountRefunded, currency)

  return [
    {
      dedupeKey: buildFactDedupeKey({
        accountId,
        gatewayReference: reference,
        factType: 'refund_succeeded',
        cumulativeAmountMinor,
        currency: currency.toUpperCase(),
      }),
      accountId,
      gatewayReference: reference,
      factType: 'refund_succeeded',
      cumulativeAmountMinor,
      currency: currency.toUpperCase(),
      occurredAt,
      refs: { gatewayCaptureRef: String(object.id ?? '') },
      rawRedacted: {
        stripe_amount_refunded: amountRefunded,
        stripe_refunded: object.refunded ?? null,
      },
    },
  ]
}

/**
 * A refund whose own status changed.
 *
 * Only failures produce a fact. A single Refund object carries its own
 * amount, not the cumulative total across the payment, and the applier
 * reconciles refunds cumulatively — so treating `refund.amount` as the
 * running total would silently erase an earlier partial refund. The
 * authoritative cumulative figure arrives on `charge.refunded`, which is
 * where a successful refund is applied from.
 */
function refundUpdatedFacts(
  accountId: bigint,
  object: Record<string, unknown>,
  occurredAt?: Date,
): ObservedFact[] {
  const status = String(object.status ?? '')

  if (status !== 'failed' && status !== 'canceled') return []

  const reference = idOf(
    object.payment_intent as string | { id: string } | null | undefined,
  )

  if (!reference) return []

  const currency = String(object.currency ?? 'usd').toUpperCase()
  const refundId = String(object.id ?? '')

  return [
    {
      // Suffixed with the refund's own id: two different refunds failing
      // on one payment are two facts, and the base key carries no amount
      // to tell them apart.
      dedupeKey: `${buildFactDedupeKey({
        accountId,
        gatewayReference: reference,
        factType: 'refund_failed',
        currency,
      })}:${refundId}`,
      accountId,
      gatewayReference: reference,
      factType: 'refund_failed',
      currency,
      occurredAt,
      refs: { gatewayCaptureRef: refundId },
      rawRedacted: { refund_status: status },
    },
  ]
}

/**
 * Stripe dispute statuses that carry a financial outcome.
 *
 * Everything else Stripe can report — `warning_needs_response`,
 * `under_review`, and the rest — is a status change with no money
 * movement, and is recorded rather than posted.
 */
const DISPUTE_OUTCOME: Readonly<Record<string, ObservedFactType>> = {
  won: 'dispute_won',
  lost: 'dispute_lost',
}

function disputeFact(
  accountId: bigint,
  event: StripeEventLike,
  object: Record<string, unknown>,
  occurredAt?: Date,
): ObservedFact {
  const reference = String(object.payment_intent ?? object.charge ?? object.id)
  const currency = String(object.currency ?? 'usd').toUpperCase()
  const status = String(object.status ?? '')
  const disputeId = String(object.id ?? '')

  const factType: ObservedFactType =
    event.type === 'charge.dispute.created'
      ? 'dispute_opened'
      : // A closed dispute only moves money when Stripe says who won.
        // Anything else closed without an outcome stays an audit record.
        (DISPUTE_OUTCOME[status] ?? 'dispute_closed')

  // Stripe reports the disputed amount on the dispute object. Without it
  // there is nothing to hold or write off, and the applier will refuse
  // the fact rather than guess.
  const amount = object.amount
  const cumulativeAmountMinor =
    typeof amount === 'number' ? fromStripeAmount(amount, currency) : undefined

  return {
    // Suffixed with the dispute id: a payment can be disputed more than
    // once, and the base key carries nothing to tell two apart.
    dedupeKey: `${buildFactDedupeKey({
      accountId,
      gatewayReference: reference,
      factType,
      cumulativeAmountMinor,
      currency,
    })}:${disputeId}`,
    accountId,
    gatewayReference: reference,
    factType,
    cumulativeAmountMinor,
    currency,
    occurredAt,
    refs: { gatewayCaptureRef: disputeId },
    rawRedacted: {
      dispute_id: disputeId,
      status: object.status ?? null,
      reason: object.reason ?? null,
    },
  }
}

function cumulativeFor(
  factType: ObservedFactType,
  intent: StripeIntentLike,
): bigint | undefined {
  if (factType === 'attempt_captured') {
    const received = intent.amount_received ?? intent.amount
    return fromStripeAmount(received, intent.currency)
  }

  if (factType === 'attempt_authorized') {
    const capturable = intent.amount_capturable ?? intent.amount
    return fromStripeAmount(capturable, intent.currency)
  }

  return undefined
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? value : value.id
}

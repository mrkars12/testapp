import {
  buildFactDedupeKey,
  type GatewayRefs,
  type ObservedFact,
  type ObservedFactType,
} from '../../provider.types'
import { fromStripeAmount } from './stripe-amount'

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
  last_payment_error?: { message?: string } | null
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
 */
export function factsFromIntent(input: {
  accountId: bigint
  intent: StripeIntentLike
  occurredAt?: Date
  providerSequence?: number
}): ObservedFact[] {
  const { accountId, intent } = input

  const factType = STATUS_TO_FACT[intent.status]
  if (!factType) return []

  const refs: GatewayRefs = {
    gatewayReference: intent.id,
    gatewayPaymentId: intent.id,
    gatewayCaptureRef: idOf(intent.latest_charge),
    gatewayCustomerId: idOf(intent.customer),
  }

  const cumulativeAmountMinor = cumulativeFor(factType, intent)

  const occurredAt =
    input.occurredAt ??
    (intent.created ? new Date(intent.created * 1000) : undefined)

  return [
    {
      dedupeKey: buildFactDedupeKey({
        accountId,
        gatewayReference: intent.id,
        factType,
        cumulativeAmountMinor,
        currency: intent.currency.toUpperCase(),
      }),
      accountId,
      gatewayReference: intent.id,
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
    },
  ]
}

/** Fact for a payment that Stripe reports as permanently failed. */
export function factFromFailure(input: {
  accountId: bigint
  intentId: string
  currency: string
  occurredAt?: Date
  message?: string
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
  }
}

/** Events we act on. Everything else is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment_intent.succeeded',
  'payment_intent.amount_capturable_updated',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.dispute.created',
  'charge.dispute.closed',
])

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
      }),
    ]
  }

  return factsFromIntent({
    accountId,
    intent: object as unknown as StripeIntentLike,
    occurredAt,
  })
}

function disputeFact(
  accountId: bigint,
  event: StripeEventLike,
  object: Record<string, unknown>,
  occurredAt?: Date,
): ObservedFact {
  const reference = String(object.payment_intent ?? object.charge ?? object.id)
  const currency = String(object.currency ?? 'usd').toUpperCase()
  const factType: ObservedFactType =
    event.type === 'charge.dispute.created' ? 'dispute_opened' : 'dispute_closed'

  return {
    dedupeKey: buildFactDedupeKey({
      accountId,
      gatewayReference: reference,
      factType,
      currency,
    }),
    accountId,
    gatewayReference: reference,
    factType,
    currency,
    occurredAt,
    rawRedacted: { dispute_id: String(object.id ?? ''), status: object.status ?? null },
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

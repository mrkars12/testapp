import {
  buildFactDedupeKey,
  type ObservedFact,
  type ObservedFactType,
} from '../../provider.types'
import { fromTapAmount } from './tap-amount'
import { mapTapResponseCode } from './tap-error-map'

/**
 * ==================================================================
 * Tap charge / authorize / refund → ObservedFact
 * ==================================================================
 *
 * Tap posts the object itself rather than an event envelope: there is no
 * `type` field and no event id anywhere in the payload. What arrives is
 * a charge, an authorize or a refund, and its `status` is the authority.
 * That is why this file switches on `object` and then on `status`, and
 * why nothing here looks for an event name that does not exist.
 *
 * The documented charge statuses are exactly:
 *
 *   "INITIATED, ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED,
 *    CAPTURED, VOID, TIMEDOUT, UNKNOWN"
 *
 * with Tap's own reading of them:
 *
 *   "INITIATED - Tap will provide the payment URL (transaction.url) …
 *    CAPTURED - Amount was successfully charged.
 *    ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED, VOID, TIMEDOUT,
 *    UNKNOWN - Payment failed."
 *
 * Only `VOID` is pulled out of that failure group, because our taxonomy
 * has a fact type of exactly that name and the correspondence is Tap's
 * word rather than our inference. `TIMEDOUT` is deliberately *not*
 * mapped to `attempt_expired`: Tap files it under "payment failed", and
 * promoting it would be our opinion, not their documentation.
 *
 * Amounts are converted, never assumed. Tap's are decimals in the major
 * unit; ours are minor units in a bigint, and the exponent comes from
 * the ISO currency registry — see `tap-amount.ts`.
 *
 * Correlation: facts carry the **charge id** as `gatewayReference`,
 * because that is what `POST /v2/charges` returns at the moment the
 * attempt is created, what `GET /v2/charges/{charge_id}` reads back, and
 * what `POST /v2/refunds` takes as `charge_id`. A refund object carries
 * that same id in its own `charge_id` field, which is what makes the
 * join possible without a second identifier.
 *
 * Sources, accessed 2026-08-19:
 *   https://developers.tap.company/reference/charges
 *   https://developers.tap.company/reference/create-a-charge
 *   https://developers.tap.company/reference/refunds
 *   https://developers.tap.company/reference/create-an-authorize
 *   https://developers.tap.company/docs/webhook
 */

/** The charge object, as it appears in responses and in callbacks. */
export interface TapCharge {
  readonly id?: unknown
  readonly object?: unknown
  readonly status?: unknown
  readonly amount?: unknown
  readonly currency?: unknown
  readonly live_mode?: unknown
  readonly transaction?: {
    readonly created?: unknown
    readonly authorization_id?: unknown
    readonly url?: unknown
  }
  readonly reference?: {
    readonly track?: unknown
    readonly payment?: unknown
    readonly gateway?: unknown
    readonly acquirer?: unknown
    readonly transaction?: unknown
    readonly order?: unknown
    readonly idempotent?: unknown
  }
  readonly response?: { readonly code?: unknown; readonly message?: unknown }
  readonly card?: { readonly scheme?: unknown; readonly brand?: unknown }
  readonly source?: { readonly payment_method?: unknown; readonly id?: unknown }
  readonly merchant?: { readonly id?: unknown }
}

/** The refund object returned by POST /v2/refunds and posted back. */
export interface TapRefund {
  readonly id?: unknown
  readonly object?: unknown
  readonly status?: unknown
  readonly amount?: unknown
  readonly currency?: unknown
  readonly charge_id?: unknown
  readonly created?: unknown
  readonly live_mode?: unknown
  readonly reference?: {
    readonly payment?: unknown
    readonly gateway?: unknown
    readonly acquirer?: unknown
  }
  readonly response?: { readonly code?: unknown; readonly message?: unknown }
}

/** Every charge status Tap documents. */
export const TAP_CHARGE_STATUSES: readonly string[] = [
  'INITIATED',
  'IN_PROGRESS',
  'ABANDONED',
  'CANCELLED',
  'FAILED',
  'DECLINED',
  'RESTRICTED',
  'CAPTURED',
  'VOID',
  'TIMEDOUT',
  'UNKNOWN',
]

/**
 * Every refund status Tap documents.
 *
 * Both generations: the current set, and the "Refund Logic V2" set that
 * a merchant can be moved onto by Tap support. Recognising both means an
 * account on the beta does not have every callback filed as unknown.
 */
export const TAP_REFUND_STATUSES: readonly string[] = [
  'PENDING',
  'REFUNDED',
  'DECLINED',
  'FAILED',
  'RESTRICTED',
  'UNKNOWN',
  'TIMED_OUT',
  'ACCEPTED',
  'REJECTED',
]

/** The documented authorize statuses. */
export const TAP_AUTHORIZE_STATUSES: readonly string[] = [
  'INITIATED',
  'AUTHORIZED',
]

export type TapObjectKind = 'charge' | 'authorize' | 'refund'

/** Which Tap object this payload is, from its own `object` field. */
export function tapObjectKind(payload: unknown): TapObjectKind | null {
  if (typeof payload !== 'object' || payload === null) return null

  const object = text((payload as { object?: unknown }).object).toLowerCase()

  if (object === 'charge') return 'charge'
  if (object === 'authorize') return 'authorize'
  if (object === 'refund') return 'refund'

  return null
}

/** Whether the object and its status are both ones Tap documents. */
export function isRecognisedPayload(payload: unknown): boolean {
  const kind = tapObjectKind(payload)
  if (kind === null) return false

  const status = text((payload as { status?: unknown }).status).toUpperCase()

  if (kind === 'charge') return TAP_CHARGE_STATUSES.includes(status)
  if (kind === 'authorize') return TAP_AUTHORIZE_STATUSES.includes(status)

  return TAP_REFUND_STATUSES.includes(status)
}

/**
 * What a charge status says happened.
 *
 * Returns null for the two states that are real but move no money —
 * `INITIATED` (Tap has issued the payment URL and the customer has not
 * paid) and `IN_PROGRESS` (documented on the charge-list filter, and
 * used by the store-counter methods) — because filing either would
 * either create an order nobody paid for or cancel a payment still in
 * flight.
 */
export function classifyCharge(status: unknown): ObservedFactType | null {
  switch (text(status).toUpperCase()) {
    case 'CAPTURED':
      // "Amount was successfully charged." The redirect flow authorises
      // and captures in one step, so there is no separate capture fact.
      return 'attempt_captured'
    case 'VOID':
      return 'attempt_voided'
    case 'ABANDONED':
    case 'CANCELLED':
    case 'FAILED':
    case 'DECLINED':
    case 'RESTRICTED':
    case 'TIMEDOUT':
    case 'UNKNOWN':
      // Tap's own grouping: "Payment failed. Use the charge response
      // code and message to identify the reason for failure."
      return 'attempt_failed'
    case 'INITIATED':
    case 'IN_PROGRESS':
      return null
    default:
      // A status Tap does not document is not guessed at. Better a fact
      // that never arrives than a wrong one that moves money.
      return null
  }
}

/**
 * What a refund status says happened.
 *
 * `PENDING` and `ACCEPTED` are explicitly in-flight — "the refund
 * request is being processed", "the refund request has been accepted and
 * is pending processing" — and Tap states that completion "will trigger
 * a webhook notification to your server (post.url)". Applying them early
 * would credit a customer twice when that second callback lands.
 */
export function classifyRefund(status: unknown): ObservedFactType | null {
  switch (text(status).toUpperCase()) {
    case 'REFUNDED':
      return 'refund_succeeded'
    case 'DECLINED':
    case 'FAILED':
    case 'RESTRICTED':
    case 'REJECTED':
    case 'TIMED_OUT':
    case 'UNKNOWN':
      return 'refund_failed'
    case 'PENDING':
    case 'ACCEPTED':
      return null
    default:
      return null
  }
}

/**
 * One Tap charge → the facts it implies.
 *
 * Never throws, and returns an empty array for a charge that has not
 * resolved or that carries no id — an empty result is how orchestration
 * is told "recognised, nothing to apply".
 */
export function factsFromCharge(input: {
  accountId: bigint
  charge: TapCharge
}): ObservedFact[] {
  const { charge } = input

  const gatewayReference = text(charge.id)
  if (gatewayReference.length === 0) return []

  const factType = classifyCharge(charge.status)
  if (factType === null) return []

  const currency = text(charge.currency).toUpperCase() || undefined
  const cumulativeAmountMinor =
    currency === undefined
      ? undefined
      : (fromTapAmount(charge.amount, currency) ?? undefined)

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
      occurredAt: epoch(charge.transaction?.created),
      refs: {
        gatewayReference,
        // The charge id is also what /v2/refunds takes as `charge_id`,
        // so there is no second identifier to carry — unlike Paymob and
        // Moyasar, where the refundable id appears only after payment.
        gatewayPaymentId: gatewayReference,
      },
      // Redacted by construction: Tap's own outcome fields, never the
      // card, the payer or the raw body.
      rawRedacted: {
        tap_object: 'charge',
        status: text(charge.status),
        response_code: text(charge.response?.code) || null,
        response_message: text(charge.response?.message) || null,
        payment_method: text(charge.source?.payment_method) || null,
      },
      failureCode:
        factType === 'attempt_failed'
          ? mapTapResponseCode(charge.response?.code)
          : undefined,
    },
  ]
}

/**
 * One Tap refund → the fact it implies.
 *
 * ⚠️ `cumulativeAmountMinor` carries **this refund's** amount, not a
 * running total. Tap publishes no cumulative refunded figure: the refund
 * object reports only `amount`, and neither the charge object nor any
 * documented endpoint exposes a refunded total. Inventing one would mean
 * summing refunds we might not have seen. The same limitation, and the
 * same choice, as the Stripe adapter.
 */
export function factsFromRefund(input: {
  accountId: bigint
  refund: TapRefund
  /** The charge this refund belongs to, when the caller already knows it. */
  gatewayReference?: string
}): ObservedFact[] {
  const { refund } = input

  const gatewayReference =
    text(refund.charge_id) || text(input.gatewayReference)

  if (gatewayReference.length === 0) return []

  const factType = classifyRefund(refund.status)
  if (factType === null) return []

  const currency = text(refund.currency).toUpperCase() || undefined
  const cumulativeAmountMinor =
    currency === undefined
      ? undefined
      : (fromTapAmount(refund.amount, currency) ?? undefined)

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
      occurredAt: epoch(refund.created),
      refs: {
        gatewayReference,
        gatewayPaymentId: gatewayReference,
        // Tap's own id for this refund, so a later callback about it is
        // traceable to the call that created it.
        gatewayCaptureRef: text(refund.id) || undefined,
      },
      rawRedacted: {
        tap_object: 'refund',
        status: text(refund.status),
        refund_id: text(refund.id) || null,
        response_code: text(refund.response?.code) || null,
        response_message: text(refund.response?.message) || null,
      },
    },
  ]
}

/**
 * A posted or fetched Tap object → facts, whichever kind it is.
 *
 * An `authorize` is recognised and produces nothing on purpose: this
 * adapter never calls `POST /v2/authorize`, so no attempt in this system
 * could correspond to one, and mapping it would attach a fact to a
 * payment we did not start.
 */
export function factsFromPayload(input: {
  accountId: bigint
  payload: unknown
  gatewayReference?: string
}): ObservedFact[] {
  switch (tapObjectKind(input.payload)) {
    case 'charge':
      return factsFromCharge({
        accountId: input.accountId,
        charge: input.payload as TapCharge,
      })
    case 'refund':
      return factsFromRefund({
        accountId: input.accountId,
        refund: input.payload as TapRefund,
        gatewayReference: input.gatewayReference,
      })
    default:
      return []
  }
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

/**
 * Tap's timestamps are Unix epoch milliseconds, sometimes as a string
 * ("created": "1698392202943") and sometimes as a number.
 */
function epoch(value: unknown): Date | undefined {
  const raw = text(value).trim()
  if (!/^\d+$/.test(raw)) return undefined

  const date = new Date(Number(raw))

  return Number.isNaN(date.getTime()) ? undefined : date
}

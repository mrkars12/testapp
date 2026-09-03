import type { PaymentAttemptStatus, PaymentIntentStatus } from '@prisma/client'
import {
  deriveStatusFromAmounts,
  evaluateOrdering,
  type IntentSnapshot,
  type ObservedFact as OrderingFact,
  type StaleReason,
} from '../payment-intent.state'
import type { ObservedFactType } from '../gateways/provider.types'

/**
 * ==================================================================
 * Fact decision
 * ==================================================================
 *
 * Turns one observed fact plus the current intent into a decision.
 *
 * Pure: no Prisma, no Nest, no I/O. The applier does the writing, this
 * decides what the writing should be, and it is unit-testable on its
 * own — which matters because every ordering bug in a payment system
 * lives exactly here.
 */

export type IgnoreReason =
  | StaleReason
  | 'unsupported_fact'
  | 'amount_missing'
  /** Same cumulative amount as already recorded: a redelivery. */
  | 'already_applied'
  /** Provider reported a refund larger than the capture it belongs to. */
  | 'refund_exceeds_capture'
  /**
   * The provider settled in a different currency than the order was
   * priced in.
   *
   * Never applied, in either direction: marking an order paid because
   * 100 of *something* arrived, when it was priced at 100 of something
   * else, is a real loss the customer never agreed to. The fact is still
   * recorded (applied = false), so the merchant and reconciliation see
   * that a payment exists and can act on it — it is simply not allowed
   * to move money or the order's state on its own.
   */
  | 'currency_mismatch'

export type RefundDecision =
  | { readonly kind: 'ignore'; readonly reason: IgnoreReason }
  | {
      readonly kind: 'apply_refund'
      readonly intentStatus: PaymentIntentStatus
      readonly refundedTotalMinor: bigint
      /** Amount of the new refund row this fact adds. */
      readonly newRefundMinor: bigint
      readonly succeeded: boolean
    }

export type DisputeDecision =
  | { readonly kind: 'ignore'; readonly reason: IgnoreReason }
  | {
      readonly kind: 'apply_dispute'
      readonly disputeStatus: 'open' | 'won' | 'lost'
      readonly amountMinor: bigint
    }

export type FactDecision =
  | RefundDecision
  | DisputeDecision
  /** Stale or illegal. Record the event with applied=false, change nothing. */
  | { readonly kind: 'ignore'; readonly reason: IgnoreReason }
  /** Audit only: nothing in this phase can act on it. */
  | { readonly kind: 'record_only'; readonly note: string }
  | {
      readonly kind: 'apply'
      readonly intentStatus: PaymentIntentStatus
      readonly attemptStatus: PaymentAttemptStatus
      readonly capturedTotalMinor: bigint
      readonly refundedTotalMinor: bigint
      /** Amount of the new capture row, when this fact adds one. */
      readonly newCaptureMinor: bigint | null
      readonly terminal: boolean
    }

export interface DecisionInput {
  readonly snapshot: IntentSnapshot
  /** The intent's full amount, used to tell partial from full capture. */
  readonly amountMinor: bigint
  /**
   * The currency the order was priced in (ISO-4217, as stored).
   *
   * Together with `factCurrency` this is the currency half of the
   * "verify what the gateway actually did against what we asked for"
   * check. Optional so a caller that genuinely has neither value — a
   * unit test of ordering, an internal fact with no money on it — is
   * unaffected: the check runs only when both sides are known.
   */
  readonly currency?: string
  /** The currency the provider reported on this fact, if it reported one. */
  readonly factCurrency?: string
  readonly factType: ObservedFactType
  /** Cumulative as the provider sees it, not a delta. */
  readonly cumulativeAmountMinor?: bigint
  readonly providerSequence?: number
  readonly occurredAt?: Date
}

/**
 * Facts that only ever produce an audit record.
 *
 * `dispute_updated` and `dispute_closed` are status changes with no
 * outcome, so there is nothing to post. `settlement_line` stays here
 * because settlement is not implemented — see the stage report; acting
 * on it would require fee and matching rules this codebase does not
 * define.
 */
const AUDIT_ONLY: ReadonlySet<ObservedFactType> = new Set<ObservedFactType>([
  'dispute_updated',
  'dispute_closed',
  'settlement_line',
])

/** Dispute facts that move the ledger, and the state they put the dispute in. */
const DISPUTE_OUTCOME: Readonly<
  Partial<Record<ObservedFactType, 'open' | 'won' | 'lost'>>
> = {
  dispute_opened: 'open',
  dispute_won: 'won',
  dispute_lost: 'lost',
}

const ATTEMPT_STATUS: Readonly<
  Partial<Record<ObservedFactType, PaymentAttemptStatus>>
> = {
  attempt_authorized: 'authorized',
  attempt_captured: 'succeeded',
  attempt_failed: 'failed',
  attempt_expired: 'expired',
  attempt_voided: 'cancelled',
}

const TERMINAL_FACTS: ReadonlySet<ObservedFactType> = new Set<ObservedFactType>([
  'attempt_captured',
  'attempt_failed',
  'attempt_expired',
  'attempt_voided',
])

export function decideFact(input: DecisionInput): FactDecision {
  const { factType } = input

  // Checked before anything else money-related, and for every fact type:
  // a refund, a dispute and a capture in the wrong currency are all
  // equally not ours to act on.
  if (isCurrencyMismatch(input)) {
    return { kind: 'ignore', reason: 'currency_mismatch' }
  }

  if (AUDIT_ONLY.has(factType)) {
    return {
      kind: 'record_only',
      note: 'Disputes and settlement lines are recorded but not acted on yet.',
    }
  }

  // A refund does not move the attempt: the payment still succeeded.
  // It moves the intent's refunded total, which the caller applies.
  if (factType === 'refund_succeeded' || factType === 'refund_failed') {
    return decideRefund(input)
  }

  // A dispute moves neither the attempt nor the intent's totals: the
  // payment did happen, and the money is held or written off beside it.
  // The dispute's own row carries the state.
  const disputeStatus = DISPUTE_OUTCOME[factType]

  if (disputeStatus) {
    if (input.cumulativeAmountMinor === undefined) {
      // Holding or writing off an unknown amount is not something to
      // guess at: the ledger would take a number nobody reported.
      return { kind: 'ignore', reason: 'amount_missing' }
    }

    return {
      kind: 'apply_dispute',
      disputeStatus,
      amountMinor: input.cumulativeAmountMinor,
    }
  }

  const attemptStatus = ATTEMPT_STATUS[factType]

  if (!attemptStatus) {
    return { kind: 'ignore', reason: 'unsupported_fact' }
  }

  // A capture with no amount cannot be reconciled against the ledger, and
  // guessing would post money that nobody reported.
  if (factType === 'attempt_captured' && input.cumulativeAmountMinor === undefined) {
    return { kind: 'ignore', reason: 'amount_missing' }
  }

  const capturedTotalMinor =
    factType === 'attempt_captured'
      ? (input.cumulativeAmountMinor as bigint)
      : input.snapshot.capturedTotalMinor

  const intentStatus = candidateIntentStatus(
    factType,
    input.amountMinor,
    capturedTotalMinor,
    input.snapshot.refundedTotalMinor,
  )

  const orderingFact: OrderingFact = {
    status: intentStatus,
    // The guard's field is cumulativeCapturedMinor, not the fact's
    // cumulativeAmountMinor. Passing the wrong name silently disables the
    // monotonic-money check, so this call is deliberately untyped-cast-free.
    cumulativeCapturedMinor:
      factType === 'attempt_captured' ? capturedTotalMinor : undefined,
    providerSequence: input.providerSequence,
    occurredAt: input.occurredAt,
  }

  const verdict = evaluateOrdering(input.snapshot, orderingFact)

  if (!verdict.apply) {
    return { kind: 'ignore', reason: verdict.reason ?? 'illegal_transition' }
  }

  const newCaptureMinor =
    factType === 'attempt_captured'
      ? capturedTotalMinor - input.snapshot.capturedTotalMinor
      : null

  // Zero means the provider reported the same cumulative amount again —
  // a redelivery, not a regression. Reporting them as the same thing
  // made a duplicate webhook look like a fault.
  if (newCaptureMinor !== null && newCaptureMinor === 0n) {
    return { kind: 'ignore', reason: 'already_applied' }
  }

  if (newCaptureMinor !== null && newCaptureMinor < 0n) {
    return { kind: 'ignore', reason: 'captured_regression' }
  }

  return {
    kind: 'apply',
    intentStatus,
    attemptStatus,
    capturedTotalMinor,
    refundedTotalMinor: input.snapshot.refundedTotalMinor,
    newCaptureMinor,
    terminal: TERMINAL_FACTS.has(factType),
  }
}

/**
 * Refund facts.
 *
 * Reported cumulatively like captures, so a second partial refund and a
 * redelivery of the first are distinguished by the delta.
 */
function decideRefund(input: DecisionInput): RefundDecision {
  if (input.factType === 'refund_failed') {
    // Nothing moved. Recorded by the applier for the audit trail.
    return { kind: 'ignore', reason: 'unsupported_fact' }
  }

  if (input.cumulativeAmountMinor === undefined) {
    return { kind: 'ignore', reason: 'amount_missing' }
  }

  const refundedTotalMinor = input.cumulativeAmountMinor
  const newRefundMinor = refundedTotalMinor - input.snapshot.refundedTotalMinor

  if (newRefundMinor === 0n) {
    return { kind: 'ignore', reason: 'already_applied' }
  }

  if (newRefundMinor < 0n) {
    return { kind: 'ignore', reason: 'refunded_regression' }
  }

  // Refunding more than was captured is a provider or operator error,
  // and posting it would drive the ledger negative.
  if (refundedTotalMinor > input.snapshot.capturedTotalMinor) {
    return { kind: 'ignore', reason: 'refund_exceeds_capture' }
  }

  return {
    kind: 'apply_refund',
    intentStatus:
      refundedTotalMinor >= input.snapshot.capturedTotalMinor
        ? 'refunded'
        : 'partially_refunded',
    refundedTotalMinor,
    newRefundMinor,
    succeeded: true,
  }
}

/**
 * Whether the provider reported a currency the order was not priced in.
 *
 * Compared case-insensitively and only when both sides are present:
 * `ObservedFact.currency` is optional on the contract and several
 * adapters legitimately omit it, and an absent value is "not reported",
 * never "reported as different".
 */
function isCurrencyMismatch(input: DecisionInput): boolean {
  const expected = input.currency?.trim().toUpperCase()
  const reported = input.factCurrency?.trim().toUpperCase()

  if (!expected || !reported) return false

  return expected !== reported
}

function candidateIntentStatus(
  factType: ObservedFactType,
  amountMinor: bigint,
  capturedMinor: bigint,
  refundedMinor: bigint,
): PaymentIntentStatus {
  switch (factType) {
    case 'attempt_authorized':
      return 'authorized'
    case 'attempt_failed':
      return 'failed'
    case 'attempt_expired':
      return 'expired'
    case 'attempt_voided':
      return 'cancelled'
    case 'attempt_captured':
      return deriveStatusFromAmounts({
        amountMinor,
        capturedMinor,
        refundedMinor,
        authorized: true,
      })
    default:
      return 'processing'
  }
}
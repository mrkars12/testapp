import type { PaymentAttemptStatus, PaymentIntentStatus } from '@prisma/client'

/**
 * ==================================================================
 * PaymentIntent state machine + ordering guards
 * ==================================================================
 *
 * منطق خالص: بيتغطّى باختبارات وحدة من غير قاعدة بيانات.
 *
 * ترتيب الأحداث دلالي مش زمني. الطوابع الزمنية بتتعارض وبعض البوابات
 * مابتبعتهاش أصلاً، فالحسم بـ:
 *   1. النهائي يفوز
 *   2. المال يزيد بس
 *   3. تسلسل البوابة لو موجود، والطابع الزمني كفاصل أخير
 */

export const TERMINAL_INTENT_STATUSES: readonly PaymentIntentStatus[] = [
  'captured',
  'refunded',
  'failed',
  'cancelled',
  'expired',
]

export const TERMINAL_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  'succeeded',
  'failed',
  'expired',
  'cancelled',
]

type IntentTransitionMap = Readonly<Record<PaymentIntentStatus, readonly PaymentIntentStatus[]>>
type AttemptTransitionMap = Readonly<Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>>

const INTENT_TRANSITIONS: IntentTransitionMap = {
  created: ['requires_payment_method', 'requires_action', 'processing', 'failed', 'cancelled', 'expired'],
  requires_payment_method: ['requires_action', 'processing', 'failed', 'cancelled', 'expired'],
  requires_action: ['processing', 'authorized', 'captured', 'failed', 'cancelled', 'expired'],
  processing: ['requires_action', 'authorized', 'partially_captured', 'captured', 'failed', 'cancelled', 'expired'],
  authorized: ['partially_captured', 'captured', 'cancelled', 'expired', 'failed'],
  partially_captured: ['partially_captured', 'captured', 'partially_refunded', 'refunded'],
  captured: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  refunded: [],
  // A declined, voided or abandoned attempt does NOT end the intent's
  // ability to be paid: the payer can present another card, or pay the
  // same provider object again (Moyasar's hosted invoice explicitly
  // allows this). The only facts that may reopen one of these is money
  // actually arriving — see `evaluateOrdering`'s recovery exception,
  // which is what gates these edges. Nothing else about them changes:
  // they remain the states reconciliation and the expiry job settle on.
  failed: ['authorized', 'partially_captured', 'captured'],
  cancelled: ['authorized', 'partially_captured', 'captured'],
  expired: ['authorized', 'partially_captured', 'captured'],
}

const ATTEMPT_TRANSITIONS: AttemptTransitionMap = {
  initialized: ['requires_action', 'processing', 'authorized', 'succeeded', 'failed', 'expired', 'cancelled'],
  requires_action: ['processing', 'authorized', 'succeeded', 'failed', 'expired', 'cancelled'],
  processing: ['requires_action', 'authorized', 'succeeded', 'failed', 'expired', 'cancelled'],
  authorized: ['succeeded', 'failed', 'expired', 'cancelled'],
  succeeded: [],
  failed: [],
  expired: [],
  cancelled: [],
}

export function isTerminalIntent(status: PaymentIntentStatus): boolean {
  return TERMINAL_INTENT_STATUSES.includes(status)
}

export function isTerminalAttempt(status: PaymentAttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.includes(status)
}

export function canTransitionIntent(
  from: PaymentIntentStatus,
  to: PaymentIntentStatus,
): boolean {
  if (from === to) return true
  return INTENT_TRANSITIONS[from].includes(to)
}

export function canTransitionAttempt(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): boolean {
  if (from === to) return true
  return ATTEMPT_TRANSITIONS[from].includes(to)
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal payment state transition: ${from} -> ${to}.`)
    this.name = 'IllegalTransitionError'
    Object.setPrototypeOf(this, IllegalTransitionError.prototype)
  }
}

export function assertIntentTransition(
  from: PaymentIntentStatus,
  to: PaymentIntentStatus,
): void {
  if (!canTransitionIntent(from, to)) throw new IllegalTransitionError(from, to)
}

export function assertAttemptTransition(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): void {
  if (!canTransitionAttempt(from, to)) throw new IllegalTransitionError(from, to)
}

/**
 * الحالة الحالية للنية زي ما حراس الترتيب بيشوفوها
 */
export interface IntentSnapshot {
  readonly status: PaymentIntentStatus
  readonly capturedTotalMinor: bigint
  readonly refundedTotalMinor: bigint
}

/**
 * حقيقة واصلة من بوابة، مهما كانت وسيلة النقل
 * (webhook / مطابقة دورية / رجوع العميل)
 */
export interface ObservedFact {
  readonly status: PaymentIntentStatus
  /** المبلغ المُحصَّل التراكمي زي ما البوابة شايفاه */
  readonly cumulativeCapturedMinor?: bigint
  readonly cumulativeRefundedMinor?: bigint
  readonly providerSequence?: number
  readonly occurredAt?: Date
}

export type StaleReason =
  | 'terminal_state'
  | 'captured_regression'
  | 'refunded_regression'
  | 'illegal_transition'

export interface OrderingVerdict {
  readonly apply: boolean
  readonly reason?: StaleReason
}

/**
 * يقرر لو الحقيقة دي تتطبّق ولا اتخطاها الزمن.
 *
 * "المال يزيد بس" أقوى إشارة ترتيب عندنا ومش محتاجة ساعة: حدث بيدّعي
 * مبلغ تراكمي أقل من الحالي هو قديم بحكم التعريف.
 */
export function evaluateOrdering(
  current: IntentSnapshot,
  fact: ObservedFact,
): OrderingVerdict {
  if (isTerminalIntent(current.status) && current.status !== fact.status) {
    // استثناء: حالة نهائية تقدر تروح لاسترداد بس
    const refundContinuation =
      (current.status === 'captured' &&
        (fact.status === 'partially_refunded' || fact.status === 'refunded')) ||
      (current.status === 'refunded' && fact.status === 'refunded')

    /*
     * The recovery exception.
     *
     * A declined attempt used to make the intent permanently terminal,
     * so a *later, genuinely successful* payment for the same order was
     * refused here with `terminal_state` — the provider had the money and
     * this system had no order. Observed against the real Moyasar test
     * account: attempt declined at 18:56:03, the payer paid again on the
     * same invoice at 18:56:24, and the capture was recorded
     * `applied = false, superseded_reason = terminal_state`.
     *
     * "المال يزيد بس" is this file's strongest ordering signal and it
     * settles the case: a capture or an authorisation strictly increases
     * secured money, so it cannot be the stale event. A decline carries
     * no money at all and therefore cannot outrank one.
     *
     * Deliberately one-directional and deliberately narrow:
     *   • only OUT of the unfunded terminal states (failed / cancelled /
     *     expired) — `captured` and `refunded` are untouched, so a late
     *     failure can still never unpay a paid order;
     *   • only INTO a state that secured funds. A second decline on a
     *     failed intent changes nothing and is still ignored.
     */
    const recovery =
      (current.status === 'failed' ||
        current.status === 'cancelled' ||
        current.status === 'expired') &&
      (fact.status === 'authorized' ||
        fact.status === 'partially_captured' ||
        fact.status === 'captured')

    if (!refundContinuation && !recovery) {
      return { apply: false, reason: 'terminal_state' }
    }
  }

  if (
    fact.cumulativeCapturedMinor !== undefined &&
    fact.cumulativeCapturedMinor < current.capturedTotalMinor
  ) {
    return { apply: false, reason: 'captured_regression' }
  }

  if (
    fact.cumulativeRefundedMinor !== undefined &&
    fact.cumulativeRefundedMinor < current.refundedTotalMinor
  ) {
    return { apply: false, reason: 'refunded_regression' }
  }

  if (!canTransitionIntent(current.status, fact.status)) {
    return { apply: false, reason: 'illegal_transition' }
  }

  return { apply: true }
}

/**
 * الحالة المشتقة من المبالغ.
 * المصدر الوحيد لتسمية حالة التحصيل.
 */
export function deriveStatusFromAmounts(params: {
  amountMinor: bigint
  capturedMinor: bigint
  refundedMinor: bigint
  authorized: boolean
}): PaymentIntentStatus {
  const { amountMinor, capturedMinor, refundedMinor, authorized } = params

  if (refundedMinor > 0n) {
    return refundedMinor >= capturedMinor ? 'refunded' : 'partially_refunded'
  }

  if (capturedMinor > 0n) {
    return capturedMinor >= amountMinor ? 'captured' : 'partially_captured'
  }

  return authorized ? 'authorized' : 'processing'
}
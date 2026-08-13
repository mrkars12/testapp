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
  failed: [],
  cancelled: [],
  expired: [],
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

    if (!refundContinuation) {
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
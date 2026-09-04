/* ══════════════════════════════════════════════════════════════════════
   Why a retry could not be started, and what the customer can do next.

   A retry that fails is not "an error page". The customer is standing in
   front of a declined payment they still want to make, and the only
   thing that matters is which of three things is now true:

     retry            — nothing about this checkout is wrong; the attempt
                        to create the next one did not land. Ask again.
     change_method    — the method they chose cannot be used any more.
                        The retry button is useless; the chooser is not.
     restart_checkout — the priced snapshot itself is no longer valid
                        (expired, or it no longer matches what the server
                        would charge). A new checkout is the honest next
                        step, and it must be presented as that rather
                        than as a mysterious failure.

   Collapsing all three into one generic message is what turns a
   recoverable decline into a dead end — the customer presses the same
   button again and again because nothing told them it could not work.

   The classification is deliberately conservative: anything unrecognised
   is `retry`, because leaving a working retry on offer costs nothing
   (the server is idempotent and re-prices from scratch) while wrongly
   telling someone to start over loses a sale.
   ══════════════════════════════════════════════════════════════════════ */

import { normalizePaymentError } from '../paymentErrors'

export type RetryFailureAction = 'retry' | 'change_method' | 'restart_checkout'

export interface RetryFailure {
  action: RetryFailureAction
  /** Arabic, customer-facing. Never a provider payload. */
  message: string
  /** The classifier's own reason, for tests and for the report. */
  kind: string
}

/** Error codes the backend already publishes that name the METHOD. */
const METHOD_CODES = new Set([
  'method_unavailable',
  'currency_unsupported',
  'amount_limit',
  'configuration_error',
  'mode_mismatch',
])

/**
 * Message fragments the checkout service raises as 400s.
 *
 * Matched on the server's own English text because these are
 * `BadRequestException`s with no code attached — see
 * `backend/src/stores/checkout/checkout.service.ts`. Fragment matching is
 * fragile by nature, so it only ever REFINES the action; an unmatched
 * 400 still lands on a safe default rather than on a guess.
 */
const METHOD_FRAGMENTS = [
  'payment method is not available',
  'payment method is not',
]
const SNAPSHOT_FRAGMENTS = [
  'not enough stock',
  'is unavailable',
  'cart total must be',
  'expired',
]

export function classifyRetryFailure(input: {
  /** HTTP status, or null when the request never got one (network). */
  status: number | null
  /** The parsed response body, when there was one. */
  body?: unknown
  /** The thrown error, when the request itself failed. */
  error?: unknown
}): RetryFailure {
  const { status, body, error } = input

  // No status at all: the request never completed. Nothing is known to
  // be wrong with the checkout, so the retry stays exactly as it was.
  if (status === null) {
    return {
      action: 'retry',
      kind: 'network',
      message: 'تعذّر الاتصال. تحقّق من اتصالك ثم حاول مرة أخرى.',
    }
  }

  const raw = (body ?? {}) as Record<string, unknown>
  const code = String(raw.code ?? raw.error_code ?? '').toLowerCase()
  const text = String(raw.message ?? raw.msg ?? '').toLowerCase()

  if (code && METHOD_CODES.has(code)) {
    return {
      action: 'change_method',
      kind: code,
      message: normalizePaymentError(raw),
    }
  }

  // The same request is already in flight (a second tab, a resend). Not
  // an error and not a reason to start anything: wait and ask again.
  if (status === 409) {
    return {
      action: 'retry',
      kind: 'in_flight',
      message: 'هذا الطلب قيد المعالجة بالفعل — انتظر لحظة من فضلك.',
    }
  }

  if (status === 404 || status === 410) {
    return {
      action: 'restart_checkout',
      kind: 'checkout_gone',
      message:
        'انتهت صلاحية عملية الدفع السابقة. ابدأ عملية دفع جديدة بنفس السلة.',
    }
  }

  if (status === 400 || status === 422) {
    if (METHOD_FRAGMENTS.some((fragment) => text.includes(fragment))) {
      return {
        action: 'change_method',
        kind: 'offering_unavailable',
        message: 'طريقة الدفع السابقة لم تعد متاحة. اختر طريقة دفع أخرى للمتابعة.',
      }
    }
    if (SNAPSHOT_FRAGMENTS.some((fragment) => text.includes(fragment))) {
      return {
        action: 'restart_checkout',
        kind: 'snapshot_invalid',
        message:
          'تغيّرت السلة أو لم تعد المنتجات متاحة بنفس الكمية. راجع سلتك ثم ابدأ عملية دفع جديدة.',
      }
    }
    // A validated 400 with nothing recognisable in it. The customer is
    // told what the server said, not a guess about what it meant.
    return {
      action: 'change_method',
      kind: 'rejected',
      message: normalizePaymentError(raw),
    }
  }

  if (status >= 500) {
    return {
      action: 'retry',
      kind: 'server_error',
      message: 'تعذّر تجهيز الدفع مؤقتاً. حاول مرة أخرى بعد لحظات.',
    }
  }

  return {
    action: 'retry',
    kind: 'unknown',
    message: normalizePaymentError(error ?? raw),
  }
}

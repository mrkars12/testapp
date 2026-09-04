/* ══════════════════════════════════════════════════════════════════════
   The checkout payment phase — ONE state machine for every gateway.

   Replaces the old arrangement, in which the outcome of a payment was
   decided by which of two pages happened to be mounted in which of two
   tabs. There is one surface now (the checkout), and this is the only
   thing that says what it is currently doing.

   The phases are the checkout's own; the *outcome* is not. PAID, FAILED,
   PENDING and CANCELLED are only ever entered from a `PaymentState` the
   server produced (lib/payments/state.ts) — never from a provider's
   query parameter, never from elapsed time, and never from the browser.
   ══════════════════════════════════════════════════════════════════════ */

import { isTerminalState, type PaymentState } from './state'

export type CheckoutPhase =
  /** Nothing started; the form is editable. */
  | 'IDLE'
  /** POST /checkout is in flight. */
  | 'CREATING_PAYMENT'
  /**
   * A retry is being prepared: the settled attempt has been released and
   * the replacement checkout is being created, but nothing is on screen
   * that the customer has to do anything with.
   *
   * Distinct from CREATING_PAYMENT, which is the SAME request made from
   * the form the customer is standing in front of. There the form stays
   * mounted with a spinner on its button, which is right — they just
   * pressed Place order on it. A retry has no such context: the customer
   * pressed "المحاولة مرة أخرى" on a failure panel, and re-rendering the
   * whole data-entry screen underneath the request reads as "start
   * over" for what is really "present another card".
   */
  | 'RETRY_PREPARING'
  /** The provider's own payment UI is mounted in this page. */
  | 'PROVIDER_UI'
  /** The provider produced a payment; the server is being told about it. */
  | 'PROVIDER_CONFIRMATION'
  /** This tab is being handed to the provider. */
  | 'REDIRECTING'
  /** The page just loaded carrying a checkout token from a return. */
  | 'RETURNING'
  /** Asking the server what actually happened. */
  | 'VERIFYING'
  /** Server says funds are secured. */
  | 'PAID'
  /** Server says the payment did not succeed. */
  | 'FAILED'
  /** Server says the payer abandoned it (or it expired unpaid). */
  | 'CANCELLED'
  /** Server has no terminal answer yet; it is still converging. */
  | 'PENDING'

/** Phases in which the checkout form must not accept another submission. */
const BUSY_PHASES: readonly CheckoutPhase[] = [
  'CREATING_PAYMENT',
  'RETRY_PREPARING',
  'PROVIDER_UI',
  'PROVIDER_CONFIRMATION',
  'REDIRECTING',
  'RETURNING',
  'VERIFYING',
  'PENDING',
]

/** Phases from which the payment can no longer change on its own. */
const SETTLED_PHASES: readonly CheckoutPhase[] = ['PAID', 'FAILED', 'CANCELLED']

export function isBusyPhase(phase: CheckoutPhase): boolean {
  return BUSY_PHASES.includes(phase)
}

export function isSettledPhase(phase: CheckoutPhase): boolean {
  return SETTLED_PHASES.includes(phase)
}

/**
 * Whether the checkout form itself should still be shown and editable.
 *
 * CREATING_PAYMENT keeps it: the customer pressed Place order on that
 * form and it stays under them, with a spinner on its own button.
 * RETRY_PREPARING deliberately does not — see the phase's own note.
 */
export function showsForm(phase: CheckoutPhase): boolean {
  return phase === 'IDLE' || phase === 'CREATING_PAYMENT'
}

/**
 * Whether a retry is offered.
 *
 * Only from a *settled, unsuccessful* phase. Offering it while a payment
 * is still converging is how a customer ends up paying twice: the first
 * attempt had not failed, it had simply not answered yet.
 */
export function canRetry(phase: CheckoutPhase, stalled = false): boolean {
  if (phase === 'FAILED' || phase === 'CANCELLED') return true

  /*
   * The bounded-processing escape hatch.
   *
   * `stalled` is set by exactly one thing: the poll exhausting its budget
   * without the server ever reaching a terminal state (see poll.ts's
   * `onExhausted`). It is not elapsed time, not a guess, and not a
   * provider query parameter — it is "we asked as long as we agreed to
   * ask and the answer never came".
   *
   * Before this, that left the customer on "جارٍ معالجة الدفع" with no
   * action at all. It is reachable in production: an embedded payment
   * whose payer abandons the 3DS challenge sits at Moyasar's `initiated`
   * forever, and Moyasar publishes no webhook for a payment nobody
   * finished — so nothing will ever arrive to settle it, and the
   * checkout's own 30-minute expiry is the only thing that ends it.
   *
   * Retrying from here is safe rather than duplicative: retry starts a
   * NEW checkout and a NEW intent (CheckoutService.createAndCommit), the
   * abandoned one expires on its own, and if the original payment does
   * land after all it settles its own intent without touching this one.
   */
  return stalled && !isSettledPhase(phase) && phase !== 'PAID'
}

/**
 * Whether the CART may be edited again while this phase is on screen.
 *
 * A payment that is over is not a payment: the customer is standing in
 * front of a decline they still want to fix, and the most ordinary fix
 * there is — buy one more, drop a line — was the one thing the checkout
 * refused. So the two settled UNSUCCESSFUL phases hand the cart back.
 *
 * It is deliberately keyed on the phase and nothing else, so the only
 * way in is a terminal state the SERVER produced. `PENDING` is not here
 * and must never be: an unresolved payment (processing, requires_action,
 * or a status this frontend does not recognise, all of which normalise
 * to PENDING) can still take the money, and its amount must not move
 * underneath it. `PAID` is not here either — that cart is already gone.
 *
 * Editing after this does NOT reuse anything: the next payment is a new
 * checkout the server prices from the cart as it then stands.
 */
export function allowsCartEditing(phase: CheckoutPhase): boolean {
  return phase === 'FAILED' || phase === 'CANCELLED'
}

/**
 * Maps the server's normalized payment state onto a checkout phase.
 *
 * `EXPIRED` reads as CANCELLED rather than FAILED on purpose: nothing was
 * declined, the customer simply never completed it, and the honest
 * message and the honest next step ("try again") are the cancelled ones.
 * `REQUIRES_ACTION` is not terminal — the customer still has something to
 * do at the provider — so it stays PENDING.
 */
export function phaseForPaymentState(state: PaymentState): CheckoutPhase {
  switch (state) {
    case 'SUCCESS':
      return 'PAID'
    case 'FAILED':
      return 'FAILED'
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELLED'
    case 'PROCESSING':
    case 'REQUIRES_ACTION':
    default:
      return 'PENDING'
  }
}

/**
 * Applies an authoritative server state to the current phase.
 *
 * A settled phase is never re-opened by a later non-terminal reading: a
 * paid checkout does not become "pending" because a straggling poll
 * response arrived from before the webhook landed.
 */
export function applyServerState(
  phase: CheckoutPhase,
  state: PaymentState | null,
): CheckoutPhase {
  if (!state) return phase === 'RETURNING' ? 'VERIFYING' : phase
  if (isSettledPhase(phase)) return phase
  return phaseForPaymentState(state)
}

/**
 * Applies a server state that arrived from RECONCILIATION rather than
 * from the payment's own progress.
 *
 * Reconciliation runs on focus, on `visibilitychange`, on `pageshow` and
 * on a cross-tab ping — all of which are things the *browser* did, not
 * things the payment did. That is fine as a trigger and wrong as an
 * authority, and the difference matters in exactly one phase.
 *
 * While PROVIDER_UI is on screen the provider's own form is mounted and
 * driving: it may be showing card fields, an STC Pay OTP modal, or an
 * Apple Pay sheet, and it holds state we cannot recreate. The intent
 * behind it has read `processing` since the moment the form was
 * PREPARED, so any reading at all maps to a non-terminal phase — which
 * would both unmount a live form mid-payment and put the page into
 * "جارٍ التحقق" for a payment nobody made. So a non-terminal reading is
 * ignored here, and only a terminal one — the payment settled, most
 * often in another tab — is allowed to take the form away.
 *
 * Everywhere else this is `applyServerState` unchanged: the server stays
 * authoritative and a real payment's reconciliation is untouched.
 */
export function applyReconciledState(
  phase: CheckoutPhase,
  state: PaymentState | null,
): CheckoutPhase {
  if (phase === 'PROVIDER_UI' && !isTerminalState(state)) return phase
  return applyServerState(phase, state)
}

/** Arabic status copy. One place, so no two surfaces disagree. */
export const PHASE_HEADLINE: Readonly<Record<CheckoutPhase, string>> = {
  IDLE: '',
  CREATING_PAYMENT: 'جارٍ تجهيز عملية الدفع…',
  // Preparation, NOT confirmation. Nothing has been submitted and there
  // is nothing to verify: saying "جارٍ تأكيد الدفع" here would announce a
  // payment the customer has not made yet.
  RETRY_PREPARING: 'جارٍ تجهيز الدفع…',
  PROVIDER_UI: 'أدخل بيانات البطاقة',
  PROVIDER_CONFIRMATION: 'جارٍ تأكيد الدفع…',
  REDIRECTING: 'جارٍ تحويلك إلى صفحة الدفع الآمنة…',
  RETURNING: 'جارٍ التحقق من نتيجة الدفع…',
  VERIFYING: 'جارٍ التحقق من نتيجة الدفع…',
  PAID: 'تم الدفع بنجاح',
  FAILED: 'لم تتم عملية الدفع',
  CANCELLED: 'تم إلغاء عملية الدفع',
  PENDING: 'جارٍ معالجة الدفع',
}

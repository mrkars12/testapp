/* ══════════════════════════════════════════════════════════════════════
   Normalized payment state — the ONLY vocabulary the payment UI renders.

   The backend's `PaymentIntentStatus` enum (backend/prisma/schema.prisma)
   has twelve values, several of which mean the same thing to a customer
   waiting on a page, and none of which should be rendered directly: a
   customer never needs to know the difference between `created` and
   `requires_payment_method`, and showing a raw enum name is how provider
   vocabulary leaks into a storefront.

   Everything the UI branches on comes from `normalizePaymentStatus()`.
   ══════════════════════════════════════════════════════════════════════ */

export type PaymentState =
  | 'PROCESSING'
  | 'REQUIRES_ACTION'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

/**
 * Funds are secured. `authorized` counts: the money is committed even
 * though capture hasn't settled, which is exactly the point at which the
 * backend creates an Order (see PaymentFactApplier — it only does so on
 * attempt_authorized/attempt_captured), so treating it as anything less
 * would leave a real, paid order rendering as "still pending".
 */
const SUCCESS_STATUSES = [
  'authorized',
  'captured',
  'partially_captured',
  // Post-success states: a refund does not retroactively make the
  // original payment a failure, and this screen is about the payment.
  'refunded',
  'partially_refunded',
]

const FAILED_STATUSES = ['failed']
const CANCELLED_STATUSES = ['cancelled']
const EXPIRED_STATUSES = ['expired']

/** The customer still has something to do (3DS, entering card details). */
const REQUIRES_ACTION_STATUSES = ['requires_action', 'requires_payment_method']

/**
 * States from which no further backend change is expected. Polling stops
 * here — and ONLY here. Nothing else (elapsed time, a closed gateway tab,
 * a provider query parameter) may end a poll.
 */
export const TERMINAL_STATES: readonly PaymentState[] = [
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]

export function isTerminalState(state: PaymentState | null): boolean {
  return !!state && TERMINAL_STATES.includes(state)
}

/**
 * Maps a raw backend `PaymentIntentStatus` onto the normalized model.
 *
 * An unrecognized value maps to `PROCESSING`, never to a terminal state:
 * if the backend ever grows a status this frontend doesn't know, the
 * failure mode is "keep waiting and keep asking", not "declare an outcome
 * we didn't understand".
 */
export function normalizePaymentStatus(status: string | null | undefined): PaymentState | null {
  if (!status) return null
  const s = String(status).toLowerCase()
  if (SUCCESS_STATUSES.includes(s)) return 'SUCCESS'
  if (FAILED_STATUSES.includes(s)) return 'FAILED'
  if (CANCELLED_STATUSES.includes(s)) return 'CANCELLED'
  if (EXPIRED_STATUSES.includes(s)) return 'EXPIRED'
  if (REQUIRES_ACTION_STATUSES.includes(s)) return 'REQUIRES_ACTION'
  return 'PROCESSING'
}

/**
 * The Order's own payment status (`UNPAID | PAID | REFUNDED | FAILED`),
 * which is a different field from the intent's. Where both exist the
 * Order is the stronger signal for a *completed* checkout, because an
 * Order only exists at all once funds were secured.
 */
export function normalizeOrderPaymentStatus(
  status: string | null | undefined,
): PaymentState | null {
  if (!status) return null
  switch (String(status).toUpperCase()) {
    case 'PAID':
    case 'REFUNDED':
      return 'SUCCESS'
    case 'FAILED':
      return 'FAILED'
    case 'UNPAID':
      return 'PROCESSING'
    default:
      return null
  }
}

/**
 * The latest ATTEMPT's own status, which answers a different question
 * from the intent's.
 *
 * The intent says whether the order can still be paid; the attempt says
 * what happened to the try the customer just made. Since a declined card
 * deliberately leaves the intent open (so the payer can present another
 * one), the attempt is the only thing that can tell this page "that try
 * is over, offer a retry" instead of spinning forever.
 *
 * Only the terminal attempt statuses are mapped. A non-terminal one
 * (`initialized`, `requires_action`, `processing`) is genuinely still in
 * flight and must not end a poll.
 */
export function normalizeAttemptStatus(
  status: string | null | undefined,
): PaymentState | null {
  if (!status) return null
  switch (String(status).toLowerCase()) {
    case 'succeeded':
      return 'SUCCESS'
    case 'failed':
      return 'FAILED'
    case 'cancelled':
      return 'CANCELLED'
    case 'expired':
      return 'EXPIRED'
    default:
      return null
  }
}

/**
 * Resolves the one state to render from everything the status endpoint
 * returned.
 *
 * The existence of an Order is itself evidence of success — no gateway
 * creates one for a payment that never secured funds — so an Order that
 * is not explicitly FAILED outranks an intent status that hasn't caught
 * up yet. This is what stops a paid checkout from rendering "processing"
 * purely because the intent row lags the order row by a beat.
 */
export function resolvePaymentState(input: {
  intentStatus?: string | null
  orderPaymentStatus?: string | null
  attemptStatus?: string | null
  hasOrder?: boolean
}): PaymentState | null {
  // 1. The Order's own explicit verdict is the strongest signal there is.
  const fromOrder = normalizeOrderPaymentStatus(input.orderPaymentStatus)
  if (fromOrder === 'SUCCESS' || fromOrder === 'FAILED') return fromOrder

  const fromIntent = normalizePaymentStatus(input.intentStatus)

  // 2. A terminal intent status settles it — including a failure that
  //    arrived alongside an order row.
  if (fromIntent && isTerminalState(fromIntent)) return fromIntent

  // 3. The intent is still open, but the attempt the customer just made
  //    is over. Since the recovery rule (backend payment-intent.state.ts)
  //    keeps an intent payable after a decline, this is the ONLY signal
  //    that distinguishes "declined, try again" from "still waiting on
  //    the bank" — without it a failed card renders as a permanent
  //    "جارٍ معالجة الدفع" with no way out.
  //
  //    Deliberately below the Order and the terminal-intent checks: a
  //    secured payment always outranks an earlier attempt's failure, so a
  //    stale attempt row can never unpay a paid checkout.
  const fromAttempt = normalizeAttemptStatus(input.attemptStatus)
  if (fromAttempt && fromAttempt !== 'SUCCESS' && !input.hasOrder) {
    return fromAttempt
  }

  // 4. An Order exists and nothing terminal contradicts it. No gateway
  //    creates an Order for a payment that never secured funds, so the
  //    row's mere existence IS the success evidence — this must outrank a
  //    non-terminal or unrecognized intent status, otherwise a paid
  //    checkout renders as "processing" forever purely because the intent
  //    row lags the order row, or because the backend grew a status value
  //    this frontend hasn't been taught yet.
  if (input.hasOrder) return 'SUCCESS'

  // 5. Still genuinely in flight.
  return fromIntent
}

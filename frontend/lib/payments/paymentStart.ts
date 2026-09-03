/* ══════════════════════════════════════════════════════════════════════
   What "the customer submitted a payment" actually means.

   The checkout has one hard invariant and this file is where it is
   written down:

       MOUNTING A FORM IS NOT SUBMITTING A PAYMENT.

   Nor is typing into one, nor changing tabs, nor coming back from one,
   nor a `pageshow` after a bfcache restore, nor a cross-tab ping, nor a
   refresh, nor a React re-render. Every one of those had, at some point,
   the same effect as a real payment: the page asked the server what had
   happened, the server answered with the intent it had created when the
   form was PREPARED, and the checkout put itself into "جارٍ التحقق" for
   a payment that did not exist.

   The fix is not to stop reconciling — reconciliation is what makes a
   real payment survive a closed tab, a dropped webhook or a 3DS detour,
   and it must not be weakened. The fix is to reconcile only when there
   is something to reconcile, and to be explicit about the three things
   that can prove there is.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Everything the checkout knows about whether a payment was submitted.
 *
 * Three independent witnesses, because each covers a case the others
 * cannot see, and any one of them is enough.
 */
export interface PaymentAttemptEvidence {
  /**
   * The provider's own form told us the payer pressed Pay.
   *
   * Moyasar Form calls `on_initiating` with the source it is about to
   * charge, immediately before it creates the payment — read out of the
   * pinned bundle, where the card, Apple Pay and STC Pay submit paths
   * all go through it. It is the earliest honest signal there is, and
   * the only one available during the window between the press and the
   * provider object existing.
   *
   * Local to this tab, so it is a witness and never a requirement.
   */
  readonly submittedHere: boolean
  /**
   * A provider payment id came back on the return URL.
   *
   * Only a completed provider round trip produces one, so its presence
   * is proof a payment was made — of nothing about its outcome, which
   * the server decides.
   */
  readonly providerPaymentRef: string | null
  /**
   * The server's own answer (`payment_attempt_started`).
   *
   * `null` means "not asked yet, or an older backend that does not
   * publish it". Deliberately NOT read as "no": a deployment where the
   * field is missing must keep the reconciliation every redirect flow
   * already depends on, so an unknown answer falls back to the previous
   * behaviour rather than silently switching it off.
   */
  readonly serverStarted: boolean | null
}

/**
 * Whether there is a real payment attempt worth asking the server about.
 *
 * The two local witnesses are checked first because they are the ones
 * that can be true while the server still says no — the payer pressed
 * Pay a moment ago and the provider has not told anyone yet.
 */
export function hasRealPaymentAttempt(evidence: PaymentAttemptEvidence): boolean {
  if (evidence.submittedHere) return true
  if (evidence.providerPaymentRef) return true
  // Unknown means an older backend; keep reconciling, as before.
  return evidence.serverStarted !== false
}

/**
 * Reads the server's verdict off a checkout status response.
 *
 * Strictly boolean-or-null: anything else (absent, a string, a number
 * from a proxy that mangled the JSON) is "unknown", never "no".
 */
export function readServerAttemptStarted(
  status: { payment_attempt_started?: unknown } | null | undefined,
): boolean | null {
  const value = status?.payment_attempt_started
  return typeof value === 'boolean' ? value : null
}

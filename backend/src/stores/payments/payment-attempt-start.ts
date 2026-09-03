/* ══════════════════════════════════════════════════════════════════════
   "Has the payer actually submitted a payment?"

   One question, one answer, one place — because the whole checkout
   lifecycle hangs off it and it is not the same question as "does a
   PaymentAttempt row exist".

   A row exists as soon as a checkout is committed. For every surface
   that hands the payer to the provider (a redirect, an offline
   instruction, a synchronous charge) that is also the moment the payment
   was submitted: a provider object exists, or money has already moved,
   and reconciling is right.

   The embedded surface is the exception, and it is the reason this file
   exists. `client_sdk` means the provider's own form is mounted inside
   OUR page and creates the payment itself, in the browser, when the
   payer presses Pay — see MoyasarAdapter.prepareEmbeddedPayment, which
   deliberately returns no gateway reference because there is no provider
   object yet. Between committing the checkout and that press there is an
   attempt row, an intent in `processing`, and nothing whatsoever having
   happened. Treating that as a payment in flight is what put a checkout
   into "verifying" because the customer opened a form and changed tabs.

   So the signal is the binding, not the row: an embedded attempt has
   started once a provider payment id is bound to it (by the storefront's
   confirm call or by a webhook), or once its status has moved somewhere
   only a real observed fact can put it.
   ══════════════════════════════════════════════════════════════════════ */

import type { NextActionKind, PaymentAttemptStatus } from '@prisma/client';

/** Exactly the attempt fields the question needs. Nothing else. */
export interface AttemptStartFields {
  readonly status: PaymentAttemptStatus;
  readonly next_action_kind: NextActionKind;
  readonly gateway_reference: string | null;
  readonly gateway_payment_id: string | null;
}

/**
 * Statuses an attempt can hold without the payer having done anything.
 *
 * `initialized` is the row's default; `requires_action` is what
 * CheckoutService stamps for every `requires_action` adapter result,
 * embedded ones included — it means "the payer still has something to
 * do", which is precisely the state before a submission, not after one.
 *
 * Everything else (`processing`, `authorized`, `succeeded`, `failed`,
 * `expired`, `cancelled`) is only ever written by the fact applier from
 * something a provider actually reported, so reaching one of them is
 * itself proof that a payment was submitted.
 */
const UNSUBMITTED_STATUSES: readonly PaymentAttemptStatus[] = [
  'initialized',
  'requires_action',
];

/**
 * True when this attempt is still waiting for the payer to submit —
 * i.e. reconciling it would be reconciling nothing.
 *
 * Deliberately conservative: it returns false (=> "treat as started")
 * for every surface except the embedded one, so no existing redirect,
 * offline or synchronous flow loses its reconciliation.
 */
export function attemptAwaitsSubmission(attempt: AttemptStartFields): boolean {
  // Only the provider's in-page form can exist without a submission.
  if (attempt.next_action_kind !== 'client_sdk') return false;

  // A bound provider payment is a submission that already happened —
  // the confirm endpoint or a webhook put it there.
  if (attempt.gateway_reference !== null) return false;
  if (attempt.gateway_payment_id !== null) return false;

  return UNSUBMITTED_STATUSES.includes(attempt.status);
}

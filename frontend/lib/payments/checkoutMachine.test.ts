import { describe, it, expect } from 'vitest'
import {
  allowsCartEditing,
  applyReconciledState,
  applyServerState,
  canRetry,
  isBusyPhase,
  isSettledPhase,
  phaseForPaymentState,
  showsForm,
  type CheckoutPhase,
} from './checkoutMachine'

describe('phaseForPaymentState — only the server decides an outcome', () => {
  it('maps secured funds to paid', () => {
    expect(phaseForPaymentState('SUCCESS')).toBe('PAID')
  })

  it('maps a decline to failed', () => {
    expect(phaseForPaymentState('FAILED')).toBe('FAILED')
  })

  it('keeps cancellation distinct from failure', () => {
    // Nothing was declined; the customer walked away. The honest message
    // and the honest next step are different.
    expect(phaseForPaymentState('CANCELLED')).toBe('CANCELLED')
    expect(phaseForPaymentState('EXPIRED')).toBe('CANCELLED')
  })

  it('keeps a non-terminal state pending rather than concluding', () => {
    expect(phaseForPaymentState('PROCESSING')).toBe('PENDING')
    expect(phaseForPaymentState('REQUIRES_ACTION')).toBe('PENDING')
  })
})

describe('applyServerState', () => {
  it('moves a returning checkout into verifying when nothing is known yet', () => {
    expect(applyServerState('RETURNING', null)).toBe('VERIFYING')
  })

  it('leaves a phase untouched when the state could not be read', () => {
    expect(applyServerState('PENDING', null)).toBe('PENDING')
    expect(applyServerState('REDIRECTING', null)).toBe('REDIRECTING')
  })

  it('never re-opens a settled payment with a stale reading', () => {
    // A poll response from before the webhook landed must not turn a paid
    // checkout back into "processing".
    expect(applyServerState('PAID', 'PROCESSING')).toBe('PAID')
    expect(applyServerState('FAILED', 'PROCESSING')).toBe('FAILED')
    expect(applyServerState('CANCELLED', 'PROCESSING')).toBe('CANCELLED')
  })

  it('settles a pending checkout when the server answers', () => {
    expect(applyServerState('PENDING', 'SUCCESS')).toBe('PAID')
    expect(applyServerState('VERIFYING', 'FAILED')).toBe('FAILED')
    expect(applyServerState('RETURNING', 'CANCELLED')).toBe('CANCELLED')
  })
})

describe('what the checkout will let the customer do', () => {
  it('shows the editable form only before a payment has started', () => {
    expect(showsForm('IDLE')).toBe(true)
    expect(showsForm('CREATING_PAYMENT')).toBe(true)
    for (const phase of ['REDIRECTING', 'RETURNING', 'VERIFYING', 'PENDING', 'PAID', 'FAILED', 'CANCELLED'] as CheckoutPhase[]) {
      expect(showsForm(phase)).toBe(false)
    }
  })

  it('blocks another submission for the whole time a payment is live', () => {
    for (const phase of ['CREATING_PAYMENT', 'REDIRECTING', 'RETURNING', 'VERIFYING', 'PENDING'] as CheckoutPhase[]) {
      expect(isBusyPhase(phase)).toBe(true)
    }
    expect(isBusyPhase('IDLE')).toBe(false)
  })

  it('offers retry only from a settled, unsuccessful payment', () => {
    expect(canRetry('FAILED')).toBe(true)
    expect(canRetry('CANCELLED')).toBe(true)
    // Retrying a payment that simply has not answered yet is how a
    // customer ends up paying twice.
    expect(canRetry('PENDING')).toBe(false)
    expect(canRetry('VERIFYING')).toBe(false)
    expect(canRetry('PAID')).toBe(false)
  })

  it('treats exactly the three outcomes as settled', () => {
    expect(isSettledPhase('PAID')).toBe(true)
    expect(isSettledPhase('FAILED')).toBe(true)
    expect(isSettledPhase('CANCELLED')).toBe(true)
    expect(isSettledPhase('PENDING')).toBe(false)
  })
})

/* ══════════════════════════════════════════════════════════════════════
   Bounded processing.

   PENDING must not be a dead end. An embedded payment whose payer
   abandons the 3DS challenge stays `initiated` at Moyasar forever and
   Moyasar publishes no webhook for it, so nothing will ever arrive to
   settle that checkout — and before this, the customer was left on
   "جارٍ معالجة الدفع" with no action available at all.

   The escape is gated on `stalled`, which is set by exactly one thing:
   the poll exhausting its agreed budget without a terminal answer. Never
   on elapsed time, a closed tab, or a provider query parameter.
   ══════════════════════════════════════════════════════════════════════ */
describe('retry from a stalled wait', () => {
  it('is not offered while the poll is still asking', () => {
    expect(canRetry('PENDING', false)).toBe(false)
    expect(canRetry('VERIFYING', false)).toBe(false)
    expect(canRetry('RETURNING', false)).toBe(false)
  })

  it('is offered once the poll has given up', () => {
    expect(canRetry('PENDING', true)).toBe(true)
    expect(canRetry('VERIFYING', true)).toBe(true)
    expect(canRetry('RETURNING', true)).toBe(true)
  })

  it('is never offered on a paid checkout, stalled or not', () => {
    expect(canRetry('PAID', false)).toBe(false)
    expect(canRetry('PAID', true)).toBe(false)
  })

  it('stays available from a settled failure regardless of the poll', () => {
    expect(canRetry('FAILED', false)).toBe(true)
    expect(canRetry('CANCELLED', false)).toBe(true)
  })
})

describe('applyReconciledState — a browser event is not a payment', () => {
  it('leaves a mounted provider form exactly where it is', () => {
    // The intent behind an embedded form has read `processing` since the
    // form was PREPARED, so every reading maps to a non-terminal phase.
    // Applying one here would both unmount a form the customer may be
    // holding an OTP or a 3DS challenge in, and announce
    // "جارٍ التحقق" for a payment nobody made.
    expect(applyReconciledState('PROVIDER_UI', 'PROCESSING')).toBe('PROVIDER_UI')
    expect(applyReconciledState('PROVIDER_UI', 'REQUIRES_ACTION')).toBe('PROVIDER_UI')
    expect(applyReconciledState('PROVIDER_UI', null)).toBe('PROVIDER_UI')
  })

  it('still lets a settled payment take the form away', () => {
    // The case this exists for: the same checkout was paid in another
    // tab. That IS news, and the form must go.
    expect(applyReconciledState('PROVIDER_UI', 'SUCCESS')).toBe('PAID')
    expect(applyReconciledState('PROVIDER_UI', 'FAILED')).toBe('FAILED')
    expect(applyReconciledState('PROVIDER_UI', 'CANCELLED')).toBe('CANCELLED')
    expect(applyReconciledState('PROVIDER_UI', 'EXPIRED')).toBe('CANCELLED')
  })

  it('is applyServerState everywhere else', () => {
    // A real payment's reconciliation is untouched.
    const phases: CheckoutPhase[] = [
      'IDLE',
      'CREATING_PAYMENT',
      'PROVIDER_CONFIRMATION',
      'REDIRECTING',
      'RETURNING',
      'VERIFYING',
      'PENDING',
      'PAID',
      'FAILED',
      'CANCELLED',
    ]
    for (const phase of phases) {
      for (const state of ['PROCESSING', 'REQUIRES_ACTION', 'SUCCESS', 'FAILED', null] as const) {
        expect(applyReconciledState(phase, state)).toBe(applyServerState(phase, state))
      }
    }
  })
})

describe('allowsCartEditing — the cart comes back only when the payment is over', () => {
  it('15 — a definitively FAILED payment hands the cart back', () => {
    expect(allowsCartEditing('FAILED')).toBe(true)
  })

  it('a cancelled or expired payment does too — it is equally over', () => {
    // `phaseForPaymentState` folds EXPIRED into CANCELLED, so this is
    // both of the non-success terminal readings the server can produce.
    expect(allowsCartEditing('CANCELLED')).toBe(true)
  })

  it('6/7/8 — an UNRESOLVED payment never does, whatever produced it', () => {
    // PROCESSING, REQUIRES_ACTION and any status this frontend does not
    // recognise all normalise to PENDING (lib/payments/state.ts), so
    // "unknown stays locked" is this single assertion.
    expect(allowsCartEditing('PENDING')).toBe(false)
    for (const state of ['PROCESSING', 'REQUIRES_ACTION'] as const) {
      expect(allowsCartEditing(phaseForPaymentState(state))).toBe(false)
    }
  })

  it('no phase in which a payment can still take the money unlocks', () => {
    const unresolved: CheckoutPhase[] = [
      'CREATING_PAYMENT',
      'RETRY_PREPARING',
      'PROVIDER_UI',
      'PROVIDER_CONFIRMATION',
      'REDIRECTING',
      'RETURNING',
      'VERIFYING',
      'PENDING',
    ]
    for (const phase of unresolved) expect(allowsCartEditing(phase)).toBe(false)
  })

  it('leaves a PAID checkout exactly as it was', () => {
    // Its cart is emptied by the success itself; nothing here reopens it.
    expect(allowsCartEditing('PAID')).toBe(false)
  })

  it('is exactly the settled phases a retry is offered from', () => {
    // The two answers must not drift apart: a screen that offers "try
    // again" is a screen whose cart the customer may fix first.
    const phases: CheckoutPhase[] = [
      'IDLE',
      'CREATING_PAYMENT',
      'RETRY_PREPARING',
      'PROVIDER_UI',
      'PROVIDER_CONFIRMATION',
      'REDIRECTING',
      'RETURNING',
      'VERIFYING',
      'PAID',
      'FAILED',
      'CANCELLED',
      'PENDING',
    ]
    for (const phase of phases) {
      expect(allowsCartEditing(phase)).toBe(isSettledPhase(phase) && phase !== 'PAID')
    }
  })
})

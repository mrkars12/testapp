import { attemptAwaitsSubmission } from './payment-attempt-start';
import type { AttemptStartFields } from './payment-attempt-start';

const attempt = (over: Partial<AttemptStartFields> = {}): AttemptStartFields => ({
  status: 'requires_action',
  next_action_kind: 'client_sdk',
  gateway_reference: null,
  gateway_payment_id: null,
  ...over,
});

describe('has the payer actually submitted a payment?', () => {
  it('says no for an embedded form that was only prepared', () => {
    // The exact shape CheckoutService writes for a Moyasar embedded
    // checkout: a row, a `requires_action` status, and no provider
    // object, because the form has not been touched yet.
    expect(attemptAwaitsSubmission(attempt())).toBe(true);
    expect(attemptAwaitsSubmission(attempt({ status: 'initialized' }))).toBe(
      true,
    );
  });

  it('says yes once a provider payment is bound to it', () => {
    // The confirm endpoint or a webhook put it there, and only a real
    // submission produces one.
    expect(
      attemptAwaitsSubmission(attempt({ gateway_reference: 'pay_1' })),
    ).toBe(false);
    expect(
      attemptAwaitsSubmission(attempt({ gateway_payment_id: 'pay_1' })),
    ).toBe(false);
  });

  it('says yes once a fact has moved the attempt', () => {
    // `processing` and everything past it are only ever written by the
    // fact applier from something a provider reported.
    for (const status of [
      'processing',
      'authorized',
      'succeeded',
      'failed',
      'cancelled',
      'expired',
    ] as const) {
      expect(attemptAwaitsSubmission(attempt({ status }))).toBe(false);
    }
  });

  it('never withholds reconciliation from a non-embedded surface', () => {
    // A redirect attempt was submitted the moment the payer was handed
    // to the provider — there is a provider object and the payer is
    // standing in front of it. Nothing about those flows may change.
    for (const kind of [
      'redirect',
      'none',
      'bank_instructions',
      'reference_code',
      'poll',
      'iframe',
    ] as const) {
      expect(
        attemptAwaitsSubmission(
          attempt({ next_action_kind: kind, status: 'requires_action' }),
        ),
      ).toBe(false);
    }
  });
});

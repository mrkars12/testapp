import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import type { ObservedFact } from '../payments/gateways/provider.types';

/* ══════════════════════════════════════════════════════════════════════
   The gate between a browser-supplied payment id and a paid order.

   The embedded flow ends with the customer's browser telling us "this
   provider payment is mine". That is a *claim*, and the claim is the
   whole attack surface this endpoint adds: paying 1 and reporting the
   id of a payment for 500, reporting a payment made in a currency the
   order was never priced in, or reporting someone else's payment
   entirely.

   `confirmEmbeddedPayment` re-fetches the reference with the store's own
   credentials — so a payment made against another merchant's account is
   simply not found — and then runs every returned fact through the
   checks below before the applier ever sees one. These tests are about
   those checks and nothing else, so the method is exercised directly
   rather than through a service that would need a database to build.
   ══════════════════════════════════════════════════════════════════════ */

const assertFactBelongsToIntent = (
  fact: ObservedFact,
  intent: { id: bigint; amount_minor: bigint; currency: string },
): void =>
  (
    Object.create(CheckoutService.prototype) as {
      assertFactBelongsToIntent: (
        f: ObservedFact,
        i: { id: bigint; amount_minor: bigint; currency: string },
      ) => void;
    }
  ).assertFactBelongsToIntent(fact, intent);

const INTENT = { id: 42n, amount_minor: 50000n, currency: 'SAR' };

function fact(overrides: Partial<ObservedFact> = {}): ObservedFact {
  return {
    dedupeKey: 'k1',
    accountId: 7n,
    gatewayReference: 'pay_abc',
    factType: 'attempt_captured',
    cumulativeAmountMinor: 50000n,
    currency: 'SAR',
    internalIntentRef: '42',
    ...overrides,
  };
}

describe('confirmEmbeddedPayment — a client-supplied payment id is a claim', () => {
  it('accepts the payment this checkout actually created', () => {
    expect(() => assertFactBelongsToIntent(fact(), INTENT)).not.toThrow();
  });

  it('refuses a payment that names a different intent', () => {
    // Someone else's payment id, or one from an earlier abandoned
    // attempt. `internalIntentRef` is our own id, round-tripped through
    // the provider's metadata, so it cannot be guessed into agreement.
    expect(() =>
      assertFactBelongsToIntent(fact({ internalIntentRef: '43' }), INTENT),
    ).toThrow(BadRequestException);
  });

  it('refuses a payment made in another currency', () => {
    expect(() =>
      assertFactBelongsToIntent(fact({ currency: 'USD' }), INTENT),
    ).toThrow(BadRequestException);
  });

  it('compares currency case-insensitively rather than rejecting on style', () => {
    expect(() =>
      assertFactBelongsToIntent(fact({ currency: 'sar' }), INTENT),
    ).not.toThrow();
  });

  it('refuses a payment for less than the order total', () => {
    // The attack this endpoint exists to stop: pay 1, report the id.
    expect(() =>
      assertFactBelongsToIntent(fact({ cumulativeAmountMinor: 100n }), INTENT),
    ).toThrow(BadRequestException);
  });

  it('refuses a payment for more than the order total', () => {
    // Not a windfall to accept quietly: it means the reference is for
    // something other than this order.
    expect(() =>
      assertFactBelongsToIntent(
        fact({ cumulativeAmountMinor: 60000n }),
        INTENT,
      ),
    ).toThrow(BadRequestException);
  });

  it('checks the amount only on facts that actually secured funds', () => {
    // A failed or refunded fact carries a cumulative amount that is not
    // the order total by definition; rejecting it would turn a legitimate
    // decline into an error instead of a decline the customer can retry.
    expect(() =>
      assertFactBelongsToIntent(
        fact({ factType: 'attempt_failed', cumulativeAmountMinor: 0n }),
        INTENT,
      ),
    ).not.toThrow();
  });

  it('checks an authorization the same way it checks a capture', () => {
    expect(() =>
      assertFactBelongsToIntent(
        fact({ factType: 'attempt_authorized', cumulativeAmountMinor: 100n }),
        INTENT,
      ),
    ).toThrow(BadRequestException);
  });

  it('does not invent a mismatch out of a field the adapter omitted', () => {
    // These fields are optional on the contract. Absent means "the
    // adapter did not report it", which is not evidence of a mismatch —
    // and treating it as one would break every adapter that omits them.
    expect(() =>
      assertFactBelongsToIntent(
        fact({
          internalIntentRef: undefined,
          currency: undefined,
          cumulativeAmountMinor: undefined,
        }),
        INTENT,
      ),
    ).not.toThrow();
  });
});

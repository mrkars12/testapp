import { canExposeCheckoutPii } from './checkout-pii-policy';
import { StorefrontCheckoutController } from './storefront-checkout.controller';
import type { CheckoutStatus, PaymentIntentStatus } from '@prisma/client';

/* ══════════════════════════════════════════════════════════════════════
   The checkout token is a BEARER CAPABILITY.

   Whoever holds it gets the answer — and it travels: a URL, browser
   history, a shared link, a screenshot. So the payer's own contact and
   address are returned only while this checkout can still be paid, which
   is the only reason the retry flow ever needed them.

   Every case below is stated as "may a holder of this token read where
   this person lives?".
   ══════════════════════════════════════════════════════════════════════ */

const expose = (
  checkoutStatus: CheckoutStatus,
  intentStatus: PaymentIntentStatus | null = null,
) => canExposeCheckoutPii({ checkoutStatus, intentStatus });

describe('canExposeCheckoutPii', () => {
  describe('states a payment can still be started or retried from', () => {
    it('A — an active unpaid checkout may return retry details', () => {
      expect(expose('open')).toBe(true);
      expect(expose('open', 'created')).toBe(true);
      expect(expose('open', 'requires_payment_method')).toBe(true);
    });

    it('A — a payment in flight may return retry details', () => {
      expect(expose('pending_payment', 'processing')).toBe(true);
      expect(expose('pending_payment', 'requires_action')).toBe(true);
    });

    it('B — a FAILED checkout may return retry details', () => {
      // The whole point of the state: the payer presents another card.
      expect(expose('failed', 'failed')).toBe(true);
    });
  });

  describe('states that are closed', () => {
    it('C — a committed (paid) checkout returns none', () => {
      expect(expose('committed', 'captured')).toBe(false);
      // Committed is closed on its own, whatever the intent reads.
      expect(expose('committed', 'processing')).toBe(false);
      expect(expose('committed', null)).toBe(false);
    });

    it('D — an abandoned checkout returns none', () => {
      expect(expose('abandoned', 'cancelled')).toBe(false);
      expect(expose('abandoned', null)).toBe(false);
    });

    it('E — an expired checkout returns none', () => {
      expect(expose('expired', 'expired')).toBe(false);
      expect(expose('expired', null)).toBe(false);
    });
  });

  describe('money already secured, whatever the checkout row says', () => {
    /*
     * The checkout row can lag its payment: a webhook captures the
     * intent moments before the checkout is committed. Reading the
     * checkout status alone would leave a window in which a PAID
     * checkout still handed back the payer's address.
     */
    it('refuses once the intent holds money, even mid-commit', () => {
      expect(expose('pending_payment', 'captured')).toBe(false);
      expect(expose('pending_payment', 'authorized')).toBe(false);
      expect(expose('pending_payment', 'partially_captured')).toBe(false);
      expect(expose('pending_payment', 'refunded')).toBe(false);
      expect(expose('pending_payment', 'partially_refunded')).toBe(false);
    });

    it('still allows the states a payer actually retries from', () => {
      // Terminal for the INTENT, but the reason retry exists.
      expect(expose('failed', 'failed')).toBe(true);
      expect(expose('pending_payment', 'cancelled')).toBe(true);
      expect(expose('pending_payment', 'expired')).toBe(true);
    });
  });

  it('H — nothing the caller sends can influence the decision', () => {
    // The function's whole input is the stored state. There is no flag,
    // no override, no options bag — so this is enforced by its type, and
    // this test exists to make removing that a visible change.
    expect(canExposeCheckoutPii.length).toBe(1);
    const paid = {
      checkoutStatus: 'committed' as CheckoutStatus,
      intentStatus: 'captured' as PaymentIntentStatus,
    };
    expect(canExposeCheckoutPii({ ...paid })).toBe(false);
    expect(
      canExposeCheckoutPii({ ...paid, ...({ include_pii: true } as object) }),
    ).toBe(false);
  });

  it('covers every CheckoutStatus explicitly', () => {
    // A new state must not silently inherit "expose".
    const all: CheckoutStatus[] = [
      'open',
      'pending_payment',
      'committed',
      'expired',
      'abandoned',
      'failed',
    ];
    const exposing = all.filter((s) => expose(s));
    expect(exposing.sort()).toEqual(['failed', 'open', 'pending_payment']);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   And the response that carries it must not be STORED.

   The policy above decides what may be in the body. This decides where
   that body may end up: a token in a URL plus a cacheable response is
   how a customer's name, address, order number and amount reach a
   shared HTTP cache, a disk cache, or the next person on the machine.

   The endpoint carried no caching directive at all — only an ETag —
   which leaves it open to heuristic caching. Asserted here, beside the
   policy it protects, because the two are the same question asked at
   two layers.

   Deliberately the API response only: `no-store` on the checkout
   DOCUMENT would make the page ineligible for the back/forward cache in
   Chrome, and the restore path depends on bfcache.
   ══════════════════════════════════════════════════════════════════════ */
describe('the checkout status response is never stored', () => {
  /** The headers Nest will apply to a handler, from its own metadata. */
  const headersOf = (handler: keyof StorefrontCheckoutController) =>
    (Reflect.getMetadata(
      '__headers__',
      StorefrontCheckoutController.prototype[handler],
    ) as { name: string; value: string }[] | undefined) ?? [];

  it('sends Cache-Control: no-store', () => {
    // Read from the decorator's own metadata: the contract is proven
    // without standing up an HTTP server.
    expect(headersOf('checkoutStatus')).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]),
    );
  });

  it('does NOT put no-store on anything else in the controller', () => {
    // The public payment-method catalogue is not sensitive and is not
    // this rule's business; the writes are POSTs, which are not cached.
    expect(headersOf('paymentMethods')).toEqual([]);
    expect(headersOf('createCheckout')).toEqual([]);
  });
});

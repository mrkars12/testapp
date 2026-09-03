import type { CheckoutStatus, PaymentIntentStatus } from '@prisma/client';

/**
 * WHEN THE CHECKOUT STATUS ENDPOINT MAY RETURN THE PAYER'S OWN DETAILS.
 *
 * `GET /storefront/:slug/checkout/:token` is authorised by a bearer
 * capability — the checkout token — and nothing else. Whoever holds the
 * token gets the answer. The token is unguessable and store-scoped, but
 * it also travels: it sits in a URL, and therefore in browser history,
 * in a shared link, in a screenshot.
 *
 * The retry flow needs the details this checkout was created with,
 * because a 3DS decline returns the payer through a redirect and the
 * page that offers them a retry is a new document holding nothing. That
 * is a real need, and it lasts exactly as long as the checkout can still
 * be paid.
 *
 * Once it cannot, the need is over and the exposure is pure surplus. A
 * token for a checkout that was paid weeks ago should not still answer
 * "where does this person live?".
 *
 * The decision is made here, on the server, from the stored state. There
 * is deliberately no request parameter that influences it: a caller
 * cannot ask for PII, only receive it when the state warrants.
 */

/**
 * Checkout states in which a payment can still legitimately be started
 * or retried.
 *
 * Straight from `CheckoutStatus`, not a parallel model:
 *
 *   open             nothing submitted yet — the ordinary live checkout
 *   pending_payment  a payment is in flight and may still be re-tried
 *   failed           declined, and retry is the whole point of this state
 *
 * Everything else in that enum is closed: `committed` (paid), `expired`,
 * `abandoned`.
 */
const RETRYABLE_CHECKOUT_STATUSES: readonly CheckoutStatus[] = [
  'open',
  'pending_payment',
  'failed',
];

/**
 * Intent states in which money is already secured.
 *
 * A checkout row can lag its payment — a webhook can capture the intent
 * moments before the checkout is committed — so the checkout status
 * alone is not sufficient to mean "still unpaid". If the money is in,
 * there is nothing to retry and nothing to hand back.
 *
 * `failed`, `cancelled` and `expired` are intentionally NOT here: those
 * are terminal for the *intent*, but they are exactly the cases the
 * payer retries from, and the checkout status above is what governs
 * whether that retry is still allowed.
 */
const MONEY_SECURED_INTENT_STATUSES: readonly PaymentIntentStatus[] = [
  'authorized',
  'partially_captured',
  'captured',
  'partially_refunded',
  'refunded',
];

/**
 * The single authority for whether this checkout's status response may
 * carry the payer's details.
 */
export function canExposeCheckoutPii(input: {
  checkoutStatus: CheckoutStatus;
  intentStatus: PaymentIntentStatus | null;
}): boolean {
  if (!RETRYABLE_CHECKOUT_STATUSES.includes(input.checkoutStatus)) {
    return false;
  }

  if (
    input.intentStatus !== null &&
    MONEY_SECURED_INTENT_STATUSES.includes(input.intentStatus)
  ) {
    return false;
  }

  return true;
}

/**
 * The details a retry actually needs, and nothing else.
 *
 * `CreateCheckoutDto` requires `customer_name`, `customer_phone`,
 * `address_line` and `city`. `customer_email` is optional on the DTO but
 * is kept because a retry is an online payment: it is the payer email
 * providers receive for the receipt, and one that requires it "refuses
 * before any network call" without it (see `payerMetadata`).
 *
 * `notes` is deliberately NOT returned. Nothing in the payment path
 * requires it, and it is free text the customer may have put anything
 * into — the least predictable field on the row, and the easiest to do
 * without. The cost is that an order note does not survive into a retry.
 */
export interface CheckoutRetryDetails {
  name: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
}

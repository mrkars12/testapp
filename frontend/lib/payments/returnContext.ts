/* ══════════════════════════════════════════════════════════════════════
   Same-page return context.

   A gateway that requires a redirect takes THIS tab away and brings it
   back to the same checkout URL. Everything needed to pick the checkout
   back up therefore has to survive a full page load in the URL — and
   nothing else may: no localStorage, no sessionStorage, no remembered
   store. (lib/store-context-url-only.test.ts enforces that rule for the
   active store generally; this module is the payment half of it.)

   Exactly one identifier travels: the checkout token, which the BACKEND
   appended to the return URL before the provider ever saw it
   (checkout.service.ts). It is a 32-char random value scoped to one
   checkout of one store, so it identifies the attempt without exposing
   an order number, a customer, or anything guessable — and reading it
   proves nothing on its own. Every fact shown after a return comes from
   asking the server about it.
   ══════════════════════════════════════════════════════════════════════ */

/** The query parameter the backend appends to the storefront return URL. */
export const CHECKOUT_TOKEN_PARAM = 'token'

/**
 * Provider-appended hints that the payer backed out rather than paid.
 *
 * A hint, never an outcome: it can skip the wait before showing
 * "cancelled", but an authoritative server state always overrides it —
 * a customer can complete a payment and still land on a cancel URL, and
 * a provider can append anything it likes to a URL we asked it to use.
 */
const CANCELLED_HINT_PARAMS: readonly string[] = ['stripe_cancelled']

/** Checkout tokens are hex, 32 chars — see randomUUID() in the backend. */
const TOKEN_PATTERN = /^[a-f0-9]{16,64}$/i

/**
 * The query parameter an embedded form appends its payment id to.
 * Moyasar uses `id`; the backend's own token travels separately.
 */
const PROVIDER_PAYMENT_PARAM = 'id'

/**
 * Provider payment ids here are UUIDs or opaque alphanumeric tokens.
 * Shape-checked before use for the same reason the checkout token is:
 * it arrives through a third party's redirect and is about to be put in
 * a request body.
 */
const PROVIDER_REF_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export interface ReturnContext {
  /** The checkout to verify, or null when this is a fresh checkout visit. */
  token: string | null
  /** The payer appears to have abandoned the provider's page. */
  cancelledHint: boolean
  /**
   * A provider payment id an embedded form appended on its way back.
   *
   * Moyasar Form redirects to `callback_url` with `?id=<payment id>`
   * once the payment — and any 3DS challenge — completes. It is a claim
   * about which provider object belongs to this checkout, nothing more:
   * the server re-fetches it with the store's own credentials and
   * checks it against the intent before anything is applied.
   */
  providerPaymentRef: string | null
}

type ParamSource = Pick<URLSearchParams, 'get'>

/**
 * Reads the return context out of the current query string.
 *
 * Validates the token's *shape* before it is used in a request path — a
 * value arriving from a third-party redirect is untrusted input, and a
 * malformed one should read as "no return in progress" rather than
 * being interpolated into a URL.
 */
export function readReturnContext(params: ParamSource | null | undefined): ReturnContext {
  const raw = params?.get(CHECKOUT_TOKEN_PARAM) ?? null
  const token = raw && TOKEN_PATTERN.test(raw) ? raw : null

  const cancelledHint = CANCELLED_HINT_PARAMS.some(
    (name) => params?.get(name) === '1',
  )

  const rawRef = params?.get(PROVIDER_PAYMENT_PARAM) ?? null
  const providerPaymentRef =
    rawRef && PROVIDER_REF_PATTERN.test(rawRef) ? rawRef : null

  return { token, cancelledHint, providerPaymentRef }
}

/**
 * The absolute URL a provider must send the payer back to: the same
 * checkout page, of the same store, on this origin.
 *
 * Built from the live `window.location.origin` rather than a configured
 * host so it is always the origin the customer is actually on — and the
 * backend independently checks it against its own allowlist before
 * handing it to a provider (checkout/return-url.ts), so a tampered value
 * cannot turn this into an open redirect.
 */
export function buildReturnUrl(storeSlug: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${checkoutPath(storeSlug)}`
}

/** The checkout route for a store. One definition, used by both sides. */
export function checkoutPath(storeSlug: string): string {
  return `/stores/${encodeURIComponent(storeSlug)}/checkout`
}

/**
 * The same checkout URL, carrying the token — what the address bar shows
 * while a payment is in flight.
 *
 * Written into history *before* the tab leaves for the provider, so that
 * a Back from the gateway, a browser-restored session, or a refresh at
 * any point all land on a checkout that knows which payment to verify.
 */
export function checkoutUrlWithToken(storeSlug: string, token: string): string {
  return `${checkoutPath(storeSlug)}?${CHECKOUT_TOKEN_PARAM}=${encodeURIComponent(token)}`
}

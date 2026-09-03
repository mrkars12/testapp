/**
 * ==================================================================
 * Paymob HTTP transport
 * ==================================================================
 *
 * A seam, not a client library. The adapter needs exactly one thing
 * from the network — "POST/GET this JSON and give me the status and the
 * parsed body" — so that is the whole interface, and tests supply it
 * without a network or an HTTP mocking library.
 *
 * Base URLs are per market and are taken from Paymob's documented list:
 *
 *   Egypt   https://accept.paymob.com/
 *   Oman    https://oman.paymob.com/
 *   KSA     https://ksa.paymob.com/
 *   UAE     https://uae.paymob.com/
 *
 * Only Egypt is wired up: it is the market this stage targets, and
 * listing a host we have not exercised would be a capability claim we
 * cannot back.
 *
 * Source: https://developers.paymob.com/paymob-docs/integration-paths/apis
 * (region base URLs), accessed 2026-08-19.
 */

/** Egypt. The only market this adapter is declared for. */
export const PAYMOB_EGYPT_BASE_URL = 'https://accept.paymob.com'

/**
 * Unified Checkout, Egypt.
 *
 * Source: https://developers.paymob.com/paymob-docs/checkout-experiences
 * → Unified Checkout (Redirection), accessed 2026-08-19:
 *   https://eg.checkout.paymob.com/?publicKey={key}&clientSecret={secret}
 */
export const PAYMOB_EGYPT_CHECKOUT_URL = 'https://eg.checkout.paymob.com/'

export interface PaymobRequest {
  readonly method: 'GET' | 'POST'
  /** Absolute URL. */
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
}

export interface PaymobResponse {
  readonly status: number
  /** Parsed JSON, or null when the body was empty or not JSON. */
  readonly body: unknown
}

export type PaymobHttp = (request: PaymobRequest) => Promise<PaymobResponse>

/** DI token: a function has no class to inject. */
export const PAYMOB_HTTP = Symbol('PAYMOB_HTTP')

/**
 * The real transport.
 *
 * Deliberately thin: no retries and no backoff here. Retry policy is a
 * property of the error taxonomy (`isRetryable`), decided by
 * orchestration, and a second retry loop hidden in the transport would
 * make the outbound idempotency guarantees impossible to reason about.
 */
export const defaultPaymobHttp: PaymobHttp = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      accept: 'application/json',
      ...(request.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...request.headers,
    },
    ...(request.body === undefined
      ? {}
      : { body: JSON.stringify(request.body) }),
  })

  const text = await response.text()

  let body: unknown = null

  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      // Left null. An unparseable body is reported through the status,
      // not by throwing here — a gateway's HTML error page must not
      // become a different class of failure from its JSON one.
      body = null
    }
  }

  return { status: response.status, body }
}

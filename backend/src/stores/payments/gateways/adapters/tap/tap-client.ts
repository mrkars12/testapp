/**
 * ==================================================================
 * Tap Payments HTTP transport
 * ==================================================================
 *
 * A seam, not a client library — the same shape the Paymob and Moyasar
 * adapters use, so tests supply a transport without a network or an
 * HTTP mocking library.
 *
 * One base URL, because Tap publishes one. There is no separate sandbox
 * host: the documentation uses `https://api.tap.company/v2/` throughout
 * and distinguishes environments by the key — "Test - Secret Key: The
 * secret API key that enables you to create transactions in the sandbox
 * environment" against "Live - Secret Key: … the production
 * environment". That is why this file has no notion of environment and
 * the adapter checks the key prefix instead.
 *
 * Sources, accessed 2026-08-19:
 *   https://developers.tap.company/docs/authentication
 *   https://developers.tap.company/docs/get-started
 *   https://developers.tap.company/reference/create-a-charge
 */

/** The only base URL Tap publishes. Versioned: v2. */
export const TAP_BASE_URL = 'https://api.tap.company/v2'

export interface TapRequest {
  readonly method: 'GET' | 'POST'
  /** Absolute URL. */
  readonly url: string
  /**
   * The secret API key sent as the Bearer token.
   *
   * Passed separately rather than as a pre-built header so the transport
   * owns the encoding and no call site can accidentally log the
   * assembled credential.
   */
  readonly apiKey: string
  readonly body?: unknown
}

export interface TapResponse {
  readonly status: number
  /** Parsed JSON, or null when the body was empty or not JSON. */
  readonly body: unknown
}

export type TapHttp = (request: TapRequest) => Promise<TapResponse>

/** DI token: a function has no class to inject. */
export const TAP_HTTP = Symbol('TAP_HTTP')

/**
 * The real transport.
 *
 * Bearer authentication with the secret API key, exactly as the
 * authentication guide shows: `Authorization: Bearer sk_test_…`.
 *
 * No retries and no backoff here: retry policy is a property of the
 * error taxonomy and belongs to orchestration, and a hidden retry loop
 * would make the idempotency story impossible to reason about.
 */
export const defaultTapHttp: TapHttp = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${request.apiKey}`,
      ...(request.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
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
      // Reported through the status rather than by throwing: a gateway's
      // HTML error page must not become a different class of failure
      // from its JSON one.
      body = null
    }
  }

  return { status: response.status, body }
}

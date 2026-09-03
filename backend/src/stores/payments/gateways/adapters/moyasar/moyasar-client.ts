/**
 * ==================================================================
 * Moyasar HTTP transport
 * ==================================================================
 *
 * A seam, not a client library — the same shape the Paymob adapter
 * uses, so tests supply a transport without a network or an HTTP
 * mocking library.
 *
 * One base URL, because Moyasar has one. There is no separate sandbox
 * host: "Moyasar API is available in two modes: live mode and test
 * mode… The mode for the request is determined by the API Key used for
 * authentication." That is why this file has no notion of environment
 * and the adapter checks the key prefix instead.
 *
 * Source: https://docs.moyasar.com/api/api-introduction and
 * https://docs.moyasar.com/api/authentication, accessed 2026-08-19.
 */

/** The only base URL Moyasar publishes. Versioned: v1. */
export const MOYASAR_BASE_URL = 'https://api.moyasar.com/v1'

export interface MoyasarRequest {
  readonly method: 'GET' | 'POST'
  /** Absolute URL. */
  readonly url: string
  /**
   * The API key used as the Basic-auth username.
   *
   * Passed separately rather than as a pre-built header so the transport
   * owns the encoding and no call site can accidentally log the
   * assembled credential.
   */
  readonly apiKey: string
  readonly body?: unknown
}

export interface MoyasarResponse {
  readonly status: number
  /** Parsed JSON, or null when the body was empty or not JSON. */
  readonly body: unknown
}

export type MoyasarHttp = (request: MoyasarRequest) => Promise<MoyasarResponse>

/** DI token: a function has no class to inject. */
export const MOYASAR_HTTP = Symbol('MOYASAR_HTTP')

/**
 * The real transport.
 *
 * HTTP Basic Auth with the API key as the username and an **empty**
 * password — the docs are emphatic about the second part ("The password
 * must be kept empty"), and a non-empty one is rejected.
 *
 * No retries and no backoff here: retry policy is a property of the
 * error taxonomy and belongs to orchestration, and a hidden retry loop
 * would make the idempotency story impossible to reason about.
 */
export const defaultMoyasarHttp: MoyasarHttp = async (request) => {
  const credentials = Buffer.from(`${request.apiKey}:`, 'utf8').toString('base64')

  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      accept: 'application/json',
      authorization: `Basic ${credentials}`,
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

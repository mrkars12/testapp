import type { WebhookResolution } from './provider.types'

/**
 * ==================================================================
 * Webhook account resolution
 * ==================================================================
 *
 * Answering one question, generically: *which payment account is this
 * callback about?*
 *
 * There are two shapes of answer in the wild, and a provider does not
 * get to choose ours:
 *
 *   endpoint_scoped  The provider posts to a URL we minted per account,
 *                    so the account is in the path. Nothing in the body
 *                    is read to route it, which is what makes routing
 *                    safe before the signature has been checked.
 *
 *   payload_scoped   The provider posts every merchant's events to one
 *                    URL and identifies the merchant inside the body.
 *                    Routing then depends on parsing untrusted bytes,
 *                    so the reference extracted this way selects *which
 *                    secret to verify against* and nothing more — it is
 *                    never itself treated as proof of anything.
 *
 * This module is pure: it decides the *reference*, never touching the
 * database. Turning a reference into an account row is the resolver
 * service's job, so the decision stays unit-testable without a schema.
 *
 * ⚠️ No provider-specific parsing lives here or ever should. A future
 * payload-scoped adapter implements `extractWebhookAccountRef` and this
 * file does not change.
 */

/**
 * A pointer to the account a callback belongs to.
 *
 * Two kinds, because the two strategies genuinely produce different
 * things: a row id we minted, or an identifier the *provider* uses for
 * the merchant account, which we then have to look up.
 */
export type WebhookAccountRef =
  | { readonly kind: 'account_id'; readonly accountId: bigint }
  | {
      readonly kind: 'provider_account'
      /** The provider's own identifier for the merchant account. */
      readonly providerAccountRef: string
    }

export interface WebhookResolutionRequest {
  /** The `:gateway` segment as sent. Never trusted; checked downstream. */
  readonly gateway: string
  /** The `:accountId` segment as sent, when the route carries one. */
  readonly endpointAccountId?: string
  readonly rawBody: Buffer
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

/**
 * Why a callback could not be routed.
 *
 * Distinct reasons because they are distinct operational problems:
 * `not_extractable` means the provider sent something we cannot read,
 * `unsupported_strategy` means we have not implemented what the adapter
 * asked for, and `no_endpoint_account` means the URL was malformed.
 */
export type WebhookRefFailure =
  | 'no_endpoint_account'
  | 'bad_endpoint_account'
  | 'not_extractable'
  | 'unsupported_strategy'

export type WebhookRefOutcome =
  | { readonly kind: 'ref'; readonly ref: WebhookAccountRef }
  | { readonly kind: 'unresolved'; readonly reason: WebhookRefFailure }

/**
 * Extracts a provider-side account reference from an unverified body.
 *
 * Implemented only by adapters whose provider is payload-scoped. It is
 * given raw bytes from an unauthenticated endpoint, so it must never
 * throw and must never act on what it reads.
 */
export type WebhookAccountRefExtractor = (
  input: {
    readonly rawBody: Buffer
    readonly headers: Readonly<Record<string, string | string[] | undefined>>
  },
) => WebhookAccountRef | null

/**
 * Decides the account reference for one callback.
 *
 * Pure, and deliberately unaware of which provider it is serving: the
 * strategy comes from the adapter's capability declaration and the
 * extraction comes from the adapter's own hook.
 */
export function resolveWebhookAccountRef(input: {
  strategy: WebhookResolution
  request: WebhookResolutionRequest
  extract?: WebhookAccountRefExtractor
}): WebhookRefOutcome {
  const { strategy, request } = input

  if (strategy === 'endpoint_scoped') {
    return fromEndpoint(request)
  }

  if (strategy === 'payload_scoped') {
    if (!input.extract) {
      return { kind: 'unresolved', reason: 'unsupported_strategy' }
    }

    let ref: WebhookAccountRef | null

    try {
      ref = input.extract({
        rawBody: request.rawBody,
        headers: request.headers,
      })
    } catch {
      // The bytes are attacker-controlled. A throw here would turn a
      // malformed body into a 500 and, worse, into a provider retry
      // storm against an endpoint that will never accept it.
      return { kind: 'unresolved', reason: 'not_extractable' }
    }

    if (!ref) {
      // A payload-scoped provider that also mints per-account URLs can
      // still be routed by the path, so the endpoint is the fallback
      // rather than an immediate rejection.
      return request.endpointAccountId
        ? fromEndpoint(request)
        : { kind: 'unresolved', reason: 'not_extractable' }
    }

    return { kind: 'ref', ref }
  }

  /**
   * 'none': the adapter takes no webhooks.
   *
   * Still routed by the endpoint when the URL carries an account, because
   * *whether the callback can be handled* is a separate decision from
   * *who it is addressed to* — and ingestion needs the account to record
   * the arrival before refusing it. Dropping it here instead would erase
   * the evidence that a provider is calling an endpoint we do not serve.
   */
  return request.endpointAccountId
    ? fromEndpoint(request)
    : { kind: 'unresolved', reason: 'unsupported_strategy' }
}

function fromEndpoint(request: WebhookResolutionRequest): WebhookRefOutcome {
  if (!request.endpointAccountId) {
    return { kind: 'unresolved', reason: 'no_endpoint_account' }
  }

  let accountId: bigint

  try {
    accountId = BigInt(request.endpointAccountId)
  } catch {
    return { kind: 'unresolved', reason: 'bad_endpoint_account' }
  }

  if (accountId <= 0n) {
    return { kind: 'unresolved', reason: 'bad_endpoint_account' }
  }

  return { kind: 'ref', ref: { kind: 'account_id', accountId } }
}

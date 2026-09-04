import {
  resolveWebhookAccountRef,
  type WebhookAccountRef,
  type WebhookResolutionRequest,
} from './webhook-resolution'

const request = (
  over: Partial<WebhookResolutionRequest> = {},
): WebhookResolutionRequest => ({
  gateway: 'spec',
  endpointAccountId: '42',
  rawBody: Buffer.from('{"ok":true}', 'utf8'),
  headers: {},
  ...over,
})

describe('endpoint-scoped resolution', () => {
  it('takes the account from the URL and reads nothing from the body', () => {
    const outcome = resolveWebhookAccountRef({
      strategy: 'endpoint_scoped',
      request: request({
        // Deliberately hostile: a body claiming a different account must
        // have no effect at all, because nothing here parses it.
        rawBody: Buffer.from('{"account_id":"999"}', 'utf8'),
      }),
    })

    expect(outcome).toEqual({
      kind: 'ref',
      ref: { kind: 'account_id', accountId: 42n },
    })
  })

  it('never calls an extractor it was given', () => {
    const extract = jest.fn()

    resolveWebhookAccountRef({
      strategy: 'endpoint_scoped',
      request: request(),
      extract,
    })

    expect(extract).not.toHaveBeenCalled()
  })

  it('reports a missing account segment', () => {
    const outcome = resolveWebhookAccountRef({
      strategy: 'endpoint_scoped',
      request: request({ endpointAccountId: undefined }),
    })

    expect(outcome).toEqual({ kind: 'unresolved', reason: 'no_endpoint_account' })
  })

  it('rejects an unparseable or non-positive account segment', () => {
    for (const value of ['abc', '', '0', '-3']) {
      const outcome = resolveWebhookAccountRef({
        strategy: 'endpoint_scoped',
        request: request({ endpointAccountId: value }),
      })

      expect(outcome.kind).toBe('unresolved')
    }
  })
})

describe('payload-scoped resolution', () => {
  const providerRef: WebhookAccountRef = {
    kind: 'provider_account',
    providerAccountRef: 'merchant-77',
  }

  it('uses the reference the adapter extracts', () => {
    const outcome = resolveWebhookAccountRef({
      strategy: 'payload_scoped',
      request: request({ endpointAccountId: undefined }),
      extract: () => providerRef,
    })

    expect(outcome).toEqual({ kind: 'ref', ref: providerRef })
  })

  it('hands the adapter the raw bytes and headers, unparsed', () => {
    const extract = jest.fn().mockReturnValue(providerRef)
    const rawBody = Buffer.from('anything at all', 'utf8')
    const headers = { 'x-provider-signature': 'sig' }

    resolveWebhookAccountRef({
      strategy: 'payload_scoped',
      request: request({ rawBody, headers }),
      extract,
    })

    expect(extract).toHaveBeenCalledWith({ rawBody, headers })
  })

  it('refuses the strategy when no extractor is supplied', () => {
    // Declaring payload-scoped without implementing the hook is caught
    // at boot; this is the runtime half of the same guarantee.
    const outcome = resolveWebhookAccountRef({
      strategy: 'payload_scoped',
      request: request(),
    })

    expect(outcome).toEqual({
      kind: 'unresolved',
      reason: 'unsupported_strategy',
    })
  })

  it('contains a throwing extractor rather than propagating it', () => {
    // The extractor runs on attacker-controlled bytes from an
    // unauthenticated endpoint. A throw escaping here is a 500 anyone
    // can trigger, plus a provider retry storm.
    const outcome = resolveWebhookAccountRef({
      strategy: 'payload_scoped',
      request: request({ endpointAccountId: undefined }),
      extract: () => {
        throw new Error('malformed')
      },
    })

    expect(outcome).toEqual({ kind: 'unresolved', reason: 'not_extractable' })
  })

  it('falls back to the endpoint when the payload names no account', () => {
    // A payload-scoped provider that also mints per-account URLs is
    // still routable; refusing outright would lose a callback we can
    // place.
    const outcome = resolveWebhookAccountRef({
      strategy: 'payload_scoped',
      request: request({ endpointAccountId: '42' }),
      extract: () => null,
    })

    expect(outcome).toEqual({
      kind: 'ref',
      ref: { kind: 'account_id', accountId: 42n },
    })
  })

  it('gives up when neither the payload nor the URL names an account', () => {
    const outcome = resolveWebhookAccountRef({
      strategy: 'payload_scoped',
      request: request({ endpointAccountId: undefined }),
      extract: () => null,
    })

    expect(outcome).toEqual({ kind: 'unresolved', reason: 'not_extractable' })
  })
})

describe("the 'none' strategy", () => {
  it('still routes by endpoint so the arrival can be recorded', () => {
    // Whether a callback can be *handled* is a separate question from
    // who it is addressed to. Ingestion needs the account to record the
    // arrival before refusing it.
    const outcome = resolveWebhookAccountRef({
      strategy: 'none',
      request: request(),
    })

    expect(outcome).toEqual({
      kind: 'ref',
      ref: { kind: 'account_id', accountId: 42n },
    })
  })

  it('is unresolvable with no endpoint account', () => {
    const outcome = resolveWebhookAccountRef({
      strategy: 'none',
      request: request({ endpointAccountId: undefined }),
    })

    expect(outcome).toEqual({
      kind: 'unresolved',
      reason: 'unsupported_strategy',
    })
  })
})

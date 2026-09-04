import { ReconciliationService } from './reconciliation.service'
import type { FetchStatusInput, ObservedFact } from '../gateways/provider.types'

/**
 * ==================================================================
 * Reconciliation must ask about the RIGHT KIND of reference
 * ==================================================================
 *
 * One provider can hand out two kinds of identifier for the same
 * gateway. Moyasar is the case in this codebase: a redirect attempt's
 * `gateway_reference` is an **invoice** id, an embedded attempt's is a
 * **payment** id, and the two are indistinguishable strings. The adapter
 * picks the endpoint from `referenceKind`, so a caller that omits it
 * sends every embedded attempt to the invoice endpoint.
 *
 * That was live behaviour, not a hypothetical: the sweep logged
 * "Moyasar fetch invoice failed … 404: The Invoice record you were
 * looking for was not found" for embedded attempts and reconciled
 * nothing. It was invisible because the browser confirm and the webhook
 * both settled those payments anyway — which is exactly the case
 * reconciliation exists to cover when they do not.
 *
 * These tests are about the CALL, not about Moyasar: what is asserted is
 * that the attempt's own action kind reaches `fetchStatus`, whatever the
 * adapter then does with it.
 */

/** The reconciliation sweep reaches into a lot; only these are read. */
function harness(attempt: {
  gateway_reference: string | null
  next_action_kind: string
}) {
  const calls: FetchStatusInput[] = []

  const intent = {
    id: 1n,
    store_id: 9n,
    mode: 'test' as const,
    account_id: 13n,
    status: 'processing',
    created_at: new Date(0),
  }

  const prisma = {
    platform: () => ({
      paymentIntent: { findMany: () => Promise.resolve([intent]) },
    }),
    withTenantTransaction: <T>(
      _storeId: bigint,
      _mode: string,
      cb: (tx: unknown) => Promise<T>,
    ): Promise<T> =>
      cb({
        paymentAccount: {
          findFirst: () => Promise.resolve({ id: 13n, gateway: 'moyasar' }),
        },
        paymentAttempt: { findFirst: () => Promise.resolve(attempt) },
      }),
  }

  const provider = {
    capabilities: { statusPolling: true },
    fetchStatus: (input: FetchStatusInput): Promise<ObservedFact[]> => {
      calls.push(input)
      return Promise.resolve([])
    },
  }

  const providers = {
    has: () => true,
    get: () => provider,
  }

  const accounts = {
    revealCredentialsForGateway: () => Promise.resolve({ secret_key: 'sk_test_x' }),
  }

  const applier = { applyMany: () => Promise.resolve(undefined) }

  const service = new ReconciliationService(
    prisma as never,
    providers as never,
    accounts as never,
    applier as never,
  )

  return { service, calls }
}

describe('reconciliation preserves the reference kind', () => {
  it('tells the adapter an embedded reference is a client_sdk one', async () => {
    const { service, calls } = harness({
      gateway_reference: 'dd1983ac-c9e7-4dc3-ae16-2dae32c51235',
      next_action_kind: 'client_sdk',
    })

    await service.sweep()

    expect(calls).toHaveLength(1)
    // Without this the adapter looks a payment id up as an invoice id.
    expect(calls[0].referenceKind).toBe('client_sdk')
    expect(calls[0].gatewayReference).toBe(
      'dd1983ac-c9e7-4dc3-ae16-2dae32c51235',
    )
  })

  it('tells the adapter a redirect reference is a redirect one', async () => {
    const { service, calls } = harness({
      gateway_reference: 'inv_123',
      next_action_kind: 'redirect',
    })

    await service.sweep()

    expect(calls[0].referenceKind).toBe('redirect')
  })

  it('asks nothing at all when there is no reference yet', async () => {
    // An embedded attempt has no provider reference until the browser or
    // a webhook reports one. Polling with a null reference would be a
    // request about nothing.
    const { service, calls } = harness({
      gateway_reference: null,
      next_action_kind: 'client_sdk',
    })

    expect(await service.sweep()).toBe(0)
    expect(calls).toHaveLength(0)
  })
})

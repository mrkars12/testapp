import { PrismaClient, Prisma } from '@prisma/client'
import type { PaymentProviderKey } from '@prisma/client'
import { WebhookAccountResolver } from './webhook-account-resolver.service'
import { ProviderRegistry } from '../gateways/provider-registry.service'
import { StripeAdapter } from '../gateways/adapters/stripe/stripe.adapter'
import { CodAdapter } from '../gateways/adapters/cod.adapter'
import type { IPaymentProvider } from '../gateways/payment-provider.interface'
import type { WebhookAccountRef } from '../gateways/webhook-resolution'
import type { GatewayCapabilities } from '../gateways/provider.types'
import type { StripeClientLike } from '../gateways/adapters/stripe/stripe-client'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../../test/db-test-harness'

/**
 * Resolution against a real database.
 *
 * The pure strategy decision is covered by `webhook-resolution.spec.ts`;
 * what needs a schema is the other half — turning a reference into the
 * one account it names, and refusing to guess when it names more than
 * one.
 *
 * The payload-scoped adapter here is a contract fixture, not a provider.
 * Its body shape is this test's own invention and nothing about it is
 * taken from any real gateway.
 */

const SLUG = 'spec-resolver'

/** A gateway key that is in the catalog but has no shipped adapter. */
const PENDING_GATEWAY = 'paymob'

function stripeClient(): StripeClientLike {
  return {
    checkout: {
      sessions: {
        create: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/c/pay/cs', payment_intent: 'pi' }),
        retrieve: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/c/pay/cs', payment_intent: 'pi' }),
      },
    },
    paymentIntents: {
      create: async () => ({ id: 'pi', status: 'succeeded', currency: 'usd', amount: 1 }),
      retrieve: async () => ({ id: 'pi', status: 'succeeded', currency: 'usd', amount: 1 }),
      capture: async () => ({ id: 'pi', status: 'succeeded', currency: 'usd', amount: 1 }),
      cancel: async () => ({ id: 'pi', status: 'canceled', currency: 'usd', amount: 1 }),
    },
    refunds: { create: async () => ({ id: 're', status: 'succeeded', amount: 1 }) },
    balance: { retrieve: async () => ({ object: 'balance' }) },
    webhooks: { constructEvent: () => ({}) as never },
  }
}

/**
 * An adapter that routes by a merchant reference inside the body.
 *
 * Registered under a catalog gateway that has no shipped adapter, purely
 * so the resolution path can be exercised end to end. It implements no
 * provider API: `extractWebhookAccountRef` reads a field this test made
 * up, and nothing else here talks to anything.
 */
function payloadScopedFixture(): IPaymentProvider {
  const capabilities: GatewayCapabilities = {
    ...new CodAdapter().capabilities,
    gateway: PENDING_GATEWAY,
    methods: ['card'],
    automaticCapture: true,
    webhooks: true,
    statusPolling: true,
    webhookResolution: 'payload_scoped',
    nextActionKinds: ['redirect'],
    offlineCommitmentKind: null,
  }

  return {
    capabilities,
    validateCredentials: async () => ({ valid: true }),
    initializePayment: async () => ({
      kind: 'pending',
      pollAfterSeconds: 5,
      refs: { gatewayReference: 'ref' },
    }),
    fetchStatus: async () => [],
    parseWebhook: async () => [],
    extractWebhookAccountRef: ({ rawBody }): WebhookAccountRef | null => {
      try {
        const parsed = JSON.parse(rawBody.toString('utf8')) as { merchant?: unknown }
        return typeof parsed.merchant === 'string'
          ? { kind: 'provider_account', providerAccountRef: parsed.merchant }
          : null
      } catch {
        return null
      }
    },
  }
}

function registryWith(providers: IPaymentProvider[]): ProviderRegistry {
  const registry = new ProviderRegistry(providers)
  registry.onModuleInit()
  return registry
}

async function withTenant<T>(
  prisma: PrismaClient,
  storeId: bigint,
  mode: string,
  cb: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${storeId.toString()}, true),
        set_config('app.mode', ${mode}, true)
    `
    return cb(tx as Prisma.TransactionClient)
  })
}

describe('WebhookAccountResolver (integration)', () => {
  let prisma: PrismaClient
  let storeId: bigint
  let stripeAccountId: bigint

  beforeAll(async () => {
    prisma = await startTestDatabase()
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)

    const user = await prisma.users.create({
      data: {
        username: 'spec_resolver',
        email: 'spec_resolver@example.test',
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    })

    const store = await prisma.store.create({
      data: {
        name: 'Spec',
        slug: SLUG,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
        payment_mode: 'MERCHANT_GATEWAY',
      },
      select: { id: true },
    })

    storeId = store.id

    const account = await withTenant(prisma, storeId, 'live', (tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: storeId,
          mode: 'live',
          gateway: 'stripe' as PaymentProviderKey,
          display_name: 'Default',
          status: 'active',
        },
        select: { id: true },
      }),
    )

    stripeAccountId = account.id
  })

  const resolver = (providers: IPaymentProvider[]) =>
    new WebhookAccountResolver(prisma as never, registryWith(providers))

  const request = (over: Record<string, unknown> = {}) => ({
    gateway: 'stripe',
    endpointAccountId: stripeAccountId.toString(),
    rawBody: Buffer.from('{}', 'utf8'),
    headers: {},
    ...over,
  })

  describe('endpoint-scoped', () => {
    it('resolves the account the URL names, with its store and mode', async () => {
      const outcome = await resolver([
        new StripeAdapter(() => stripeClient()),
      ]).resolve(request())

      expect(outcome.kind).toBe('resolved')

      if (outcome.kind !== 'resolved') return

      expect(outcome.account.id).toBe(stripeAccountId)
      expect(outcome.account.store_id).toBe(storeId)
      expect(outcome.account.mode).toBe('live')
      expect(outcome.ref).toEqual({ kind: 'account_id', accountId: stripeAccountId })
    })

    it('does not resolve an account that does not exist', async () => {
      const outcome = await resolver([
        new StripeAdapter(() => stripeClient()),
      ]).resolve(request({ endpointAccountId: '999999' }))

      expect(outcome).toEqual({ kind: 'unresolved', reason: 'unknown_account' })
    })

    it('rejects a malformed account segment without throwing', async () => {
      const outcome = await resolver([
        new StripeAdapter(() => stripeClient()),
      ]).resolve(request({ endpointAccountId: 'not-a-number' }))

      expect(outcome).toEqual({
        kind: 'unresolved',
        reason: 'bad_endpoint_account',
      })
    })

    it('still routes a callback whose path names an unregistered gateway', async () => {
      // So ingestion can record the arrival and reject it as a gateway
      // mismatch, rather than the evidence disappearing.
      const outcome = await resolver([
        new StripeAdapter(() => stripeClient()),
      ]).resolve(request({ gateway: 'not_registered' }))

      expect(outcome.kind).toBe('resolved')
    })
  })

  describe('payload-scoped', () => {
    async function seedPendingAccount(ref: string | null, displayName: string) {
      return withTenant(prisma, storeId, 'live', (tx) =>
        tx.paymentAccount.create({
          data: {
            store_id: storeId,
            mode: 'live',
            gateway: PENDING_GATEWAY as PaymentProviderKey,
            display_name: displayName,
            status: 'active',
            connected_account_ref: ref,
          },
          select: { id: true },
        }),
      )
    }

    it('resolves by the provider reference in the body, with no account in the URL', async () => {
      const account = await seedPendingAccount('merchant-alpha', 'Alpha')

      const outcome = await resolver([payloadScopedFixture()]).resolve({
        gateway: PENDING_GATEWAY,
        rawBody: Buffer.from(JSON.stringify({ merchant: 'merchant-alpha' }), 'utf8'),
        headers: {},
      })

      expect(outcome.kind).toBe('resolved')

      if (outcome.kind !== 'resolved') return

      expect(outcome.account.id).toBe(account.id)
      expect(outcome.ref).toEqual({
        kind: 'provider_account',
        providerAccountRef: 'merchant-alpha',
      })
    })

    it('does not resolve a reference no account claims', async () => {
      await seedPendingAccount('merchant-alpha', 'Alpha')

      const outcome = await resolver([payloadScopedFixture()]).resolve({
        gateway: PENDING_GATEWAY,
        rawBody: Buffer.from(JSON.stringify({ merchant: 'merchant-unknown' }), 'utf8'),
        headers: {},
      })

      expect(outcome).toEqual({ kind: 'unresolved', reason: 'unknown_account' })
    })

    it('refuses to guess when two accounts claim one reference', async () => {
      // Attributing it to either would be a guess about someone's money.
      await seedPendingAccount('merchant-alpha', 'Alpha')
      await seedPendingAccount('merchant-alpha', 'Alpha copy')

      const outcome = await resolver([payloadScopedFixture()]).resolve({
        gateway: PENDING_GATEWAY,
        rawBody: Buffer.from(JSON.stringify({ merchant: 'merchant-alpha' }), 'utf8'),
        headers: {},
      })

      expect(outcome).toEqual({ kind: 'unresolved', reason: 'ambiguous_account' })
    })

    it('does not cross gateways on a shared reference string', async () => {
      // A provider reference is only unique within its own provider.
      await withTenant(prisma, storeId, 'live', (tx) =>
        tx.paymentAccount.update({
          where: { id: stripeAccountId, store_id: storeId, mode: 'live' },
          data: { connected_account_ref: 'merchant-alpha' },
        }),
      )

      const outcome = await resolver([payloadScopedFixture()]).resolve({
        gateway: PENDING_GATEWAY,
        rawBody: Buffer.from(JSON.stringify({ merchant: 'merchant-alpha' }), 'utf8'),
        headers: {},
      })

      expect(outcome).toEqual({ kind: 'unresolved', reason: 'unknown_account' })
    })

    it('falls back to the endpoint when the body names no merchant', async () => {
      const account = await seedPendingAccount(null, 'Alpha')

      const outcome = await resolver([payloadScopedFixture()]).resolve({
        gateway: PENDING_GATEWAY,
        endpointAccountId: account.id.toString(),
        rawBody: Buffer.from('{"no":"merchant"}', 'utf8'),
        headers: {},
      })

      expect(outcome.kind).toBe('resolved')
    })

    it('survives a body that is not JSON at all', async () => {
      // The endpoint is unauthenticated; garbage is the normal case.
      const outcome = await resolver([payloadScopedFixture()]).resolve({
        gateway: PENDING_GATEWAY,
        rawBody: Buffer.from('<html>nope</html>', 'utf8'),
        headers: {},
      })

      expect(outcome).toEqual({ kind: 'unresolved', reason: 'not_extractable' })
    })
  })
})

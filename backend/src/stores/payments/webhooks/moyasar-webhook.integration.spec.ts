import { PrismaClient, Prisma } from '@prisma/client'
import type { PaymentProviderKey } from '@prisma/client'
import { WebhookIngestionService } from './webhook-ingestion.service'
import { WebhookAccountResolver } from './webhook-account-resolver.service'
import { ProviderRegistry } from '../gateways/provider-registry.service'
import { MoyasarAdapter } from '../gateways/adapters/moyasar/moyasar.adapter'
import {
  PAID_PAYMENT,
  webhookEvent,
} from '../gateways/adapters/moyasar/moyasar-fixtures'
import type { MoyasarHttp } from '../gateways/adapters/moyasar/moyasar-client'
import { PaymentFactApplier } from '../facts/payment-fact.applier'
import { CheckoutFinalizerService } from '../facts/checkout-finalizer.service'
import { CheckoutSuccessionFundsService } from '../facts/checkout-succession-funds.service'
import { LedgerService } from '../../../ledger/ledger.service'
import { OutboxService } from '../../../common/messaging/outbox.service'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../../test/db-test-harness'

/**
 * Moyasar callbacks, end to end through the real ingestion pipeline.
 *
 * What this proves that the adapter's unit spec cannot:
 *
 *   • The account is resolved from the URL — Moyasar is endpoint-scoped,
 *     so nothing in the unverified body decides where a callback lands.
 *   • Ingestion finds the shared secret under `webhook_secret` and the
 *     adapter compares it against the token in the body.
 *   • A callback with a wrong or missing token is refused *and recorded*,
 *     so an attempt leaves evidence.
 *   • The same event delivered twice is applied once, while a different
 *     event about the same payment is not mistaken for a redelivery.
 *
 * Offline throughout: the transport throws if the callback path ever
 * tries to make an outbound call.
 */

const SLUG = 'spec-moyasar'
const SECRET = 'moyasar_secret_integration'

/** Never reached: nothing in the callback path calls Moyasar. */
const unusedHttp: MoyasarHttp = async () => {
  throw new Error('the webhook path must not call Moyasar')
}

function registry(): ProviderRegistry {
  const instance = new ProviderRegistry([new MoyasarAdapter(unusedHttp)])
  instance.onModuleInit()
  return instance
}

/** Stands in for the credential store. */
const accounts = {
  revealCredentialsForGateway: async () => ({ webhook_secret: SECRET }),
} as never

const body = (event: unknown) => Buffer.from(JSON.stringify(event), 'utf8')

/** Live mode, because the seeded account is a live one. */
const liveEvent = (over: Record<string, unknown> = {}) =>
  webhookEvent({ secretToken: SECRET, live: true, ...over })

async function withTenant<T>(
  prisma: PrismaClient,
  storeId: bigint,
  cb: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${storeId.toString()}, true),
        set_config('app.mode', 'live', true)
    `
    return cb(tx as Prisma.TransactionClient)
  })
}

describe('Moyasar webhook ingestion (integration)', () => {
  let prisma: PrismaClient
  let ingestion: WebhookIngestionService
  let storeId: bigint
  let accountId: bigint

  beforeAll(async () => {
    prisma = await startTestDatabase()

    const providers = registry()

    ingestion = new WebhookIngestionService(
      prisma as never,
      providers,
      accounts,
      new PaymentFactApplier(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        new CheckoutFinalizerService(prisma as never, new OutboxService()),
        new CheckoutSuccessionFundsService(),
      ),
      new WebhookAccountResolver(prisma as never, providers),
    )
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)

    const user = await prisma.users.create({
      data: {
        username: 'spec_moyasar',
        email: 'spec_moyasar@example.test',
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    })

    const store = await prisma.store.create({
      data: {
        name: 'Spec',
        slug: SLUG,
        currency: 'SAR',
        ownerId: user.id,
        updatedAt: new Date(),
        payment_mode: 'MERCHANT_GATEWAY',
      },
      select: { id: true },
    })

    storeId = store.id

    const account = await withTenant(prisma, storeId, (tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: storeId,
          mode: 'live',
          gateway: 'moyasar' as PaymentProviderKey,
          display_name: 'Default',
          status: 'active',
          settlement_currency: 'SAR',
        },
        select: { id: true },
      }),
    )

    accountId = account.id
  })

  const ingest = (over: Partial<Parameters<typeof ingestion.ingest>[0]> = {}) =>
    ingestion.ingest({
      gateway: 'moyasar',
      accountId: accountId.toString(),
      rawBody: body(liveEvent()),
      headers: {},
      query: {},
      ...over,
    })

  const records = () => prisma.webhookEvent.findMany({ orderBy: { id: 'asc' } })

  describe('a callback carrying the right secret token', () => {
    it('is accepted and its facts reach the applier', async () => {
      const result = await ingest()

      // No attempt exists for this invoice, so the facts are unmatched —
      // which is itself the proof that the token was checked and the
      // payment was mapped. Reconciliation picks these up later.
      expect(result.outcome).toBe('unmatched')
      expect(result.factCount).toBe(1)
    })

    it("is recorded with Moyasar's own event id", async () => {
      await ingest()

      const [record] = await records()

      expect(record.gateway).toBe('moyasar')
      expect(record.account_id).toBe(accountId)
      expect(record.store_id).toBe(storeId)
      expect(record.signature_verified).toBe(true)
      expect(record.event_type).toBe('payment_paid')
      expect(record.provider_event_id).toBe(liveEvent().id)
    })

    it('is applied once when delivered twice', async () => {
      await ingest()
      const second = await ingest()

      expect(second.outcome).toBe('duplicate')
      expect(second.factCount).toBe(0)
    })

    it('treats a different event about the same payment as new', async () => {
      // A refund of a paid payment is a distinct event with its own id;
      // dropping it as a duplicate would leave the customer's money
      // unaccounted for.
      await ingest()

      const second = await ingest({
        rawBody: body(
          liveEvent({
            id: 'evt_refund_1',
            type: 'payment_refunded',
            data: { ...PAID_PAYMENT, status: 'refunded', refunded: 100 },
          }),
        ),
      })

      expect(second.outcome).not.toBe('duplicate')

      const rows = await records()
      expect(rows).toHaveLength(2)
      expect(rows[0].provider_event_id).not.toBe(rows[1].provider_event_id)
    })

    it('records a recognised event that implies no fact as ignored', async () => {
      // `payment_verified` is a card check in the tokenization flow, not
      // a charge. Recognised, and correctly inert.
      const result = await ingest({
        rawBody: body(
          liveEvent({
            id: 'evt_verified_1',
            type: 'payment_verified',
            data: { ...PAID_PAYMENT, status: 'verified' },
          }),
        ),
      })

      expect(result.outcome).toBe('ignored')
      expect(result.detail).toBeUndefined()
    })
  })

  describe('a callback that is not properly authenticated', () => {
    it('is refused when the secret token is wrong', async () => {
      const result = await ingest({
        rawBody: body(webhookEvent({ secretToken: 'not-the-secret', live: true })),
      })

      expect(result.outcome).toBe('unsupported')
      expect(result.detail).toBe('authentication_failed')
    })

    it('is refused when the secret token is absent', async () => {
      const { secret_token, ...withoutToken } = liveEvent()

      const result = await ingest({ rawBody: body(withoutToken) })

      expect(result.outcome).toBe('unsupported')
    })

    it('leaves evidence rather than failing silently', async () => {
      await ingest({
        rawBody: body(webhookEvent({ secretToken: 'not-the-secret', live: true })),
      })

      const [record] = await records()

      expect(record.status).toBe('rejected_signature')
      expect(record.failure_code).toBe('authentication_failed')
      expect(record.signature_verified).toBe(false)
      // The body is hashed, never stored — it carries the shared secret.
      expect(record.body_sha256).toHaveLength(64)
    })

    it('applies nothing', async () => {
      await ingest({ rawBody: body(webhookEvent({ secretToken: 'wrong', live: true })) })

      expect(await prisma.paymentAttempt.count()).toBe(0)
    })

    it('refuses a test-mode event delivered to a live account', async () => {
      // Applying it would mix simulated money into real books.
      const result = await ingest({
        rawBody: body(webhookEvent({ secretToken: SECRET, live: false })),
      })

      expect(result.outcome).toBe('unsupported')
      expect(result.detail).toBe('mode_mismatch')
    })
  })

  describe('routing', () => {
    it('takes the account from the URL, not from the body', async () => {
      const other = await withTenant(prisma, storeId, (tx) =>
        tx.paymentAccount.create({
          data: {
            store_id: storeId,
            mode: 'live',
            gateway: 'moyasar' as PaymentProviderKey,
            display_name: 'Secondary',
            status: 'active',
          },
          select: { id: true },
        }),
      )

      await ingest()

      const [record] = await records()

      expect(record.account_id).toBe(accountId)
      expect(record.account_id).not.toBe(other.id)
    })

    it('refuses a callback posted to another gateway path', async () => {
      const result = await ingest({ gateway: 'paymob' })

      expect(result.outcome).toBe('unmatched')
      expect(result.detail).toBe('gateway mismatch')
    })

    it('does not record a callback for an account that does not exist', async () => {
      const result = await ingest({ accountId: '999999' })

      expect(result.outcome).toBe('unmatched')
      expect(await records()).toHaveLength(0)
    })
  })
})

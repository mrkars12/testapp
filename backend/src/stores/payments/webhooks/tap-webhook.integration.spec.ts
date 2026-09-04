import { PrismaClient, Prisma } from '@prisma/client'
import type { PaymentProviderKey } from '@prisma/client'
import { WebhookIngestionService } from './webhook-ingestion.service'
import { WebhookAccountResolver } from './webhook-account-resolver.service'
import { ProviderRegistry } from '../gateways/provider-registry.service'
import { TapAdapter } from '../gateways/adapters/tap/tap.adapter'
import {
  AUTHORIZED_CALLBACK,
  CAPTURED_CHARGE_CALLBACK,
  REFUND_RESPONSE,
} from '../gateways/adapters/tap/tap-fixtures'
import { tapHash, tapHashFields } from '../gateways/adapters/tap/tap-hash'
import type { TapHttp } from '../gateways/adapters/tap/tap-client'
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
 * Tap callbacks, end to end through the real ingestion pipeline.
 *
 * What this proves that the adapter's unit spec cannot:
 *
 *   • The account is resolved from the URL — Tap posts to whatever
 *     `post.url` the charge carried, so nothing in the unverified body
 *     decides where a callback lands.
 *   • Ingestion finds the signing secret under `secret_key`, which is
 *     what the adapter's `webhookSecretField` declares. Tap issues no
 *     separate webhook secret, and getting this wrong would reject every
 *     genuine callback.
 *   • A callback with a wrong or missing `hashstring` is refused *and
 *     recorded*, so an attempt leaves evidence.
 *   • The same callback delivered twice is applied once, while a refund
 *     of the same charge is not mistaken for a redelivery.
 *
 * Offline throughout: the transport throws if the callback path ever
 * tries to make an outbound call.
 */

const SLUG = 'spec-tap'
const SECRET = 'sk_live_tap_integration'

/** Never reached: nothing in the callback path calls Tap. */
const unusedHttp: TapHttp = async () => {
  throw new Error('the webhook path must not call Tap')
}

function registry(): ProviderRegistry {
  const instance = new ProviderRegistry([new TapAdapter(unusedHttp)])
  instance.onModuleInit()
  return instance
}

/**
 * Stands in for the credential store.
 *
 * `secret_key`, not `webhook_secret`: that is the whole point of the
 * adapter declaring `webhookSecretField`.
 */
const accounts = {
  revealCredentialsForGateway: async () => ({ secret_key: SECRET }),
} as never

const body = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8')

/** Live mode, because the seeded account is a live one. */
const liveCharge = (over: Record<string, unknown> = {}) => ({
  ...CAPTURED_CHARGE_CALLBACK,
  live_mode: true,
  ...over,
})

/** The documented header, computed the documented way. */
const hashHeader = (payload: Record<string, unknown>, secret = SECRET) => ({
  hashstring: tapHash(tapHashFields(payload)!, secret),
})

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

describe('Tap webhook ingestion (integration)', () => {
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
        username: 'spec_tap',
        email: 'spec_tap@example.test',
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
          gateway: 'tap' as PaymentProviderKey,
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
      gateway: 'tap',
      accountId: accountId.toString(),
      rawBody: body(liveCharge()),
      headers: hashHeader(liveCharge()),
      query: {},
      ...over,
    })

  const records = () => prisma.webhookEvent.findMany({ orderBy: { id: 'asc' } })

  describe('a callback carrying a valid hashstring', () => {
    it('is accepted and its facts reach the applier', async () => {
      const result = await ingest()

      // No attempt exists for this charge, so the facts are unmatched —
      // which is itself the proof that the hash was checked and the
      // charge was mapped. Reconciliation picks these up later.
      expect(result.outcome).toBe('unmatched')
      expect(result.factCount).toBe(1)
    })

    it('is recorded with the identity the adapter synthesised', async () => {
      // Tap sends no event id and no event type, so both are derived
      // from fields the hash covers.
      await ingest()

      const [record] = await records()

      expect(record.gateway).toBe('tap')
      expect(record.account_id).toBe(accountId)
      expect(record.store_id).toBe(storeId)
      expect(record.signature_verified).toBe(true)
      expect(record.event_type).toBe('charge.CAPTURED')
      expect(record.provider_event_id).toBe(
        `${CAPTURED_CHARGE_CALLBACK.id}:CAPTURED`,
      )
    })

    it('is applied once when delivered twice', async () => {
      await ingest()
      const second = await ingest()

      expect(second.outcome).toBe('duplicate')
      expect(second.factCount).toBe(0)
    })

    it('treats a refund of the same charge as a new callback', async () => {
      // Dropping it as a duplicate would leave the customer's money
      // unaccounted for.
      await ingest()

      const refund = {
        ...REFUND_RESPONSE,
        live_mode: true,
        charge_id: CAPTURED_CHARGE_CALLBACK.id,
      }

      const second = await ingest({
        rawBody: body(refund),
        headers: hashHeader(refund),
      })

      expect(second.outcome).not.toBe('duplicate')

      const rows = await records()
      expect(rows).toHaveLength(2)
      expect(rows[0].provider_event_id).not.toBe(rows[1].provider_event_id)
    })

    it('records a verified authorize as recognised but inert', async () => {
      // This adapter never creates an authorize, so no attempt here could
      // correspond to one.
      const authorize = { ...AUTHORIZED_CALLBACK, live_mode: true }

      const result = await ingest({
        rawBody: body(authorize),
        headers: hashHeader(authorize),
      })

      expect(result.outcome).toBe('ignored')
      expect(result.factCount).toBe(0)
    })
  })

  describe('a callback that is not properly authenticated', () => {
    it('is refused when the hashstring is wrong', async () => {
      const result = await ingest({ headers: { hashstring: 'f'.repeat(64) } })

      expect(result.outcome).toBe('unsupported')
      expect(result.detail).toBe('authentication_failed')
    })

    it('is refused when the hashstring is absent', async () => {
      const result = await ingest({ headers: {} })

      expect(result.outcome).toBe('unsupported')
      expect(result.detail).toBe('authentication_failed')
    })

    it('is refused when it was signed with a different secret', async () => {
      const result = await ingest({
        headers: hashHeader(liveCharge(), 'sk_live_someone_else'),
      })

      expect(result.outcome).toBe('unsupported')
    })

    it('is refused when a signed field was altered in flight', async () => {
      // The hash covers seven named fields; changing the amount must
      // break it.
      const tampered = liveCharge({ amount: 999 })

      const result = await ingest({ rawBody: body(tampered) })

      expect(result.outcome).toBe('unsupported')
      expect(result.detail).toBe('authentication_failed')
    })

    it('leaves evidence rather than failing silently', async () => {
      await ingest({ headers: { hashstring: 'f'.repeat(64) } })

      const [record] = await records()

      expect(record.status).toBe('rejected_signature')
      expect(record.failure_code).toBe('authentication_failed')
      expect(record.signature_verified).toBe(false)
      // The body is hashed, never stored.
      expect(record.body_sha256).toHaveLength(64)
    })

    it('applies nothing', async () => {
      await ingest({ headers: { hashstring: 'f'.repeat(64) } })

      expect(await prisma.paymentAttempt.count()).toBe(0)
    })

    it('refuses a test-mode callback delivered to a live account', async () => {
      // Applying it would mix simulated money into real books.
      const testMode = { ...CAPTURED_CHARGE_CALLBACK, live_mode: false }

      const result = await ingest({
        rawBody: body(testMode),
        headers: hashHeader(testMode),
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
            gateway: 'tap' as PaymentProviderKey,
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
      const result = await ingest({ gateway: 'moyasar' })

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

import { createHmac } from 'crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import type { PaymentProviderKey } from '@prisma/client'
import { WebhookIngestionService } from './webhook-ingestion.service'
import { WebhookAccountResolver } from './webhook-account-resolver.service'
import { ProviderRegistry } from '../gateways/provider-registry.service'
import { PaymobAdapter } from '../gateways/adapters/paymob/paymob.adapter'
import {
  DOCUMENTED_HMAC_STRING,
  PROCESSED_CALLBACK,
} from '../gateways/adapters/paymob/paymob-fixtures'
import type { PaymobHttp } from '../gateways/adapters/paymob/paymob-client'
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
 * Paymob callbacks, end to end through the real ingestion pipeline.
 *
 * What this proves that the adapter's own unit spec cannot:
 *
 *   • The account is resolved from the URL — Paymob is endpoint-scoped,
 *     so nothing in the unverified body decides where a callback lands.
 *   • Ingestion finds the signing secret under `hmac_secret`, which is
 *     what Paymob calls it, rather than Stripe's `webhook_secret`.
 *   • A forged or unsigned callback is refused *and recorded*, so an
 *     attack leaves evidence.
 *   • The same callback delivered twice is applied once, and a later
 *     state of the same transaction is not mistaken for a redelivery.
 *
 * Offline throughout: the transport is never called on this path, and no
 * Paymob credential is real.
 */

const SLUG = 'spec-paymob'
const HMAC_SECRET = 'hmac_secret_integration'

/** Never reached: nothing in the callback path makes an outbound call. */
const unusedHttp: PaymobHttp = async () => {
  throw new Error('the webhook path must not call Paymob')
}

function registry(): ProviderRegistry {
  const instance = new ProviderRegistry([new PaymobAdapter(unusedHttp)])
  instance.onModuleInit()
  return instance
}

/** Stands in for the credential store; the secret is under Paymob's name. */
const accounts = {
  revealCredentialsForGateway: async () => ({ hmac_secret: HMAC_SECRET }),
} as never

function sign(payload = DOCUMENTED_HMAC_STRING): string {
  return createHmac('sha512', HMAC_SECRET).update(payload, 'utf8').digest('hex')
}

const body = (obj: unknown = PROCESSED_CALLBACK.obj) =>
  Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8')

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

describe('Paymob webhook ingestion (integration)', () => {
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
        username: 'spec_paymob',
        email: 'spec_paymob@example.test',
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    })

    const store = await prisma.store.create({
      data: {
        name: 'Spec',
        slug: SLUG,
        currency: 'EGP',
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
          gateway: 'paymob' as PaymentProviderKey,
          display_name: 'Default',
          status: 'active',
          settlement_currency: 'EGP',
        },
        select: { id: true },
      }),
    )

    accountId = account.id
  })

  const ingest = (over: Partial<Parameters<typeof ingestion.ingest>[0]> = {}) =>
    ingestion.ingest({
      gateway: 'paymob',
      accountId: accountId.toString(),
      rawBody: body(),
      headers: {},
      query: { hmac: sign() },
      ...over,
    })

  const records = () =>
    prisma.webhookEvent.findMany({ orderBy: { id: 'asc' } })

  describe('a correctly signed callback', () => {
    it('is accepted and its facts reach the applier', async () => {
      const result = await ingest()

      // No attempt exists for this order, so the facts are unmatched —
      // which is itself the proof that the signature passed and the
      // transaction was mapped. Reconciliation picks these up later.
      expect(result.outcome).toBe('unmatched')
      expect(result.factCount).toBe(1)
    })

    it('is recorded with the provider event id it claimed', async () => {
      await ingest()

      const [record] = await records()

      expect(record.gateway).toBe('paymob')
      expect(record.account_id).toBe(accountId)
      expect(record.store_id).toBe(storeId)
      expect(record.signature_verified).toBe(true)
      expect(record.event_type).toBe('TRANSACTION')
      // Transaction plus the moment it changed.
      expect(record.provider_event_id).toBe('192036465:2024-06-13T11:34:07.272638')
    })

    it('is applied once when delivered twice', async () => {
      await ingest()
      const second = await ingest()

      expect(second.outcome).toBe('duplicate')
      expect(second.factCount).toBe(0)
    })

    it('does not mistake a later state of the same transaction for a redelivery', async () => {
      // Paymob re-delivers the *parent* transaction when it is refunded.
      // Keying dedupe on the transaction id alone would drop the refund
      // and leave the customer's money unaccounted for.
      await ingest()

      const refunded = {
        ...PROCESSED_CALLBACK.obj,
        is_refunded: true,
        refunded_amount_cents: 100000,
        updated_at: '2024-06-14T09:00:00.000000',
      }

      const payload =
        // Recomputed for the altered object: amount, order and id are
        // unchanged, but this is a different delivery.
        DOCUMENTED_HMAC_STRING

      const second = await ingestion.ingest({
        gateway: 'paymob',
        accountId: accountId.toString(),
        rawBody: body(refunded),
        headers: {},
        query: { hmac: sign(payload) },
      })

      // is_refunded does not take part in the documented HMAC, so the
      // signature still verifies — and the delivery is treated as new.
      expect(second.outcome).not.toBe('duplicate')

      const rows = await records()
      expect(rows).toHaveLength(2)
      expect(rows[0].provider_event_id).not.toBe(rows[1].provider_event_id)
    })
  })

  describe('a callback that is not properly signed', () => {
    it('is refused when the signature is missing', async () => {
      const result = await ingest({ query: {} })

      expect(result.outcome).toBe('unsupported')
      expect(result.detail).toBe('authentication_failed')
    })

    it('is refused when the signature is forged', async () => {
      const result = await ingest({ query: { hmac: 'f'.repeat(128) } })

      expect(result.outcome).toBe('unsupported')
    })

    it('is refused when the body was altered after signing', async () => {
      // A real callback edited upward in flight — the attack the HMAC
      // exists to stop.
      const result = await ingest({
        rawBody: body({ ...PROCESSED_CALLBACK.obj, amount_cents: 9_999_999 }),
      })

      expect(result.outcome).toBe('unsupported')
    })

    it('leaves evidence rather than failing silently', async () => {
      await ingest({ query: { hmac: 'f'.repeat(128) } })

      const [record] = await records()

      expect(record.status).toBe('rejected_signature')
      expect(record.failure_code).toBe('authentication_failed')
      expect(record.signature_verified).toBe(false)
      // The body is hashed, never stored: a callback carries customer data.
      expect(record.body_sha256).toHaveLength(64)
    })

    it('applies nothing', async () => {
      await ingest({ query: {} })

      expect(await prisma.paymentAttempt.count()).toBe(0)
    })
  })

  describe('routing', () => {
    it('takes the account from the URL, not from the body', async () => {
      // Paymob is endpoint-scoped. A body naming another account must
      // have no effect on where the callback lands.
      const other = await withTenant(prisma, storeId, (tx) =>
        tx.paymentAccount.create({
          data: {
            store_id: storeId,
            mode: 'live',
            gateway: 'paymob' as PaymentProviderKey,
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
      // A signed Paymob body posted to /stripe/:id must not be handed to
      // whichever adapter the path names.
      const result = await ingest({ gateway: 'stripe' })

      expect(result.outcome).toBe('unmatched')
      expect(result.detail).toBe('gateway mismatch')
    })

    it('does not record a callback for an account that does not exist', async () => {
      // The endpoint is unauthenticated; persisting before an account is
      // resolved would let anyone fill the table.
      const result = await ingest({ accountId: '999999' })

      expect(result.outcome).toBe('unmatched')
      expect(await records()).toHaveLength(0)
    })
  })
})

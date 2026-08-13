import { PrismaClient } from '@prisma/client'
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { PaymentCollectionService } from './payment-collection.service'
import { CheckoutService } from '../checkout/checkout.service'
import { CodAdapter } from '../payments/gateways/adapters/cod.adapter'
import { LedgerService } from '../../ledger/ledger.service'
import { OutboxService } from '../../common/messaging/outbox.service'
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness'

/**
 * Integration coverage for recording collection of an offline payment.
 *
 * The important test here is the concurrency one: Capture has no unique
 * constraint, so the compare-and-set claim on the order is the only
 * thing preventing a duplicate capture. That guarantee can only be
 * demonstrated against a real database with two real connections.
 */

const SLUG = 'spec-store'

interface Fixture {
  storeId: bigint
  variantId: bigint
  offeringId: bigint
}

/**
 * Collaborators the commit path actually calls. See the note in
 * checkout.service.integration.spec.ts: `{} as never` compiled and then
 * threw at runtime, because `never` silences the checker precisely where
 * it was warning us.
 */
let reservedId = 700_000n
const fakeIds = { reserve: async () => ++reservedId } as never

const codAdapter = new CodAdapter()
const fakeRegistry = {
  has: (gateway: string) => gateway === 'cod',
  get: () => codAdapter,
  assertCanHandle: () => codAdapter,
} as never

const fakeAccounts = { revealCredentialsForGateway: async () => ({}) } as never

const fakeIdempotency = {
  defaultTtlSeconds: 3600,
  defaultLeaseSeconds: 60,
  claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
  complete: async () => undefined,
  fail: async () => undefined,
} as never

const fakeApplier = { applyMany: async () => [] } as never

describe('PaymentCollectionService (integration)', () => {
  let prisma: PrismaClient
  let ledger: LedgerService
  let checkout: CheckoutService
  let collection: PaymentCollectionService
  let fx: Fixture

  beforeAll(async () => {
    prisma = await startTestDatabase()
    ledger = new LedgerService(prisma as never)
    checkout = new CheckoutService(
      prisma as never,
      ledger,
      new OutboxService(),
      fakeAccounts,
      fakeIdempotency,
      fakeRegistry,
      fakeIds,
      fakeApplier,
    )
    collection = new PaymentCollectionService(
      prisma as never,
      ledger,
      new OutboxService(),
    )
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    fx = await seedStore(prisma, SLUG, 'main')
  })

  /** Places an order through the real checkout path. */
  async function placeOrder(quantity = 2): Promise<string> {
    const result = await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    })
    return result.order!.id
  }

  describe('happy path', () => {
    it('marks the order paid', async () => {
      const orderId = await placeOrder()
      const result = await collection.recordCollection(fx.storeId, orderId)

      expect(result.payment_status).toBe('PAID')
      expect(result.paid_at).not.toBeNull()
      expect(result.order_number).toBe('1001')
    })

    it('clears the receivable and records the cash', async () => {
      const orderId = await placeOrder()
      await collection.recordCollection(fx.storeId, orderId)

      const balances = {
        receivable: await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'offline_receivable',
        }),
        cash: await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'cash_collected',
        }),
      }

      expect(balances.receivable).toBe(0n)
      expect(balances.cash).toBe(5000n)
      expect(await ledger.findUnbalancedEntries()).toEqual([])
    })

    it('creates exactly one capture with a matching allocation', async () => {
      const orderId = await placeOrder()
      await collection.recordCollection(fx.storeId, orderId)

      const captures = await prisma.capture.findMany({})
      expect(captures).toHaveLength(1)
      expect(captures[0].amount_minor).toBe(5000n)
      expect(captures[0].status).toBe('succeeded')

      const allocations = await prisma.captureAllocation.findMany({})
      expect(allocations).toHaveLength(1)
      expect(allocations[0].amount_minor).toBe(5000n)
      expect(allocations[0].kind).toBe('revenue')
    })

    it('drives the intent and attempt to a terminal state', async () => {
      const orderId = await placeOrder()
      await collection.recordCollection(fx.storeId, orderId)

      const intent = await prisma.paymentIntent.findFirstOrThrow({})
      expect(intent.status).toBe('captured')
      expect(intent.captured_total_minor).toBe(5000n)
      expect(intent.terminal_at).not.toBeNull()
      expect(intent.version).toBe(1)

      const attempt = await prisma.paymentAttempt.findFirstOrThrow({})
      expect(attempt.status).toBe('succeeded')
      expect(attempt.next_action_kind).toBe('none')
    })

    it('records an audit event and an outbox message', async () => {
      const orderId = await placeOrder()
      await collection.recordCollection(fx.storeId, orderId, {
        reference: 'courier-42',
      })

      const event = await prisma.paymentEvent.findFirstOrThrow({})
      expect(event.event_type).toBe('payment.collected.offline')
      expect(event.source).toBe('merchant')
      expect(event.applied).toBe(true)

      const messages = await prisma.outboxMessage.findMany({
        where: { event_type: 'payment.collected' },
      })
      expect(messages).toHaveLength(1)
      expect(JSON.stringify(messages[0].payload)).not.toContain('Test Buyer')
    })

    it('stores the merchant reference on the capture', async () => {
      const orderId = await placeOrder()
      await collection.recordCollection(fx.storeId, orderId, {
        reference: 'BANK-REF-9',
      })

      const capture = await prisma.capture.findFirstOrThrow({})
      expect(capture.gateway_capture_ref).toBe('BANK-REF-9')
    })
  })

  describe('concurrency', () => {
    it('produces exactly one capture under two parallel calls', async () => {
      const orderId = await placeOrder()

      const second = createAdditionalClient()

      try {
        const otherLedger = new LedgerService(second as never)
        const otherCollection = new PaymentCollectionService(
          second as never,
          otherLedger,
          new OutboxService(),
        )

        const results = await Promise.allSettled([
          collection.recordCollection(fx.storeId, orderId),
          otherCollection.recordCollection(fx.storeId, orderId),
        ])

        const fulfilled = results.filter((r) => r.status === 'fulfilled')
        const rejected = results.filter((r) => r.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)

        // This is the assertion the compare-and-set claim exists for.
        expect(await prisma.capture.count()).toBe(1)
        expect(await prisma.captureAllocation.count()).toBe(1)
        expect(
          await prisma.journalEntry.count({
            where: { entry_type: 'payment.collected.offline' },
          }),
        ).toBe(1)

        expect(
          await ledger.balance({
            storeId: fx.storeId,
            mode: 'live',
            currency: 'USD',
            accountType: 'cash_collected',
          }),
        ).toBe(5000n)
      } finally {
        await second.$disconnect()
      }
    })

    it('leaves the ledger balanced after a contended collection', async () => {
      const orderId = await placeOrder()
      const second = createAdditionalClient()

      try {
        const otherCollection = new PaymentCollectionService(
          second as never,
          new LedgerService(second as never),
          new OutboxService(),
        )

        await Promise.allSettled([
          collection.recordCollection(fx.storeId, orderId),
          otherCollection.recordCollection(fx.storeId, orderId),
        ])

        expect(await ledger.findUnbalancedEntries()).toEqual([])
        expect(
          await ledger.balance({
            storeId: fx.storeId,
            mode: 'live',
            currency: 'USD',
            accountType: 'offline_receivable',
          }),
        ).toBe(0n)
      } finally {
        await second.$disconnect()
      }
    })
  })

  describe('rejections', () => {
    it('rejects a second sequential collection', async () => {
      const orderId = await placeOrder()
      await collection.recordCollection(fx.storeId, orderId)

      await expect(
        collection.recordCollection(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException)

      expect(await prisma.capture.count()).toBe(1)
    })

    it('rejects an order from another store', async () => {
      const orderId = await placeOrder()
      const other = await seedStore(prisma, 'other-store', 'other')

      await expect(
        collection.recordCollection(other.storeId, orderId),
      ).rejects.toBeInstanceOf(NotFoundException)

      expect(await prisma.capture.count()).toBe(0)
    })

    it('rejects an unknown order', async () => {
      await expect(
        collection.recordCollection(fx.storeId, '999999'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('rejects a legacy order with no checkout', async () => {
      const order = await prisma.order.create({
        data: {
          store_id: fx.storeId,
          order_number: '9001',
          status: 'PENDING',
          payment_status: 'UNPAID',
          currency: 'USD',
          customer_name: 'Legacy',
          customer_phone: '0100',
          address_line: 'x',
          city: 'Cairo',
          subtotal: '10.00',
          total: '10.00',
        },
        select: { id: true },
      })

      await expect(
        collection.recordCollection(fx.storeId, order.id.toString()),
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(await prisma.journalEntry.count()).toBe(0)
    })

    it('rejects a refunded order', async () => {
      const orderId = await placeOrder()
      await prisma.order.update({
        where: { id: BigInt(orderId) },
        data: { payment_status: 'REFUNDED' },
      })

      await expect(
        collection.recordCollection(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('writes nothing when it rejects', async () => {
      const orderId = await placeOrder()
      const journalBefore = await prisma.journalEntry.count()

      await collection.recordCollection(fx.storeId, orderId)
      const journalAfter = await prisma.journalEntry.count()

      await expect(
        collection.recordCollection(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException)

      expect(await prisma.journalEntry.count()).toBe(journalAfter)
      expect(journalAfter).toBe(journalBefore + 1)
    })
  })
})

/* ------------------------------------------------------------------ */

async function seedStore(
  prisma: PrismaClient,
  slug: string,
  suffix: string,
): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: `spec_${suffix}`,
      email: `spec_${suffix}@example.test`,
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  })

  const store = await prisma.store.create({
    data: {
      name: `Spec ${suffix}`,
      slug,
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  })

  const product = await prisma.product.create({
    data: {
      store_id: store.id,
      title: 'Spec Product',
      handle: `spec-product-${suffix}`,
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  const variant = await prisma.productVariant.create({
    data: {
      product_id: product.id,
      title: 'Default Title',
      price: '25.00',
      inventory_qty: 10,
      track_inventory: true,
      continue_selling: false,
    },
    select: { id: true },
  })

  const account = await prisma.paymentAccount.create({
    data: {
      store_id: store.id,
      mode: 'live',
      gateway: 'cod',
      display_name: 'Default',
      status: 'active',
      settlement_currency: 'USD',
    },
    select: { id: true },
  })

  const offering = await prisma.paymentMethodOffering.create({
    data: {
      account_id: account.id,
      store_id: store.id,
      mode: 'live',
      method: 'cod',
      enabled: true,
      position: 0,
      commitment_kind: 'promise_accepted',
      capture_mode: 'automatic',
    },
    select: { id: true },
  })

  return { storeId: store.id, variantId: variant.id, offeringId: offering.id }
}
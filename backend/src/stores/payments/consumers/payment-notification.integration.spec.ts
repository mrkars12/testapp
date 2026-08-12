import { PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { SchedulerRegistry } from '@nestjs/schedule'
import { OutboxService } from '../../../common/messaging/outbox.service'
import { OutboxDispatcherService } from '../../../common/messaging/outbox-dispatcher.service'
import { OutboxHandlerRegistry } from '../../../common/messaging/outbox-handler.registry'
import { ConsumedEventService } from '../../../common/messaging/consumed-event.service'
import { NotificationRepository } from '../../../notifications/notification.repository'
import { PaymentNotificationConsumer } from './payment-notification.consumer'
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../../test/db-test-harness'

/**
 * Integration coverage for outbox delivery to the notification consumer.
 *
 * Unit tests prove the consumer's own logic. What only a real database
 * and the real dispatcher can prove is the part that has already gone
 * wrong once: that a handler which fails is actually retried rather than
 * having its consumption claim silently swallow it, and that a message
 * delivered twice produces one notification, not two.
 */

const OWNER = 'owner-room'

/** Records realtime pushes instead of opening a socket. */
class FakeRealtime {
  readonly pushed: { userId: string; event: string }[] = []
  shouldThrow = false

  notifyUser(userId: string, event: string): void {
    if (this.shouldThrow) throw new Error('socket down')
    this.pushed.push({ userId, event })
  }
}

/** Wraps the real repository so a write can be made to fail once. */
class FlakyRepository {
  failuresRemaining = 0

  constructor(private readonly inner: NotificationRepository) {}

  async create(input: Parameters<NotificationRepository['create']>[0]) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1
      throw new Error('notification write exploded')
    }
    return this.inner.create(input)
  }
}

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    messaging: {
      dispatcherEnabled: true,
      pollIntervalMs: 5000,
      batchSize: 50,
      leaseSeconds: 60,
      maxAttempts: 3,
      backoffBaseSeconds: 0,
      ...overrides,
    },
  }
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService
}

function makeScheduler(): SchedulerRegistry {
  return {
    addInterval: () => undefined,
    deleteInterval: () => undefined,
    doesExist: () => false,
  } as unknown as SchedulerRegistry
}

describe('payment notifications over the outbox (integration)', () => {
  let prisma: PrismaClient
  let outbox: OutboxService
  let registry: OutboxHandlerRegistry
  let consumed: ConsumedEventService
  let dispatcher: OutboxDispatcherService
  let realtime: FakeRealtime
  let repository: FlakyRepository
  let storeId: bigint
  let ownerId: bigint

  beforeAll(async () => {
    prisma = await startTestDatabase()
    outbox = new OutboxService()
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)

    const seeded = await seed(prisma)
    storeId = seeded.storeId
    ownerId = seeded.ownerId

    realtime = new FakeRealtime()
    repository = new FlakyRepository(new NotificationRepository(prisma as never))
    registry = new OutboxHandlerRegistry()
    consumed = new ConsumedEventService(prisma as never)

    const consumer = new PaymentNotificationConsumer(
      prisma as never,
      repository as never,
      realtime as never,
      registry,
    )
    consumer.onModuleInit()

    dispatcher = new OutboxDispatcherService(
      prisma as never,
      makeConfig(),
      registry,
      consumed,
      makeScheduler(),
    )
  })

  /** Emits an event the way production does: inside a transaction. */
  async function emit(
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<bigint> {
    return prisma.$transaction((tx) =>
      outbox.emit(tx as never, {
        storeId,
        mode: 'live',
        aggregateType: 'order',
        aggregateId: '1',
        eventType,
        payload: {
          orderId: '11',
          orderNumber: '1001',
          amountMinor: '5000',
          currency: 'USD',
          ...payload,
        },
        occurredAt: new Date(),
      }),
    )
  }

  describe('delivery', () => {
    it('turns a committed checkout into a notification for the owner', async () => {
      await emit('checkout.committed')

      expect(await dispatcher.dispatchBatch()).toBe(1)

      const notification = await prisma.notifications.findFirstOrThrow({})
      expect(notification.user_id).toBe(ownerId)
      expect(notification.type).toBe('order.placed')
      expect(notification.read_at).toBeNull()
      expect(notification.created_at).not.toBeNull()
    })

    it('pushes to the owner room as well as persisting', async () => {
      await emit('checkout.committed')
      await dispatcher.dispatchBatch()

      expect(realtime.pushed).toEqual([
        { userId: ownerId.toString(), event: 'payment_event' },
      ])
    })

    it('marks the message published', async () => {
      const id = await emit('checkout.committed')
      await dispatcher.dispatchBatch()

      const message = await prisma.outboxMessage.findFirstOrThrow({
        where: { id },
      })
      expect(message.status).toBe('published')
    })

    it('delivers all four payment events', async () => {
      for (const eventType of [
        'checkout.committed',
        'payment.collected',
        'order.cancelled',
        'payment.refunded',
      ]) {
        await emit(eventType)
      }

      expect(await dispatcher.dispatchBatch()).toBe(4)

      const types = await prisma.notifications.findMany({
        orderBy: { id: 'asc' },
        select: { type: true },
      })
      expect(types.map((t) => t.type)).toEqual([
        'order.placed',
        'payment.collected',
        'order.cancelled',
        'payment.refunded',
      ])
    })

    it('carries no customer details into the notification', async () => {
      await emit('checkout.committed')
      await dispatcher.dispatchBatch()

      const notification = await prisma.notifications.findFirstOrThrow({})
      expect(JSON.stringify(notification.data)).not.toContain('@')
      expect(JSON.stringify(notification.data)).toContain('1001')
    })
  })

  describe('retry on handler failure', () => {
    it('retries a failed handler and eventually delivers', async () => {
      repository.failuresRemaining = 1
      const id = await emit('checkout.committed')

      // First pass fails inside the handler.
      await dispatcher.dispatchBatch()

      let message = await prisma.outboxMessage.findFirstOrThrow({ where: { id } })
      expect(message.status).toBe('pending')
      expect(message.attempts).toBe(1)
      expect(message.last_error).toContain('exploded')
      expect(await prisma.notifications.count()).toBe(0)

      // Second pass succeeds. This only works because the dispatcher
      // releases the consumption claim when a handler throws — without
      // that the retry skips the handler and marks it published.
      await dispatcher.dispatchBatch()

      message = await prisma.outboxMessage.findFirstOrThrow({ where: { id } })
      expect(message.status).toBe('published')
      expect(await prisma.notifications.count()).toBe(1)
    })

    it('writes exactly one notification despite the failed attempt', async () => {
      repository.failuresRemaining = 1
      await emit('checkout.committed')

      await dispatcher.dispatchBatch()
      await dispatcher.dispatchBatch()

      expect(await prisma.notifications.count()).toBe(1)
    })

    it('dead-letters after the attempt limit', async () => {
      repository.failuresRemaining = 99
      const id = await emit('checkout.committed')

      await dispatcher.dispatchBatch()
      await dispatcher.dispatchBatch()
      await dispatcher.dispatchBatch()

      const message = await prisma.outboxMessage.findFirstOrThrow({ where: { id } })
      expect(message.status).toBe('dead')
      expect(await prisma.notifications.count()).toBe(0)
      expect(await dispatcher.deadLetterCount()).toBe(1)
    })

    it('does not fail the handler when realtime is down', async () => {
      // A merchant with no tab open is normal. Failing here would retry
      // and write a second notification.
      realtime.shouldThrow = true
      const id = await emit('checkout.committed')

      await dispatcher.dispatchBatch()

      const message = await prisma.outboxMessage.findFirstOrThrow({ where: { id } })
      expect(message.status).toBe('published')
      expect(await prisma.notifications.count()).toBe(1)
    })
  })

  describe('deduplication', () => {
    it('does not redeliver a message already consumed', async () => {
      await emit('checkout.committed')

      expect(await dispatcher.dispatchBatch()).toBe(1)
      // Nothing pending, so nothing to do.
      expect(await dispatcher.dispatchBatch()).toBe(0)

      expect(await prisma.notifications.count()).toBe(1)
    })

    it('records the consumption once', async () => {
      await emit('checkout.committed')
      await dispatcher.dispatchBatch()

      const consumedRows = await prisma.consumedEvent.findMany({})
      expect(consumedRows).toHaveLength(1)
      expect(consumedRows[0].consumer_name).toBe('payments.notifications')
    })

    it('writes one notification when two dispatchers race the same message', async () => {
      await emit('checkout.committed')

      const second = createAdditionalClient()

      try {
        const otherRegistry = new OutboxHandlerRegistry()
        const otherConsumer = new PaymentNotificationConsumer(
          second as never,
          new NotificationRepository(second as never) as never,
          new FakeRealtime() as never,
          otherRegistry,
        )
        otherConsumer.onModuleInit()

        const otherDispatcher = new OutboxDispatcherService(
          second as never,
          makeConfig(),
          otherRegistry,
          new ConsumedEventService(second as never),
          makeScheduler(),
        )

        // FOR UPDATE SKIP LOCKED means exactly one of these claims it.
        const [a, b] = await Promise.all([
          dispatcher.dispatchBatch(),
          otherDispatcher.dispatchBatch(),
        ])

        expect(a + b).toBe(1)
        expect(await prisma.notifications.count()).toBe(1)
      } finally {
        await second.$disconnect()
      }
    })

    it('does not write twice if the same message is handled again directly', async () => {
      // Belt and braces: the outbox marker guards the notification even
      // if consumed_events were bypassed.
      const id = await emit('checkout.committed')
      await dispatcher.dispatchBatch()

      const message = await prisma.outboxMessage.findFirstOrThrow({ where: { id } })

      const consumer = new PaymentNotificationConsumer(
        prisma as never,
        repository as never,
        realtime as never,
        new OutboxHandlerRegistry(),
      )

      await consumer.handle({
        id: message.id,
        storeId,
        mode: 'live',
        aggregateType: 'order',
        aggregateId: '1',
        eventType: 'checkout.committed',
        eventVersion: 1,
        payload: message.payload as Record<string, unknown>,
        attempts: 0,
        occurredAt: new Date(),
      })

      expect(await prisma.notifications.count()).toBe(1)
    })
  })

  describe('events that cannot be delivered', () => {
    it('acknowledges rather than retrying when the store is gone', async () => {
      const id = await emit('checkout.committed')
      await prisma.store.deleteMany({ where: { id: storeId } })

      await dispatcher.dispatchBatch()

      const message = await prisma.outboxMessage.findFirstOrThrow({ where: { id } })
      expect(message.status).toBe('published')
      expect(await prisma.notifications.count()).toBe(0)
    })
  })
})

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient) {
  const user = await prisma.users.create({
    data: {
      username: OWNER,
      email: `${OWNER}@example.test`,
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  })

  const store = await prisma.store.create({
    data: {
      name: 'Spec',
      slug: 'spec-notify',
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  })

  return { storeId: store.id, ownerId: user.id }
}
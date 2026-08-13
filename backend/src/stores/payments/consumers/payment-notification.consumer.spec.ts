import { PaymentNotificationConsumer } from './payment-notification.consumer'
import type { OutboxRecord } from '../../../common/messaging/messaging.types'

/**
 * Unit coverage for the parts that need no database: which events are
 * registered, what gets written, and the failure boundaries.
 */

const record = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 7n,
  storeId: 1n,
  mode: 'live',
  aggregateType: 'checkout',
  aggregateId: '1',
  eventType: 'checkout.committed',
  eventVersion: 1,
  payload: { orderId: '11', orderNumber: '1001', amountMinor: '5000', currency: 'USD' },
  attempts: 0,
  occurredAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
})

function build(over: {
  store?: unknown
  existing?: unknown
  realtimeThrows?: boolean
} = {}) {
  const created: Record<string, unknown>[] = []
  const pushed: Record<string, unknown>[] = []
  const registered: string[] = []

  const delegates = {
    store: {
      // `??` would fall through on an explicit null, which is exactly the
      // case being tested, so presence is checked instead.
      findFirst: async () =>
        'store' in over ? over.store : { id: 1n, ownerId: 99n, name: 'Spec' },
    },
    notifications: { findFirst: async () => over.existing ?? null },
  }

  // The consumer reads through guarded(), matching PrismaService. The
  // stub exposes the same surface rather than the production code being
  // reshaped to suit the test.
  const prisma = { ...delegates, guarded: () => delegates } as never

  const notifications = {
    create: async (input: Record<string, unknown>) => {
      created.push(input)
      return 1n
    },
  } as never

  const realtime = {
    notifyUser: (userId: string, event: string, payload: Record<string, unknown>) => {
      if (over.realtimeThrows) throw new Error('socket down')
      pushed.push({ userId, event, payload })
    },
  } as never

  const registry = {
    register: (eventType: string) => registered.push(eventType),
  } as never

  const consumer = new PaymentNotificationConsumer(
    prisma,
    notifications,
    realtime,
    registry,
  )

  return { consumer, created, pushed, registered }
}

describe('registration', () => {
  it('registers for exactly the four payment events', () => {
    const { consumer, registered } = build()
    consumer.onModuleInit()

    expect(registered).toEqual([
      'checkout.committed',
      'payment.collected',
      'order.cancelled',
      'payment.refunded',
    ])
  })

  it('has a stable consumer name — it is half the dedupe key', () => {
    expect(build().consumer.consumerName).toBe('payments.notifications')
  })
})

describe('writing the notification', () => {
  it('notifies the store owner, not the store', async () => {
    const { consumer, created } = build()
    await consumer.handle(record())

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ userId: 99n, type: 'order.placed' })
  })

  it('carries identifiers only, never customer details', async () => {
    const { consumer, created } = build()
    await consumer.handle(
      record({
        payload: {
          orderId: '11',
          orderNumber: '1001',
          amountMinor: '5000',
          currency: 'USD',
        },
      }),
    )

    const data = created[0].data as Record<string, unknown>
    expect(data.order_number).toBe('1001')
    expect(JSON.stringify(data)).not.toContain('@')
  })

  it('stamps a marker derived from the message id', async () => {
    const { consumer, created } = build()
    await consumer.handle(record({ id: 42n }))

    expect((created[0].data as Record<string, unknown>).outbox_marker).toBe(
      'outbox:42',
    )
  })

  it('phrases each event distinctly', async () => {
    const cases = [
      ['checkout.committed', 'order.placed'],
      ['payment.collected', 'payment.collected'],
      ['order.cancelled', 'order.cancelled'],
      ['payment.refunded', 'payment.refunded'],
    ] as const

    for (const [eventType, type] of cases) {
      const { consumer, created } = build()
      await consumer.handle(record({ eventType }))
      expect(created[0]).toMatchObject({ type })
    }
  })
})

describe('idempotency', () => {
  it('writes nothing when the marker already exists', async () => {
    // The dispatcher retries a handler that failed partway. Without this
    // the retry would write a second notification.
    const { consumer, created } = build({ existing: { id: 5n } })
    await consumer.handle(record())

    expect(created).toHaveLength(0)
  })
})

describe('failure boundaries', () => {
  it('acknowledges an event it cannot phrase rather than retrying forever', async () => {
    const { consumer, created } = build()
    await expect(
      consumer.handle(record({ eventType: 'something.else' })),
    ).resolves.toBeUndefined()
    expect(created).toHaveLength(0)
  })

  it('drops the event when the store is gone', async () => {
    // Retrying cannot bring a deleted store back, so failing would burn
    // three attempts and dead-letter for nothing.
    const { consumer, created } = build({ store: null })
    await expect(consumer.handle(record())).resolves.toBeUndefined()
    expect(created).toHaveLength(0)
  })

  it('still succeeds when realtime delivery fails', async () => {
    // A merchant with no tab open is normal. Throwing here would retry
    // and write a second notification.
    const { consumer, created } = build({ realtimeThrows: true })
    await expect(consumer.handle(record())).resolves.toBeUndefined()
    expect(created).toHaveLength(1)
  })

  it('pushes to the owner room after persisting', async () => {
    const { consumer, pushed } = build()
    await consumer.handle(record())

    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({ userId: '99', event: 'payment_event' })
  })
})
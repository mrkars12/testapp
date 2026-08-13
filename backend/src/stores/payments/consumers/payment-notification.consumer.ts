import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import { NotificationRepository } from '../../../notifications/notification.repository'
import { RealtimeGateway } from '../../../realtime/realtime.gateway'
import { OutboxHandlerRegistry } from '../../../common/messaging/outbox-handler.registry'
import type { OutboxRecord } from '../../../common/messaging/messaging.types'

/**
 * ==================================================================
 * Notifying the merchant about payment events
 * ==================================================================
 *
 * Until now the outbox emitted correctly and the registry was empty, so
 * every checkout.committed, payment.collected, order.cancelled and
 * payment.refunded was marked `no_handlers` and discarded. A customer
 * could complete a card payment and nobody would ever be told.
 *
 * Three properties this consumer has to hold, because the dispatcher
 * guarantees at-least-once delivery, not exactly-once:
 *
 *   Idempotent. The dispatcher records consumption per consumer, but a
 *   handler that fails partway is retried, so writing a notification
 *   must not produce two on the second attempt. Guarded by a
 *   deterministic marker in the notification's data column.
 *
 *   Cheap. A slow handler holds the message's lease and starves the
 *   queue. This does one lookup and one insert.
 *
 *   Failure-honest. Realtime delivery is best-effort — a merchant with
 *   no socket open is normal, not an error — but a failed *persist* must
 *   throw, so the dispatcher retries rather than dropping the event.
 */

/** One consumer name per concern; it is half the dedupe key. */
const CONSUMER = 'payments.notifications'

const HANDLED_EVENTS = [
  'checkout.committed',
  'payment.collected',
  'order.cancelled',
  'payment.refunded',
] as const

interface Notice {
  type: string
  title: string
  message: string
}

@Injectable()
export class PaymentNotificationConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentNotificationConsumer.name)

  readonly consumerName = CONSUMER

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationRepository,
    private readonly realtime: RealtimeGateway,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  /**
   * Registered here rather than in the messaging module, so the registry
   * never has to know which modules produce consumers.
   */
  onModuleInit(): void {
    for (const eventType of HANDLED_EVENTS) {
      this.registry.register(eventType, this)
    }
  }

  async handle(message: OutboxRecord): Promise<void> {
    const notice = this.describe(message)

    // An event we registered for but cannot phrase is a programming
    // error, not a delivery failure; retrying would never fix it.
    if (!notice) {
      this.logger.warn(
        `No notification defined for ${message.eventType}; acknowledging.`,
      )
      return
    }

    const store = await this.prisma.guarded().store.findFirst({
      where: { id: message.storeId },
      select: { id: true, ownerId: true, name: true },
    })

    if (!store) {
      // The store is gone. Retrying cannot bring it back, and throwing
      // would burn three attempts before dead-lettering for no reason.
      this.logger.warn(
        `Store ${message.storeId} no longer exists; dropping ${message.eventType}.`,
      )
      return
    }

    // Deterministic from the message id, so a retry after a partial
    // failure finds its own earlier write instead of duplicating it.
    const marker = `outbox:${message.id}`

    const existing = await this.prisma.guarded().notifications.findFirst({
      where: {
        user_id: store.ownerId,
        type: notice.type,
        data: { path: ['outbox_marker'], equals: marker },
      },
      select: { id: true },
    })

    if (existing) {
      this.logger.debug(`Notification for message ${message.id} already written.`)
      return
    }

    await this.notifications.create({
      userId: store.ownerId,
      type: notice.type,
      title: notice.title,
      message: notice.message,
      data: {
        outbox_marker: marker,
        event_type: message.eventType,
        store_id: message.storeId.toString(),
        mode: message.mode,
        // Identifiers only. The outbox carries no customer details, and
        // copying them here would route PII around the access controls
        // that guard the order itself.
        order_id: message.payload.orderId ?? null,
        order_number: message.payload.orderNumber ?? null,
        amount_minor: message.payload.amountMinor ?? null,
        currency: message.payload.currency ?? null,
      },
    })

    // Best effort. A merchant with no tab open is the normal case, so a
    // realtime failure must not fail the handler and force a retry that
    // would write a second notification.
    try {
      this.realtime.notifyUser(store.ownerId.toString(), 'payment_event', {
        eventType: message.eventType,
        orderId: message.payload.orderId ?? null,
        orderNumber: message.payload.orderNumber ?? null,
        title: notice.title,
      })
    } catch (error) {
      this.logger.warn(
        `Realtime push failed for message ${message.id}: ${(error as Error).message}`,
      )
    }
  }

  /** Phrasing per event. Amounts are not formatted here — the payload
   *  carries minor units and the client knows the locale. */
  private describe(message: OutboxRecord): Notice | null {
    const orderNumber = message.payload.orderNumber ?? ''

    switch (message.eventType) {
      case 'checkout.committed':
        return {
          type: 'order.placed',
          title: 'طلب جديد',
          message: `وصلك طلب جديد رقم ${orderNumber}.`,
        }

      case 'payment.collected':
        return {
          type: 'payment.collected',
          title: 'تم تحصيل الدفع',
          message: `الطلب رقم ${orderNumber} اتدفع.`,
        }

      case 'order.cancelled':
        return {
          type: 'order.cancelled',
          title: 'طلب اتلغى',
          message: `الطلب رقم ${orderNumber} اتلغى.`,
        }

      case 'payment.refunded':
        return {
          type: 'payment.refunded',
          title: 'استرداد',
          message: `تم استرداد مبلغ على الطلب رقم ${orderNumber}.`,
        }

      default:
        return null
    }
  }
}
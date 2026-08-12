import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  CURRENT_EVENT_VERSION,
  OutboxEnvelope,
  assertPayloadIsSafe,
} from './messaging.types'

/**
 * كتابة الأحداث في صندوق الصادر.
 *
 * ⚠️ **بياخد عميل الـ transaction من المستدعي.** ده جوهر الفكرة:
 * الحدث بيتكتب جوه نفس الـ transaction بتاعة تغيير الحالة، فمستحيل
 * الحالة تتحفظ والحدث يضيع أو العكس.
 *
 * الاستخدام المتوقع في المرحلة 1b:
 *
 *   await this.prisma.$transaction(async (tx) => {
 *     const order = await tx.order.create({ ... })
 *     await this.outbox.emit(tx, {
 *       storeId, mode,
 *       aggregateType: 'checkout',
 *       aggregateId: checkout.id.toString(),
 *       eventType: 'checkout.committed',
 *       payload: { checkoutId, orderId: order.id.toString() },
 *     })
 *   })
 *
 * ❌ ماينفعش يتنادى بـ PrismaService مباشرةً برّه transaction — ساعتها
 * الضمانة بتضيع وبتبقى كتابة مزدوجة عادية.
 */
@Injectable()
export class OutboxService {
  async emit(
    tx: Prisma.TransactionClient,
    envelope: OutboxEnvelope,
  ): Promise<bigint> {
    assertPayloadIsSafe(envelope.payload)

    const created = await tx.outboxMessage.create({
      data: {
        store_id: envelope.storeId,
        mode: envelope.mode,
        aggregate_type: envelope.aggregateType,
        aggregate_id: envelope.aggregateId,
        event_type: envelope.eventType,
        event_version: envelope.eventVersion ?? CURRENT_EVENT_VERSION,
        payload: envelope.payload as Prisma.InputJsonValue,
        occurred_at: envelope.occurredAt ?? new Date(),
      },
      select: { id: true },
    })

    return created.id
  }

  /** يكتب أكتر من حدث في نفس الـ transaction */
  async emitMany(
    tx: Prisma.TransactionClient,
    envelopes: readonly OutboxEnvelope[],
  ): Promise<void> {
    // الفحص كله الأول: صف واحد غير آمن مايخلّيش أي صف يتكتب
    for (const envelope of envelopes) {
      assertPayloadIsSafe(envelope.payload)
    }

    await tx.outboxMessage.createMany({
      data: envelopes.map((envelope) => ({
        store_id: envelope.storeId,
        mode: envelope.mode,
        aggregate_type: envelope.aggregateType,
        aggregate_id: envelope.aggregateId,
        event_type: envelope.eventType,
        event_version: envelope.eventVersion ?? CURRENT_EVENT_VERSION,
        payload: envelope.payload as Prisma.InputJsonValue,
        occurred_at: envelope.occurredAt ?? new Date(),
      })),
    })
  }
}

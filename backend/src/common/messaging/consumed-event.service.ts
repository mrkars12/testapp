import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { isUniqueConstraintError } from '../idempotency/idempotency.types'
import { OutboxRecord } from './messaging.types'

/**
 * منع التكرار على مستوى المستهلك.
 *
 * التسليم at-least-once: الموزّع ممكن يسلّم نفس الرسالة مرتين (انتهاء
 * حجز أثناء معالجة بطيئة، أو إعادة تشغيل بعد فشل جزئي).
 *
 * القيد الفريد (consumer_name, message_id) **هو** الضمانة — مش فحص
 * في الكود. الفحص بيسيب فرصة لطلبين متوازيين يعدّوا الاتنين.
 */
@Injectable()
export class ConsumedEventService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * بيحاول يحجز الرسالة للمستهلك ده.
   *
   * @returns true لو دي أول مرة، false لو اتستهلكت قبل كده
   */
  async tryConsume(
    consumerName: string,
    message: OutboxRecord,
    result = 'ok',
  ): Promise<boolean> {
    try {
      await this.prisma.consumedEvent.create({
        data: {
          consumer_name: consumerName,
          message_id: message.id,
          store_id: message.storeId,
          mode: message.mode,
          result,
        },
        select: { id: true },
      })
      return true
    } catch (error) {
      if (isUniqueConstraintError(error)) return false
      throw error
    }
  }

  /**
   * Releases a claim so the message can be retried.
   *
   * The claim is taken before the handler runs, which is what makes
   * concurrent delivery safe. But a handler that throws would otherwise
   * leave the claim behind, and every later attempt would skip it — the
   * message would be marked published without ever being processed.
   */
  async release(consumerName: string, messageId: bigint): Promise<void> {
    await this.prisma.consumedEvent.deleteMany({
      where: { consumer_name: consumerName, message_id: messageId },
    })
  }

  async wasConsumed(consumerName: string, messageId: bigint): Promise<boolean> {
    const found = await this.prisma.consumedEvent.findFirst({
      where: { consumer_name: consumerName, message_id: messageId },
      select: { id: true },
    })
    return found !== null
  }
}
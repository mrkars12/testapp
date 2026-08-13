import { Injectable, Logger } from '@nestjs/common'
import { OutboxHandler } from './messaging.types'

/**
 * سجل مستهلكي الأحداث.
 *
 * **فاضي في المرحلة 1a** — الصندوق بيتبني كبنية تحتية بس، وأول مستهلك
 * إنتاجي (إنشاء الطلب من checkout.committed) بييجي في 1b.
 *
 * التسجيل بيحصل في onModuleInit بتاع الموديول المالك للمستهلك، عشان
 * مايبقاش في اعتماد دائري بين الموديولات.
 */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly logger = new Logger(OutboxHandlerRegistry.name)
  private readonly handlers = new Map<string, OutboxHandler[]>()

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType) ?? []

    if (existing.some((h) => h.consumerName === handler.consumerName)) {
      throw new Error(
        `المستهلك "${handler.consumerName}" متسجّل قبل كده على الحدث "${eventType}".`,
      )
    }

    existing.push(handler)
    this.handlers.set(eventType, existing)

    this.logger.log(`مستهلك مسجّل: ${handler.consumerName} ← ${eventType}`)
  }

  handlersFor(eventType: string): readonly OutboxHandler[] {
    return this.handlers.get(eventType) ?? []
  }

  hasHandlers(eventType: string): boolean {
    return (this.handlers.get(eventType)?.length ?? 0) > 0
  }

  registeredEventTypes(): string[] {
    return [...this.handlers.keys()]
  }
}

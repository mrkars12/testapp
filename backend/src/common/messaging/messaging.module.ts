import { Module } from '@nestjs/common'
import { ConsumedEventService } from './consumed-event.service'
import { OutboxDispatcherService } from './outbox-dispatcher.service'
import { OutboxHandlerRegistry } from './outbox-handler.registry'
import { OutboxService } from './outbox.service'

/**
 * صندوق الصادر (Transactional Outbox).
 *
 * سجل المستهلكين **فاضي في المرحلة 1a** — الموزّع بيشتغل على جدول
 * فاضي في الإنتاج. أول منتج ومستهلك بييجوا في المرحلة 1b.
 *
 * الموديول مصدّر السجل عشان موديولات 1b تقدر تسجّل مستهلكيها في
 * onModuleInit من غير اعتماد دائري.
 */
@Module({
  providers: [
    OutboxService,
    OutboxHandlerRegistry,
    ConsumedEventService,
    OutboxDispatcherService,
  ],
  exports: [
    OutboxService,
    OutboxHandlerRegistry,
    ConsumedEventService,
    OutboxDispatcherService,
  ],
})
export class MessagingModule {}

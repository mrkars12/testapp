import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller'
import { NotificationRepository } from './notification.repository'
import { PrismaModule } from '../prisma/prisma.module'

/**
 * Notifications.
 *
 * The controller keeps its existing behaviour untouched. The repository
 * is added and exported so the payment outbox consumers have one write
 * path instead of reaching for PrismaService themselves.
 */
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationRepository],
  exports: [NotificationRepository],
})
export class NotificationsModule {}
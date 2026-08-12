import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/**
 * ==================================================================
 * Persisting a notification
 * ==================================================================
 *
 * The smallest abstraction the outbox consumers need: one write.
 *
 * Deliberately not a NotificationsService that absorbs the controller's
 * read and mark-as-read logic. That code works, it belongs to the
 * controller's own concerns, and moving it would be an unrelated
 * refactor riding along with this milestone.
 *
 * created_at and updated_at are nullable with no database default, so
 * they are set explicitly — a row without them sorts unpredictably in
 * the controller's `orderBy: { created_at: 'desc' }`.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: bigint
    type: string
    title: string
    message: string
    data?: Record<string, unknown>
  }): Promise<bigint> {
    const now = new Date()

    const created = await this.prisma.notifications.create({
      data: {
        user_id: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: (input.data ?? null) as Prisma.InputJsonValue,
        created_at: now,
        updated_at: now,
      },
      select: { id: true },
    })

    return created.id
  }
}
// src/notifications/notifications.controller.ts
import { Controller, Get, Post, Param, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getNotifications(
    @Query('page') page: string = '1', 
    @Query('limit') limit: string = '10', 
    @Req() req
  ) {
    const userId = BigInt(req.user.sub);
    const p = Number(page);
    const l = Number(limit);
    const skip = (p - 1) * l;

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notifications.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: l,
        skip: skip,
      }),
      this.prisma.notifications.count({ where: { user_id: userId } }),
      this.prisma.notifications.count({ where: { user_id: userId, read_at: null } })
    ]);

    return {
      notifications: {
        // تحويل الـ IDs داخل المصفوفة لـ Strings لكي لا ينكسر الفرونت-إند
        data: notifications.map(n => ({ ...n, id: n.id.toString() })),
        current_page: p,
        last_page: Math.ceil(total / l),
        total: total
      },
      unread_count: unreadCount
    };
  }

  @Post(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req) {
    const userId = BigInt(req.user.sub);
    
    await this.prisma.notifications.updateMany({
      where: { 
        id: BigInt(id), 
        user_id: userId 
      },
      data: { read_at: new Date() }
    });
    
    return { success: true };
  }

  @Post('mark-all-read')
  async markAllRead(@Req() req) {
    const userId = BigInt(req.user.sub);
    
    await this.prisma.notifications.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() }
    });
    
    return { success: true };
  }
}
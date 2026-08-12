import {
  Controller, Get, Put,
  Body, Param, Query, UseGuards,
} from '@nestjs/common'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import { OrderService } from './order.service'
import { OrderStatus } from '@prisma/client'
import { ActiveStoreGuard } from '../active-store.guard'
import { ActiveStore } from '../active-store.decorator'
import type { store as StoreRecord } from '@prisma/client'

@Controller('stores/orders')
@UseGuards(SessionAuthGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @UseGuards(ActiveStoreGuard)
  async getOrders(
    @ActiveStore() store: StoreRecord,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.orderService.getOrders(store.id, {
      status,
      search,
      page: parseInt(page),
      limit: parseInt(limit),
    })
  }

  @Get(':id')
  @UseGuards(ActiveStoreGuard)
  async getOrder(@Param('id') id: string, @ActiveStore() store: StoreRecord) {
    return this.orderService.getOrder(store.id, id)
  }

  @Put(':id/status')
  @UseGuards(ActiveStoreGuard)
  async updateStatus(
    @Param('id') id: string,
    @ActiveStore() store: StoreRecord,
    @Body() body: { status: OrderStatus },
  ) {
    return this.orderService.updateOrderStatus(store.id, id, body.status)
  }
}

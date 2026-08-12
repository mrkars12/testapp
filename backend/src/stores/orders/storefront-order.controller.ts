import { Controller, Get, Post, Param, Body } from '@nestjs/common'
import { OrderService } from './order.service'

@Controller('storefront')
export class StorefrontOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get(':slug/orders/:orderNumber')
  async getOrder(
    @Param('slug') slug: string,
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.orderService.getStorefrontOrder(slug, orderNumber)
  }
}

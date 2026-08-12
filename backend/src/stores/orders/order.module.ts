import { Module } from '@nestjs/common'
import { OrderController } from './order.controller'
import { StorefrontOrderController } from './storefront-order.controller'
import { OrderService } from './order.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { ActiveStoreModule } from '../active-store.module'

@Module({
  imports: [PrismaModule, ActiveStoreModule],
  controllers: [OrderController, StorefrontOrderController],
  providers: [OrderService],
})
export class OrderModule {}

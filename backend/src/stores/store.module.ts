import { Module } from '@nestjs/common'
import { StoreController } from './store.controller'
import { StorePublicController } from './store-public.controller'
import { StoreService } from './store.service'
import { PrismaService } from '../prisma/prisma.service'
import { ActiveStoreModule } from './active-store.module'

@Module({
  imports: [ActiveStoreModule],
  controllers: [StoreController, StorePublicController],
  providers: [StoreService, PrismaService],
  exports: [StoreService],
})
export class StoreModule {}
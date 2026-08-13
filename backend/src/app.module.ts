import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { WalletModule } from './wallet/wallet.module'
import { DevicesModule } from './devices/devices.module'
import { NotificationsModule } from './notifications/notifications.module'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { StoreModule } from './stores/store.module'
import { ProductModule } from './stores/products/product.module'
import { OrderModule } from './stores/orders/order.module'
import { CollectionsModule } from './stores/collections/collections.module'
import { PaymentsModule } from './stores/payments/payments.module'
import { CheckoutModule } from './stores/checkout/checkout.module'
import { UploadsModule } from './uploads/uploads.module'
import { ActiveStoreModule } from './stores/active-store.module'
import { CryptoModule } from './common/crypto/crypto.module'
import { TenantModule } from './common/tenant/tenant.module'
import { IdsModule } from './common/ids/ids.module'
import { IdempotencyModule } from './common/idempotency/idempotency.module'
import { MessagingModule } from './common/messaging/messaging.module'
import { LedgerModule } from './ledger/ledger.module'
import { configurationLoaders } from './common/config/configuration'
import { validateEnv } from './common/config/env.validation'
import { ThrottlerModule } from '@nestjs/throttler'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configurationLoaders,
      validate: validateEnv,
    }),

    ScheduleModule.forRoot(),

    // Rate limiting configuration only. ThrottlerGuard is applied on the
    // public storefront checkout controller, not globally, so no existing
    // route changes behaviour.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
    ]),

    CryptoModule,
    TenantModule,
    IdsModule,
    MessagingModule,
    IdempotencyModule,
    LedgerModule,

    PrismaModule,
    AuthModule,
    WalletModule,
    DevicesModule,
    NotificationsModule,
    EventEmitterModule.forRoot(),
    CollectionsModule,

    // Must precede OrderModule: both use the 'storefront' prefix, and
    // NestJS matches routes in module registration order. This keeps
    // POST 'storefront/:slug/checkout' ahead of the existing dynamic
    // 'storefront/:slug/orders/:orderNumber' route.
    CheckoutModule,

    OrderModule,
    ProductModule,

    // Must precede StoreModule: both use the 'stores' prefix.
    PaymentsModule,

    StoreModule,
    UploadsModule,
    ActiveStoreModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

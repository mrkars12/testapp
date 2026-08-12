import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { LedgerModule } from '../../ledger/ledger.module'
import { MessagingModule } from '../../common/messaging/messaging.module'
import { IdempotencyModule } from '../../common/idempotency/idempotency.module'
import { IdsModule } from '../../common/ids/ids.module'
import { PaymentsModule } from '../payments/payments.module'
import { GatewaysModule } from '../payments/gateways/gateways.module'
import { CheckoutService } from './checkout.service'
import { CheckoutExpiryJob } from './checkout-expiry.job'
import { StorefrontCheckoutController } from './storefront-checkout.controller'

/**
 * Checkout: cart snapshot, quote, commitment, order creation.
 *
 * Imports PaymentsModule to read merchant bank details for the
 * bank-transfer instructions, and IdempotencyModule so a retried
 * checkout does not create a second order. Neither imports
 * CheckoutModule, so there is no cycle.
 *
 * Registered before OrderModule in app.module so that the static
 * 'storefront/:slug/checkout' route is matched ahead of the existing
 * dynamic 'storefront/:slug/orders/:orderNumber' route.
 */
@Module({
  imports: [
    PrismaModule,
    LedgerModule,
    MessagingModule,
    IdempotencyModule,
    IdsModule,
    PaymentsModule,
    GatewaysModule,
  ],
  controllers: [StorefrontCheckoutController],
  providers: [CheckoutService, CheckoutExpiryJob],
  exports: [CheckoutService, CheckoutExpiryJob],
})
export class CheckoutModule {}
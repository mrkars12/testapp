import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { ActiveStoreModule } from '../active-store.module'
import { CryptoModule } from '../../common/crypto/crypto.module'
import { IdsModule } from '../../common/ids/ids.module'
import { LedgerModule } from '../../ledger/ledger.module'
import { MessagingModule } from '../../common/messaging/messaging.module'
import { GatewaysModule } from './gateways/gateways.module'
import { PaymentAccountService } from './payment-account.service'
import { PaymentSettingsController } from './payment-settings.controller'
import { PaymentCollectionService } from './payment-collection.service'
import { PaymentQueryService } from './payment-query.service'
import { OrderCancellationService } from './order-cancellation.service'
import { PaymentsHealthJob } from './payments-health.job'
import { RefundService } from './refund.service'
import { PaymentNotificationConsumer } from './consumers/payment-notification.consumer'
import { NotificationsModule } from '../../notifications/notifications.module'
import { RealtimeModule } from '../../realtime/realtime.module'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service'
import { ReconciliationService } from './facts/reconciliation.service'
import { WebhookIngestionService } from './webhooks/webhook-ingestion.service'
import { WebhookController } from './webhooks/webhook.controller'
import { PaymentOperationsController } from './payment-operations.controller'

/**
 * Payments: merchant gateway configuration, payment operations and
 * reporting.
 *
 * No gateway adapter talks to a provider yet.
 */
@Module({
  imports: [
    PrismaModule,
    ActiveStoreModule,
    CryptoModule,
    IdsModule,
    LedgerModule,
    MessagingModule,
    GatewaysModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [
    PaymentSettingsController,
    PaymentOperationsController,
    WebhookController,
  ],
  providers: [
    PaymentAccountService,
    PaymentCollectionService,
    PaymentQueryService,
    OrderCancellationService,
    PaymentsHealthJob,
    RefundService,
    PaymentNotificationConsumer,
    PaymentFactApplier,
    CheckoutFinalizerService,
    ReconciliationService,
    WebhookIngestionService,
  ],
  exports: [
    GatewaysModule,
    PaymentAccountService,
    PaymentCollectionService,
    PaymentQueryService,
    OrderCancellationService,
    RefundService,
    PaymentFactApplier,
    CheckoutFinalizerService,
    ReconciliationService,
  ],
})
export class PaymentsModule {}
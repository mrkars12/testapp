import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { ActiveStoreModule } from '../active-store.module'
import { CryptoModule } from '../../common/crypto/crypto.module'
import { IdsModule } from '../../common/ids/ids.module'
import { LedgerModule } from '../../ledger/ledger.module'
import { MessagingModule } from '../../common/messaging/messaging.module'
import { IdempotencyModule } from '../../common/idempotency/idempotency.module'
import { GatewaysModule } from './gateways/gateways.module'
import { PaymentAccountService } from './payment-account.service'
import { PaymentSettingsController } from './payment-settings.controller'
import { PaymentCollectionService } from './payment-collection.service'
import { PaymentQueryService } from './payment-query.service'
import { OrderCancellationService } from './order-cancellation.service'
import { PaymentsHealthJob } from './payments-health.job'
import { RefundService } from './refund.service'
import { PaymentCaptureService } from './payment-capture.service'
import { PaymentNotificationConsumer } from './consumers/payment-notification.consumer'
import { SupersededFundsConsumer } from './consumers/superseded-funds.consumer'
import { NotificationsModule } from '../../notifications/notifications.module'
import { RealtimeModule } from '../../realtime/realtime.module'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service'
import { CheckoutSuccessionFundsService } from './facts/checkout-succession-funds.service'
import { ReconciliationService } from './facts/reconciliation.service'
import { WebhookIngestionService } from './webhooks/webhook-ingestion.service'
import { WebhookAccountResolver } from './webhooks/webhook-account-resolver.service'
import { WebhookController } from './webhooks/webhook.controller'
import { PaymentOperationsController } from './payment-operations.controller'
import { TestPaymentController } from './test-payment.controller'
import { TestPaymentService } from './test-payment.service'

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
    IdempotencyModule,
    GatewaysModule,
    NotificationsModule,
    RealtimeModule,
  ],
  controllers: [
    PaymentSettingsController,
    PaymentOperationsController,
    TestPaymentController,
    WebhookController,
  ],
  providers: [
    PaymentAccountService,
    TestPaymentService,
    PaymentCollectionService,
    PaymentQueryService,
    OrderCancellationService,
    PaymentsHealthJob,
    RefundService,
    PaymentCaptureService,
    PaymentNotificationConsumer,
    SupersededFundsConsumer,
    PaymentFactApplier,
    CheckoutFinalizerService,
    CheckoutSuccessionFundsService,
    ReconciliationService,
    WebhookIngestionService,
    WebhookAccountResolver,
  ],
  exports: [
    GatewaysModule,
    PaymentAccountService,
    PaymentCollectionService,
    PaymentQueryService,
    OrderCancellationService,
    RefundService,
    PaymentCaptureService,
    PaymentFactApplier,
    CheckoutFinalizerService,
    CheckoutSuccessionFundsService,
    ReconciliationService,
  ],
})
export class PaymentsModule {}
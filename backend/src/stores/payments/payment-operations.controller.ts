import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import type { Mode, store as StoreRecord } from '@prisma/client'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import { ActiveStoreGuard } from '../active-store.guard'
import { ActiveStore } from '../active-store.decorator'
import { IDEMPOTENCY_HEADER } from '../../common/idempotency/idempotency.types'
import { PaymentCollectionService } from './payment-collection.service'
import { PaymentQueryService } from './payment-query.service'
import { OrderCancellationService } from './order-cancellation.service'
import { RefundService } from './refund.service'
import { PaymentCaptureService } from './payment-capture.service'
import { RecordCollectionDto } from './dto/record-collection.dto'
import { CancelOrderDto } from './dto/cancel-order.dto'
import { CreateRefundDto } from './dto/create-refund.dto'
import { CapturePaymentDto } from './dto/capture-payment.dto'
import { VoidPaymentDto } from './dto/void-payment.dto'

/**
 * Merchant payment operations and reporting.
 *
 * Routed under 'stores/payments/...' so it cannot collide with the
 * existing 'stores/orders/:id' routes in OrderController.
 */
@Controller('stores')
@UseGuards(SessionAuthGuard)
export class PaymentOperationsController {
  constructor(
    private readonly collection: PaymentCollectionService,
    private readonly query: PaymentQueryService,
    private readonly cancellation: OrderCancellationService,
    private readonly refunds: RefundService,
    private readonly captures: PaymentCaptureService,
  ) {}

  /** Outstanding receivables, cash collected and open work. */
  @Get('payments/summary')
  @UseGuards(ActiveStoreGuard)
  async summary(
    @ActiveStore() store: StoreRecord,
    @Query('mode') mode?: string,
  ) {
    return this.query.summary(store.id, this.resolveMode(mode))
  }

  /** Full payment trail behind one order. */
  @Get('payments/orders/:orderId')
  @UseGuards(ActiveStoreGuard)
  async orderPayment(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Query('mode') mode?: string,
  ) {
    return this.query.orderPayment(store.id, orderId, this.resolveMode(mode))
  }

  /**
   * Records that an offline order (COD / bank transfer) was paid.
   *
   * Every mutation below accepts an optional `Idempotency-Key` header.
   * Sending one makes a retry replay the original result instead of
   * running the operation twice; omitting it keeps the previous
   * behaviour exactly, so existing clients are unaffected.
   */
  @Post('payments/orders/:orderId/collect')
  @UseGuards(ActiveStoreGuard)
  async collect(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Body() body: RecordCollectionDto,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    return this.collection.recordCollection(store.id, orderId, {
      mode: body.mode,
      reference: body.reference,
      idempotencyKey,
    })
  }

  /**
   * Cancels an unpaid order: restocks, reverses the commitment entry and
   * cancels the payment intent.
   */
  @Post('payments/orders/:orderId/cancel')
  @UseGuards(ActiveStoreGuard)
  async cancel(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Body() body: CancelOrderDto,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    return this.cancellation.cancelOrder(store.id, orderId, {
      mode: body.mode,
      reason: body.reason,
      restock: body.restock !== 'false',
      idempotencyKey,
    })
  }

  /**
   * Captures a payment that was authorised but not taken.
   *
   * Only meaningful for an offering configured `capture_mode: manual`.
   * Omit amount_minor to capture everything still authorised.
   */
  @Post('payments/orders/:orderId/capture')
  @UseGuards(ActiveStoreGuard)
  async capture(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Body() body: CapturePaymentDto,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    return this.captures.captureOrder(store.id, orderId, {
      mode: body.mode,
      amountMinor: body.amount_minor ? BigInt(body.amount_minor) : undefined,
      idempotencyKey,
    })
  }

  /** Releases an authorisation that was never captured. */
  @Post('payments/orders/:orderId/void')
  @UseGuards(ActiveStoreGuard)
  async void(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Body() body: VoidPaymentDto,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    return this.captures.voidOrder(store.id, orderId, {
      mode: body.mode,
      reason: body.reason,
      idempotencyKey,
    })
  }

  /**
   * Refunds a paid order, fully or partially.
   *
   * Omit amount_minor to refund whatever is still refundable.
   */
  @Post('payments/orders/:orderId/refund')
  @UseGuards(ActiveStoreGuard)
  async refund(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Body() body: CreateRefundDto,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    return this.refunds.refundOrder(store.id, orderId, {
      mode: body.mode,
      amountMinor: body.amount_minor ? BigInt(body.amount_minor) : undefined,
      reason: body.reason,
      idempotencyKey,
    })
  }

  private resolveMode(raw?: string): Mode {
    return raw === 'test' ? 'test' : 'live'
  }
}
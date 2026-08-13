import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import type { Mode, store as StoreRecord } from '@prisma/client'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import { ActiveStoreGuard } from '../active-store.guard'
import { ActiveStore } from '../active-store.decorator'
import { PaymentCollectionService } from './payment-collection.service'
import { PaymentQueryService } from './payment-query.service'
import { OrderCancellationService } from './order-cancellation.service'
import { RefundService } from './refund.service'
import { RecordCollectionDto } from './dto/record-collection.dto'
import { CancelOrderDto } from './dto/cancel-order.dto'
import { CreateRefundDto } from './dto/create-refund.dto'

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

  /** Records that an offline order (COD / bank transfer) was paid. */
  @Post('payments/orders/:orderId/collect')
  @UseGuards(ActiveStoreGuard)
  async collect(
    @ActiveStore() store: StoreRecord,
    @Param('orderId') orderId: string,
    @Body() body: RecordCollectionDto,
  ) {
    return this.collection.recordCollection(store.id, orderId, {
      mode: body.mode,
      reference: body.reference,
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
  ) {
    return this.cancellation.cancelOrder(store.id, orderId, {
      mode: body.mode,
      reason: body.reason,
      restock: body.restock !== 'false',
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
  ) {
    return this.refunds.refundOrder(store.id, orderId, {
      mode: body.mode,
      amountMinor: body.amount_minor ? BigInt(body.amount_minor) : undefined,
      reason: body.reason,
    })
  }

  private resolveMode(raw?: string): Mode {
    return raw === 'test' ? 'test' : 'live'
  }
}
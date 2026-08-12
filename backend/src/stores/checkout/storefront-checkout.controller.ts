import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { CheckoutService } from './checkout.service'
import { CreateCheckoutDto } from './dto/create-checkout.dto'

/**
 * Public storefront checkout.
 *
 * No auth guard by design; the store is resolved from the slug.
 *
 * ThrottlerGuard is applied here and nowhere else. These are the only
 * unauthenticated endpoints that write: placing an order creates a
 * checkout, an intent, an order, a ledger entry and decrements stock.
 * Applying the guard per-controller rather than globally keeps every
 * existing route, including auth, untouched.
 */
@Controller('storefront')
@UseGuards(ThrottlerGuard)
export class StorefrontCheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get(':slug/payment-methods')
  async paymentMethods(@Param('slug') slug: string) {
    return this.checkout.listPaymentMethods(slug)
  }

  /**
   * Places an order.
   *
   * Send an Idempotency-Key header to make a retry safe: the same key
   * replays the original response instead of creating a second order.
   * The header is optional, so existing clients keep working.
   *
   * Tighter limit than the reads: this is the write path.
   */
  @Post(':slug/checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createCheckout(
    @Param('slug') slug: string,
    @Body() body: CreateCheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.checkout.createAndCommit(slug, body, 'live', idempotencyKey)
  }

  /**
   * Called when the customer returns from a gateway.
   *
   * Asks the provider synchronously before answering, so the page does
   * not depend on a webhook that may not have arrived yet.
   */
  @Post(':slug/checkout/:token/sync')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async syncCheckout(
    @Param('slug') slug: string,
    @Param('token') token: string,
  ) {
    return this.checkout.syncCheckoutStatus(slug, token)
  }

  /**
   * Payment status and any pending customer action, by checkout token.
   *
   * The token is unguessable and scoped to one checkout, unlike a
   * sequential order number.
   */
  @Get(':slug/checkout/:token')
  async checkoutStatus(
    @Param('slug') slug: string,
    @Param('token') token: string,
  ) {
    return this.checkout.getCheckoutStatus(slug, token)
  }
}

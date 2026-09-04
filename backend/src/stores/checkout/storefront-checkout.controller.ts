import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../common/config/configuration';
import { readCartToken, setCartCookie } from '../cart/cart-token';
import { CheckoutService } from './checkout.service';
import { ConfirmEmbeddedPaymentDto } from './dto/confirm-embedded-payment.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

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
  constructor(
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The mode this storefront transacts in.
   *
   * `live` unless a non-production deployment explicitly opted into
   * `test` (see AppConfig.storefrontPaymentMode). Read per request from
   * config rather than captured once, so it is one value that every
   * endpoint below agrees on — a storefront listing test methods and
   * then creating a live checkout would be worse than either alone.
   */
  private get mode(): 'live' | 'test' {
    return this.config.get<AppConfig>('app')?.storefrontPaymentMode ?? 'live';
  }

  /**
   * The shopper's cart cookie, when cart identity is switched on.
   *
   * Returning `null` — no cookie, or the kill switch off — is a fully
   * supported path, not a degraded one: the checkout then behaves
   * exactly as it did before carts existed. That is what makes this
   * deployable and reversible one layer at a time.
   */
  private cartToken(req: Request): string | null {
    const app = this.config.get<AppConfig>('app');
    if (app?.cartIdentityEnabled === false) return null;
    return readCartToken((req as { cookies?: unknown }).cookies);
  }

  @Get(':slug/payment-methods')
  async paymentMethods(@Param('slug') slug: string) {
    return this.checkout.listPaymentMethods(slug, this.mode);
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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const cartToken = this.cartToken(req);

    const result = await this.checkout.createAndCommit(
      slug,
      body,
      this.mode,
      idempotencyKey,
      cartToken,
    );

    if (cartToken) {
      // Refreshes the 30-day window. Placing an order is the strongest
      // signal there is that this shopper is active, and an expiring
      // cookie mid-purchase would silently split one shopper into two.
      setCartCookie(res, cartToken, {
        slug,
        isProduction:
          this.config.get<AppConfig>('app')?.isProduction ?? false,
      });
    }

    /*
     * A CONVERGED answer is 200, not 201.
     *
     * Nothing was created: the second tab was handed the checkout the
     * first tab already made. Saying 201 would tell every cache, every
     * client library and every reader of a log that a resource came
     * into existence here, and one did not.
     */
    if ((result as { converged?: boolean }).converged === true) {
      res.status(200);
    }

    return result;
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
    return this.checkout.syncCheckoutStatus(slug, token, this.mode);
  }

  /**
   * Binds a payment the provider's own browser form created.
   *
   * The embedded counterpart of the redirect flow's return: instead of
   * the customer coming back with a token in the URL, the form hands the
   * page a provider payment id and the page posts it here. The id is a
   * claim — it is re-fetched from the provider with this store's
   * credentials and checked against this checkout's intent before
   * anything is applied. Throttled like the other write.
   */
  @Post(':slug/checkout/:token/confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async confirmEmbeddedPayment(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Body() body: ConfirmEmbeddedPaymentDto,
  ) {
    return this.checkout.confirmEmbeddedPayment(
      slug,
      token,
      body.payment_reference,
      this.mode,
    );
  }

  /**
   * Payment status and any pending customer action, by checkout token.
   *
   * The token is unguessable and scoped to one checkout, unlike a
   * sequential order number.
   */
  /*
   * NO-STORE, on this response only.
   *
   * What this returns is the most sensitive body the storefront has: the
   * customer's own name, email, phone and address while the checkout is
   * still payable (§ `canExposeCheckoutPii`), the order number and the
   * amount once it is paid, and now the identity of the checkout that
   * replaced it. It is addressed by a token that travels in a URL and
   * lives in browser history, and it carried no caching directive at all
   * — only an ETag — which leaves it eligible for heuristic caching by
   * the browser's HTTP cache and by any intermediary.
   *
   * Deliberately on the API response and NOT on the checkout document:
   * `no-store` on an HTML response makes the page ineligible for the
   * back/forward cache in Chrome, and this page's bfcache behaviour is
   * load-bearing (§ the `pageshow` restore path). A header on a JSON
   * body fetched by `fetch()` has no bearing on the document's own
   * cacheability or its bfcache eligibility.
   *
   * Nothing else changes: the page re-reads this endpoint on every
   * mount, every poll and every browser event already, so there was no
   * cache to lose.
   */
  @Header('Cache-Control', 'no-store')
  @Get(':slug/checkout/:token')
  async checkoutStatus(
    @Param('slug') slug: string,
    @Param('token') token: string,
  ) {
    return this.checkout.getCheckoutStatus(slug, token, this.mode);
  }
}

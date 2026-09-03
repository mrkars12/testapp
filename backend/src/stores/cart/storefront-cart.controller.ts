import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AppConfig } from '../../common/config/configuration';
import { CartService, type CartView } from './cart.service';
import { clearCartCookie, readCartToken, setCartCookie } from './cart-token';
import { AddCartItemDto } from './dto/add-item.dto';
import { UpdateCartItemDto } from './dto/update-item.dto';

/**
 * The public storefront cart.
 *
 * Unauthenticated by design, exactly like the checkout controller
 * beside it: the store is resolved from the slug, and the shopper is
 * identified only by an opaque cookie they never see.
 *
 * Throttled, because these are unauthenticated endpoints that write.
 * The limit is looser than checkout's 10/60s: adding to a cart is
 * ordinary browsing and a shopper filling a basket legitimately makes
 * many more of these calls than they ever make of a checkout.
 *
 * `no-store` on every response. A cart view carries a shopper's basket
 * and the identity of their live checkout, addressed by a cookie, and
 * it must never be served to the next visitor out of a shared cache.
 */
@Controller('storefront')
@UseGuards(ThrottlerGuard)
export class StorefrontCartController {
  constructor(
    private readonly carts: CartService,
    private readonly config: ConfigService,
  ) {}

  private get app(): AppConfig | undefined {
    return this.config.get<AppConfig>('app');
  }

  private get mode(): 'live' | 'test' {
    return this.app?.storefrontPaymentMode ?? 'live';
  }

  /**
   * When this is off, every endpoint below answers as if the browser
   * sent no cookie — an empty cart, and no cookie written back. That is
   * the same path a cookieless browser takes, so nothing has to be
   * special-cased anywhere else.
   */
  private get enabled(): boolean {
    return this.app?.cartIdentityEnabled ?? true;
  }

  private token(req: Request): string | null {
    if (!this.enabled) return null;
    return readCartToken((req as { cookies?: unknown }).cookies);
  }

  private cookieScope(slug: string) {
    return { slug, isProduction: this.app?.isProduction ?? false };
  }

  /**
   * The shopper's cart.
   *
   * Mints NOTHING: a read must not create state, so a first-time
   * visitor gets an empty view and leaves with no cookie. A cookie that
   * resolves to no cart is cleared rather than left to be sent on every
   * request for the next thirty days.
   */
  @Header('Cache-Control', 'no-store')
  @Get(':slug/cart')
  async read(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartView> {
    const store = await this.carts.findStore(slug);
    const token = this.token(req);

    const result = await this.carts.view(store.id, this.mode, token);

    if (token && !result.found) {
      clearCartCookie(res, this.cookieScope(slug));
    }

    return result.view;
  }

  /**
   * Adds one line, minting a cart (and a cookie) if there isn't one.
   *
   * The only endpoint that mints. It is also the one that recovers a
   * shopper from a TERMINAL cart: adding to a converted basket produces
   * a brand-new cart with a new token, which is what makes an immediate
   * repeat purchase of the identical basket work.
   */
  @Header('Cache-Control', 'no-store')
  @Post(':slug/cart/items')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async addItem(
    @Param('slug') slug: string,
    @Body() body: AddCartItemDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartView> {
    const store = await this.carts.findStore(slug);

    if (!this.enabled) {
      // The kill switch: behave as a server that has no carts at all.
      return emptyView();
    }

    const result = await this.carts.addItem(
      store.id,
      this.mode,
      this.token(req),
      { variantId: body.variant_id, quantity: body.quantity },
    );

    // Written on every add, not only the first: this is what refreshes
    // the 30-day window for a shopper who keeps coming back.
    setCartCookie(res, result.token, this.cookieScope(slug));

    return result.view;
  }

  /**
   * Sets one line's quantity. Zero removes it.
   *
   * REFUSED with 409 `cart_locked` while a checkout is live. That
   * refusal is the real lock — the storefront's own guard is a
   * reflection of it, and cannot be the enforcement, because a second
   * tab has its own copy of that guard and knows nothing about this
   * one.
   */
  @Header('Cache-Control', 'no-store')
  @Patch(':slug/cart/items/:variantId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async updateItem(
    @Param('slug') slug: string,
    @Param('variantId') variantId: string,
    @Body() body: UpdateCartItemDto,
    @Req() req: Request,
  ): Promise<CartView> {
    const store = await this.carts.findStore(slug);
    if (!this.enabled) return emptyView();

    return this.carts.setQuantity(store.id, this.mode, this.token(req), {
      variantId,
      quantity: body.quantity,
    });
  }

  /** Removes one line. Same refusal as the quantity update. */
  @Header('Cache-Control', 'no-store')
  @Delete(':slug/cart/items/:variantId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async removeItem(
    @Param('slug') slug: string,
    @Param('variantId') variantId: string,
    @Req() req: Request,
  ): Promise<CartView> {
    const store = await this.carts.findStore(slug);
    if (!this.enabled) return emptyView();

    return this.carts.removeItem(
      store.id,
      this.mode,
      this.token(req),
      variantId,
    );
  }

  /**
   * Empties the cart.
   *
   * Deliberately NOT refused while a checkout is live: this is what runs
   * when a payment succeeds, and a lock held by that very payment must
   * not block it. It does not touch the checkout — emptying a basket is
   * not a statement about a payment.
   */
  @Header('Cache-Control', 'no-store')
  @Delete(':slug/cart')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async clear(
    @Param('slug') slug: string,
    @Req() req: Request,
  ): Promise<CartView> {
    const store = await this.carts.findStore(slug);
    if (!this.enabled) return emptyView();

    return this.carts.clear(store.id, this.mode, this.token(req));
  }
}

function emptyView(): CartView {
  return {
    cart_public_id: null,
    version: 0,
    status: 'active',
    items: [],
    active_checkout_token: null,
    converted_order_number: null,
  };
}

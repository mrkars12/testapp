import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Mode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CART_CLAIM_LEASE_SECONDS,
  cartExpiryFrom,
  mintCartPublicId,
  mintCartToken,
} from './cart-token';

/* ══════════════════════════════════════════════════════════════════════
   THE SERVER-AUTHORITATIVE CART.

   What this table answers is not "what is in the basket" — the browser
   could hold that, and did. It answers "are these two tabs buying the
   same thing?", and only a shared server-side row can.

   Two rules govern everything below:

     1. NO MONEY LIVES HERE. A cart holds variant ids and quantities.
        Prices are still resolved in `CheckoutService.resolveLines()`
        out of ProductVariant, at checkout time, exactly as before. A
        cart that carried a price would be a second, weaker source of an
        amount, and the one thing this codebase never does is let a
        client-reachable record influence what is charged.

     2. IDENTITY IS STRUCTURAL, NEVER DERIVED. Nothing here hashes the
        basket's contents to decide whether two purchases are "the
        same". A shopper who buys the same two products again five
        seconds later gets a new cart row and a second order, and that
        is correct. The only constraint asserted is one live checkout
        per cart.
   ══════════════════════════════════════════════════════════════════════ */

/** Bounds the table. A real basket never approaches this. */
const MAX_CART_LINES = 100;

/** Bounds one line. The stock check at checkout is the real limit. */
const MAX_LINE_QUANTITY = 999;

/** What the browser is allowed to know about its own cart. */
export interface CartView {
  cart_public_id: string | null;
  version: number;
  status: 'active' | 'converted' | 'abandoned';
  items: { variant_id: string; quantity: number }[];
  /**
   * IDENTITY, NEVER A VERDICT — the same discipline
   * `superseded_by_token` follows.
   *
   * This is the field that makes two tabs converge BEFORE either one
   * presses Place Order: a tab that has no checkout of its own learns
   * which checkout its cart already has, and goes and reads that
   * checkout's own record for what happened to it. Nothing about a
   * payment travels in this value.
   */
  active_checkout_token: string | null;
  /** Present only once the cart became an order. */
  converted_order_number: string | null;
}

/** A cart row as the claim protocol needs to see it. */
interface CartRow {
  id: bigint;
  public_id: string;
  status: 'active' | 'converted' | 'abandoned';
  active_checkout_id: bigint | null;
  claimed_until: Date | null;
  version: number;
}

/** The line items of a cart, as the checkout will price them. */
export interface CartLine {
  variantId: bigint;
  quantity: number;
}

/**
 * The outcome of Phase A — the claim taken BEFORE the provider is
 * called.
 *
 * Every branch except `claimed` is an instruction to stop, and stopping
 * here is the whole point: the duplicate dies before a single byte
 * reaches the gateway.
 */
export type CartClaim =
  /** No cookie, or a token that resolves to nothing. Stateless path. */
  | { kind: 'no_cart' }
  /** This cart already has a live checkout — use that one. */
  | {
      kind: 'converged';
      checkoutId: bigint;
      checkoutToken: string;
      cartPublicId: string;
      version: number;
    }
  /** Already bought. A repeat purchase needs a NEW cart. */
  | { kind: 'converted'; orderNumber: string | null; cartPublicId: string }
  /** Expired or emptied. Terminal. */
  | { kind: 'not_active'; cartPublicId: string }
  /** Another request is mid-provider-call for this cart right now. */
  | { kind: 'in_flight'; cartPublicId: string }
  /** Won. The lease is held; the caller must release or convert it. */
  | {
      kind: 'claimed';
      cartId: bigint;
      cartPublicId: string;
      version: number;
      lines: CartLine[];
    };

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /* ────────────────────────────────────────────────────────────────
     Store resolution
     ──────────────────────────────────────────────────────────────── */

  /**
   * Resolves a storefront tenant by public slug.
   *
   * Intentionally cross-tenant: there is no store_id available yet.
   * Mirrors `CheckoutService.findStore` exactly, including installing
   * the resolved store on the tenant context so every following guarded
   * query is restricted to it.
   */
  async findStore(slug: string): Promise<{ id: bigint }> {
    const store = await this.prisma
      .guarded()
      .store.findFirst({ where: { slug }, select: { id: true } });

    if (!store) throw new NotFoundException('Store not found.');

    this.tenantContext.setStoreId(store.id.toString());

    return store;
  }

  /* ────────────────────────────────────────────────────────────────
     Reads
     ──────────────────────────────────────────────────────────────── */

  /**
   * The cart behind a cookie, or the empty view.
   *
   * Mints nothing: a GET must not create state, so a browser that has
   * never added anything gets an empty view and no cookie. Every
   * failure to resolve — no cookie, a token from another store, a cart
   * deleted with its store — is the same empty answer, so this cannot
   * be used to probe which tokens exist.
   */
  async view(
    storeId: bigint,
    mode: Mode,
    token: string | null,
  ): Promise<{ view: CartView; token: string | null; found: boolean }> {
    if (!token) return { view: emptyView(), token: null, found: false };

    const resolved = await this.prisma.withTenantTransaction(
      storeId,
      mode,
      async (tx) => this.loadByToken(tx, storeId, mode, token),
    );

    if (!resolved) return { view: emptyView(), token: null, found: false };

    return { view: resolved.view, token, found: true };
  }

  /* ────────────────────────────────────────────────────────────────
     Mutations
     ──────────────────────────────────────────────────────────────── */

  /**
   * Adds (or increments) one line, minting a cart if there isn't one.
   *
   * The two reasons this mints:
   *   - there is no cookie at all (a first-time shopper);
   *   - the cookie's cart is TERMINAL.
   *
   * The second is what makes an immediate repeat purchase work. A
   * converted cart is never revived — the shopper gets a brand-new cart
   * row, a new token and a new cookie value, and buys the identical
   * basket again with no time window and no fingerprint anywhere in the
   * decision.
   *
   * Deliberately NOT refused while a checkout is live, matching the
   * storefront's own asymmetry: adding something elsewhere in the shop
   * is ordinary browsing, it cannot change the amount the provider was
   * already given, and the checkout says out loud when the cart has
   * moved on from the payment.
   */
  async addItem(
    storeId: bigint,
    mode: Mode,
    token: string | null,
    input: { variantId: string; quantity: number },
  ): Promise<{ view: CartView; token: string }> {
    const quantity = assertQuantity(input.quantity, { allowZero: false });
    const variantId = assertVariantId(input.variantId);

    return this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      await this.assertVariantBelongsToStore(tx, storeId, variantId);

      const existing = token
        ? await this.loadByToken(tx, storeId, mode, token)
        : null;

      // A terminal cart is never revived; it is replaced.
      const usable =
        existing && existing.row.status === 'active' ? existing : null;

      const cart = usable ? usable.row : await this.mintCart(tx, storeId, mode);
      const cartToken = usable ? token! : cart.token;

      if (usable) {
        const lineCount = await tx.cartItem.count({
          where: { cart_id: cart.id },
        });
        const already = await tx.cartItem.findFirst({
          where: { cart_id: cart.id, variant_id: variantId },
          select: { id: true, quantity: true },
        });

        if (!already && lineCount >= MAX_CART_LINES) {
          throw new BadRequestException('Cart is full.');
        }

        if (already) {
          await tx.cartItem.update({
            where: { id: already.id },
            data: {
              quantity: Math.min(
                already.quantity + quantity,
                MAX_LINE_QUANTITY,
              ),
            },
          });
        } else {
          await tx.cartItem.create({
            data: { cart_id: cart.id, variant_id: variantId, quantity },
          });
        }
      } else {
        await tx.cartItem.create({
          data: { cart_id: cart.id, variant_id: variantId, quantity },
        });
      }

      const view = await this.touchAndView(tx, storeId, mode, cart.id);
      return { view, token: cartToken };
    });
  }

  /**
   * Sets one line's quantity. Zero removes it.
   *
   * REFUSED while a checkout is live, and this refusal is the real
   * cart lock — the storefront's `cartLockedRef` is now a reflection of
   * it rather than the enforcement. A stale render, a queued event or a
   * second tab all get the same answer here, on the server, where it
   * cannot be bypassed.
   */
  async setQuantity(
    storeId: bigint,
    mode: Mode,
    token: string | null,
    input: { variantId: string; quantity: number },
  ): Promise<CartView> {
    const quantity = assertQuantity(input.quantity, { allowZero: true });
    const variantId = assertVariantId(input.variantId);

    return this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      const resolved = await this.requireMutableCart(tx, storeId, mode, token);

      if (quantity === 0) {
        await tx.cartItem.deleteMany({
          where: { cart_id: resolved.row.id, variant_id: variantId },
        });
      } else {
        const existing = await tx.cartItem.findFirst({
          where: { cart_id: resolved.row.id, variant_id: variantId },
          select: { id: true },
        });

        // A quantity update for something that is not in the cart is not
        // an error worth a message: the answer is the cart as it stands.
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity },
          });
        }
      }

      return this.touchAndView(tx, storeId, mode, resolved.row.id);
    });
  }

  /** Removes one line. Same refusal as `setQuantity`. */
  async removeItem(
    storeId: bigint,
    mode: Mode,
    token: string | null,
    variantIdRaw: string,
  ): Promise<CartView> {
    return this.setQuantity(storeId, mode, token, {
      variantId: variantIdRaw,
      quantity: 0,
    });
  }

  /**
   * Empties the cart.
   *
   * NOT refused while a checkout is live, deliberately: this is what
   * runs when a payment SUCCEEDS, and a lock held by that very payment
   * must not block it. It does not touch `active_checkout_id` — the
   * checkout's own fate is decided by the payment, never by the cart
   * being emptied.
   */
  async clear(
    storeId: bigint,
    mode: Mode,
    token: string | null,
  ): Promise<CartView> {
    if (!token) return emptyView();

    return this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      const resolved = await this.loadByToken(tx, storeId, mode, token);
      if (!resolved) return emptyView();
      if (resolved.row.status !== 'active') return resolved.view;

      await tx.cartItem.deleteMany({ where: { cart_id: resolved.row.id } });

      return this.touchAndView(tx, storeId, mode, resolved.row.id);
    });
  }

  /* ────────────────────────────────────────────────────────────────
     PHASE A — the claim, taken before the provider is called
     ──────────────────────────────────────────────────────────────── */

  /**
   * Serialises two tabs onto one checkout.
   *
   * `SELECT ... FOR UPDATE` on the cart row is the serialisation point:
   * two concurrent transactions cannot both reach the winning branch,
   * because the second blocks on the row lock, then reads the first's
   * COMMITTED result and lands on `converged` or `in_flight` instead.
   *
   * Why a lease rather than holding the transaction: `commit()` calls
   * the provider OUTSIDE any transaction — correctly, because a
   * database transaction must never be held open across network I/O. So
   * the claim is taken in one short transaction, the provider call
   * happens, and Phase B turns the lease into the real claim inside the
   * transaction that creates the checkout. The lease is what makes a
   * process that dies mid-call free the basket by itself.
   */
  async claimForCheckout(
    storeId: bigint,
    mode: Mode,
    token: string | null,
    now = new Date(),
  ): Promise<CartClaim> {
    if (!token) return { kind: 'no_cart' };

    return this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      /*
       * THE SERIALISATION POINT.
       *
       * Raw SQL because `FOR UPDATE` has no Prisma expression. Store
       * and mode are in the predicate as well as in the RLS context, so
       * a token from another merchant is not a token here at all — the
       * lock is taken on a row this tenant may actually see.
       */
      const locked = await tx.$queryRaw<CartRow[]>`
        SELECT id, public_id, status::text AS status, active_checkout_id,
               claimed_until, version
          FROM carts
         WHERE token = ${token}
           AND store_id = ${storeId}
           AND mode::text = ${mode}
         FOR UPDATE
      `;

      const cart = locked[0];
      if (!cart) return { kind: 'no_cart' as const };

      // 1. Already bought. Terminal, and a repeat purchase is a new cart.
      if (cart.status === 'converted') {
        const orderNumber = await this.convertedOrderNumber(
          tx,
          storeId,
          cart.id,
        );
        return {
          kind: 'converted' as const,
          orderNumber,
          cartPublicId: cart.public_id,
        };
      }

      // 2. Expired or emptied. Also terminal.
      if (cart.status !== 'active') {
        return { kind: 'not_active' as const, cartPublicId: cart.public_id };
      }

      // 3. A checkout already exists for this cart — CONVERGE on it.
      //    This is tab B's whole story: it does not create a second
      //    checkout and it does not call the provider a second time. It
      //    is handed the incumbent's token and renders that.
      if (cart.active_checkout_id !== null) {
        const incumbent = await tx.checkout.findFirst({
          where: {
            id: cart.active_checkout_id,
            store_id: storeId,
            mode,
          },
          select: {
            id: true,
            token: true,
            status: true,
            order_id: true,
            expires_at: true,
          },
        });

        const live =
          incumbent !== null &&
          incumbent.order_id === null &&
          (incumbent.status === 'open' ||
            incumbent.status === 'pending_payment') &&
          incumbent.expires_at > now;

        if (live) {
          return {
            kind: 'converged' as const,
            checkoutId: incumbent.id,
            checkoutToken: incumbent.token,
            cartPublicId: cart.public_id,
            version: cart.version,
          };
        }

        /*
         * The slot points at a checkout that is dead — expired, failed,
         * or gone. Clearing it here is safe precisely because we hold
         * the row lock: no other transaction can be deciding the same
         * thing at the same time. Falls through to the claim below, so
         * a shopper whose first attempt expired is not stuck.
         */
        await tx.$executeRaw`
          UPDATE carts
             SET active_checkout_id = NULL, version = version + 1
           WHERE id = ${cart.id}
        `;
        cart.active_checkout_id = null;
        cart.version += 1;
      }

      // 4. Someone else is mid-provider-call for this very cart.
      if (cart.claimed_until !== null && cart.claimed_until > now) {
        return { kind: 'in_flight' as const, cartPublicId: cart.public_id };
      }

      // 5. Won.
      const leaseUntil = new Date(
        now.getTime() + CART_CLAIM_LEASE_SECONDS * 1000,
      );

      await tx.$executeRaw`
        UPDATE carts
           SET claimed_until = ${leaseUntil}, version = version + 1
         WHERE id = ${cart.id}
      `;

      const lines = await tx.cartItem.findMany({
        where: { cart_id: cart.id },
        select: { variant_id: true, quantity: true },
        orderBy: { id: 'asc' },
      });

      return {
        kind: 'claimed' as const,
        cartId: cart.id,
        cartPublicId: cart.public_id,
        version: cart.version + 1,
        lines: lines.map((line) => ({
          variantId: line.variant_id,
          quantity: line.quantity,
        })),
      };
    });
  }

  /* ────────────────────────────────────────────────────────────────
     PHASE B — the lease becomes the real claim
     ──────────────────────────────────────────────────────────────── */

  /**
   * Attaches the new checkout to the cart, INSIDE the transaction that
   * creates it.
   *
   * The guard is the point: `status = 'active' AND active_checkout_id
   * IS NULL`. Zero rows affected means something took the slot between
   * the two phases, and the caller must let the whole transaction roll
   * back — no half-written checkout, intent, attempt or reservation
   * survives, because they were all written in this same transaction.
   *
   * The partial unique index `checkouts_one_live_per_cart` backs this up
   * at the storage layer, so even a future code path that forgot to
   * call this cannot produce a second live checkout for one cart.
   */
  async attachCheckout(
    tx: Prisma.TransactionClient,
    input: { cartId: bigint; storeId: bigint; mode: Mode; checkoutId: bigint },
  ): Promise<void> {
    /*
     * `version` is deliberately NOT bumped here.
     *
     * It was bumped once already, by the claim in Phase A — one shopper
     * action, one increment. Bumping again would put the cart on a
     * version the checkout's `quote_hash` was never sealed against, and
     * every single checkout would then read back as "the basket moved"
     * the instant it was created. The seal has to be comparable, and a
     * detector that fires on everything detects nothing.
     *
     * Taking the slot is also not a change to the BASKET, which is what
     * `version` describes. It is published through
     * `active_checkout_token` instead, which is the field that actually
     * answers "does this cart have a checkout?".
     */
    const claimed = await tx.$executeRaw`
      UPDATE carts
         SET active_checkout_id = ${input.checkoutId},
             claimed_until      = NULL
       WHERE id = ${input.cartId}
         AND store_id = ${input.storeId}
         AND mode::text = ${input.mode}
         AND status = 'active'
         AND active_checkout_id IS NULL
    `;

    if (claimed === 0) {
      throw new ConflictException(
        'This cart already has a checkout in progress.',
      );
    }
  }

  /**
   * Frees the lease when the attempt never became a checkout.
   *
   * Guarded on `active_checkout_id IS NULL` so a late failure can never
   * wipe a slot that a successful attempt has since taken.
   */
  async releaseLease(
    storeId: bigint,
    mode: Mode,
    cartId: bigint,
  ): Promise<void> {
    await this.prisma
      .withTenantTransaction(storeId, mode, async (tx) => {
        await tx.$executeRaw`
          UPDATE carts
             SET claimed_until = NULL
           WHERE id = ${cartId}
             AND store_id = ${storeId}
             AND mode::text = ${mode}
             AND active_checkout_id IS NULL
        `;
      })
      .catch((error: unknown) => {
        // Never masks the original failure that brought us here. The
        // lease expires by itself in 90 seconds anyway.
        this.logger.warn(
          `Releasing cart lease ${cartId} failed: ${(error as Error).message}`,
        );
      });
  }

  /* ────────────────────────────────────────────────────────────────
     Internals
     ──────────────────────────────────────────────────────────────── */

  private async mintCart(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    now = new Date(),
  ): Promise<{ id: bigint; token: string; public_id: string }> {
    return tx.cart.create({
      data: {
        store_id: storeId,
        mode,
        token: mintCartToken(),
        public_id: mintCartPublicId(),
        expires_at: cartExpiryFrom(now),
      },
      select: { id: true, token: true, public_id: true },
    });
  }

  /**
   * The cart a mutation may act on, or the reason it may not.
   *
   * Both refusals carry a code the storefront switches on, and the
   * `cart_locked` one carries the checkout's token — identity, so the
   * tab can go and read that checkout's own record, never a verdict
   * about it.
   */
  private async requireMutableCart(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    token: string | null,
  ) {
    const resolved = token
      ? await this.loadByToken(tx, storeId, mode, token)
      : null;

    if (!resolved) throw new NotFoundException({ code: 'cart_not_found' });

    if (resolved.row.status !== 'active') {
      throw new ConflictException({ code: 'cart_not_active' });
    }

    if (resolved.row.active_checkout_id !== null) {
      throw new ConflictException({
        code: 'cart_locked',
        active_checkout_token: resolved.view.active_checkout_token,
      });
    }

    return resolved;
  }

  private async loadByToken(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    token: string,
  ): Promise<{ row: CartRow & { token: string }; view: CartView } | null> {
    const cart = await tx.cart.findFirst({
      where: { token, store_id: storeId, mode },
      select: {
        id: true,
        token: true,
        public_id: true,
        status: true,
        active_checkout_id: true,
        claimed_until: true,
        version: true,
      },
    });

    if (!cart) return null;

    return {
      row: cart,
      view: await this.buildView(tx, storeId, mode, cart),
    };
  }

  /** Bumps `version`, refreshes the TTL, and returns the new view. */
  private async touchAndView(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    cartId: bigint,
    now = new Date(),
  ): Promise<CartView> {
    const cart = await tx.cart.update({
      where: { id: cartId },
      data: { version: { increment: 1 }, expires_at: cartExpiryFrom(now) },
      select: {
        id: true,
        public_id: true,
        status: true,
        active_checkout_id: true,
        claimed_until: true,
        version: true,
      },
    });

    return this.buildView(tx, storeId, mode, cart);
  }

  private async buildView(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    cart: {
      id: bigint;
      public_id: string;
      status: string;
      active_checkout_id: bigint | null;
      version: number;
    },
  ): Promise<CartView> {
    const items = await tx.cartItem.findMany({
      where: { cart_id: cart.id },
      select: { variant_id: true, quantity: true },
      orderBy: { id: 'asc' },
    });

    /*
     * The live checkout's TOKEN, not its state.
     *
     * Published so a tab that has no checkout of its own can go and read
     * that checkout's record from the status endpoint — the same
     * authoritative round trip it would have made anyway. Nothing about
     * the payment is inferred here.
     */
    const activeCheckoutToken =
      cart.active_checkout_id === null
        ? null
        : ((
            await tx.checkout.findFirst({
              where: {
                id: cart.active_checkout_id,
                store_id: storeId,
                mode,
              },
              select: { token: true },
            })
          )?.token ?? null);

    return {
      cart_public_id: cart.public_id,
      version: cart.version,
      status: cart.status as CartView['status'],
      items: items.map((item) => ({
        variant_id: item.variant_id.toString(),
        quantity: item.quantity,
      })),
      active_checkout_token: activeCheckoutToken,
      converted_order_number:
        cart.status === 'converted'
          ? await this.convertedOrderNumber(tx, storeId, cart.id)
          : null,
    };
  }

  private async convertedOrderNumber(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    cartId: bigint,
  ): Promise<string | null> {
    const cart = await tx.cart.findFirst({
      where: { id: cartId },
      select: { converted_order_id: true },
    });

    if (!cart?.converted_order_id) return null;

    const order = await tx.order.findFirst({
      where: { id: cart.converted_order_id, store_id: storeId },
      select: { order_number: true },
    });

    return order?.order_number ?? null;
  }

  /**
   * A variant the storefront may put in a cart.
   *
   * Ownership comes through Product.store_id — ProductVariant has no
   * store_id of its own — so a variant belonging to another merchant is
   * simply not found. Checked at ADD time as well as at pricing time,
   * because a cart holding another store's variant would be a stored
   * cross-tenant reference even if it never priced.
   */
  private async assertVariantBelongsToStore(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    variantId: bigint,
  ): Promise<void> {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, product: { store_id: storeId } },
      select: { id: true },
    });

    if (!variant) {
      throw new BadRequestException(`Product variant is unavailable.`);
    }
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

function assertVariantId(raw: string): bigint {
  try {
    const parsed = BigInt(raw);
    if (parsed <= 0n) throw new Error('non-positive');
    return parsed;
  } catch {
    throw new BadRequestException('Invalid product variant.');
  }
}

function assertQuantity(
  quantity: number,
  options: { allowZero: boolean },
): number {
  if (!Number.isInteger(quantity)) {
    throw new BadRequestException('Invalid quantity.');
  }
  const min = options.allowZero ? 0 : 1;
  if (quantity < min || quantity > MAX_LINE_QUANTITY) {
    throw new BadRequestException('Invalid quantity.');
  }
  return quantity;
}

// src/stores/orders/order.service.ts
import {
  Injectable,
  NotFoundException,
  Optional,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus, ProductStatus } from '@prisma/client';
import type { Mode } from '@prisma/client';
import type { AppConfig } from '../../common/config/configuration';
import { nextOrderNumber } from '../checkout/order-numbering';
import {
  assertAvailable,
  decrementInventory,
  InsufficientStockError,
} from '../inventory/inventory-claim';

interface CheckoutItemInput {
  variantId: string;
  qty: number;
}

interface CheckoutCustomerInput {
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  notes?: string;
}

/**
 * The mode a manual order runs under when nothing configures one.
 *
 * `Order`/`OrderItem` carry no `mode` column and their RLS policies
 * (`order_store_isolation`, `order_item_store_isolation`) key on
 * `store_id` alone — but `withTenantTransaction` always installs both
 * `app.store_id` and `app.mode` as a pair, so a value has to be chosen.
 */
const DEFAULT_ORDER_RLS_MODE: Mode = 'live';

@Injectable()
export class OrderService {
  /**
   * ══════════════════════════════════════════════════════════════
   * THE MODE A MANUAL ORDER CLAIMS STOCK IN — one source of truth.
   * ══════════════════════════════════════════════════════════════
   *
   * This was hard-coded `'live'`, and while `Order` genuinely has no
   * mode, the value is NOT inert: it is installed as `app.mode` on the
   * transaction, and `inventory_reservations` is RLS-scoped on store AND
   * mode. So it decides which holds this path's availability check can
   * SEE — while the decrement it guards writes `ProductVariant.
   * inventory_qty`, a column with no mode at all.
   *
   * A storefront running with `STOREFRONT_PAYMENT_MODE=test` therefore
   * held its units in a mode this path could not see, and both were
   * told the last unit was theirs:
   *
   *     one unit left, held by a test-mode checkout
   *     manual order nets holds WHERE mode='live' → 0
   *       → availability 1 - 0 = 1 → passes → decrements to 0
   *     the test-mode shopper pays → the guard refuses, or a
   *       backorder variant goes to -1
   *
   * The row locks serialised the two perfectly and they still both said
   * yes, because each subtracted only its own half of the holds.
   *
   * Production was never exposed: `parseStorefrontPaymentMode()` forces
   * `live` whenever `NODE_ENV=production`, so both sides already agreed
   * there. Development and staging — where the storefront really does
   * run in test mode, as `.env` does today — were.
   *
   * Reading the storefront's own mode makes the two agree in EVERY
   * environment, which is the smallest change that closes it. No schema
   * change is implied and none would help: the pool is shared because
   * `inventory_qty` has no mode, and that is correct — `mode` is a
   * payment-processing dimension, not an inventory one. See the rule
   * stated in full in `inventory-claim.ts`'s `heldQuantities()`.
   *
   * Optional so the many `new OrderService(prisma)` call sites in the
   * specs keep working, exactly as `CheckoutService` treats `carts`.
   */
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private get orderRlsMode(): Mode {
    return (
      this.config?.get<AppConfig>('app')?.storefrontPaymentMode ??
      DEFAULT_ORDER_RLS_MODE
    );
  }

  private jsonSafe(data: any) {
    return JSON.parse(
      JSON.stringify(data, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    );
  }

  async createOrder(
    storeSlug: string,
    customer: CheckoutCustomerInput,
    items: CheckoutItemInput[],
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestException('السلة فاضية');
    }

    if (
      !customer?.name ||
      !customer?.phone ||
      !customer?.address ||
      !customer?.city
    ) {
      throw new BadRequestException('بيانات العميل ناقصة');
    }

    const store = await this.prisma.store.findFirst({
      where: { slug: storeSlug },
    });
    if (!store) throw new NotFoundException('Store not found');

    const variantIds = items.map((i) => BigInt(i.variantId));

    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        product: {
          store_id: store.id,
        },
      },
      include: { product: true },
    });

    const orderItemsData: any[] = [];
    let subtotal = 0;

    for (const item of items) {
      const variant = variants.find((v) => v.id === BigInt(item.variantId));

      if (!variant) {
        throw new BadRequestException(
          `منتج غير موجود (variant ${item.variantId})`,
        );
      }

      // Defense-in-depth: يفضل الإبقاء على فحص الملكية حتى بعد
      // تقييد الـquery نفسه بالمتجر.
      if (variant.product.store_id !== store.id) {
        throw new BadRequestException('منتج لا ينتمي لهذا المتجر');
      }

      if (
        variant.product.status !== ProductStatus.ACTIVE &&
        variant.product.status !== ProductStatus.UNLISTED
      ) {
        throw new BadRequestException(
          `المنتج "${variant.product.title}" غير متاح حالياً`,
        );
      }

      const qty = Math.max(1, Math.floor(item.qty));

      /*
       * NO STOCK CHECK HERE ANY MORE.
       *
       * This read happens outside the transaction that decrements, so a
       * check here decided nothing: the value could change between this
       * line and the write below, and it ignored every live reservation
       * — a merchant creating a manual order silently consumed stock a
       * paying storefront customer was already holding.
       *
       * Availability is decided inside the transaction below, under the
       * same row lock and the same netting as the storefront path. This
       * loop prices and validates the product; it no longer judges
       * stock.
       */

      const price = Number(variant.price);
      subtotal += price * qty;

      orderItemsData.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        title: variant.product.title,
        variant_title: variant.title === 'Default Title' ? null : variant.title,
        price,
        qty,
        image_url: variant.image_url || null,
      });
    }

    const total = subtotal;

    const order = await this.prisma.withTenantTransaction(
      store.id,
      this.orderRlsMode,
      async (tx) => {
        /*
         * THE SAME CLAIM THE STOREFRONT MAKES.
         *
         * Locks every tracked variant FOR UPDATE in ascending id order
         * and nets live `held` reservations, so a manual order and a
         * storefront checkout competing for the last unit serialise on
         * the same rows and exactly one of them wins.
         *
         * A manual order writes no reservation of its own — it takes
         * the stock immediately, below — so this is the availability
         * check without the hold.
         */
        try {
          await assertAvailable(tx, {
            storeId: store.id,
            /*
             * No `mode`, and this call site is why it matters most.
             *
             * One variant has one physical pool, so this must compete
             * with every storefront hold rather than only the ones
             * sharing its payment mode. The transaction now runs in the
             * storefront's OWN configured mode (see `orderRlsMode`), so
             * the holds it nets are the holds that actually exist.
             */
            lines: items.map((item: any) => {
              const variant = variants.find(
                (v) => v.id === BigInt(item.variantId),
              )!;
              return {
                variantId: variant.id,
                quantity: Math.max(1, Math.floor(item.qty)),
                trackInventory: variant.track_inventory,
                continueSelling: variant.continue_selling,
              };
            }),
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            const variant = variants.find((v) => v.id === error.variantId);
            throw new BadRequestException(
              `الكمية المطلوبة من "${
                variant?.product.title ?? ''
              }" غير متوفرة`,
            );
          }
          throw error;
        }

        const orderNumber = await nextOrderNumber(tx, store.id);

        const created = await tx.order.create({
          data: {
            store_id: store.id,
            order_number: orderNumber,
            status: OrderStatus.PENDING,
            customer_name: customer.name.trim(),
            customer_phone: customer.phone.trim(),
            customer_email: customer.email?.trim() || null,
            address_line: customer.address.trim(),
            city: customer.city.trim(),
            notes: customer.notes?.trim() || null,
            subtotal,
            total,
            items: { create: orderItemsData },
          },
          include: { items: true },
        });

        // نقص المخزون فوراً — guarded, and scoped to this store.
        //
        // The guard carries the same disjunction as the database CHECK
        // and as every other decrement in the system: a backorder
        // variant may always be taken, any other must have the units on
        // hand. A refusal here throws and rolls the whole order back,
        // which is the right answer for this path — no money has moved,
        // and a manual order that cannot take its stock must not exist.
        for (const item of items) {
          const variant = variants.find(
            (v) => v.id === BigInt(item.variantId),
          )!;

          if (variant.track_inventory) {
            const taken = await decrementInventory(tx, {
              storeId: store.id,
              variantId: variant.id,
              quantity: Math.max(1, Math.floor(item.qty)),
            });

            if (!taken) {
              throw new BadRequestException(
                `الكمية المطلوبة من "${variant.product.title}" غير متوفرة`,
              );
            }
          }
        }

        return created;
      },
    );

    // إرجاع الطلب بدون أي رابط دفع
    return this.jsonSafe({
      order,
      payment_redirect_url: null,
    });
  }

  /** جلب طلب واحد بالـ order number — مستخدمة في صفحة تأكيد الطلب public */
  async getStorefrontOrder(storeSlug: string, orderNumber: string) {
    const store = await this.prisma.store.findFirst({
      where: { slug: storeSlug },
    });
    if (!store) throw new NotFoundException('Store not found');

    const order = await this.prisma.withTenantTransaction(
      store.id,
      this.orderRlsMode,
      (tx) =>
        tx.order.findFirst({
          where: {
            store_id: store.id,
            order_number: orderNumber,
          },
          include: { items: true },
        }),
    );

    if (!order) throw new NotFoundException('Order not found');

    return this.jsonSafe(order);
  }

  // ── لوحة تحكم التاجر ────────────────────────────────────────────────────

  async getOrders(
    storeId: bigint,
    filters: {
      status?: string;
      search?: string;
      page: number;
      limit: number;
    },
  ) {
    const where: any = { store_id: storeId };

    if (filters.status) {
      where.status = filters.status.toUpperCase();
    }

    if (filters.search) {
      where.OR = [
        {
          order_number: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
        {
          customer_name: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
        {
          customer_phone: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const [total, orders] = await this.prisma.withTenantTransaction(
      storeId,
      this.orderRlsMode,
      (tx) =>
        Promise.all([
          tx.order.count({ where }),
          tx.order.findMany({
            where,
            include: { items: true },
            orderBy: { created_at: 'desc' },
            skip: (filters.page - 1) * filters.limit,
            take: filters.limit,
          }),
        ]),
    );

    return this.jsonSafe({
      orders,
      total,
      page: filters.page,
      pages: Math.ceil(total / filters.limit),
    });
  }

  async getOrder(storeId: bigint, orderId: string) {
    const order = await this.prisma.withTenantTransaction(
      storeId,
      this.orderRlsMode,
      (tx) =>
        tx.order.findFirst({
          where: {
            id: BigInt(orderId),
            store_id: storeId,
          },
          include: { items: true },
        }),
    );

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.jsonSafe(order);
  }

  async updateOrderStatus(
    storeId: bigint,
    orderId: string,
    status: OrderStatus,
  ) {
    const order = await this.prisma.withTenantTransaction(
      storeId,
      this.orderRlsMode,
      async (tx) => {
        const existing = await tx.order.findFirst({
          where: {
            id: BigInt(orderId),
            store_id: storeId,
          },
        });

        if (!existing) {
          throw new NotFoundException('Order not found');
        }

        return tx.order.update({
          where: {
            id: existing.id,
            store_id: storeId,
          },
          data: { status },
        });
      },
    );

    return this.jsonSafe(order);
  }
}

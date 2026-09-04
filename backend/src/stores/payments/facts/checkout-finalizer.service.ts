import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Mode, OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OutboxService } from '../../../common/messaging/outbox.service';
import { money, toDecimalString } from '../../../common/money/money.util';
import { nextOrderNumber } from '../../checkout/order-numbering';
import {
  convertCartForCheckout,
  releaseCartSlot,
} from '../../cart/cart-slot';
import { decrementInventory } from '../../inventory/inventory-claim';

/** Shapes read off the loaded checkout. */
interface CheckoutLine {
  product_id: bigint | null;
  variant_id: bigint | null;
  title: string;
  variant_title: string | null;
  image_url: string | null;
  unit_price_minor: bigint;
  quantity: number;
}

interface QuoteLine {
  kind: string;
  amount_minor: bigint;
}

/**
 * ==================================================================
 * Finalising a funds-secured checkout
 * ==================================================================
 *
 * For cash on delivery and bank transfer the merchant accepts an
 * unfunded promise, so the order exists from the moment the customer
 * confirms. For a gateway it does not: the customer may abandon the 3DS
 * challenge, the card may be declined, the redirect may never complete.
 * Creating the order at that point would fill the merchant's dashboard
 * with orders nobody ever paid for and decrement stock for carts that
 * were never bought.
 *
 * So a funds_secured checkout produces no order until the provider says
 * the money is secured. This runs at that moment, inside the applier's
 * transaction, and does what commitment does for the offline path:
 * creates the order, converts the stock reservations, and decrements
 * inventory.
 *
 * Lives in the payments module rather than checkout because the applier
 * drives it, and CheckoutModule already imports PaymentsModule — the
 * reverse would be a cycle.
 */
@Injectable()
export class CheckoutFinalizerService {
  private readonly logger = new Logger(CheckoutFinalizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Creates the order for a checkout whose payment just succeeded.
   *
   * Idempotent: a checkout that already carries an order id is left
   * alone, so a redelivered capture cannot produce a second order.
   *
   * @returns the order id, or null when there was nothing to finalise.
   */
  async finalize(
    tx: Prisma.TransactionClient,
    input: {
      checkoutId: bigint;
      storeId: bigint;
      mode: Mode;
      paid: boolean;
      occurredAt: Date;
    },
  ): Promise<bigint | null> {
    const checkout = await tx.checkout.findFirst({
      where: {
        id: input.checkoutId,
        store_id: input.storeId,
        mode: input.mode,
      },
      include: {
        items: true,
        components: true,
      },
    });

    if (!checkout) {
      return null;
    }

    // Already finalised by another route.
    //
    // The order exists, but its payment status may still be behind: under
    // manual capture the order is created UNPAID when the authorisation
    // lands, and the money only arrives later when the merchant captures.
    // That second fact reaches here with paid=true against an order that
    // already exists, so without this the order would stay UNPAID forever
    // — and a refund would be refused on a payment that was really taken.
    //
    // Guarded on payment_status so this only ever moves UNPAID -> PAID:
    // a refunded or already-paid order is left exactly as it is.
    if (checkout.order_id !== null) {
      if (input.paid) {
        await tx.order.updateMany({
          where: {
            id: checkout.order_id,
            store_id: input.storeId,
            payment_status: 'UNPAID',
          },
          data: {
            payment_status: 'PAID' as PaymentStatus,
            paid_at: input.occurredAt,
          },
        });
      }

      return checkout.order_id;
    }

    const orderNumber = await nextOrderNumber(tx, input.storeId);

    const currency = checkout.currency;

    const components = checkout.components as QuoteLine[];

    const items = checkout.items as CheckoutLine[];

    const subtotalMinor = components
      .filter((component) => component.kind === 'line_subtotal')
      .reduce((acc: bigint, component) => acc + component.amount_minor, 0n);

    const totalMinor = checkout.quote_total_minor;

    const shipping = (checkout.shipping_address ?? {}) as Record<
      string,
      unknown
    >;

    const order = await tx.order.create({
      data: {
        store_id: input.storeId,
        order_number: orderNumber,
        status: 'PENDING' as OrderStatus,
        payment_status: (input.paid ? 'PAID' : 'UNPAID') as PaymentStatus,
        currency,
        checkout_id: checkout.id,
        customer_name: checkout.customer_name ?? '',
        customer_phone: checkout.customer_phone ?? '',
        customer_email: checkout.customer_email,
        address_line: String(shipping.address_line ?? ''),
        city: String(shipping.city ?? ''),
        notes:
          shipping.notes === null || shipping.notes === undefined
            ? null
            : String(shipping.notes),
        paid_at: input.paid ? input.occurredAt : null,
        subtotal: toDecimalString(money(subtotalMinor, currency)),
        total: toDecimalString(money(totalMinor, currency)),
        items: {
          create: items.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            title: item.title,
            variant_title: item.variant_title,
            price: toDecimalString(money(item.unit_price_minor, currency)),
            qty: item.quantity,
            image_url: item.image_url,
          })),
        },
      },
      select: {
        id: true,
        order_number: true,
      },
    });

    await tx.checkout.update({
      where: {
        id: checkout.id,
        store_id: input.storeId,
        mode: input.mode,
      },
      data: {
        status: 'committed',
        committed_at: input.occurredAt,
        order_id: order.id,
      },
    });

    /*
     * THE CART BECAME AN ORDER — terminal, and in this same transaction.
     *
     * Not a separate write afterwards: an order that exists while its
     * cart is still buyable is exactly the window a second tab pays
     * through. Committing them together means there is no such window,
     * and a rollback here takes both back.
     *
     * The cart's slot is cleared by the same statement and its status
     * moves to `converted`, which is terminal — a shopper buying the
     * same basket again gets a NEW cart, not this one revived. No
     * payment state is written here: `converted` says a basket became
     * an order, and whether that order was paid is read from the order.
     *
     * A no-op for a checkout with no cart, which is every checkout on
     * the stateless path.
     */
    await convertCartForCheckout(tx, {
      checkoutId: checkout.id,
      storeId: input.storeId,
      mode: input.mode,
      orderId: order.id,
      occurredAt: input.occurredAt,
    });

    /*
     * Stock was held at checkout, not taken. It is taken now.
     *
     * ALL THREE NON-CONVERTED STATES ARE SELECTED, and each one is here
     * for the same reason: real money must take real goods, whatever
     * happened to the hold in the meantime.
     *
     *   held      the ordinary path. The reservation is still live.
     *
     *   released  the decline-then-pay path. `abandon()` releases the
     *             hold so a failed card does not sit on someone else's
     *             stock; if the payer then pays for the same checkout
     *             after all — a second payment on the same Moyasar
     *             invoice, or a late capture that overtakes the decline
     *             — the goods must still move.
     *
     *   expired   the SAME situation, reached by a different route:
     *             `CheckoutExpiryJob.releaseOne()` writes `expired`, not
     *             `released`, when it sweeps a checkout nobody came back
     *             to. A shopper whose provider session outlived our TTL
     *             can still complete payment, and a delayed webhook
     *             redelivery can land long after the sweep.
     *
     *             This state was missing, and its absence was silent in
     *             the worst way: the selection came back EMPTY, so the
     *             loop below never ran, `shortfalls` stayed empty, and
     *             no `inventory.oversold` event was emitted. The order
     *             was created and marked PAID while inventory was never
     *             decremented at all — goods sold twice, with nothing
     *             anywhere recording it. Every other path through this
     *             method either takes the stock or says loudly that it
     *             could not.
     *
     * Still runs exactly once: `finalize()` returns early above whenever
     * the checkout already carries an order id, and the same query moves
     * every row it reads to `converted`.
     */
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        checkout_id: checkout.id,
        store_id: input.storeId,
        mode: input.mode,
        state: { in: ['held', 'released', 'expired'] },
      },
    });

    /*
     * TAKING THE STOCK — guarded, and the one place a refusal does NOT
     * mean "refuse the sale".
     *
     * The guard carries the same disjunction as the database CHECK
     * `product_variant_inventory_floor`: a backorder variant may always
     * be decremented, any other must have the units on hand.
     *
     * When it refuses, the customer has already paid. Rolling back
     * would mean taking real money and recording no order, which is
     * strictly worse than an inventory discrepancy the merchant can
     * see and act on. So the order stands, the reservation still
     * converts, and the shortfall is emitted as an explicit oversell
     * event rather than silently written as a negative on a variant
     * whose merchant said "stop selling when out of stock".
     *
     * The realistic way to get here is the late-capture path: a
     * declined attempt released its hold, that stock was legitimately
     * re-sold, and a capture then arrived on the original checkout
     * after all. `released` is in the selection above precisely so real
     * money still takes real goods — this is what happens when the
     * goods are gone.
     */
    const shortfalls: {
      variantId: bigint;
      quantity: number;
    }[] = [];

    for (const reservation of reservations) {
      const taken = await decrementInventory(tx, {
        storeId: input.storeId,
        variantId: reservation.variant_id,
        quantity: reservation.quantity,
      });

      if (!taken) {
        shortfalls.push({
          variantId: reservation.variant_id,
          quantity: reservation.quantity,
        });
      }
    }

    await tx.inventoryReservation.updateMany({
      where: {
        checkout_id: checkout.id,
        store_id: input.storeId,
        mode: input.mode,
        state: { in: ['held', 'released', 'expired'] },
      },
      data: {
        state: 'converted',
        settled_at: input.occurredAt,
      },
    });

    if (shortfalls.length > 0) {
      await this.outbox.emit(tx as unknown as Prisma.TransactionClient, {
        storeId: input.storeId,
        mode: input.mode,
        aggregateType: 'checkout',
        aggregateId: checkout.id.toString(),
        eventType: 'inventory.oversold',
        payload: {
          checkoutId: checkout.id.toString(),
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          lines: shortfalls.map((shortfall) => ({
            variantId: shortfall.variantId.toString(),
            quantity: shortfall.quantity,
          })),
        },
        occurredAt: input.occurredAt,
      });

      this.logger.error(
        `Checkout ${checkout.id} finalised into order ${order.order_number} ` +
          `but ${shortfalls.length} line(s) could not be taken from stock. ` +
          `The payment is real and the order stands; inventory is short by ` +
          shortfalls
            .map((s) => `${s.quantity} of variant ${s.variantId}`)
            .join(', ') +
          '.',
      );
    }

    await this.outbox.emit(tx as unknown as Prisma.TransactionClient, {
      storeId: input.storeId,
      mode: input.mode,
      aggregateType: 'checkout',
      aggregateId: checkout.id.toString(),
      eventType: 'checkout.committed',
      payload: {
        checkoutId: checkout.id.toString(),
        orderId: order.id.toString(),
        orderNumber: order.order_number,
        amountMinor: totalMinor.toString(),
        currency,
        commitmentKind: 'funds_secured',
      },
      occurredAt: input.occurredAt,
    });

    this.logger.log(
      `Finalised checkout ${checkout.id} into order ${order.order_number} (${reservations.length} lines taken).`,
    );

    return order.id;
  }

  /**
   * Releases a checkout whose payment will never complete.
   *
   * Without this the held stock stays unavailable until it expires, and
   * a customer whose card was declined silently blocks inventory.
   */
  async abandon(
    tx: Prisma.TransactionClient,
    input: {
      checkoutId: bigint;
      storeId: bigint;
      mode: Mode;
      occurredAt: Date;
    },
  ): Promise<void> {
    const checkout = await tx.checkout.findFirst({
      where: {
        id: input.checkoutId,
        store_id: input.storeId,
        mode: input.mode,
      },
      select: {
        id: true,
        order_id: true,
      },
    });

    // An order already exists, so the payment did succeed at some point;
    // unwinding it is a refund, not an abandonment.
    if (!checkout || checkout.order_id !== null) {
      return;
    }

    await tx.inventoryReservation.updateMany({
      where: {
        checkout_id: input.checkoutId,
        store_id: input.storeId,
        mode: input.mode,
        state: 'held',
      },
      data: {
        state: 'released',
        settled_at: input.occurredAt,
      },
    });

    await tx.checkout.updateMany({
      where: {
        id: input.checkoutId,
        store_id: input.storeId,
        mode: input.mode,
      },
      data: {
        status: 'failed',
      },
    });

    /*
     * THE SLOT GOES BACK, AND THE CART STAYS ACTIVE.
     *
     * This is what makes «المحاولة مرة أخرى» work. A declined payment
     * ends this checkout, not the purchase: the shopper's basket is
     * still their basket, and the retry creates a new checkout that
     * claims the slot again and records `supersedes_id` pointing at
     * this one. `cart_id` is the same on both, because it is the same
     * basket — the two columns answer two different questions and
     * neither is ever written with the other's value.
     *
     * In the same transaction that just marked the checkout failed, so
     * there is no state where a dead checkout still holds a live cart.
     */
    await releaseCartSlot(tx, {
      checkoutId: input.checkoutId,
      storeId: input.storeId,
      mode: input.mode,
    });
  }
}

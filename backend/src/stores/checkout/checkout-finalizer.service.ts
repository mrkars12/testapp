import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Mode, OrderStatus, PaymentStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { OutboxService } from '../../common/messaging/outbox.service'
import { money, toDecimalString } from '../../common/money/money.util'

/** Shapes read off the loaded checkout. */
interface CheckoutLine {
  product_id: bigint | null
  variant_id: bigint | null
  title: string
  variant_title: string | null
  image_url: string | null
  unit_price_minor: bigint
  quantity: number
}

interface QuoteLine {
  kind: string
  amount_minor: bigint
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
  private readonly logger = new Logger(CheckoutFinalizerService.name)

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
      checkoutId: bigint
      storeId: bigint
      mode: Mode
      paid: boolean
      occurredAt: Date
    },
  ): Promise<bigint | null> {
    const checkout = await tx.checkout.findFirst({
      where: { id: input.checkoutId, store_id: input.storeId },
      include: { items: true, components: true },
    })

    if (!checkout) return null

    // Already finalised by another route.
    if (checkout.order_id !== null) return checkout.order_id

    const orderNumber = await this.nextOrderNumber(tx, input.storeId)
    const currency = checkout.currency

    const components = checkout.components as QuoteLine[]
    const items = checkout.items as CheckoutLine[]

    const subtotalMinor = components
      .filter((component) => component.kind === 'line_subtotal')
      .reduce((acc: bigint, component) => acc + component.amount_minor, 0n)

    const totalMinor = checkout.quote_total_minor

    const shipping = (checkout.shipping_address ?? {}) as Record<string, unknown>

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
        notes: shipping.notes === null || shipping.notes === undefined
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
      select: { id: true, order_number: true },
    })

    await tx.checkout.update({
      where: { id: checkout.id },
      data: {
        status: 'committed',
        committed_at: input.occurredAt,
        order_id: order.id,
      },
    })

    // Stock was held at checkout, not taken. It is taken now.
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        checkout_id: checkout.id,
        store_id: input.storeId,
        state: 'held',
      },
    })

    for (const reservation of reservations) {
      await tx.productVariant.update({
        where: { id: reservation.variant_id },
        data: { inventory_qty: { decrement: reservation.quantity } },
      })
    }

    await tx.inventoryReservation.updateMany({
      where: { checkout_id: checkout.id, store_id: input.storeId, state: 'held' },
      data: { state: 'converted', settled_at: input.occurredAt },
    })

    await this.outbox.emit(tx, {
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
    })

    this.logger.log(
      `Finalised checkout ${checkout.id} into order ${order.order_number} (${reservations.length} lines taken).`,
    )

    return order.id
  }

  /**
   * Releases a checkout whose payment will never complete.
   *
   * Without this the held stock stays unavailable until it expires, and
   * a customer whose card was declined silently blocks inventory.
   */
  async abandon(
    tx: Prisma.TransactionClient,
    input: { checkoutId: bigint; storeId: bigint; occurredAt: Date },
  ): Promise<void> {
    const checkout = await tx.checkout.findFirst({
      where: { id: input.checkoutId, store_id: input.storeId },
      select: { id: true, order_id: true },
    })

    // An order already exists, so the payment did succeed at some point;
    // unwinding it is a refund, not an abandonment.
    if (!checkout || checkout.order_id !== null) return

    await tx.inventoryReservation.updateMany({
      where: { checkout_id: input.checkoutId, store_id: input.storeId, state: 'held' },
      data: { state: 'released', settled_at: input.occurredAt },
    })

    await tx.checkout.updateMany({
      where: { id: input.checkoutId, store_id: input.storeId },
      data: { status: 'failed' },
    })
  }

  /**
   * Next per-store order number.
   *
   * Same reasoning as CheckoutService.nextOrderNumber: `count(*) + 1001`
   * is not safe when two captures finalise at once, and here it matters
   * more — the money is already taken, so a rejected insert means a paid
   * customer with no order.
   */
  private async nextOrderNumber(
    tx: Prisma.TransactionClient,
    storeId: bigint,
  ): Promise<string> {
    await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`

    const highest = await tx.order.findFirst({
      where: { store_id: storeId },
      orderBy: { id: 'desc' },
      select: { order_number: true },
    })

    const previous = highest ? Number.parseInt(highest.order_number, 10) : NaN

    return String(Number.isFinite(previous) ? previous + 1 : 1001)
  }
}
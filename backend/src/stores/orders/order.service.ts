// src/stores/orders/order.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { OrderStatus, ProductStatus } from '@prisma/client'

interface CheckoutItemInput {
  variantId: string
  qty: number
}

interface CheckoutCustomerInput {
  name: string
  phone: string
  email?: string
  address: string
  city: string
  notes?: string
}

@Injectable()
export class OrderService {
  constructor(
    private prisma: PrismaService,
  ) {}

  private jsonSafe(data: any) {
    return JSON.parse(JSON.stringify(data, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ))
  }

  /** رقم طلب بسيط وقابل للقراءة: #1001, #1002... لكل متجر لوحده */
  private async generateOrderNumber(storeId: bigint): Promise<string> {
    const count = await this.prisma.order.count({ where: { store_id: storeId } })
    return String(1000 + count + 1)
  }

  async createOrder(
    storeSlug: string,
    customer: CheckoutCustomerInput,
    items: CheckoutItemInput[],
  ) {
    if (!items || items.length === 0) throw new BadRequestException('السلة فاضية')
    if (!customer?.name || !customer?.phone || !customer?.address || !customer?.city) {
      throw new BadRequestException('بيانات العميل ناقصة')
    }

    const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
    if (!store) throw new NotFoundException('Store not found')

    const variantIds = items.map((i) => BigInt(i.variantId))
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    })

    const orderItemsData: any[] = []
    let subtotal = 0

    for (const item of items) {
      const variant = variants.find((v) => v.id === BigInt(item.variantId))
      if (!variant) {
        throw new BadRequestException(`منتج غير موجود (variant ${item.variantId})`)
      }
      if (variant.product.store_id !== store.id) {
        throw new BadRequestException('منتج لا ينتمي لهذا المتجر')
      }
      if (
        variant.product.status !== ProductStatus.ACTIVE &&
        variant.product.status !== ProductStatus.UNLISTED
      ) {
        throw new BadRequestException(`المنتج "${variant.product.title}" غير متاح حالياً`)
      }
      const qty = Math.max(1, Math.floor(item.qty))
      if (variant.track_inventory && !variant.continue_selling && variant.inventory_qty < qty) {
        throw new BadRequestException(`الكمية المطلوبة من "${variant.product.title}" غير متوفرة`)
      }

      const price = Number(variant.price)
      subtotal += price * qty

      orderItemsData.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        title: variant.product.title,
        variant_title: variant.title === 'Default Title' ? null : variant.title,
        price,
        qty,
        image_url: variant.image_url || null,
      })
    }

    const total = subtotal
    const orderNumber = await this.generateOrderNumber(store.id)

    const order = await this.prisma.$transaction(async (tx) => {
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
      })

      // نقص المخزون فوراً
      for (const item of items) {
        const variant = variants.find((v) => v.id === BigInt(item.variantId))!
        if (variant.track_inventory) {
          await tx.productVariant.update({
            where: { id: variant.id },
            data: { inventory_qty: { decrement: Math.max(1, Math.floor(item.qty)) } },
          })
        }
      }

      return created
    })

    // إرجاع الطلب بدون أي رابط دفع
    return this.jsonSafe({ order, payment_redirect_url: null })
  }

  /** جلب طلب واحد بالـ order number — مستخدمة في صفحة تأكيد الطلب public */
  async getStorefrontOrder(storeSlug: string, orderNumber: string) {
    const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
    if (!store) throw new NotFoundException('Store not found')

    const order = await this.prisma.order.findFirst({
      where: { store_id: store.id, order_number: orderNumber },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('Order not found')
    return this.jsonSafe(order)
  }

  // ── لوحة تحكم التاجر ────────────────────────────────────────────────────

  async getOrders(
    storeId: bigint,
    filters: { status?: string; search?: string; page: number; limit: number },
  ) {
    const where: any = { store_id: storeId }
    if (filters.status) where.status = filters.status.toUpperCase()
    if (filters.search) {
      where.OR = [
        { order_number: { contains: filters.search, mode: 'insensitive' } },
        { customer_name: { contains: filters.search, mode: 'insensitive' } },
        { customer_phone: { contains: filters.search, mode: 'insensitive' } },
      ]
    }
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { created_at: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
    ])
    return this.jsonSafe({
      orders,
      total,
      page: filters.page,
      pages: Math.ceil(total / filters.limit),
    })
  }

  async getOrder(storeId: bigint, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), store_id: storeId },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('Order not found')
    return this.jsonSafe(order)
  }

  async updateOrderStatus(storeId: bigint, orderId: string, status: OrderStatus) {
    const order = await this.prisma.order.findFirst({
      where: { id: BigInt(orderId), store_id: storeId },
    })
    if (!order) throw new NotFoundException('Order not found')
    return this.jsonSafe(
      await this.prisma.order.update({ where: { id: order.id }, data: { status } }),
    )
  }
}

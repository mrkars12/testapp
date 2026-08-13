/**
 * ── Backend: Storefront Collections Endpoints (NestJS) ──
 *
 * أضف هذين الـ endpoints في الـ controller بتاع الـ storefront.
 * عادةً موجود في: src/storefront/storefront.controller.ts
 * أو ممكن تعمل controller جديد: src/storefront/storefront-collections.controller.ts
 */

// ─── في الـ Controller ────────────────────────────────────────────────

import { Controller, Get, Param, Query } from '@nestjs/common'
import { StorefrontCollectionsService } from './storefront-collections.service'

@Controller('storefront/:storeSlug')
export class StorefrontController {
  constructor(private readonly collectionsService: StorefrontCollectionsService) {}

  /**
   * GET /api/storefront/:storeSlug/collections
   * قائمة الكولكشنز للـ storefront مع عدد المنتجات
   */
  @Get('collections')
  getCollections(@Param('storeSlug') storeSlug: string) {
    return this.collectionsService.listForStorefront(storeSlug)
  }

  /**
   * GET /api/storefront/:storeSlug/collections/:handle
   * كولكشن واحدة مع كل منتجاتها (ACTIVE فقط)
   */
  @Get('collections/:handle')
  getCollection(
    @Param('storeSlug') storeSlug: string,
    @Param('handle') handle: string,
  ) {
    return this.collectionsService.getOneForStorefront(storeSlug, handle)
  }
}

// ─── Service (storefront-collections.service.ts) ────────────────────

/*
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ProductStatus } from '@prisma/client'

@Injectable()
export class StorefrontCollectionsService {
  constructor(private prisma: PrismaService) {}

  async listForStorefront(storeSlug: string) {
    const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
    if (!store) throw new NotFoundException('Store not found')

    const collections = await this.prisma.collection.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            products: {
              where: {
                product: { status: ProductStatus.ACTIVE, deleted_at: null },
              },
            },
          },
        },
      },
    })

    return collections.map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      description: c.description,
      image_url: c.image_url,
      // عدد المنتجات ACTIVE فقط
      product_count: c._count.products,
    }))
  }

  async getOneForStorefront(storeSlug: string, handle: string) {
    const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
    if (!store) throw new NotFoundException('Store not found')

    const collection = await this.prisma.collection.findFirst({
      where: { storeId: store.id, handle },
      include: {
        products: {
          where: {
            product: { status: ProductStatus.ACTIVE, deleted_at: null },
          },
          orderBy: { position: 'asc' },
          include: {
            product: {
              include: {
                images: { take: 1, orderBy: { position: 'asc' } },
                variants: { orderBy: { position: 'asc' }, take: 1 },
              },
            },
          },
        },
      },
    })
    if (!collection) throw new NotFoundException('Collection not found')

    return {
      id: collection.id,
      name: collection.name,
      handle: collection.handle,
      description: collection.description,
      image_url: collection.image_url,
      products: collection.products.map((pc) => ({
        id: pc.product.id.toString(),
        title: pc.product.title,
        handle: pc.product.handle,
        image_url: pc.product.images[0]?.url || null,
        // السعر من أول variant
        price: pc.product.variants[0]?.price ?? null,
        compare_at_price: pc.product.variants[0]?.compare_at_price ?? null,
        position: pc.position,
      })),
    }
  }
}
*/

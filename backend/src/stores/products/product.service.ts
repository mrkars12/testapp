import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ProductStatus } from '@prisma/client'
import type { store as StoreRecord } from '@prisma/client'

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  private jsonSafe(data: any) {
    return JSON.parse(JSON.stringify(data, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ))
  }

  // ── Handle / slug helpers ────────────────────────────────────────────────

  private slugify(text: string): string {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private async ensureUniqueHandle(
    storeId: bigint,
    base: string,
    excludeProductId?: bigint,
  ): Promise<string> {
    const safeBase = base && base.trim() ? base : 'product'
    let handle = safeBase
    let counter = 2
    while (true) {
      const existing = await this.prisma.product.findFirst({
        where: {
          store_id: storeId,
          handle,
          ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
        },
      })
      if (!existing) return handle
      handle = `${safeBase}-${counter}`
      counter++
    }
  }

  private generateVariants(options: { name: string; values: string[] }[], basePrice: number) {
    if (!options || options.length === 0) {
      return [{ title: 'Default Title', price: basePrice, option1: null, option2: null, option3: null }]
    }
    const combos: any[] = []
    const recurse = (idx: number, current: string[]) => {
      if (idx === options.length) { combos.push(current.slice()); return }
      for (const val of options[idx].values) {
        current.push(val)
        recurse(idx + 1, current)
        current.pop()
      }
    }
    recurse(0, [])
    return combos.map(combo => ({
      title: combo.join(' / '),
      price: basePrice,
      option1: combo[0] || null,
      option2: combo[1] || null,
      option3: combo[2] || null,
    }))
  }

  async getProducts(
    storeId: bigint,
    filters: { status?: string; search?: string; page: number; limit: number },
  ) {
    const where: any = { store_id: storeId }
    /**
     * FIX: الفرونت اند بيبعت الحالة بحروف صغيرة (مثلاً "active")، لكن الـ
     * enum في Prisma معرّف بحروف كبيرة ("ACTIVE"). كان ده بيسبب 500 على
     * أي فلترة بالحالة. .toUpperCase() بيوحّد الشكل قبل ما يوصل لـ Prisma.
     */
    if (filters.status) where.status = filters.status.toUpperCase()
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { productType: { name: { contains: filters.search, mode: 'insensitive' } } },
        { variants: { some: { sku: { contains: filters.search, mode: 'insensitive' } } } },
      ]
    }
    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          productType: true,
          tags: { include: { tag: true } },
          images: { orderBy: { position: 'asc' }, take: 1 },
          variants: { orderBy: { position: 'asc' } },
          _count: { select: { variants: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
    ])
    return this.jsonSafe({
      products,
      total,
      page: filters.page,
      pages: Math.ceil(total / filters.limit),
    })
  }

  /**
   * جديد: قائمة المنتجات العامة (واجهة المتجر للعميل النهائي). بنستبعد
   * هنا صراحةً أي منتج DRAFT أو UNLISTED — الـ Unlisted معناه بالتحديد
   * إنه ميظهرش في أي قائمة أو بحث عادي، وبيتفتح بس لو حد معاه لينكه
   * المباشر (شوف getStorefrontProductByHandle تحت).
   */
  async getStorefrontProducts(
    storeSlug: string,
    filters: { search?: string; page: number; limit: number },
  ) {
    const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
    if (!store) throw new NotFoundException('Store not found')

    const where: any = {
      store_id: store.id,
      status: ProductStatus.ACTIVE,
      deleted_at: null,
    }
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { productType: { name: { contains: filters.search, mode: 'insensitive' } } },
      ]
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          productType: true,
          images: { orderBy: { position: 'asc' }, take: 1 },
          variants: { orderBy: { position: 'asc' } },
        },
        orderBy: { created_at: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
    ])
    return this.jsonSafe({
      products,
      total,
      page: filters.page,
      pages: Math.ceil(total / filters.limit),
    })
  }

  /**
   * جديد: جلب منتج واحد عن طريق الـ handle بتاعه لصفحة المنتج العامة.
   * بيسمح بحالتين بس: ACTIVE (المنتج العادي الظاهر في المتجر) و UNLISTED
   * (المنتج اللي مخفي من القوائم بس لسه شغال لو حد فتح لينكه المباشر).
   * DRAFT و ARCHIVED مبيرجعوش حاجة هنا خالص — العميل النهائي ميقدرش
   * يشوفهم حتى لو حصل عليه الرابط بأي شكل.
   */
  async getStorefrontProductByHandle(storeSlug: string, handle: string) {
    const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
    if (!store) throw new NotFoundException('Store not found')

    const product = await this.prisma.product.findFirst({
      where: {
        store_id: store.id,
        handle,
        deleted_at: null,
        status: { in: [ProductStatus.ACTIVE, ProductStatus.UNLISTED] },
      },
      include: {
        productType: true,
        tags: { include: { tag: true } },
        images: { orderBy: { position: 'asc' } },
        variants: { orderBy: { position: 'asc' } },
        options: {
          include: { values: true },
          orderBy: { position: 'asc' },
        },
        // ⬇️ جديد — عشان الـ breadcrumb الاحترافي في الفرونت
        collections: {
          include: { collection: { select: { name: true, handle: true } } },
        },
      },
    })
    if (!product) throw new NotFoundException('Product not found')

    return this.jsonSafe({
      ...product,
      // شكل نضيف وجاهز للفرونت: array بسيطة من {name, handle}
      // بدل الـ join table المتداخلة
      collections: product.collections.map((pc) => ({
        name: pc.collection.name,
        handle: pc.collection.handle,
      })),
    })
  }

  async getProduct(store: StoreRecord, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: store.id },
      include: {
        productType: true,
        tags: { include: { tag: true } },
        collections: { include: { collection: true } },   // ← ضيف السطر ده
        images: { orderBy: { position: 'asc' } },
        variants: { orderBy: { position: 'asc' } },
        options: {
          include: { values: true },
          orderBy: { position: 'asc' },
        },
      },
    })
    if (!product) throw new NotFoundException('Product not found')
    return this.jsonSafe({ ...product, store: { slug: store.slug } })
  }

  async createProduct(store: StoreRecord, data: any) {
    const hasPrice = data.price !== undefined && data.price !== null && String(data.price).trim() !== ''
    const price = hasPrice ? parseFloat(data.price) : null

    const baseHandle = this.slugify(data.handle || data.title)
    const handle = await this.ensureUniqueHandle(store.id, baseHandle)

    const effectiveOptions = (data.options || []).filter(
      (o: any) => o.name && o.values?.some((v: string) => String(v).trim()),
    )
    const hasOptions = effectiveOptions.length > 0

    const productId = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          store_id: store.id,
          title: data.title,
          description: data.description || null,
          status: (data.status as ProductStatus) || ProductStatus.DRAFT,
          product_type_id: data.product_type_id ? BigInt(data.product_type_id) : null,
          handle,
          seo_title: data.seo_title || null,
          seo_desc: data.seo_desc || null,
          category: data.category || null,
          charge_tax: data.charge_tax !== false,
        },
      })

      // Options
      if (Array.isArray(data.options) && data.options.length > 0) {
        for (let i = 0; i < data.options.length; i++) {
          const opt = data.options[i]
          if (!opt.name || !opt.values?.length) continue
          const option = await tx.productOption.create({
            data: {
              product_id: product.id,
              name: opt.name,
              position: i,
              colors: opt.colors ?? undefined,   // ← جديد
              display_type: opt.display_type ?? undefined,   // ← جديد
            },
          })
          for (const val of opt.values) {
            if (String(val).trim()) {
              await tx.productOptionValue.create({
                data: { option_id: option.id, value: String(val).trim() },
              })
            }
          }
        }
      }

      // Variants
      if (hasOptions && Array.isArray(data.variants) && data.variants.length > 0) {
        // الفرونت اند بعت variants كاملة جاهزة (فيها combination/options)
        for (let i = 0; i < data.variants.length; i++) {
          const v = data.variants[i]
          const vPrice = parseFloat(v.price ?? '0')
          await tx.productVariant.create({
            data: {
              product_id: product.id,
              title: v.title || (Array.isArray(v.combination) ? v.combination.join(' / ') : '') || 'Default Title',
              price: isNaN(vPrice) ? 0 : vPrice,
              compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
              cost_per_item: v.cost_per_item ? parseFloat(v.cost_per_item) : null,
              sku: v.sku || null,
              barcode: v.barcode || null,
              inventory_qty: parseInt(v.inventory_qty ?? '0') || 0,
              track_inventory: true,
              continue_selling: v.continue_selling === true,
              option1: v.option1 ?? v.combination?.[0] ?? null,
              option2: v.option2 ?? v.combination?.[1] ?? null,
              option3: v.option3 ?? v.combination?.[2] ?? null,
              image_url: v.image_url || null,
              image_key: v.image_key || null,
              position: i,
            },
          })
        }
      } else {
        await tx.productVariant.create({
          data: {
            product_id: product.id,
            title: 'Default Title',
            price,
            compare_at_price: data.compare_at_price ? parseFloat(data.compare_at_price) : null,
            cost_per_item: data.cost_per_item ? parseFloat(data.cost_per_item) : null,
            sku: data.sku || null,
            barcode: data.barcode || null,
            inventory_qty: parseInt(data.inventory_qty || data.quantity || '0'),
            track_inventory: data.track_inventory !== false,
            continue_selling: data.continue_selling === true,
            option1: null,
            option2: null,
            option3: null,
            position: 0,
          },
        })
      }

      // Images
      if (Array.isArray(data.images) && data.images.length > 0) {
        for (let i = 0; i < data.images.length; i++) {
          await tx.productImage.create({
            data: {
              product_id: product.id,
              url: data.images[i].url,
              key: data.images[i].key || null,
              alt: data.images[i].alt || data.title,
              position: i,
            },
          })
        }
      }

      // Tags
      if (Array.isArray(data.tag_ids) && data.tag_ids.length > 0) {
        await tx.productTag.createMany({
          data: data.tag_ids.map((tagId: string | number) => ({
            product_id: product.id,
            tag_id: BigInt(tagId),
          })),
        })
      }

      // Collections
      if (Array.isArray(data.collection_ids) && data.collection_ids.length > 0) {
        await tx.productCollection.createMany({
          data: data.collection_ids.map((collectionId: string | number) => ({
            productId: product.id,
            collectionId: Number(collectionId),
          })),
        })
      }

      return product.id
    }, { timeout: 20000, maxWait: 10000 })

    const created = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        images: true,
        variants: true,
        options: { include: { values: true } },
      },
    })
    return this.jsonSafe({ ...created, store: { slug: store.slug } })
  }

  async updateProduct(store: StoreRecord, productId: string, data: any) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: store.id },
    })
    if (!product) throw new NotFoundException('Product not found')

    let handle: string | undefined
    if (data.handle !== undefined && data.handle !== null) {
      const baseHandle = this.slugify(data.handle)
      const candidate = baseHandle || this.slugify(data.title || 'product')
      if (candidate !== product.handle) {
        handle = await this.ensureUniqueHandle(store.id, candidate, product.id)
      }
    }

    const hasOptions = Array.isArray(data.options) && data.options.length > 0

    await this.prisma.$transaction(async (tx) => {
      // 1. Update core product fields
      await tx.product.update({
        where: { id: product.id },
        data: {
          title: data.title,
          description: data.description ?? null,
          status: data.status as ProductStatus,
          product_type_id: data.product_type_id ? BigInt(data.product_type_id) : null,
          seo_title: data.seo_title || null,
          seo_desc: data.seo_desc || null,
          category: data.category || null,
          charge_tax: data.charge_tax !== false,
          ...(handle !== undefined ? { handle } : {}),
        },
      })

      // 2. Sync tags (delete all, recreate)
      await tx.productTag.deleteMany({ where: { product_id: product.id } })
      if (Array.isArray(data.tag_ids) && data.tag_ids.length > 0) {
        await tx.productTag.createMany({
          data: data.tag_ids.map((tagId: string | number) => ({
            product_id: product.id,
            tag_id: BigInt(tagId),
          })),
        })
      }

      // 2b. Sync collections (delete all, recreate)
      await tx.productCollection.deleteMany({ where: { productId: product.id } })
      if (Array.isArray(data.collection_ids) && data.collection_ids.length > 0) {
        await tx.productCollection.createMany({
          data: data.collection_ids.map((collectionId: string | number) => ({
            productId: product.id,
            collectionId: Number(collectionId),
          })),
        })
      }

      // 3. Sync options (delete old, recreate from incoming)
      if (Array.isArray(data.options)) {
        const oldOptions = await tx.productOption.findMany({
          where: { product_id: product.id },
        })
        if (oldOptions.length) {
          await tx.productOptionValue.deleteMany({
            where: { option_id: { in: oldOptions.map((o) => o.id) } },
          })
          await tx.productOption.deleteMany({ where: { product_id: product.id } })
        }
        for (let i = 0; i < data.options.length; i++) {
          const opt = data.options[i]
          if (!opt.name || !opt.values?.length) continue
          const option = await tx.productOption.create({
            data: {
              product_id: product.id,
              name: opt.name,
              position: i,
              colors: opt.colors ?? undefined,   // ← جديد
              display_type: opt.display_type ?? undefined,   // ← ناقصة، ضيفها
            },
          })
          for (const val of opt.values) {
            if (val && String(val).trim()) {
              await tx.productOptionValue.create({
                data: { option_id: option.id, value: String(val).trim() },
              })
            }
          }
        }
      }

      // 4. Sync variants
      if (hasOptions && Array.isArray(data.variants)) {
        const existingVariants = await tx.productVariant.findMany({
          where: { product_id: product.id },
        })
        const incomingIds = new Set(
          data.variants.filter((v: any) => v.id).map((v: any) => v.id.toString()),
        )
        const toDelete = existingVariants.filter((v) => !incomingIds.has(v.id.toString()))
        if (toDelete.length) {
          await tx.productVariant.deleteMany({
            where: { id: { in: toDelete.map((v) => v.id) } },
          })
        }
        for (let i = 0; i < data.variants.length; i++) {
          const v = data.variants[i]
          const vPrice = parseFloat(v.price ?? '0')
          const payload = {
            title: v.title || (Array.isArray(v.combination) ? v.combination.join(' / ') : '') || 'Default Title',
            price: isNaN(vPrice) ? 0 : vPrice,
            compare_at_price: v.compare_at_price != null && v.compare_at_price !== '' ? parseFloat(v.compare_at_price) : null,
            cost_per_item: v.cost_per_item != null && v.cost_per_item !== '' ? parseFloat(v.cost_per_item) : null,
            sku: v.sku || null,
            barcode: v.barcode || null,
            inventory_qty: parseInt(v.inventory_qty ?? v.quantity ?? '0') || 0,
            continue_selling: v.continue_selling === true,
            option1: v.option1 ?? v.combination?.[0] ?? null,
            option2: v.option2 ?? v.combination?.[1] ?? null,
            option3: v.option3 ?? v.combination?.[2] ?? null,
            image_url: v.image_url || null,
            image_key: v.image_key || null,
            position: i,
          }
          if (v.id) {
            await tx.productVariant.update({ where: { id: BigInt(v.id) }, data: payload })
          } else {
            await tx.productVariant.create({ data: { product_id: product.id, ...payload } })
          }
        }
      } else {
        const payload: any = {
          title: 'Default Title',
          sku: data.sku || null,
          barcode: data.barcode || null,
          inventory_qty: parseInt(data.inventory_qty ?? data.quantity ?? '0') || 0,
          track_inventory: data.track_inventory !== false,
          continue_selling: data.continue_selling === true,
          option1: null,
          option2: null,
          option3: null,
          position: 0,
        }

        if (data.price !== undefined) {
          const trimmed = data.price === null ? '' : String(data.price).trim()
          payload.price = trimmed === '' ? null : (isNaN(parseFloat(trimmed)) ? null : parseFloat(trimmed))
        }

        if (data.compare_at_price !== undefined) {
          payload.compare_at_price =
            data.compare_at_price !== null && String(data.compare_at_price).trim() !== ''
              ? parseFloat(data.compare_at_price)
              : null
        }
        if (data.cost_per_item !== undefined) {
          payload.cost_per_item =
            data.cost_per_item !== null && String(data.cost_per_item).trim() !== ''
              ? parseFloat(data.cost_per_item)
              : null
        }

        const existing = await tx.productVariant.findMany({
          where: { product_id: product.id },
          orderBy: { position: 'asc' },
        })
        if (existing.length > 0) {
          await tx.productVariant.update({ where: { id: existing[0].id }, data: payload })
          const extras = existing.slice(1)
          if (extras.length) {
            await tx.productVariant.deleteMany({ where: { id: { in: extras.map((v) => v.id) } } })
          }
        } else {
          await tx.productVariant.create({
            data: { product_id: product.id, price: payload.price ?? 0, ...payload },
          })
        }
      }

      // 5. Sync images (delete all, recreate from incoming)
      if (Array.isArray(data.images)) {
        await tx.productImage.deleteMany({ where: { product_id: product.id } })
        for (let i = 0; i < data.images.length; i++) {
          await tx.productImage.create({
            data: {
              product_id: product.id,
              url: data.images[i].url,
              key: data.images[i].key || null,
              alt: data.images[i].alt || null,
              position: i,
            },
          })
        }
      }
    }, { timeout: 20000, maxWait: 10000 })

    const updated = await this.prisma.product.findUnique({
      where: { id: product.id },
      include: {
        productType: true,
        tags: { include: { tag: true } },
        collections: { include: { collection: true } },   // ← ضيف السطر ده
        images: true,
        variants: { orderBy: { position: 'asc' } },
        options: { include: { values: true }, orderBy: { position: 'asc' } },
      },
    })
    return this.jsonSafe({ ...updated, store: { slug: store.slug } })
  }

  async updateProductStatus(storeId: bigint, productId: string, status: ProductStatus) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: storeId },
    })
    if (!product) throw new NotFoundException('Product not found')
    return this.jsonSafe(
      await this.prisma.product.update({ where: { id: product.id }, data: { status } }),
    )
  }

  async deleteProduct(storeId: bigint, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: storeId },
    })
    if (!product) throw new NotFoundException('Product not found')

    return this.prisma.$transaction(async (tx) => {
      const options = await tx.productOption.findMany({ where: { product_id: product.id } })
      if (options.length) {
        await tx.productOptionValue.deleteMany({ where: { option_id: { in: options.map((o) => o.id) } } })
        await tx.productOption.deleteMany({ where: { product_id: product.id } })
      }
      await tx.productVariant.deleteMany({ where: { product_id: product.id } })
      await tx.productImage.deleteMany({ where: { product_id: product.id } })
      await tx.productTag.deleteMany({ where: { product_id: product.id } })
      return tx.product.delete({ where: { id: product.id } })
    })
  }

  async duplicateProduct(storeId: bigint, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: storeId },
      include: {
        images: true,
        variants: true,
        options: { include: { values: true } },
        tags: true,
      },
    })
    if (!product) throw new NotFoundException('Product not found')

    const baseHandle = this.slugify(`${product.title}-copy`)
    const handle = await this.ensureUniqueHandle(storeId, baseHandle)

    const newProductId = await this.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          store_id: storeId,
          title: `${product.title} (Copy)`,
          description: product.description,
          status: ProductStatus.DRAFT,
          product_type_id: product.product_type_id,
          handle,
          seo_title: product.seo_title,
          seo_desc: product.seo_desc,
          category: product.category,
          charge_tax: product.charge_tax,
        },
      })

      for (const t of product.tags) {
        await tx.productTag.create({
          data: { product_id: newProduct.id, tag_id: t.tag_id },
        })
      }

      for (const opt of product.options) {
        const newOpt = await tx.productOption.create({
          data: {
            product_id: newProduct.id,
            name: opt.name,
            position: opt.position,
            colors: (opt as any).colors ?? undefined,
            display_type: (opt as any).display_type ?? undefined,
          },
        })
        for (const val of opt.values) {
          await tx.productOptionValue.create({
            data: { option_id: newOpt.id, value: val.value },
          })
        }
      }

      for (const v of product.variants) {
        await tx.productVariant.create({
          data: {
            product_id: newProduct.id,
            title: v.title,
            price: v.price,
            compare_at_price: v.compare_at_price,
            cost_per_item: v.cost_per_item,
            sku: v.sku,
            image_url: v.image_url,
            image_key: v.image_key,
            barcode: v.barcode,
            inventory_qty: v.inventory_qty,
            track_inventory: v.track_inventory,
            continue_selling: v.continue_selling,
            option1: v.option1,
            option2: v.option2,
            option3: v.option3,
            position: v.position,
          },
        })
      }

      for (const img of product.images) {
        await tx.productImage.create({
          data: {
            product_id: newProduct.id,
            url: img.url,
            key: img.key,
            alt: img.alt,
            position: img.position,
          },
        })
      }

      return newProduct.id
    }, { timeout: 20000, maxWait: 10000 })

    return this.jsonSafe(
      await this.prisma.product.findUnique({
        where: { id: newProductId },
        include: {
          productType: true,
          tags: { include: { tag: true } },
          images: true,
          variants: { orderBy: { position: 'asc' } },
          options: { include: { values: true }, orderBy: { position: 'asc' } },
        },
      }),
    )
  }

  async addProductImages(storeId: bigint, productId: string, images: { url: string; alt?: string; key?: string }[]) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: storeId },
    })
    if (!product) throw new NotFoundException('Product not found')
    const last = await this.prisma.productImage.findFirst({
      where: { product_id: product.id },
      orderBy: { position: 'desc' },
    })
    const created: any[] = []
    let pos = last ? last.position + 1 : 0
    for (const img of images) {
      created.push(
        await this.prisma.productImage.create({
          data: { product_id: product.id, url: img.url, key: img.key || null, alt: img.alt || null, position: pos++ },
        }),
      )
    }
    return this.jsonSafe(created)
  }

  async deleteProductImage(storeId: bigint, productId: string, imageId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: BigInt(productId), store_id: storeId },
    })
    if (!product) throw new NotFoundException('Product not found')
    // ✅ تحقق ملكية إضافي (متفق عليه): قبل كده كان الحذف بيتم بالـ
    // imageId بس من غير التأكد إن الصورة دي بتاعة نفس المنتج اللي
    // اتأكدنا إنه بتاع المتجر الفعّال. دلوقتي البحث بيتقيّد بـ product_id
    // كمان، فمينفعش تتمسح صورة بتاعة منتج تاني حتى لو ID اتخمّن صح.
    const image = await this.prisma.productImage.findFirst({
      where: { id: BigInt(imageId), product_id: product.id },
    })
    if (!image) throw new NotFoundException('Image not found')
    return this.prisma.productImage.delete({ where: { id: image.id } })
  }

  async getProductTypes(storeId: bigint) {
    return this.jsonSafe(
      await this.prisma.productType.findMany({
        where: { store_id: storeId },
        orderBy: { name: 'asc' },
      }),
    )
  }

  async createProductType(storeId: bigint, name: string) {
    const exists = await this.prisma.productType.findFirst({
      where: { store_id: storeId, name: { equals: name.trim(), mode: 'insensitive' } },
    })
    if (exists) return this.jsonSafe(exists)
    return this.jsonSafe(
      await this.prisma.productType.create({ data: { store_id: storeId, name: name.trim() } }),
    )
  }

  async updateProductType(storeId: bigint, id: string, name: string) {
    const type = await this.prisma.productType.findFirst({
      where: { id: BigInt(id), store_id: storeId },
    })
    if (!type) throw new NotFoundException('Product type not found')
    return this.jsonSafe(
      await this.prisma.productType.update({ where: { id: type.id }, data: { name: name.trim() } }),
    )
  }

  async deleteProductType(storeId: bigint, id: string) {
    const type = await this.prisma.productType.findFirst({
      where: { id: BigInt(id), store_id: storeId },
    })
    if (!type) throw new NotFoundException('Product type not found')
    await this.prisma.product.updateMany({
      where: { product_type_id: type.id },
      data: { product_type_id: null },
    })
    return this.prisma.productType.delete({ where: { id: type.id } })
  }

  async getTags(storeId: bigint) {
    return this.jsonSafe(
      await this.prisma.tag.findMany({
        where: { store_id: storeId },
        orderBy: { name: 'asc' },
      }),
    )
  }

  async createTag(storeId: bigint, name: string) {
    const exists = await this.prisma.tag.findFirst({
      where: { store_id: storeId, name: { equals: name.trim(), mode: 'insensitive' } },
    })
    if (exists) return this.jsonSafe(exists)
    return this.jsonSafe(
      await this.prisma.tag.create({ data: { store_id: storeId, name: name.trim() } }),
    )
  }

  async updateTag(storeId: bigint, id: string, name: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: BigInt(id), store_id: storeId },
    })
    if (!tag) throw new NotFoundException('Tag not found')
    return this.jsonSafe(
      await this.prisma.tag.update({ where: { id: tag.id }, data: { name: name.trim() } }),
    )
  }

  async deleteTag(storeId: bigint, id: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: BigInt(id), store_id: storeId },
    })
    if (!tag) throw new NotFoundException('Tag not found')
    await this.prisma.productTag.deleteMany({ where: { tag_id: tag.id } })
    return this.prisma.tag.delete({ where: { id: tag.id } })
  }
}

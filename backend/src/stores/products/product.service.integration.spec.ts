import { PrismaClient } from '@prisma/client';
import { ProductService } from './product.service';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness';

const STORE = 1n;
const OTHER_STORE = 2n;

async function seedStores(prisma: PrismaClient): Promise<void> {
  for (const id of [STORE, OTHER_STORE]) {
    const user = await prisma.users.create({
      data: {
        id,
        username: `spec_product_${id}`,
        email: `spec_product_${id}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });

    await prisma.store.create({
      data: {
        id,
        name: `Spec Product Store ${id}`,
        slug: `spec-product-store-${id}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
    });
  }
}

async function cleanupProductTables(prisma: PrismaClient): Promise<void> {
  await prisma.productCollection.deleteMany();
  await prisma.productTag.deleteMany();
  await prisma.productOptionValue.deleteMany();
  await prisma.productOption.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productType.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.collection.deleteMany();
}

describe('ProductService cross-store isolation (integration)', () => {
  let prisma: PrismaClient;
  let service: ProductService;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    service = new ProductService(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await cleanupProductTables(prisma);
    await truncateTables(ALL_TEST_TABLES);
    await seedStores(prisma);
  });

  describe('createProduct', () => {
    it('rejects a product type owned by another store and creates nothing', async () => {
      const otherType = await prisma.productType.create({
        data: {
          store_id: OTHER_STORE,
          name: 'Other Store Type',
        },
      });

      const store = await prisma.store.findUniqueOrThrow({
        where: { id: STORE },
      });

      await expect(
        service.createProduct(store, {
          title: 'Cross Store Type Product',
          price: '10',
          compare_at_price: '15',
          product_type_id: otherType.id.toString(),
        }),
      ).rejects.toThrow('Product type not found');

      const products = await prisma.product.findMany({
        where: { store_id: STORE },
      });

      expect(products).toHaveLength(0);
    });

    it('rejects mixed tags when one tag belongs to another store', async () => {
      const ownTag = await prisma.tag.create({
        data: {
          store_id: STORE,
          name: 'Own Tag',
        },
      });

      const foreignTag = await prisma.tag.create({
        data: {
          store_id: OTHER_STORE,
          name: 'Foreign Tag',
        },
      });

      const store = await prisma.store.findUniqueOrThrow({
        where: { id: STORE },
      });

      await expect(
        service.createProduct(store, {
          title: 'Mixed Tag Product',
          price: '10',
          compare_at_price: '15',
          tag_ids: [ownTag.id.toString(), foreignTag.id.toString()],
        }),
      ).rejects.toThrow('One or more tags not found');

      const products = await prisma.product.findMany({
        where: { store_id: STORE },
      });

      expect(products).toHaveLength(0);

      const links = await prisma.productTag.findMany();

      expect(links).toHaveLength(0);
    });

    it('rejects mixed collections when one collection belongs to another store', async () => {
      const ownCollection = await prisma.collection.create({
        data: {
          storeId: STORE,
          name: 'Own Collection',
          handle: 'own-collection',
        },
      });

      const foreignCollection = await prisma.collection.create({
        data: {
          storeId: OTHER_STORE,
          name: 'Foreign Collection',
          handle: 'foreign-collection',
        },
      });

      const store = await prisma.store.findUniqueOrThrow({
        where: { id: STORE },
      });

      await expect(
        service.createProduct(store, {
          title: 'Mixed Collection Product',
          price: '10',
          compare_at_price: '15',
          collection_ids: [
            ownCollection.id.toString(),
            foreignCollection.id.toString(),
          ],
        }),
      ).rejects.toThrow('One or more collections not found');

      const products = await prisma.product.findMany({
        where: { store_id: STORE },
      });

      expect(products).toHaveLength(0);

      const links = await prisma.productCollection.findMany();

      expect(links).toHaveLength(0);
    });
  });

  describe('updateProduct', () => {
    it('rejects a variant from another store and rolls back the entire update', async () => {
      const store1 = await prisma.store.findUniqueOrThrow({
        where: { id: STORE },
      });

      const store2 = await prisma.store.findUniqueOrThrow({
        where: { id: OTHER_STORE },
      });

      const ownTag = await prisma.tag.create({
        data: {
          store_id: STORE,
          name: 'Keep Tag',
        },
      });

      const ownCollection = await prisma.collection.create({
        data: {
          storeId: STORE,
          name: 'Keep Collection',
          handle: 'keep-collection',
        },
      });

      const product1 = await prisma.product.create({
        data: {
          store_id: STORE,
          title: 'Original Product',
          handle: 'original-product',
          status: 'ACTIVE',
          charge_tax: true,
          tags: {
            create: {
              tag_id: ownTag.id,
            },
          },
          variants: {
            create: {
              title: 'Original Variant',
              price: 25,
              inventory_qty: 7,
              track_inventory: true,
              position: 0,
            },
          },
        },
      });

      await prisma.productCollection.create({
        data: {
          productId: product1.id,
          collectionId: ownCollection.id,
          position: 0,
        },
      });

      const foreignProduct = await prisma.product.create({
        data: {
          store_id: OTHER_STORE,
          title: 'Other Product',
          handle: 'other-product',
          status: 'ACTIVE',
          charge_tax: true,
          variants: {
            create: {
              title: 'Foreign Variant',
              price: 99,
              inventory_qty: 20,
              track_inventory: true,
              position: 0,
            },
          },
        },
        include: {
          variants: true,
        },
      });

      const foreignVariant = foreignProduct.variants[0];

      await expect(
        service.updateProduct(store1, product1.id.toString(), {
          title: 'HACKED PRODUCT',
          compare_at_price: '15',
          tag_ids: [],
          collection_ids: [],
          variants: [
            {
              id: foreignVariant.id.toString(),
              title: 'ILLEGAL UPDATE',
              price: '1',
              compare_at_price: '10',
              inventory_qty: '999',
            },
          ],
        }),
      ).rejects.toThrow('Variant does not belong to this product');

      const savedProduct = await prisma.product.findUniqueOrThrow({
        where: { id: product1.id },
        include: {
          variants: true,
          tags: true,
          collections: true,
        },
      });

      expect(savedProduct.store_id).toBe(STORE);
      expect(savedProduct.title).toBe('Original Product');
      expect(savedProduct.variants).toHaveLength(1);
      expect(savedProduct.variants[0].title).toBe('Original Variant');
      expect(savedProduct.variants[0].price?.toString()).toBe('25');
      expect(savedProduct.variants[0].inventory_qty).toBe(7);

      expect(savedProduct.tags).toHaveLength(1);
      expect(savedProduct.tags[0].tag_id).toBe(ownTag.id);

      expect(savedProduct.collections).toHaveLength(1);
      expect(savedProduct.collections[0].collectionId).toBe(ownCollection.id);

      const foreignVariantAfter = await prisma.productVariant.findUniqueOrThrow(
        {
          where: { id: foreignVariant.id },
        },
      );

      expect(foreignVariantAfter.title).toBe('Foreign Variant');
      expect(foreignVariantAfter.price?.toString()).toBe('99');
      expect(foreignVariantAfter.inventory_qty).toBe(20);

      expect(savedProduct).not.toBeUndefined();
      expect(store2.id).toBe(OTHER_STORE);
    });
  });

  /* ══════════════════════════════════════════════════════════════
     ROUND 9A — THE INVENTORY FLOOR ON THE MERCHANT'S SIDE.

     A negative `inventory_qty` is legitimate only while the merchant
     has authorised backorder on that variant. Turning the switch off
     against an outstanding deficit is refused BEFORE the write, so the
     merchant reads a sentence instead of a Postgres constraint
     violation from `product_variant_inventory_floor`.
     ══════════════════════════════════════════════════════════════ */

  describe('the inventory floor', () => {
    async function backorderedProduct(deficit: number) {
      return prisma.product.create({
        data: {
          store_id: STORE,
          title: 'Backordered Product',
          handle: 'backordered-product',
          status: 'ACTIVE',
          charge_tax: true,
          variants: {
            create: {
              title: 'Default Title',
              price: 25,
              inventory_qty: -deficit,
              track_inventory: true,
              continue_selling: true,
              position: 0,
            },
          },
        },
        include: { variants: true },
      });
    }

    it('B3 — refuses to switch continue_selling off while units are owed, with a message the merchant can act on', async () => {
      const product = await backorderedProduct(3);
      const store = await prisma.store.findUniqueOrThrow({
        where: { id: STORE },
      });

      await expect(
        service.updateProduct(store, product.id.toString(), {
          title: 'Backordered Product',
          compare_at_price: '30',
          tag_ids: [],
          collection_ids: [],
          variants: [
            {
              id: product.variants[0].id.toString(),
              title: 'Default Title',
              price: '25',
              inventory_qty: '-3',
              track_inventory: true,
              continue_selling: false,
            },
          ],
        }),
      ).rejects.toThrow(/outstanding backorder of 3 unit/);

      // And nothing was written: the deficit and the flag are intact.
      const after = await prisma.productVariant.findUniqueOrThrow({
        where: { id: product.variants[0].id },
      });
      expect(after.inventory_qty).toBe(-3);
      expect(after.continue_selling).toBe(true);
    });

    it('allows the switch off once the deficit is resolved in the same save', async () => {
      const product = await backorderedProduct(3);
      const store = await prisma.store.findUniqueOrThrow({
        where: { id: STORE },
      });

      await service.updateProduct(store, product.id.toString(), {
        title: 'Backordered Product',
        compare_at_price: '30',
        tag_ids: [],
        collection_ids: [],
        variants: [
          {
            id: product.variants[0].id.toString(),
            title: 'Default Title',
            price: '25',
            inventory_qty: '5',
            track_inventory: true,
            continue_selling: false,
          },
        ],
      });

      const after = await prisma.productVariant.findUniqueOrThrow({
        where: { id: product.variants[0].id },
      });
      expect(after.inventory_qty).toBe(5);
      expect(after.continue_selling).toBe(false);
    });
  });
});

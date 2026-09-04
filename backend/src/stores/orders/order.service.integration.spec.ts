import { PrismaClient, OrderStatus, Prisma } from '@prisma/client';
import { OrderService } from './order.service';
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
        username: `spec_order_${id}`,
        email: `spec_order_${id}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });

    await prisma.store.create({
      data: {
        id,
        name: `Spec Order Store ${id}`,
        slug: `spec-order-store-${id}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
    });
  }
}

async function cleanupOrderFixtures(prisma: PrismaClient): Promise<void> {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
}

describe('OrderService cross-store isolation (integration)', () => {
  let prisma: PrismaClient;
  let service: OrderService;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    service = new OrderService(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await cleanupOrderFixtures(prisma);
    await truncateTables(ALL_TEST_TABLES);
    await seedStores(prisma);
  });

  /**
   * `Order`/`OrderItem` are RLS-enabled (test/global-setup.ts): the raw
   * `rls_test` client this spec holds can only read or write them once
   * `app.store_id` (and, for the `WITH CHECK` pair, `app.mode`) are
   * installed on the same transaction — exactly what OrderService itself
   * now does via `withTenantTransaction`. Fixture setup and assertions
   * that reach `Order`/`OrderItem` directly need the same context, or
   * they see either a silently empty result set or a `42501`
   * row-level-security violation on insert.
   */
  async function withTenant<T>(
    storeId: bigint,
    cb: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT
          set_config('app.store_id', ${storeId.toString()}, true),
          set_config('app.mode', 'live', true)
      `;
      return cb(tx as Prisma.TransactionClient);
    });
  }

  async function createProductWithVariant(
    storeId: bigint,
    title: string,
    price: number,
    inventoryQty = 10,
  ) {
    return prisma.product.create({
      data: {
        store_id: storeId,
        title,
        handle: `${title.toLowerCase().replace(/\s+/g, '-')}-${storeId}`,
        status: 'ACTIVE',
        charge_tax: true,
        variants: {
          create: {
            title: 'Default Title',
            price,
            inventory_qty: inventoryQty,
            track_inventory: true,
            continue_selling: false,
            position: 0,
          },
        },
      },
      include: {
        variants: true,
      },
    });
  }

  async function createOrderFixture(
    storeId: bigint,
    orderNumber: string,
    customerName: string,
    status: OrderStatus = OrderStatus.PENDING,
  ) {
    return withTenant(storeId, (tx) =>
      tx.order.create({
        data: {
          store_id: storeId,
          order_number: orderNumber,
          status,
          customer_name: customerName,
          customer_phone: '01000000000',
          customer_email: `${customerName.toLowerCase().replace(/\s+/g, '.')}@example.test`,
          address_line: '1 Test Street',
          city: 'Cairo',
          subtotal: 100,
          total: 100,
          items: {
            create: {
              title: 'Fixture Product',
              variant_title: null,
              price: 100,
              qty: 1,
              product_id: null,
              variant_id: null,
              image_url: null,
            },
          },
        },
        include: {
          items: true,
        },
      }),
    );
  }

  describe('createOrder', () => {
    it('rejects a variant owned by another store and creates no order', async () => {
      const foreignProduct = await createProductWithVariant(
        OTHER_STORE,
        'Foreign Product',
        25,
        10,
      );

      const foreignVariant = foreignProduct.variants[0];

      await expect(
        service.createOrder(
          'spec-order-store-1',
          {
            name: 'Attacker',
            phone: '01111111111',
            email: 'attacker@example.test',
            address: '1 Attack Street',
            city: 'Cairo',
          },
          [
            {
              variantId: foreignVariant.id.toString(),
              qty: 1,
            },
          ],
        ),
      ).rejects.toThrow(
        `منتج غير موجود (variant ${foreignVariant.id.toString()})`,
      );

      const orders = await withTenant(STORE, (tx) =>
        tx.order.findMany({
          where: { store_id: STORE },
        }),
      );

      expect(orders).toHaveLength(0);

      const savedForeignVariant = await prisma.productVariant.findUniqueOrThrow(
        {
          where: { id: foreignVariant.id },
        },
      );

      expect(savedForeignVariant.inventory_qty).toBe(10);
    });

    it('creates an order only from a variant belonging to the requested store', async () => {
      const ownProduct = await createProductWithVariant(
        STORE,
        'Own Product',
        25,
        10,
      );

      const ownVariant = ownProduct.variants[0];

      const result = await service.createOrder(
        'spec-order-store-1',
        {
          name: 'Valid Customer',
          phone: '01000000000',
          email: 'valid@example.test',
          address: '1 Valid Street',
          city: 'Cairo',
        },
        [
          {
            variantId: ownVariant.id.toString(),
            qty: 2,
          },
        ],
      );

      expect(result.payment_redirect_url).toBeNull();
      expect(result.order).toBeDefined();

      const order = await withTenant(STORE, (tx) =>
        tx.order.findFirstOrThrow({
          where: {
            store_id: STORE,
          },
          include: {
            items: true,
          },
        }),
      );

      expect(order.store_id).toBe(STORE);
      expect(order.order_number).toBe('1001');
      expect(order.items).toHaveLength(1);
      expect(order.items[0].variant_id).toBe(ownVariant.id);
      expect(order.items[0].qty).toBe(2);
      expect(order.total.toString()).toBe('50');

      const savedVariant = await prisma.productVariant.findUniqueOrThrow({
        where: {
          id: ownVariant.id,
        },
      });

      expect(savedVariant.inventory_qty).toBe(8);
    });
  });

  describe('getOrder', () => {
    it('does not return an order belonging to another store', async () => {
      const foreignOrder = await createOrderFixture(
        OTHER_STORE,
        '1001',
        'Foreign Customer',
      );

      await expect(
        service.getOrder(STORE, foreignOrder.id.toString()),
      ).rejects.toThrow('Order not found');
    });

    it('returns an order belonging to the requested store', async () => {
      const ownOrder = await createOrderFixture(STORE, '1001', 'Own Customer');

      const result = await service.getOrder(STORE, ownOrder.id.toString());

      expect(result).toMatchObject({
        id: ownOrder.id.toString(),
        order_number: '1001',
        customer_name: 'Own Customer',
      });
    });
  });

  describe('updateOrderStatus', () => {
    it('does not update an order belonging to another store', async () => {
      const foreignOrder = await createOrderFixture(
        OTHER_STORE,
        '1001',
        'Foreign Customer',
      );

      await expect(
        service.updateOrderStatus(
          STORE,
          foreignOrder.id.toString(),
          OrderStatus.SHIPPED,
        ),
      ).rejects.toThrow('Order not found');

      const saved = await withTenant(OTHER_STORE, (tx) =>
        tx.order.findUniqueOrThrow({
          where: {
            id: foreignOrder.id,
          },
        }),
      );

      expect(saved.status).toBe(OrderStatus.PENDING);
      expect(saved.store_id).toBe(OTHER_STORE);
    });

    it('updates only the order belonging to the requested store', async () => {
      const ownOrder = await createOrderFixture(STORE, '1001', 'Own Customer');

      const result = await service.updateOrderStatus(
        STORE,
        ownOrder.id.toString(),
        OrderStatus.SHIPPED,
      );

      expect(result.status).toBe(OrderStatus.SHIPPED);

      const saved = await withTenant(STORE, (tx) =>
        tx.order.findUniqueOrThrow({
          where: {
            id: ownOrder.id,
          },
        }),
      );

      expect(saved.store_id).toBe(STORE);
      expect(saved.status).toBe(OrderStatus.SHIPPED);
    });
  });

  describe('getStorefrontOrder', () => {
    it('does not expose another store order through the storefront slug', async () => {
      const foreignOrder = await createOrderFixture(
        OTHER_STORE,
        '1001',
        'Foreign Customer',
      );

      await expect(
        service.getStorefrontOrder(
          'spec-order-store-1',
          foreignOrder.order_number,
        ),
      ).rejects.toThrow('Order not found');
    });

    it('returns only the order belonging to the storefront store', async () => {
      const ownOrder = await createOrderFixture(STORE, '1001', 'Own Customer');

      const result = await service.getStorefrontOrder(
        'spec-order-store-1',
        ownOrder.order_number,
      );

      expect(result).toMatchObject({
        id: ownOrder.id.toString(),
        order_number: '1001',
        customer_name: 'Own Customer',
      });
    });
  });

  describe('getOrders', () => {
    it('returns orders from the requested store only', async () => {
      await createOrderFixture(STORE, '1001', 'Store One Customer');
      await createOrderFixture(OTHER_STORE, '1001', 'Store Two Customer');

      const result = await service.getOrders(STORE, {
        page: 1,
        limit: 50,
      });

      expect(result.total).toBe(1);
      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].customer_name).toBe('Store One Customer');
      expect(result.orders[0].store_id).toBe(STORE.toString());
    });
  });
});

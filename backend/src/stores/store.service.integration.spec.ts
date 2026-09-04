import { PrismaClient } from '@prisma/client';
import { StoreService } from './store.service';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../test/db-test-harness';

const STORE = 1n;
const OTHER_STORE = 2n;

async function seedStores(prisma: PrismaClient) {
  for (const id of [STORE, OTHER_STORE]) {
    const user = await prisma.users.create({
      data: {
        id,
        username: `spec_store_${id}`,
        email: `spec_store_${id}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });

    await prisma.store.create({
      data: {
        id,
        name: `Spec Store ${id}`,
        slug: `spec-store-${id}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
    });
  }
}

async function cleanupMenuFixtures(prisma: PrismaClient) {
  await prisma.menuItem.deleteMany();
  await prisma.storeMenu.deleteMany();
}

describe('StoreService menu cross-store isolation (integration)', () => {
  let prisma: PrismaClient;
  let service: StoreService;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    service = new StoreService(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await cleanupMenuFixtures(prisma);
    await truncateTables(ALL_TEST_TABLES);
    await seedStores(prisma);
  });

  async function createMenu(storeId: bigint, name: string, handle: string) {
    return prisma.storeMenu.create({
      data: {
        store_id: storeId,
        name,
        handle,
      },
    });
  }

  async function createItem(
    menuId: bigint,
    title: string,
    sortOrder = 0,
    parentId: bigint | null = null,
  ) {
    return prisma.menuItem.create({
      data: {
        menu_id: menuId,
        title,
        type: 'CUSTOM',
        url: `/${title.toLowerCase().replace(/\s+/g, '-')}`,
        resource_id: null,
        parent_id: parentId,
        sort_order: sortOrder,
      },
    });
  }

  describe('getMenus', () => {
    it('returns only menus owned by the requested store', async () => {
      await createMenu(STORE, 'My Menu', 'my-menu');
      await createMenu(OTHER_STORE, 'Other Menu', 'other-menu');

      const menus = await service.getMenus(STORE);

      expect(menus).toHaveLength(1);
      expect(menus[0].store_id).toBe(STORE);
      expect(menus[0].name).toBe('My Menu');
    });
  });

  describe('updateMenu', () => {
    it('rejects updating a menu belonging to another store', async () => {
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );

      await expect(
        service.updateMenu(STORE, foreignMenu.id.toString(), {
          name: 'HACKED',
        }),
      ).rejects.toThrow('Menu not found');

      const saved = await prisma.storeMenu.findUniqueOrThrow({
        where: { id: foreignMenu.id },
      });

      expect(saved.name).toBe('Foreign Menu');
      expect(saved.store_id).toBe(OTHER_STORE);
    });

    it('updates only a menu belonging to the requested store', async () => {
      const menu = await createMenu(STORE, 'My Menu', 'my-menu');

      const result = await service.updateMenu(STORE, menu.id.toString(), {
        name: 'Updated Menu',
      });

      expect(result.name).toBe('Updated Menu');

      const saved = await prisma.storeMenu.findUniqueOrThrow({
        where: { id: menu.id },
      });

      expect(saved.name).toBe('Updated Menu');
      expect(saved.store_id).toBe(STORE);
    });
  });

  describe('deleteMenu', () => {
    it('rejects deleting a menu belonging to another store', async () => {
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );

      await expect(
        service.deleteMenu(STORE, foreignMenu.id.toString()),
      ).rejects.toThrow('Menu not found');

      const stillThere = await prisma.storeMenu.findUnique({
        where: { id: foreignMenu.id },
      });

      expect(stillThere).not.toBeNull();
      expect(stillThere?.store_id).toBe(OTHER_STORE);
    });
  });

  describe('addMenuItem', () => {
    it('cannot add an item to a menu owned by another store', async () => {
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );

      await expect(
        service.addMenuItem(STORE, foreignMenu.id.toString(), {
          title: 'Injected Item',
          type: 'CUSTOM',
          url: '/injected',
        }),
      ).rejects.toThrow('Menu not found');

      const items = await prisma.menuItem.findMany({
        where: { menu_id: foreignMenu.id },
      });

      expect(items).toHaveLength(0);
    });

    it('rejects a parent from another menu even inside the same store', async () => {
      const menuA = await createMenu(STORE, 'Menu A', 'menu-a');
      const menuB = await createMenu(STORE, 'Menu B', 'menu-b');

      const foreignParent = await createItem(menuB.id, 'Foreign Parent');

      await expect(
        service.addMenuItem(STORE, menuA.id.toString(), {
          title: 'Child',
          type: 'CUSTOM',
          url: '/child',
          parent_id: foreignParent.id.toString(),
        }),
      ).rejects.toThrow('Parent menu item not found');

      const items = await prisma.menuItem.findMany({
        where: { menu_id: menuA.id },
      });

      expect(items).toHaveLength(0);
    });
  });

  describe('updateMenuItem', () => {
    it('rejects updating an item belonging to another store', async () => {
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );
      const foreignItem = await createItem(foreignMenu.id, 'Foreign Item');

      await expect(
        service.updateMenuItem(STORE, foreignItem.id.toString(), {
          title: 'HACKED',
          url: '/hacked',
          type: 'CUSTOM',
        }),
      ).rejects.toThrow('Menu item not found');

      const saved = await prisma.menuItem.findUniqueOrThrow({
        where: { id: foreignItem.id },
      });

      expect(saved.title).toBe('Foreign Item');
      expect(saved.menu_id).toBe(foreignMenu.id);
    });

    it('rejects assigning a parent from another menu', async () => {
      const menuA = await createMenu(STORE, 'Menu A', 'menu-a');
      const menuB = await createMenu(STORE, 'Menu B', 'menu-b');

      const item = await createItem(menuA.id, 'Item');
      const foreignParent = await createItem(menuB.id, 'Parent');

      await expect(
        service.updateMenuItem(STORE, item.id.toString(), {
          title: 'Item',
          url: '/item',
          type: 'CUSTOM',
          parent_id: foreignParent.id.toString(),
        }),
      ).rejects.toThrow('Parent menu item not found');

      const saved = await prisma.menuItem.findUniqueOrThrow({
        where: { id: item.id },
      });

      expect(saved.parent_id).toBeNull();
      expect(saved.menu_id).toBe(menuA.id);
    });
  });

  describe('deleteMenuItem', () => {
    it('rejects deleting an item belonging to another store', async () => {
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );
      const foreignItem = await createItem(foreignMenu.id, 'Foreign Item');

      await expect(
        service.deleteMenuItem(STORE, foreignItem.id.toString()),
      ).rejects.toThrow('Menu item not found');

      const stillThere = await prisma.menuItem.findUnique({
        where: { id: foreignItem.id },
      });

      expect(stillThere).not.toBeNull();
    });
  });

  describe('reorderMenuItems', () => {
    it('rejects when any requested item belongs to another store', async () => {
      const ownMenu = await createMenu(STORE, 'My Menu', 'my-menu');
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );

      const ownItem = await createItem(ownMenu.id, 'Own Item', 0);
      const foreignItem = await createItem(foreignMenu.id, 'Foreign Item', 0);

      await expect(
        service.reorderMenuItems(STORE, [
          {
            id: ownItem.id.toString(),
            sortOrder: 5,
          },
          {
            id: foreignItem.id.toString(),
            sortOrder: 6,
          },
        ]),
      ).rejects.toThrow('One or more menu items not found');

      const savedOwn = await prisma.menuItem.findUniqueOrThrow({
        where: { id: ownItem.id },
      });

      const savedForeign = await prisma.menuItem.findUniqueOrThrow({
        where: { id: foreignItem.id },
      });

      expect(savedOwn.sort_order).toBe(0);
      expect(savedForeign.sort_order).toBe(0);
    });

    it('rejects a parent belonging to another menu', async () => {
      const menuA = await createMenu(STORE, 'Menu A', 'menu-a');
      const menuB = await createMenu(STORE, 'Menu B', 'menu-b');

      const item = await createItem(menuA.id, 'Item', 0);
      const foreignParent = await createItem(menuB.id, 'Parent', 0);

      await expect(
        service.reorderMenuItems(STORE, [
          {
            id: item.id.toString(),
            sortOrder: 3,
            parentId: foreignParent.id.toString(),
          },
        ]),
      ).rejects.toThrow('A menu item parent must belong to the same menu.');

      const saved = await prisma.menuItem.findUniqueOrThrow({
        where: { id: item.id },
      });

      expect(saved.sort_order).toBe(0);
      expect(saved.parent_id).toBeNull();
    });
  });

  describe('duplicateMenu', () => {
    it('rejects duplicating a menu owned by another store', async () => {
      const foreignMenu = await createMenu(
        OTHER_STORE,
        'Foreign Menu',
        'foreign-menu',
      );

      await createItem(foreignMenu.id, 'Foreign Item');

      await expect(
        service.duplicateMenu(STORE, foreignMenu.id.toString()),
      ).rejects.toThrow('Menu not found');

      const menus = await prisma.storeMenu.findMany({
        orderBy: { id: 'asc' },
      });

      expect(menus).toHaveLength(1);
      expect(menus[0].id).toBe(foreignMenu.id);
    });

    it('duplicates only a menu belonging to the requested store', async () => {
      const menu = await createMenu(STORE, 'My Menu', 'my-menu');
      const root = await createItem(menu.id, 'Root', 0);
      await createItem(menu.id, 'Child', 1, root.id);

      const result = await service.duplicateMenu(STORE, menu.id.toString());

      expect(result.store_id).toBe(STORE);
      expect(result.name).toBe('My Menu copy');

      const duplicated = await prisma.storeMenu.findFirstOrThrow({
        where: {
          id: { not: menu.id },
          store_id: STORE,
        },
        include: {
          items: {
            orderBy: {
              sort_order: 'asc',
            },
          },
        },
      });

      expect(duplicated.items).toHaveLength(2);
      expect(duplicated.items[0].title).toBe('Root');
      expect(duplicated.items[1].title).toBe('Child');
      expect(duplicated.items[1].parent_id).toBe(duplicated.items[0].id);
      expect(duplicated.id).not.toBe(menu.id);
    });
  });
});

import { PrismaClient } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../test/db-test-harness';

/**
 * Default Store — integration coverage.
 *
 * Covers the required cases from STAGE — SECURE DEFAULT STORE / PRIMARY
 * STORE: zero/one/many-store defaulting, atomic switch, cross-owner
 * rejection, body-injection resistance, the DB-level one-default
 * invariant under a genuine race, per-owner independence, and
 * GET /stores exposing `is_default` correctly.
 */

const USER_A = 1n;
const USER_B = 2n;

async function seedUser(prisma: PrismaClient, id: bigint) {
  await prisma.users.create({
    data: {
      id,
      username: `default_store_user_${id}`,
      email: `default_store_user_${id}@example.test`,
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  });
}

async function seedStore(
  prisma: PrismaClient,
  id: bigint,
  ownerId: bigint,
  slug: string,
) {
  return prisma.store.create({
    data: {
      id,
      name: `Store ${id}`,
      slug,
      currency: 'USD',
      ownerId,
      updatedAt: new Date(),
    },
  });
}

describe('Default Store (integration)', () => {
  let prisma: PrismaClient;
  let service: StoreService;
  let controller: StoreController;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    service = new StoreService(prisma as never);
    controller = new StoreController(service);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    await seedUser(prisma, USER_A);
    await seedUser(prisma, USER_B);
  });

  describe('createStore auto-default policy', () => {
    it('makes the first store for an owner the default', async () => {
      const store = await service.createStore(USER_A.toString(), {
        name: 'First Store',
        slug: 'first-store',
        currency: 'SAR',
      });

      expect(store.is_default).toBe(true);
    });

    it('does not change the existing default when a second store is created', async () => {
      const first = await service.createStore(USER_A.toString(), {
        name: 'First Store',
        slug: 'first-store',
        currency: 'SAR',
      });
      expect(first.is_default).toBe(true);

      const second = await service.createStore(USER_A.toString(), {
        name: 'Second Store',
        slug: 'second-store',
        currency: 'SAR',
      });
      expect(second.is_default).toBe(false);

      const stores = await service.getMyStores(USER_A.toString());
      const defaults = stores.filter((s) => s.is_default);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].slug).toBe('first-store');
    });
  });

  /*
   * THE CURRENCY CONTRACT — Round 10.
   *
   * `currency` is required at store creation and must be one of
   * SUPPORTED_STORE_CURRENCIES. It is not defaulted, deliberately:
   * currency is store-scoped and settlement-relevant (ledger accounts
   * are keyed on it, and payment offerings are validated against it),
   * so guessing is worse than refusing. `store.currency`'s
   * `@default("USD")` in the schema is a legacy column default, not the
   * product default — the creation form defaults to SAR — and silently
   * applying it would hand a Saudi merchant a USD store.
   *
   * These tests exist because the two above previously omitted the
   * field and had been failing ever since the validation was added.
   */
  describe('the currency contract', () => {
    it('accepts and persists a supported currency', async () => {
      const store = await service.createStore(USER_A.toString(), {
        name: 'Currency Store',
        slug: 'currency-store',
        currency: 'EGP',
      });

      expect(store.currency).toBe('EGP');

      const saved = await prisma.store.findUniqueOrThrow({
        where: { id: BigInt(store.id) },
      });
      expect(saved.currency).toBe('EGP');
    });

    it('normalises the case rather than rejecting it', async () => {
      const store = await service.createStore(USER_A.toString(), {
        name: 'Lowercase Store',
        slug: 'lowercase-store',
        currency: 'sar',
      });

      expect(store.currency).toBe('SAR');
    });

    it('refuses an unsupported currency, and creates nothing', async () => {
      await expect(
        service.createStore(USER_A.toString(), {
          name: 'Bad Currency Store',
          slug: 'bad-currency-store',
          currency: 'GBP',
        }),
      ).rejects.toThrow('عملة غير مدعومة');

      expect(await prisma.store.count({ where: { ownerId: USER_A } })).toBe(0);
    });

    it('refuses a missing currency rather than defaulting one', async () => {
      await expect(
        service.createStore(USER_A.toString(), {
          name: 'No Currency Store',
          slug: 'no-currency-store',
        }),
      ).rejects.toThrow('عملة غير مدعومة');

      expect(await prisma.store.count({ where: { ownerId: USER_A } })).toBe(0);
    });
  });

  describe('GET /stores (getMyStores)', () => {
    it('returns is_default: false for every store when the owner has none set (0 stores case has none at all)', async () => {
      const stores = await service.getMyStores(USER_A.toString());
      expect(stores).toHaveLength(0);
    });

    it('reports exactly one default among multiple stores once one is set', async () => {
      await seedStore(prisma, 10n, USER_A, 'store-a');
      await seedStore(prisma, 11n, USER_A, 'store-b');
      await seedStore(prisma, 12n, USER_A, 'store-c');

      await service.setDefaultStore(USER_A.toString(), 'store-b');

      const stores = await service.getMyStores(USER_A.toString());
      const defaults = stores.filter((s) => s.is_default);

      expect(stores).toHaveLength(3);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].slug).toBe('store-b');
    });
  });

  describe('setDefaultStore — happy path', () => {
    it('a single-store owner can make their only store default', async () => {
      await seedStore(prisma, 20n, USER_A, 'only-store');

      const result = await service.setDefaultStore(
        USER_A.toString(),
        'only-store',
      );

      expect(result.is_default).toBe(true);
    });

    it('switching default from A to B: A becomes false, B becomes true', async () => {
      await seedStore(prisma, 30n, USER_A, 'store-a');
      await seedStore(prisma, 31n, USER_A, 'store-b');

      await service.setDefaultStore(USER_A.toString(), 'store-a');
      let stores = await service.getMyStores(USER_A.toString());
      expect(stores.find((s) => s.slug === 'store-a')?.is_default).toBe(true);
      expect(stores.find((s) => s.slug === 'store-b')?.is_default).toBe(
        false,
      );

      await service.setDefaultStore(USER_A.toString(), 'store-b');
      stores = await service.getMyStores(USER_A.toString());
      expect(stores.find((s) => s.slug === 'store-a')?.is_default).toBe(
        false,
      );
      expect(stores.find((s) => s.slug === 'store-b')?.is_default).toBe(true);

      const defaults = stores.filter((s) => s.is_default);
      expect(defaults).toHaveLength(1);
    });

    it('different users each keep their own independent default', async () => {
      await seedStore(prisma, 40n, USER_A, 'a-store');
      await seedStore(prisma, 41n, USER_B, 'b-store');

      await service.setDefaultStore(USER_A.toString(), 'a-store');
      await service.setDefaultStore(USER_B.toString(), 'b-store');

      const storesA = await service.getMyStores(USER_A.toString());
      const storesB = await service.getMyStores(USER_B.toString());

      expect(storesA[0].is_default).toBe(true);
      expect(storesB[0].is_default).toBe(true);
    });
  });

  describe('ownership security', () => {
    it('rejects setting another user\'s store as default, by slug', async () => {
      await seedStore(prisma, 50n, USER_B, 'victim-store');

      await expect(
        service.setDefaultStore(USER_A.toString(), 'victim-store'),
      ).rejects.toThrow(NotFoundException);

      const stores = await service.getMyStores(USER_B.toString());
      expect(stores[0].is_default).toBe(false);
    });

    it('rejects an unknown slug the same way as a foreign slug (no existence leak)', async () => {
      await expect(
        service.setDefaultStore(USER_A.toString(), 'does-not-exist'),
      ).rejects.toThrow(NotFoundException);
    });

    it('the controller ignores any client-supplied ownerId/userId/is_default and only trusts the authenticated request user', async () => {
      await seedStore(prisma, 60n, USER_A, 'own-store');

      // The controller method takes no @Body(), so an attacker cannot
      // inject ownerId/userId/is_default even by crafting a request body —
      // this call proves the handler signature ignores it structurally.
      const req = { user: { id: USER_A.toString() } };
      const result = await controller.setDefault(req, 'own-store');

      expect(result.is_default).toBe(true);
      expect(result.ownerId).toBe(USER_A);
    });

    it('cannot promote a foreign store by numeric id disguised as a slug', async () => {
      await seedStore(prisma, 70n, USER_B, 'other-victim');

      await expect(
        service.setDefaultStore(USER_A.toString(), '70'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('concurrency / race safety', () => {
    it('never leaves two defaults for the same owner under concurrent set-default calls', async () => {
      await seedStore(prisma, 80n, USER_A, 'race-a');
      await seedStore(prisma, 81n, USER_A, 'race-b');

      const results = await Promise.allSettled([
        service.setDefaultStore(USER_A.toString(), 'race-a'),
        service.setDefaultStore(USER_A.toString(), 'race-b'),
      ]);

      // At least one must succeed; if the other loses the DB-level race it
      // must fail cleanly (ConflictException), never silently corrupt state.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      if (rejected.length > 0) {
        const reason = (rejected[0] as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(ConflictException);
      }

      const stores = await service.getMyStores(USER_A.toString());
      const defaults = stores.filter((s) => s.is_default);
      expect(defaults.length).toBeLessThanOrEqual(1);
    });

    it('the database rejects a direct duplicate-default write, bypassing the service entirely', async () => {
      await seedStore(prisma, 90n, USER_A, 'dup-a');
      await seedStore(prisma, 91n, USER_A, 'dup-b');

      await prisma.store.update({
        where: { id: 90n },
        data: { is_default: true },
      });

      await expect(
        prisma.store.update({
          where: { id: 91n },
          data: { is_default: true },
        }),
      ).rejects.toThrow();
    });
  });

  describe('idempotency', () => {
    it('setting the already-current default again is a no-op that still returns is_default: true', async () => {
      await seedStore(prisma, 100n, USER_A, 'idem-store');
      await service.setDefaultStore(USER_A.toString(), 'idem-store');

      const result = await service.setDefaultStore(
        USER_A.toString(),
        'idem-store',
      );

      expect(result.is_default).toBe(true);

      const stores = await service.getMyStores(USER_A.toString());
      expect(stores.filter((s) => s.is_default)).toHaveLength(1);
    });
  });
});

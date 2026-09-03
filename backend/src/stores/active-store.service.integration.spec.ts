import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { ActiveStoreService } from './active-store.service'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../test/db-test-harness'

/**
 * ══════════════════════════════════════════════════════════════════
 * Store switching, against a real database
 * ══════════════════════════════════════════════════════════════════
 *
 * `ActiveStoreService` is the only thing standing between a
 * client-supplied store identifier and the store every downstream query
 * is scoped to. It is therefore the authorization boundary for store
 * switching, and everything it is supposed to refuse is asserted here
 * rather than read off the comments.
 *
 * The fixture is the multi-store scenario itself:
 *
 *   owner    → store A (older) and store B (newer)
 *   stranger → store C
 *
 * Payment-method isolation is proven at the end under real RLS, because
 * "Store A's gateways must not appear after switching to Store B" is
 * the case that matters most and the one a stubbed database could not
 * honestly answer.
 */

const OWNER_ID = 8001n
const STRANGER_ID = 8002n

const STORE_A = 9001n
const STORE_B = 9002n
const STORE_C = 9003n
const DISABLED_STORE = 9004n

async function seed(prisma: PrismaClient) {
  await prisma.users.create({
    data: {
      id: OWNER_ID,
      username: 'active_store_owner',
      email: 'active_store_owner@example.test',
      password: 'x',
      updated_at: new Date(),
    },
  })

  await prisma.users.create({
    data: {
      id: STRANGER_ID,
      username: 'active_store_stranger',
      email: 'active_store_stranger@example.test',
      password: 'x',
      updated_at: new Date(),
    },
  })

  // Creation order is explicit: the no-identifier fallback is defined as
  // "oldest store", so the fixture must pin which one that is instead of
  // letting insertion order decide.
  await prisma.store.create({
    data: {
      id: STORE_A,
      name: 'Store A',
      slug: 'store-a',
      currency: 'SAR',
      ownerId: OWNER_ID,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date(),
    },
  })

  await prisma.store.create({
    data: {
      id: STORE_B,
      name: 'Store B',
      slug: 'store-b',
      currency: 'SAR',
      ownerId: OWNER_ID,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date(),
    },
  })

  await prisma.store.create({
    data: {
      id: STORE_C,
      name: 'Store C',
      slug: 'store-c',
      currency: 'SAR',
      ownerId: STRANGER_ID,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date(),
    },
  })

  await prisma.store.create({
    data: {
      id: DISABLED_STORE,
      name: 'Disabled Store',
      slug: 'disabled-store',
      currency: 'SAR',
      ownerId: OWNER_ID,
      status: 0n,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date(),
    },
  })
}

describe('ActiveStoreService (integration)', () => {
  let prisma: PrismaClient
  let service: ActiveStoreService

  beforeAll(async () => {
    prisma = await startTestDatabase()
    service = new ActiveStoreService(prisma as never)
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    await seed(prisma)
  })

  /**
   * Runs a callback with `app.store_id` and `app.mode` set for the
   * duration of one transaction — the same call production makes
   * through `PrismaService.withTenantTransaction`, which the test
   * harness attaches to this client.
   */
  function prismaTenant<T>(
    storeId: bigint,
    mode: 'live' | 'test',
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return (
      prisma as unknown as {
        withTenantTransaction: (
          storeId: bigint,
          mode: string,
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T>
      }
    ).withTenantTransaction(storeId, mode, callback)
  }

  describe('an authorized switch, A → B', () => {
    it('resolves the oldest store when the client names none', async () => {
      const store = await service.resolveActiveStore(OWNER_ID)

      expect(store.id).toBe(STORE_A)
    })

    it('switches to store B by id', async () => {
      const store = await service.resolveActiveStore(OWNER_ID, STORE_B.toString())

      expect(store.id).toBe(STORE_B)
      expect(store.slug).toBe('store-b')
    })

    it('switches to store B by slug', async () => {
      const store = await service.resolveActiveStore(OWNER_ID, 'store-b')

      expect(store.id).toBe(STORE_B)
    })

    it('switches back to A, carrying nothing over from B', async () => {
      await service.resolveActiveStore(OWNER_ID, 'store-b')
      const store = await service.resolveActiveStore(OWNER_ID, 'store-a')

      expect(store.id).toBe(STORE_A)
    })

    it('accepts the user id as a string, as the guard passes it', async () => {
      // SessionAuthGuard stringifies the id before putting it on the
      // request, so this is the shape production actually uses.
      const store = await service.resolveActiveStore(OWNER_ID.toString(), 'store-b')

      expect(store.id).toBe(STORE_B)
    })
  })

  describe('an unauthorized switch, A → C', () => {
    it('refuses a store owned by another user, by id', async () => {
      await expect(
        service.resolveActiveStore(OWNER_ID, STORE_C.toString()),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses a store owned by another user, by slug', async () => {
      await expect(
        service.resolveActiveStore(OWNER_ID, 'store-c'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('answers identically for a foreign store and a missing one', async () => {
      // Deliberate: distinguishing the two would confirm to a caller
      // that some other merchant's store exists under that id or slug.
      const foreign = await service
        .resolveActiveStore(OWNER_ID, 'store-c')
        .catch((error: Error) => error)
      const missing = await service
        .resolveActiveStore(OWNER_ID, 'store-does-not-exist')
        .catch((error: Error) => error)

      expect((foreign as Error).message).toBe((missing as Error).message)
    })

    it('refuses every store for a user who owns none', async () => {
      const orphan = await prisma.users.create({
        data: {
          id: 8003n,
          username: 'active_store_orphan',
          email: 'active_store_orphan@example.test',
          password: 'x',
          updated_at: new Date(),
        },
      })

      await expect(service.resolveActiveStore(orphan.id)).rejects.toBeInstanceOf(
        NotFoundException,
      )
      await expect(
        service.resolveActiveStore(orphan.id, 'store-a'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('malformed and hostile identifiers', () => {
    it('refuses a numeric id that exists for nobody', async () => {
      await expect(
        service.resolveActiveStore(OWNER_ID, '999999'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses a non-numeric identifier that is no slug either', async () => {
      await expect(
        service.resolveActiveStore(OWNER_ID, '../../etc/passwd'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses an id too large for a 64-bit column', async () => {
      // A stale or hand-edited store id must produce a clean refusal the
      // client can recover from, not a database error surfacing as 500.
      await expect(
        service.resolveActiveStore(OWNER_ID, '99999999999999999999999999'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('treats an empty identifier as "none given"', async () => {
      const store = await service.resolveActiveStore(OWNER_ID, '')

      expect(store.id).toBe(STORE_A)
    })

    it('resolves a disabled store for its owner', async () => {
      // Documented, not incidental: `status` gates the public storefront,
      // not the merchant's own dashboard. A merchant must still be able
      // to open a store they have switched off in order to switch it
      // back on.
      const store = await service.resolveActiveStore(OWNER_ID, 'disabled-store')

      expect(store.id).toBe(DISABLED_STORE)
      expect(Number(store.status)).toBe(0)
    })
  })

  describe('assertOwnership', () => {
    it('returns the store when the caller owns it', async () => {
      const store = await service.assertOwnership(OWNER_ID, 'store-b')

      expect(store.id).toBe(STORE_B)
    })

    it('distinguishes a foreign store from a missing one', async () => {
      await expect(
        service.assertOwnership(OWNER_ID, 'store-c'),
      ).rejects.toBeInstanceOf(ForbiddenException)

      await expect(
        service.assertOwnership(OWNER_ID, 'store-does-not-exist'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses an id too large for a 64-bit column', async () => {
      await expect(
        service.assertOwnership(OWNER_ID, '99999999999999999999999999'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('payment methods follow the active store', () => {
    /**
     * The tenant-transaction surface the harness gives the test client,
     * identical to the one PrismaService exposes to production code.
     */
    const tenant = prismaTenant

    /** Enables one gateway with one method on a store, in live mode. */
    async function enableGateway(
      storeId: bigint,
      gateway: 'stripe' | 'paymob' | 'moyasar',
      method: 'card' | 'mada',
    ) {
      // Seeded through the store's own tenant transaction on purpose.
      // RLS refuses a payment_accounts insert with no app.store_id, so
      // the fixture has to obey exactly the rule under test.
      await tenant(storeId, 'live', async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: storeId,
            mode: 'live',
            gateway,
            display_name: `${gateway} main`,
            status: 'active',
          },
        })

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: storeId,
            mode: 'live',
            method,
            enabled: true,
            position: 0,
          },
        })
      })
    }

    /** Reads offerings the way a request does: under RLS, for one store. */
    async function offeringsFor(storeId: bigint) {
      return tenant(storeId, 'live', async (tx) =>
        tx.paymentMethodOffering.findMany({
          where: { store_id: storeId, mode: 'live', enabled: true },
          include: { account: { select: { gateway: true } } },
        }),
      )
    }

    beforeEach(async () => {
      await enableGateway(STORE_A, 'stripe', 'card')
      await enableGateway(STORE_A, 'paymob', 'mada')
      await enableGateway(STORE_B, 'moyasar', 'card')
    })

    it('shows only the active store gateways, before and after a switch', async () => {
      const a = await service.resolveActiveStore(OWNER_ID, 'store-a')
      expect(
        (await offeringsFor(a.id)).map((o) => o.account.gateway).sort(),
      ).toEqual(['paymob', 'stripe'])

      const b = await service.resolveActiveStore(OWNER_ID, 'store-b')
      const afterSwitch = (await offeringsFor(b.id)).map((o) => o.account.gateway)

      expect(afterSwitch).toEqual(['moyasar'])
      expect(afterSwitch).not.toContain('stripe')
      expect(afterSwitch).not.toContain('paymob')
    })

    it('hides store A payment rows from store B tenant context entirely', async () => {
      // RLS, not a where clause: asking for store A's rows while the
      // active store is B returns nothing, so a forgotten filter cannot
      // become a cross-store read.
      const leaked = await tenant(STORE_B, 'live', async (tx) => ({
        accounts: await tx.paymentAccount.findMany({ where: { store_id: STORE_A } }),
        offerings: await tx.paymentMethodOffering.findMany({
          where: { store_id: STORE_A },
        }),
        unfiltered: await tx.paymentAccount.findMany({}),
      }))

      expect(leaked.accounts).toEqual([])
      expect(leaked.offerings).toEqual([])
      expect(leaked.unfiltered.map((a) => a.store_id)).toEqual([STORE_B])
    })

    it('refuses to write into store A while store B is active', async () => {
      await expect(
        tenant(STORE_B, 'live', async (tx) =>
          tx.paymentAccount.create({
            data: {
              store_id: STORE_A,
              mode: 'live',
              gateway: 'tap',
              display_name: 'smuggled',
              status: 'active',
            },
          }),
        ),
      ).rejects.toThrow()
    })
  })
})

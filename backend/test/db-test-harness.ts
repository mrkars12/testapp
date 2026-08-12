import { PrismaClient } from '@prisma/client'
import { TenantContextService } from '../src/common/tenant/tenant-context.service'
import { createTenantGuardExtension } from '../src/common/tenant/tenant-guard.extension'

/**
 * ══════════════════════════════════════════════════════════════════
 * بيئة اختبار بقاعدة بيانات حقيقية
 * ══════════════════════════════════════════════════════════════════
 *
 * ليه Postgres حقيقي مش mock:
 *
 * السلوكيات اللي المشروع قايم عليها مستحيل تتأكد من غير قاعدة بيانات
 * فعلية:
 *   • حصرية الحجز (lease) بين أكتر من instance
 *   • القيود الفريدة كضمانة للـ idempotency
 *   • رجوع الـ transaction وتأثيره على صندوق الصادر
 *   • ذرّية nextval تحت التوازي
 *   • القفل التفاؤلي على نية الدفع
 *
 * الـ mock بيأكد اللي الكود بيعمله، مش اللي المفروض يحصل.
 *
 * الحاوية بتقوم مرة واحدة للتشغيل كله في test/global-setup.ts، مش لكل
 * ملف اختبار. الملف ده بيتصل بيها بس.
 */

let client: PrismaClient | undefined

/**
 * Tables owned by the payment engine, in dependency order.
 *
 * Exported so a spec can reset exactly what it touched. `store` and
 * `users` are included because payment_accounts and checkouts hold
 * foreign keys to them, and a spec that seeds a store must be able to
 * clear it — otherwise the second test fails on a unique username.
 */
export const PAYMENT_TABLES: readonly string[] = [
  'ledger_postings',
  'journal_entries',
  'ledger_accounts',
  'capture_allocations',
  'captures',
  'payment_events',
  'payment_attempts',
  'payment_intents',
  'inventory_reservations',
  'quote_components',
  'checkout_line_items',
  'checkouts',
  'beneficiaries',
  'payment_method_offerings',
  'payment_accounts',
  'consumed_events',
  'outbox_messages',
  'payment_idempotency_records',
]

/** Domain tables a spec seeds. Truncating these cascades widely. */
export const FIXTURE_TABLES: readonly string[] = [
  '"OrderItem"',
  '"Order"',
  '"ProductVariant"',
  '"Product"',
  'store',
  'users',
]

/** Everything a payment spec should clear between tests. */
export const ALL_TEST_TABLES: readonly string[] = [
  ...PAYMENT_TABLES,
  ...FIXTURE_TABLES,
]

/**
 * Connects to the shared container started by global-setup.
 *
 * Does not start a container: doing that per suite multiplied startup
 * cost by the number of suites and left later suites holding clients
 * whose container had already been stopped.
 */
/**
 * Shared tenant context for the test client.
 *
 * Exposed so a spec can set an active store and assert what the guard
 * does about it, the same way ActiveStoreGuard would in a request.
 */
export const testTenantContext = new TenantContextService()

/**
 * Gives a raw PrismaClient the same surface PrismaService exposes.
 *
 * Specs construct services with `prisma as never`, which is a real
 * PrismaClient and has no guarded(). Once services began reading through
 * guarded(), every one of those calls threw.
 *
 * The fix attaches a genuinely extended client rather than an alias back
 * to the unguarded one. A stub returning `this` would have made the
 * tests pass while proving nothing: the guard would never run, and the
 * first query missing store_id would still reach production unnoticed.
 */
function withGuarded(raw: PrismaClient): PrismaClient {
  const extended = raw.$extends(
    createTenantGuardExtension({
      enabled: true,
      tenantContext: testTenantContext,
      // Left off deliberately, matching production. Turning it on is a
      // separate, explicit decision.
      throwOnViolation: false,
    }),
  )

  return Object.assign(raw, { guarded: () => extended }) as PrismaClient
}

export async function startTestDatabase(): Promise<PrismaClient> {
  if (client) return client

  const url = process.env.TEST_DATABASE_URL

  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration specs must run through ' +
        'test/jest-integration.json so global-setup starts the container.',
    )
  }

  client = withGuarded(new PrismaClient({ datasources: { db: { url } } }))
  await client.$connect()

  return client
}

export function getTestClient(): PrismaClient {
  if (!client) {
    throw new Error(
      'قاعدة بيانات الاختبار لسه ماقامتش — نادِ startTestDatabase() في beforeAll.',
    )
  }
  return client
}

export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL

  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set.')
  }

  return url
}

/**
 * Clears the payment engine's own tables.
 *
 * Kept narrow on purpose. A spec that seeds a store should call
 * truncateTables(ALL_TEST_TABLES) instead, so it also clears its
 * fixtures.
 */
export async function resetTestDatabase(): Promise<void> {
  await truncateTables(PAYMENT_TABLES)
}

/**
 * Truncates tables and reports the blocker if it cannot.
 *
 * TRUNCATE needs ACCESS EXCLUSIVE, so one session left open by an
 * earlier test blocks it. With lock_timeout set that surfaces in five
 * seconds instead of hanging, and the error names the sessions that were
 * in the way.
 *
 * Terminating other backends was tried and is wrong: the shared client's
 * own pooled connections get killed too, leaving every later suite with
 * a dead pool.
 */
export async function truncateTables(tables: readonly string[]): Promise<void> {
  const db = getTestClient()

  try {
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
    )
  } catch (error) {
    const blockers = await db
      .$queryRawUnsafe<{ pid: number; state: string; query: string }[]>(`
        SELECT pid, state, left(query, 200) AS query
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
      `)
      .catch(() => [])

    throw new Error(
      `TRUNCATE failed: ${(error as Error).message}\n` +
        `sessions on this database: ${JSON.stringify(blockers, null, 2)}`,
    )
  }
}

/**
 * Disconnects this suite's client.
 *
 * The container itself is stopped by global-teardown once every suite
 * has finished, not here.
 */
export async function stopTestDatabase(): Promise<void> {
  await client?.$disconnect()
  client = undefined
}

/**
 * A second Prisma client against the same database.
 *
 * Required for genuine concurrency tests: a second application instance
 * means a separate connection pool, which a mock cannot represent.
 *
 * ⚠️ Always disconnect it in a finally block. A client left connected
 * holds backends that block the next TRUNCATE.
 */
export function createAdditionalClient(): PrismaClient {
  return withGuarded(
    new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } }),
  )
}
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ReconciliationService } from './reconciliation.service';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
  withTestTenant,
} from '../../../../test/db-test-harness';

/**
 * ══════════════════════════════════════════════════════════════════
 * F-07 — reconciliation must not starve itself.
 * ══════════════════════════════════════════════════════════════════
 *
 * `ReconciliationService`'s own header states the contract it exists to
 * keep: "The system is designed to be correct with every webhook
 * dropped. That claim is only true because this exists."
 *
 * It was not true. The sweep took the 50 OLDEST non-terminal intents on
 * every run, and several ordinary kinds of intent sit non-terminal
 * indefinitely without ever being reconcilable — a manual-capture
 * `authorized` waiting weeks for the merchant, an attempt that never got
 * a gateway reference, an account whose provider has no status polling.
 * Each one stays in the result set forever AND stays the oldest. Fifty
 * of them occupy the whole batch permanently: the sweep re-reads the
 * same fifty every five minutes and never reaches a newer intent again.
 *
 * And it does that SILENTLY, because `run()` only logs when it actually
 * processed something.
 *
 * These tests need a real database: the fix turns on query ordering
 * (`NULLS FIRST` on a column PostgreSQL sorts last by default) and on a
 * durable marker surviving between passes. A fake client would prove
 * neither. There is no existing reconciliation integration suite to
 * extend.
 */
describe('ReconciliationService starvation (integration)', () => {
  let prisma: PrismaClient;
  let storeId: bigint;
  let accountId: bigint;

  /** Every intent the sweep asked the provider about, in order. */
  let visited: bigint[] = [];

  /**
   * A registry whose provider always polls and always returns nothing.
   *
   * "Returns nothing" is the honest shape for this suite: it means the
   * sweep VISITED the intent and learned nothing new, which is exactly
   * the state a stuck-but-recoverable intent is in. What is under test
   * is which intents get looked at at all.
   */
  const registry = {
    has: () => true,
    get: () => ({
      capabilities: { statusPolling: true },
      fetchStatus: () => Promise.resolve([]),
    }),
  } as never;

  const accounts = {
    revealCredentialsForGateway: () => Promise.resolve({}),
  } as never;

  const service = (): ReconciliationService =>
    new ReconciliationService(prisma as never, registry, accounts, {
      applyMany: () => Promise.resolve([]),
    } as never);

  const inTenant = <T,>(cb: (tx: Prisma.TransactionClient) => Promise<T>) =>
    withTestTenant(storeId, cb);

  /**
   * An intent old enough to be swept, with an attempt carrying a gateway
   * reference so `reconcileIntent` reaches the provider.
   */
  async function makeIntent(input: {
    createdMinutesAgo: number;
    lastReconciledMinutesAgo?: number | null;
    status?: 'processing' | 'authorized';
    withReference?: boolean;
  }): Promise<bigint> {
    const createdAt = new Date(
      Date.now() - input.createdMinutesAgo * 60_000,
    );

    const intent = await inTenant((tx) =>
      tx.paymentIntent.create({
        data: {
          store_id: storeId,
          mode: 'live',
          context_kind: 'checkout',
          context_id: '0',
          amount_minor: 1000n,
          currency: 'USD',
          capture_method: 'automatic',
          usage: 'one_time',
          status: input.status ?? 'processing',
          payment_mode: 'MERCHANT_GATEWAY',
          account_id: accountId,
          created_at: createdAt,
          last_reconciled_at:
            input.lastReconciledMinutesAgo === null ||
            input.lastReconciledMinutesAgo === undefined
              ? null
              : new Date(Date.now() - input.lastReconciledMinutesAgo * 60_000),
        },
        select: { id: true },
      }),
    );

    await inTenant((tx) =>
      tx.paymentAttempt.create({
        data: {
          intent_id: intent.id,
          store_id: storeId,
          mode: 'live',
          sequence: 1,
          account_id: accountId,
          status: 'processing',
          gateway_reference:
            input.withReference === false ? null : `ref_${intent.id}`,
          next_action_kind: 'none',
          psp_idempotency_key: `k_${intent.id}`,
        },
      }),
    );

    return intent.id;
  }

  beforeAll(async () => {
    prisma = await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    visited = [];

    const user = await prisma.users.create({
      data: {
        username: `recon_${Date.now()}`,
        email: `recon_${Date.now()}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });

    const store = await prisma.store.create({
      data: {
        name: 'Reconciliation Spec Store',
        slug: `recon-spec-${Date.now()}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    storeId = store.id;

    const account = await inTenant((tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: storeId,
          mode: 'live',
          gateway: 'stripe',
          display_name: 'Default',
          status: 'active',
          settlement_currency: 'USD',
        },
        select: { id: true },
      }),
    );
    accountId = account.id;
  });

  /** Which intents currently carry a visit stamp. */
  const stamped = async (): Promise<bigint[]> => {
    const rows = await inTenant((tx) =>
      tx.paymentIntent.findMany({
        where: { store_id: storeId, last_reconciled_at: { not: null } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
    return rows.map((r) => r.id);
  };

  it('stamps every intent it visits, not only the ones it could process', async () => {
    // Nothing here can produce a fact — the provider returns no facts —
    // yet all of them must be marked as looked at, or they stay at the
    // front of the queue forever. This is the whole mechanism.
    const a = await makeIntent({ createdMinutesAgo: 60 });
    const b = await makeIntent({ createdMinutesAgo: 50, withReference: false });

    await service().sweep();

    expect(await stamped()).toEqual([a, b]);
  });

  it('does not let permanently unprocessable OLD intents starve a newer recoverable one', async () => {
    /*
     * THE REGRESSION, at the shape that actually happened.
     *
     * `BATCH_SIZE` is 50, so 50 intents that can never reconcile — here,
     * manual-capture authorisations with no gateway reference — used to
     * fill every batch, forever, and the newer intent behind them was
     * never looked at.
     */
    const stuck: bigint[] = [];
    for (let i = 0; i < 50; i += 1) {
      stuck.push(
        await makeIntent({
          createdMinutesAgo: 600 - i,
          status: 'authorized',
          withReference: false,
        }),
      );
    }

    const newer = await makeIntent({ createdMinutesAgo: 10 });

    // Pass one fills its batch with the fifty oldest, exactly as before.
    await service().sweep();
    expect(await stamped()).toEqual(stuck.sort((x, y) => (x < y ? -1 : 1)));

    // Pass two is the one that used to be identical to pass one. The
    // fifty are now stamped and no longer eligible, so the newer intent
    // is finally reached.
    await service().sweep();
    expect(await stamped()).toContain(newer);
  });

  it('does not resolve a long-lived manual-capture authorization to a wrong state', async () => {
    // Getting an intent out of the queue must never mean declaring it
    // failed. A merchant is still entitled to capture this.
    const authorized = await makeIntent({
      createdMinutesAgo: 60,
      status: 'authorized',
    });

    await service().sweep();

    const row = await inTenant((tx) =>
      tx.paymentIntent.findFirst({
        where: { id: authorized, store_id: storeId },
        select: { status: true, last_reconciled_at: true },
      }),
    );

    expect(row?.status).toBe('authorized');
    // Visited and shuffled to the back — not terminated.
    expect(row?.last_reconciled_at).not.toBeNull();
  });

  it('makes a visited intent eligible again once the recheck interval passes', async () => {
    // Retryability. A stamp must be a "later", never a "never": the
    // provider may be reachable next time, or the payment may have
    // resolved.
    const recent = await makeIntent({
      createdMinutesAgo: 60,
      lastReconciledMinutesAgo: 1,
    });
    const old = await makeIntent({
      createdMinutesAgo: 60,
      lastReconciledMinutesAgo: 30,
    });

    const before = await inTenant((tx) =>
      tx.paymentIntent.findFirst({
        where: { id: recent, store_id: storeId },
        select: { last_reconciled_at: true },
      }),
    );

    await service().sweep();

    const after = await inTenant((tx) =>
      tx.paymentIntent.findMany({
        where: { store_id: storeId },
        select: { id: true, last_reconciled_at: true },
      }),
    );

    const recentAfter = after.find((r) => r.id === recent);
    const oldAfter = after.find((r) => r.id === old);

    // The one visited a minute ago was skipped; the one visited half an
    // hour ago was picked up again.
    expect(recentAfter?.last_reconciled_at?.getTime()).toBe(
      before?.last_reconciled_at?.getTime(),
    );
    expect(oldAfter?.last_reconciled_at?.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it('reports a lag that grows while a backlog is not draining, and 0 when idle', async () => {
    // The observable that makes starvation visible at all. Nothing
    // eligible is the ordinary quiet state and must not read as a
    // problem.
    expect(await service().oldestEligibleAgeSeconds()).toBe(0);

    await makeIntent({ createdMinutesAgo: 120 });

    const lag = await service().oldestEligibleAgeSeconds();
    // Never visited, so the age is measured from creation.
    expect(lag).toBeGreaterThanOrEqual(110 * 60);
  });

  it('prefers a never-visited intent over one already looked at', async () => {
    /*
     * `NULLS FIRST` is load-bearing and easy to get wrong: PostgreSQL
     * sorts NULLs LAST in ASC by default, which would have put every
     * brand-new intent behind every row the sweep had already given up
     * on — reintroducing the starvation through the back door.
     */
    const visitedLongAgo = await makeIntent({
      createdMinutesAgo: 600,
      lastReconciledMinutesAgo: 20,
    });
    const neverVisited = await makeIntent({ createdMinutesAgo: 10 });

    const oldest = await service().oldestEligibleAgeSeconds();

    // The never-visited one is the most urgent, so the reported lag is
    // its age (~10 minutes), not the other's 20-minute-old stamp.
    expect(oldest).toBeGreaterThanOrEqual(9 * 60);
    expect(oldest).toBeLessThan(20 * 60);
    expect(neverVisited).toBeDefined();
    expect(visitedLongAgo).toBeDefined();
  });
});

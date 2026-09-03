import { PrismaClient, Prisma } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { LedgerError } from './ledger.types';
import {
  captureSucceeded,
  offlineCollected,
  offlineCommitment,
  platformFee,
  pspFeeEstimated,
} from './posting-rules';
import {
  resetTestDatabase,
  truncateTables,
  startTestDatabase,
  stopTestDatabase,
} from '../../test/db-test-harness';

const STORE = 1n;
const MODE = 'live' as const;
const CUR = 'USD';

describe('LedgerService (integration)', () => {
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let storeBeneficiary: bigint;
  let platformBeneficiary: bigint;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    ledger = new LedgerService(prisma as never);
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables([
      'ledger_postings',
      'journal_entries',
      'ledger_accounts',
      'beneficiaries',
    ]);
    await resetTestDatabase();

    const store = await withTenant((tx) =>
      tx.beneficiary.create({
        data: {
          store_id: STORE,
          mode: MODE,
          kind: 'store',
          default_currency: CUR,
        },
        select: { id: true },
      }),
    );
    const platform = await withTenant((tx) =>
      tx.beneficiary.create({
        data: {
          store_id: STORE,
          mode: MODE,
          kind: 'platform',
          default_currency: CUR,
        },
        select: { id: true },
      }),
    );
    storeBeneficiary = store.id;
    platformBeneficiary = platform.id;
  });

  /**
   * `beneficiaries`, `ledger_accounts` and `journal_entries` are all
   * RLS-enabled (test/global-setup.ts); `ledger_postings` is not (it
   * carries no store_id of its own — see LedgerService.findUnbalancedEntries's
   * own doc comment). The raw `rls_test` client this spec holds can only
   * read or write the three RLS-enabled tables once `app.store_id`/
   * `app.mode` are installed on the same transaction. `LedgerService.post`/
   * `.reverse` are deliberately designed to take a caller-supplied
   * transaction and never install that context themselves (the same
   * safe-by-design pattern `OutboxService.emit` uses) — installing it is
   * the caller's job, exactly as it already is for every other consumer
   * of `withTenantTransaction` in production. This helper is that job,
   * for this spec, matching the pattern already used in
   * order.service.integration.spec.ts, payment-collection.service.integration.spec.ts,
   * refunds.integration.spec.ts, outbox-dispatcher.integration.spec.ts,
   * and payment-notification.integration.spec.ts.
   *
   * `mode` defaults to the suite's usual 'live', but the RLS policies on
   * `ledger_accounts`/`journal_entries` check mode as well as store_id
   * (ledger_account_store_isolation: "mode::text = current_setting('app.mode', ...)"),
   * so the one test that deliberately posts a 'test'-mode entry passes
   * 'test' explicitly.
   */
  async function withTenant<T>(
    cb: (tx: Prisma.TransactionClient) => Promise<T>,
    mode: string = MODE,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT
          set_config('app.store_id', ${STORE.toString()}, true),
          set_config('app.mode', ${mode}, true)
      `;
      return cb(tx as Prisma.TransactionClient);
    });
  }

  const entry = (
    postings: ReturnType<typeof captureSucceeded>,
    dedupeKey: string,
  ) => ({
    storeId: STORE,
    mode: MODE,
    currency: CUR,
    entryType: 'spec.entry',
    sourceKind: 'spec',
    sourceId: '1',
    dedupeKey,
    occurredAt: new Date(),
    postings,
  });

  describe('posting', () => {
    it('posts a balanced capture', async () => {
      const result = await withTenant((tx) =>
        ledger.post(
          tx,
          entry(
            captureSucceeded({
              totalMinor: 1000n,
              paymentAccountId: 7n,
              allocations: [
                { beneficiaryId: storeBeneficiary, amountMinor: 1000n },
              ],
            }),
            'capture:1',
          ),
        ),
      );

      expect(result.duplicate).toBe(false);
      expect(
        await prisma.ledgerPosting.count({
          where: { entry_id: result.entryId },
        }),
      ).toBe(2);
    });

    it('is idempotent on the dedupe key', async () => {
      const post = () =>
        withTenant((tx) =>
          ledger.post(
            tx,
            entry(
              offlineCommitment({
                totalMinor: 500n,
                allocations: [
                  { beneficiaryId: storeBeneficiary, amountMinor: 500n },
                ],
              }),
              'same-key',
            ),
          ),
        );

      const first = await post();
      const second = await post();

      expect(first.duplicate).toBe(false);
      expect(second).toEqual({ entryId: first.entryId, duplicate: true });
      expect(await withTenant((tx) => tx.journalEntry.count())).toBe(1);
    });

    it('rolls back with the caller transaction', async () => {
      await expect(
        withTenant(async (tx) => {
          await ledger.post(
            tx,
            entry(offlineCollected({ totalMinor: 100n }), 'rb'),
          );
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(await withTenant((tx) => tx.journalEntry.count())).toBe(0);
      expect(await prisma.ledgerPosting.count()).toBe(0);
    });

    it('reuses ledger accounts across entries', async () => {
      for (const key of ['a', 'b', 'c']) {
        await withTenant((tx) =>
          ledger.post(tx, entry(offlineCollected({ totalMinor: 10n }), key)),
        );
      }

      expect(await withTenant((tx) => tx.ledgerAccount.count())).toBe(2);
    });

    it('separates accounts by currency', async () => {
      await withTenant((tx) =>
        ledger.post(tx, {
          ...entry(offlineCollected({ totalMinor: 10n }), 'usd'),
          currency: 'USD',
        }),
      );
      await withTenant((tx) =>
        ledger.post(tx, {
          ...entry(offlineCollected({ totalMinor: 10n }), 'kwd'),
          currency: 'KWD',
        }),
      );

      expect(await withTenant((tx) => tx.ledgerAccount.count())).toBe(4);
    });

    it('separates accounts by mode', async () => {
      await withTenant((tx) =>
        ledger.post(tx, entry(offlineCollected({ totalMinor: 10n }), 'live')),
      );
      await withTenant(
        (tx) =>
          ledger.post(tx, {
            ...entry(offlineCollected({ totalMinor: 10n }), 'test'),
            mode: 'test',
          }),
        'test',
      );

      // The mode isolation under test means one RLS context can only ever
      // see one mode's rows, so this counts each mode separately and sums.
      const liveCount = await withTenant((tx) => tx.ledgerAccount.count());
      const testCount = await withTenant(
        (tx) => tx.ledgerAccount.count(),
        'test',
      );
      expect(liveCount + testCount).toBe(4);
    });
  });

  describe('validation', () => {
    it('rejects an unbalanced entry', async () => {
      await expect(
        withTenant((tx) =>
          ledger.post(tx, {
            ...entry([], 'bad'),
            postings: [
              {
                accountType: 'cash_collected',
                direction: 'debit',
                amountMinor: 100n,
              },
              {
                accountType: 'offline_receivable',
                direction: 'credit',
                amountMinor: 90n,
              },
            ],
          }),
        ),
      ).rejects.toThrow(LedgerError);

      expect(await withTenant((tx) => tx.journalEntry.count())).toBe(0);
    });

    it('rejects a non-positive posting amount', async () => {
      await expect(
        withTenant((tx) =>
          ledger.post(tx, {
            ...entry([], 'neg'),
            postings: [
              {
                accountType: 'cash_collected',
                direction: 'debit',
                amountMinor: -100n,
              },
              {
                accountType: 'offline_receivable',
                direction: 'credit',
                amountMinor: -100n,
              },
            ],
          }),
        ),
      ).rejects.toThrow(LedgerError);
    });

    it('rejects a single-sided entry', async () => {
      await expect(
        withTenant((tx) =>
          ledger.post(tx, {
            ...entry([], 'one'),
            postings: [
              {
                accountType: 'cash_collected',
                direction: 'debit',
                amountMinor: 100n,
              },
            ],
          }),
        ),
      ).rejects.toThrow(LedgerError);
    });

    it('rejects an invalid currency code', async () => {
      await expect(
        withTenant((tx) =>
          ledger.post(tx, {
            ...entry(offlineCollected({ totalMinor: 10n }), 'cur'),
            currency: 'usd',
          }),
        ),
      ).rejects.toThrow(LedgerError);
    });
  });

  describe('posting rules', () => {
    it('rejects allocations that do not sum to the total', () => {
      expect(() =>
        captureSucceeded({
          totalMinor: 1000n,
          paymentAccountId: 1n,
          allocations: [{ beneficiaryId: 1n, amountMinor: 900n }],
        }),
      ).toThrow(LedgerError);
    });

    it('rejects a zero amount', () => {
      expect(() => offlineCollected({ totalMinor: 0n })).toThrow(LedgerError);
    });

    it('splits revenue across beneficiaries', async () => {
      const result = await withTenant((tx) =>
        ledger.post(
          tx,
          entry(
            captureSucceeded({
              totalMinor: 1000n,
              paymentAccountId: 7n,
              allocations: [
                { beneficiaryId: storeBeneficiary, amountMinor: 900n },
                { beneficiaryId: platformBeneficiary, amountMinor: 100n },
              ],
            }),
            'split',
          ),
        ),
      );

      expect(
        await prisma.ledgerPosting.count({
          where: { entry_id: result.entryId },
        }),
      ).toBe(3);
    });
  });

  describe('balances', () => {
    it('derives a balance from postings', async () => {
      await withTenant((tx) =>
        ledger.post(
          tx,
          entry(
            offlineCommitment({
              totalMinor: 1000n,
              allocations: [
                { beneficiaryId: storeBeneficiary, amountMinor: 1000n },
              ],
            }),
            'commit',
          ),
        ),
      );

      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'offline_receivable',
        }),
      ).toBe(1000n);

      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'sales_revenue',
          beneficiaryId: storeBeneficiary,
        }),
      ).toBe(-1000n);
    });

    it('nets a receivable to zero once collected', async () => {
      await withTenant((tx) =>
        ledger.post(
          tx,
          entry(
            offlineCommitment({
              totalMinor: 1000n,
              allocations: [
                { beneficiaryId: storeBeneficiary, amountMinor: 1000n },
              ],
            }),
            'c1',
          ),
        ),
      );
      await withTenant((tx) =>
        ledger.post(tx, entry(offlineCollected({ totalMinor: 1000n }), 'c2')),
      );

      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'offline_receivable',
        }),
      ).toBe(0n);

      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'cash_collected',
        }),
      ).toBe(1000n);
    });

    it('returns zero for an account that was never used', async () => {
      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'disputes_held',
        }),
      ).toBe(0n);
    });

    it('records a platform fee as payable, not custody', async () => {
      await withTenant((tx) =>
        ledger.post(
          tx,
          entry(
            platformFee({
              amountMinor: 50n,
              platformBeneficiaryId: platformBeneficiary,
            }),
            'fee',
          ),
        ),
      );

      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'platform_fee_payable',
          beneficiaryId: platformBeneficiary,
        }),
      ).toBe(-50n);
    });
  });

  describe('reversal', () => {
    it('reverses an entry without mutating the original', async () => {
      const original = await withTenant((tx) =>
        ledger.post(
          tx,
          entry(
            pspFeeEstimated({ amountMinor: 30n, paymentAccountId: 7n }),
            'fee-est',
          ),
        ),
      );

      const reversal = await withTenant((tx) =>
        ledger.reverse(tx, original.entryId, 'fee-est.reversed'),
      );

      expect(reversal.duplicate).toBe(false);

      expect(
        await ledger.balance({
          storeId: STORE,
          mode: MODE,
          currency: CUR,
          accountType: 'psp_fee_expense',
        }),
      ).toBe(0n);

      const originalRow = await withTenant((tx) =>
        tx.journalEntry.findFirstOrThrow({
          where: { id: original.entryId },
        }),
      );
      expect(originalRow.reverses_entry_id).toBeNull();
    });

    it('is idempotent on the reversal dedupe key', async () => {
      const original = await withTenant((tx) =>
        ledger.post(tx, entry(offlineCollected({ totalMinor: 10n }), 'orig')),
      );

      const first = await withTenant((tx) =>
        ledger.reverse(tx, original.entryId, 'rev'),
      );
      const second = await withTenant((tx) =>
        ledger.reverse(tx, original.entryId, 'rev'),
      );

      expect(second).toEqual({ entryId: first.entryId, duplicate: true });
    });
  });

  describe('invariant checker', () => {
    it('reports no unbalanced entries after normal posting', async () => {
      await withTenant((tx) =>
        ledger.post(tx, entry(offlineCollected({ totalMinor: 10n }), 'ok')),
      );

      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });
  });
});

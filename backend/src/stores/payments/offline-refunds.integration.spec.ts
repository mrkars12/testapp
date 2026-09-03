import { appConfigStub } from '../../../test/config.stub';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RefundService } from './refund.service';
import { PaymentCollectionService } from './payment-collection.service';
import { PaymentFactApplier } from './facts/payment-fact.applier';
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from './facts/checkout-succession-funds.service';
import { CheckoutService } from '../checkout/checkout.service';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import { CodAdapter } from './gateways/adapters/cod.adapter';
import { BankTransferAdapter } from './gateways/adapters/bank-transfer.adapter';
import * as postingRules from '../../ledger/posting-rules';
import type { InitializeResult } from './gateways/provider.types';
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  createTestIdempotencyService,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness';

/**
 * Integration coverage for refunding money collected outside a gateway.
 *
 * COD and bank transfer take the money in cash, so there is no provider
 * to ask for a refund and no gateway reference to quote. The invariant
 * under test is that such a refund still produces exactly one Refund row,
 * one balanced ledger reversal through refundIssuedOffline, and the same
 * response shape as a gateway refund — and that an order whose cash was
 * never collected cannot be refunded at all.
 */

const SLUG = 'spec-store';

interface Fixture {
  storeId: bigint;
  variantId: bigint;
  codOfferingId: bigint;
  bankOfferingId: bigint;
  codAccountId: bigint;
  bankAccountId: bigint;
}

/**
 * The real COD and bank-transfer adapters.
 *
 * Using the genuine articles rather than stubs is the point: whether a
 * payment counts as offline is read from the adapter's own
 * `offlineCommitmentKind`, so a stub declaring it by hand would prove
 * nothing about the two adapters that actually ship.
 */
function realRegistry() {
  const cod = new CodAdapter();
  const bank = new BankTransferAdapter();

  const byGateway: Record<string, unknown> = {
    cod,
    bank_transfer: bank,
  };

  return {
    has: (gateway: string) => gateway in byGateway,
    get: (gateway: string) => byGateway[gateway],
    assertCanHandle: (input: { gateway: string }) => byGateway[input.gateway],
  } as never;
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({
    bank_name: 'Test Bank',
    account_holder: 'Store Owner',
  }),
} as never;

async function withTenant<T>(
  prisma: PrismaClient,
  storeId: bigint,
  mode: string,
  cb: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${storeId.toString()}, true),
        set_config('app.mode', ${mode}, true)
    `;
    return cb(tx as Prisma.TransactionClient);
  });
}

describe('Offline refunds — COD and bank transfer (integration)', () => {
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let applier: PaymentFactApplier;
  let refunds: RefundService;
  let collection: PaymentCollectionService;
  let checkout: CheckoutService;
  let fx: Fixture;

  let intentCounter = 90_000n;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    ledger = new LedgerService(prisma as never);
    applier = new PaymentFactApplier(
      prisma as never,
      ledger,
      new OutboxService(),
      new CheckoutFinalizerService(prisma as never, new OutboxService()),
      new CheckoutSuccessionFundsService(),
    );

    const idempotency = createTestIdempotencyService(prisma);

    refunds = new RefundService(
      prisma as never,
      realRegistry(),
      fakeAccounts,
      applier,
      idempotency,
    );
    collection = new PaymentCollectionService(
      prisma as never,
      ledger,
      new OutboxService(),
      idempotency,
    );
    checkout = new CheckoutService(
      prisma as never,
      ledger,
      new OutboxService(),
      fakeAccounts,
      {
        defaultTtlSeconds: 3600,
        defaultLeaseSeconds: 60,
        claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
        complete: async () => undefined,
        fail: async () => undefined,
      } as never,
      realRegistry(),
      { reserve: async () => ++intentCounter } as never,
      applier,
      new TenantContextService(),
      appConfigStub(),
      new CheckoutSuccessionFundsService(),
    );
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    jest.restoreAllMocks();
    fx = await seed(prisma);
  });

  /** Places an offline order (2 x 25.00 = 50.00) and returns its id. */
  async function placeOfflineOrder(offeringId: bigint): Promise<string> {
    const result = await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: offeringId.toString(),
    });

    return result.order!.id;
  }

  async function placeAndCollect(offeringId: bigint): Promise<string> {
    const orderId = await placeOfflineOrder(offeringId);
    await collection.recordCollection(fx.storeId, orderId);
    return orderId;
  }

  function readOrder(orderId: string) {
    return withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.order.findFirstOrThrow({ where: { id: BigInt(orderId) } }),
    );
  }

  function readIntent() {
    return withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.paymentIntent.findFirstOrThrow({}),
    );
  }

  function balance(accountType: string, beneficiaryId?: bigint) {
    return ledger.balance({
      storeId: fx.storeId,
      mode: 'live',
      currency: 'USD',
      accountType: accountType as never,
      ...(beneficiaryId === undefined ? {} : { beneficiaryId }),
    });
  }

  async function storeBeneficiaryId(): Promise<bigint> {
    const beneficiary = await withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.beneficiary.findFirstOrThrow({
        where: { store_id: fx.storeId, mode: 'live', kind: 'store' },
      }),
    );
    return beneficiary.id;
  }

  /* ================================================================ */

  describe('COD', () => {
    it('refunds a collected COD order', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      const result = await refunds.refundOrder(fx.storeId, orderId);

      expect(result.applied).toBe(true);
      expect(result.refunded_amount_minor).toBe('5000');
      expect(result.refunded_total_minor).toBe('5000');
      expect(result.payment_status).toBe('refunded');
    });

    it('marks the order refunded', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);
      await refunds.refundOrder(fx.storeId, orderId);

      expect((await readOrder(orderId)).payment_status).toBe('REFUNDED');
      expect((await readIntent()).status).toBe('refunded');
    });

    it('records one Refund row with a proportional allocation', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);
      await refunds.refundOrder(fx.storeId, orderId);

      const refund = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.refund.findFirstOrThrow({}),
      );
      expect(refund.amount_minor).toBe(5000n);
      expect(refund.status).toBe('succeeded');
      expect(refund.initiated_by).toBe('merchant');

      const allocations = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.refundAllocation.findMany({}),
      );
      expect(allocations).toHaveLength(1);
      expect(allocations[0].amount_minor).toBe(5000n);
    });

    it('refuses to refund a COD order whose cash was never collected', async () => {
      const orderId = await placeOfflineOrder(fx.codOfferingId);

      await expect(
        refunds.refundOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.refund.count()),
      ).toBe(0);
    });

    it('supports a partial COD refund', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      const result = await refunds.refundOrder(fx.storeId, orderId, {
        amountMinor: 2000n,
      });

      expect(result.payment_status).toBe('partially_refunded');
      expect(result.refunded_total_minor).toBe('2000');
      expect((await readOrder(orderId)).payment_status).toBe(
        'PARTIALLY_REFUNDED',
      );
    });
  });

  describe('bank transfer', () => {
    it('refunds a collected bank-transfer order', async () => {
      const orderId = await placeAndCollect(fx.bankOfferingId);

      const result = await refunds.refundOrder(fx.storeId, orderId);

      expect(result.applied).toBe(true);
      expect(result.refunded_total_minor).toBe('5000');
      expect(result.payment_status).toBe('refunded');
      expect((await readOrder(orderId)).payment_status).toBe('REFUNDED');
    });

    it('refuses to refund a bank-transfer order still awaiting settlement', async () => {
      const orderId = await placeOfflineOrder(fx.bankOfferingId);

      await expect(
        refunds.refundOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ledger', () => {
    it('invokes refundIssuedOffline, not the gateway rule', async () => {
      const offlineRule = jest.spyOn(postingRules, 'refundIssuedOffline');
      const gatewayRule = jest.spyOn(postingRules, 'refundIssued');

      const orderId = await placeAndCollect(fx.codOfferingId);
      await refunds.refundOrder(fx.storeId, orderId);

      expect(offlineRule).toHaveBeenCalledTimes(1);
      expect(offlineRule).toHaveBeenCalledWith(
        expect.objectContaining({ totalMinor: 5000n, collected: true }),
      );
      expect(gatewayRule).not.toHaveBeenCalled();
    });

    it('reverses the collected cash and leaves the books balanced', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      // Collected but not yet refunded: the cash is in hand.
      expect(await balance('cash_collected')).toBe(5000n);

      await refunds.refundOrder(fx.storeId, orderId);

      // The cash has gone back out.
      expect(await balance('cash_collected')).toBe(0n);
      // The receivable was already cleared at collection and stays clear.
      expect(await balance('offline_receivable')).toBe(0n);
      // The sale stays on the books; the refund sits beside it rather
      // than netting it away. balance() is signed debit-minus-credit, so
      // a credit-balance account like revenue reads negative.
      expect(await balance('refunds_contra', await storeBeneficiaryId())).toBe(
        5000n,
      );
      expect(await balance('sales_revenue', await storeBeneficiaryId())).toBe(
        -5000n,
      );

      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('writes the reversal as a new entry rather than mutating the collection', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);
      await refunds.refundOrder(fx.storeId, orderId);

      const entries = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.journalEntry.findMany({ orderBy: { id: 'asc' } }),
      );

      const types = entries.map((entry) => entry.entry_type);
      expect(types).toContain('payment.collected.offline');
      expect(types).toContain('payment.refunded.offline');

      // The original collection entry is untouched.
      const collected = entries.find(
        (entry) => entry.entry_type === 'payment.collected.offline',
      );
      expect(collected).toBeDefined();
    });
  });

  describe('idempotency', () => {
    it('replays rather than refunding twice', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      const first = await refunds.refundOrder(fx.storeId, orderId, {
        idempotencyKey: 'offline-refund-1',
      });
      const second = await refunds.refundOrder(fx.storeId, orderId, {
        idempotencyKey: 'offline-refund-1',
      });

      expect(second).toEqual(first);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.refund.count()),
      ).toBe(1);
      expect(await balance('cash_collected')).toBe(0n);
    });

    it('rejects the same key carrying a different request', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      await refunds.refundOrder(fx.storeId, orderId, {
        amountMinor: 2000n,
        idempotencyKey: 'offline-refund-2',
      });

      await expect(
        refunds.refundOrder(fx.storeId, orderId, {
          amountMinor: 3000n,
          idempotencyKey: 'offline-refund-2',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refunds once under a concurrent duplicate submission', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      const second = createAdditionalClient();

      try {
        const otherRefunds = new RefundService(
          second as never,
          realRegistry(),
          fakeAccounts,
          new PaymentFactApplier(
            second as never,
            new LedgerService(second as never),
            new OutboxService(),
            new CheckoutFinalizerService(second as never, new OutboxService()),
            new CheckoutSuccessionFundsService(),
          ),
          createTestIdempotencyService(second),
        );

        const results = await Promise.allSettled([
          refunds.refundOrder(fx.storeId, orderId, {
            idempotencyKey: 'offline-concurrent',
          }),
          otherRefunds.refundOrder(fx.storeId, orderId, {
            idempotencyKey: 'offline-concurrent',
          }),
        ]);

        /*
         * ══════════════════════════════════════════════════════════
         * THE INVARIANT IS "ONE REFUND", NOT "ONE FULFILLED PROMISE".
         * ══════════════════════════════════════════════════════════
         *
         * This used to assert `fulfilled.length === 1`, and that made
         * the test fail roughly one run in seven — reproduced 3 times
         * in 20 here, and 5 times in 25 under instrumentation. It was
         * never a duplicate refund: every single one of those runs had
         * exactly ONE refund row and a balanced ledger. What varied was
         * only WHICH of two equally-correct idempotency outcomes the
         * loser got, and that is decided purely by timing:
         *
         *   loser's INSERT lands while the winner still holds the lease
         *     → `in_flight`  → ConflictException → REJECTED
         *   loser's INSERT lands after the winner has completed
         *     → `replay`     → the winner's stored body → FULFILLED
         *
         * `Promise.allSettled` over two independent connection pools
         * guarantees no overlap whatsoever, so on a loaded machine the
         * winner routinely finishes before the loser has issued its
         * INSERT at all. Asserting the first shape is asserting a race
         * that nothing schedules.
         *
         * And replay is not a weaker answer — it is the entire point of
         * an idempotency key. Refusing a completed key with a 409 would
         * be less correct, not more.
         *
         * So the assertions below drop the timing claim and pin what
         * actually protects the money. They are STRICTLY STRONGER than
         * the single line they replace: that line said nothing about
         * what the second caller received, and would have passed a
         * response that reported a different, larger, or second refund
         * as long as exactly one promise had fulfilled.
         */

        // The refund really happened — this is not vacuously satisfied
        // by both callers failing.
        const fulfilled = results.filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<RefundService['refundOrder']>>> =>
            r.status === 'fulfilled',
        );
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);

        // THE MONEY INVARIANT. One submission, one refund row, whatever
        // the interleaving.
        expect(
          await withTenant(prisma, fx.storeId, 'live', (tx) =>
            tx.refund.count(),
          ),
        ).toBe(1);

        // Every fulfilled result must describe THE SAME single refund.
        // A second refund — or a doubled total replayed back — fails
        // here even though the row count above could not see it.
        for (const result of fulfilled) {
          expect(result.value.refunded_total_minor).toBe('5000');
          expect(result.value.refunded_amount_minor).toBe('5000');
          expect(result.value.payment_status).toBe('refunded');
          expect(result.value.order_id).toBe(fulfilled[0].value.order_id);
        }

        // A rejection is only ever allowed to be the idempotency
        // refusal. Anything else — a crash, a constraint violation
        // surfacing raw, a provider error — is a real failure hiding
        // behind `allSettled`, and the old assertion would have counted
        // it as success.
        for (const result of results) {
          if (result.status === 'rejected') {
            expect(result.reason).toBeInstanceOf(ConflictException);
          }
        }

        // Exactly one key, and it completed. Two records would mean the
        // unique constraint that IS the guarantee had not held.
        const records = await withTenant(prisma, fx.storeId, 'live', (tx) =>
          tx.paymentIdempotencyRecord.findMany({
            where: { scope: 'payments.refund' },
            select: { idempotency_key: true, status: true },
          }),
        );
        expect(records).toEqual([
          { idempotency_key: 'offline-concurrent', status: 'completed' },
        ]);

        // And the order itself was refunded once, not twice — the
        // aggregate the customer and the merchant actually see.
        expect((await readOrder(orderId)).payment_status).toBe('REFUNDED');

        expect(await ledger.findUnbalancedEntries()).toEqual([]);
      } finally {
        await second.$disconnect();
      }
    });
  });

  describe('invalid states', () => {
    it('refuses a second refund once fully refunded', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);
      await refunds.refundOrder(fx.storeId, orderId);

      await expect(
        refunds.refundOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to refund more than was collected', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      await expect(
        refunds.refundOrder(fx.storeId, orderId, { amountMinor: 9000n }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a zero refund', async () => {
      const orderId = await placeAndCollect(fx.codOfferingId);

      await expect(
        refunds.refundOrder(fx.storeId, orderId, { amountMinor: 0n }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_offline_refund',
      email: 'spec_offline_refund@example.test',
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  });

  const store = await prisma.store.create({
    data: {
      name: 'Spec',
      slug: SLUG,
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
      payment_mode: 'MERCHANT_GATEWAY',
    },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      store_id: store.id,
      title: 'Spec Product',
      handle: 'spec-offline-refund',
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  const variant = await prisma.productVariant.create({
    data: {
      product_id: product.id,
      title: 'Default Title',
      price: '25.00',
      inventory_qty: 10,
      track_inventory: true,
      continue_selling: false,
    },
    select: { id: true },
  });

  const makeAccount = (gateway: string) =>
    withTenant(prisma, store.id, 'live', (tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: store.id,
          mode: 'live',
          gateway: gateway as PaymentProviderKey,
          display_name: 'Default',
          status: 'active',
          settlement_currency: 'USD',
        },
        select: { id: true },
      }),
    );

  const codAccount = await makeAccount('cod');
  const bankAccount = await makeAccount('bank_transfer');

  const makeOffering = (
    accountId: bigint,
    method: string,
    commitment: CommitmentKind,
    position: number,
  ) =>
    withTenant(prisma, store.id, 'live', (tx) =>
      tx.paymentMethodOffering.create({
        data: {
          account_id: accountId,
          store_id: store.id,
          mode: 'live',
          method: method as PaymentMethodKey,
          enabled: true,
          position,
          commitment_kind: commitment,
          capture_mode: 'automatic',
        },
        select: { id: true },
      }),
    );

  const codOffering = await makeOffering(
    codAccount.id,
    'cod',
    'promise_accepted' as CommitmentKind,
    0,
  );

  const bankOffering = await makeOffering(
    bankAccount.id,
    'bank_transfer',
    'awaiting_offline_settlement' as CommitmentKind,
    1,
  );

  return {
    storeId: store.id,
    variantId: variant.id,
    codOfferingId: codOffering.id,
    bankOfferingId: bankOffering.id,
    codAccountId: codAccount.id,
    bankAccountId: bankAccount.id,
  };
}

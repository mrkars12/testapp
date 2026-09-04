import { appConfigStub } from '../../../test/config.stub';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutExpiryJob } from './checkout-expiry.job';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import { PaymentFactApplier } from '../payments/facts/payment-fact.applier';
import { CheckoutFinalizerService } from '../payments/facts/checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from '../payments/facts/checkout-succession-funds.service';
import { CartService } from '../cart/cart.service';
import {
  buildFactDedupeKey,
  type InitializeResult,
  type ObservedFact,
} from '../payments/gateways/provider.types';
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness';

/**
 * Integration coverage for the funds_secured flow.
 *
 * The invariant under test is the one the whole design rests on:
 * an order exists only when the money is secured. Everything here is a
 * way that could be false — a declined card, a redelivered capture, an
 * abandoned redirect — and each one is a failure that stays invisible
 * until a merchant notices phantom orders or missing stock.
 */

const SLUG = 'spec-store';
const STRIPE_REF = 'pi_spec_1';

interface Fixture {
  storeId: bigint;
  variantId: bigint;
  codOfferingId: bigint;
  bankOfferingId: bigint;
  gatewayOfferingId: bigint;
  gatewayAccountId: bigint;
}

/** Provider registry returning a scripted adapter. */
function fakeRegistry(result: InitializeResult) {
  const provider = {
    capabilities: {
      gateway: 'stripe',
      methods: ['card'],
      currencies: 'all' as const,
      exponentOverrides: {},
      manualCapture: false,
      partialCapture: false,
      multiCapture: false,
      partialRefund: false,
      voidSupported: false,
      authorizationExpiry: false,
      vaulting: false,
      merchantInitiated: false,
      threeDSecure: false,
      webhooks: false,
      statusPolling: false,
      settlementReports: false,
      webhookResolution: 'none' as const,
      offlineCommitmentKind: null,
    },
    validateCredentials: async () => ({ valid: true }),
    initializePayment: async () => result,
    fetchStatus: async () => [],
  };

  const offline = {
    ...provider,
    capabilities: {
      ...provider.capabilities,
      gateway: 'cod',
      methods: ['cod'],
    },
    initializePayment: async () => ({
      kind: 'no_gateway' as const,
      commitmentKind: 'promise_accepted' as const,
    }),
  };

  const bank = {
    ...provider,
    capabilities: {
      ...provider.capabilities,
      gateway: 'bank_transfer',
      methods: ['bank_transfer'],
    },
    initializePayment: async () => ({
      kind: 'no_gateway' as const,
      commitmentKind: 'awaiting_offline_settlement' as const,
      nextAction: {
        kind: 'bank_instructions' as const,
        fields: { bank_name: 'Test Bank', account_holder: 'Spec' },
      },
    }),
  };

  const byKey: Record<string, unknown> = {
    stripe: provider,
    cod: offline,
    bank_transfer: bank,
  };

  return {
    has: (gateway: string) => gateway in byKey,
    get: (gateway: string) => byKey[gateway],
    assertCanHandle: ({ gateway }: { gateway: string }) => byKey[gateway],
  } as never;
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({
    secret_key: 'sk_test',
    bank_name: 'Test Bank',
    account_holder: 'Spec',
  }),
} as never;

const fakeIdempotency = {
  defaultTtlSeconds: 3600,
  defaultLeaseSeconds: 60,
  claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
  complete: async () => undefined,
  fail: async () => undefined,
} as never;

function body(fx: Fixture, offeringId: bigint, quantity = 2) {
  return {
    items: [{ variant_id: fx.variantId.toString(), quantity }],
    customer_name: 'Test Buyer',
    customer_phone: '01000000000',
    address_line: '1 Test Street',
    city: 'Cairo',
    payment_offering_id: offeringId.toString(),
  };
}

function captureFact(fx: Fixture, amountMinor: bigint): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference: STRIPE_REF,
      factType: 'attempt_captured',
      cumulativeAmountMinor: amountMinor,
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference: STRIPE_REF,
    factType: 'attempt_captured',
    cumulativeAmountMinor: amountMinor,
    currency: 'USD',
  };
}

function captureFactFor(
  fx: Fixture,
  gatewayReference: string,
  amountMinor: bigint,
): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference,
      factType: 'attempt_captured',
      cumulativeAmountMinor: amountMinor,
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference,
    factType: 'attempt_captured',
    cumulativeAmountMinor: amountMinor,
    currency: 'USD',
  };
}

function failFactFor(fx: Fixture, gatewayReference: string): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference,
      factType: 'attempt_failed',
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference,
    factType: 'attempt_failed',
    currency: 'USD',
  };
}

function failFact(fx: Fixture): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference: STRIPE_REF,
      factType: 'attempt_failed',
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference: STRIPE_REF,
    factType: 'attempt_failed',
    currency: 'USD',
  };
}

describe('funds_secured checkout (integration)', () => {
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let applier: PaymentFactApplier;
  let fx: Fixture;

  async function withTenant<T>(
    storeId: bigint,
    mode: 'live' | 'test',
    cb: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId.toString()}, true), set_config('app.mode', ${mode}, true)`;
      return cb(tx);
    });
  }


  /*
   * `checkouts` and `checkout_line_items` carry RLS as of
   * `20260904090000_enable_checkout_rls`, so a bare client read sees
   * NOTHING — this harness connects as `dartstore_app`, the role the
   * policies target. Assertions therefore go through tenant context,
   * which is both what the application does and, incidentally, standing
   * proof that the policy is switched on: if it ever stopped being,
   * these reads would keep passing, but the cross-store and cross-mode
   * specs below would start failing.
   */
  const asTenant = <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    storeId?: bigint,
  ): Promise<T> => withTenant(storeId ?? fx.storeId, 'live', fn);

  let carts: CartService;

  const buildCheckout = (result: InitializeResult) =>
    new CheckoutService(
      prisma as never,
      ledger,
      new OutboxService(),
      fakeAccounts,
      fakeIdempotency,
      fakeRegistry(result),
      { reserve: async () => nextIntentId() } as never,
      applier,
      new TenantContextService(),
      appConfigStub(),
      new CheckoutSuccessionFundsService(),
      carts,
    );

  let intentCounter = 9000n;
  const nextIntentId = () => ++intentCounter;

  beforeAll(async () => {
    prisma = await startTestDatabase();
    carts = new CartService(prisma as never, new TenantContextService());
    ledger = new LedgerService(prisma as never);
    applier = new PaymentFactApplier(
      prisma as never,
      ledger,
      new OutboxService(),
      new CheckoutFinalizerService(prisma as never, new OutboxService()),
      new CheckoutSuccessionFundsService(),
    );
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    fx = await seed(prisma);
  });

  describe('before the money is secured', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    };

    it('creates no order', async () => {
      const result = await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      expect(result.order).toBeNull();
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(0);
    });

    it('returns the action the customer must complete', async () => {
      const result = await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      expect(result.next_action).toMatchObject({ kind: 'client_sdk' });
      expect(result.checkout_token).toHaveLength(32);
    });

    it('holds stock rather than taking it', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      const reservation = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findFirstOrThrow({}),
      );
      expect(reservation.state).toBe('held');

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(10);
    });

    it('posts nothing to the ledger', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.journalEntry.count())).toBe(0);
    });

    it('leaves the checkout pending', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      const checkout = await asTenant((tx) => tx.checkout.findFirstOrThrow({}));
      expect(checkout.status).toBe('pending_payment');
      expect(checkout.order_id).toBeNull();
    });
  });

  describe('when the money is secured', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    };

    beforeEach(async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
    });

    it('creates the order', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      const order = await withTenant(fx.storeId, 'live', (tx) => tx.order.findFirstOrThrow({}));
      expect(order.order_number).toBe('1001');
      expect(order.payment_status).toBe('PAID');
      expect(order.paid_at).not.toBeNull();
      // Prisma Decimal renders without trailing zeros; compare numerically.
      expect(Number(order.total)).toBe(50);
    });

    it('takes the held stock', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(8);

      const reservation = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findFirstOrThrow({}),
      );
      expect(reservation.state).toBe('converted');
    });

    it('posts a balanced gateway receivable', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(5000n);

      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('links the checkout to the order', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      const checkout = await asTenant((tx) => tx.checkout.findFirstOrThrow({}));
      const order = await withTenant(fx.storeId, 'live', (tx) => tx.order.findFirstOrThrow({}));
      expect(checkout.status).toBe('committed');
      expect(checkout.order_id).toBe(order.id);
      expect(order.checkout_id).toBe(checkout.id);
    });

    it('does not create a second order when the capture is redelivered', async () => {
      const fact = captureFact(fx, 5000n);

      await applier.apply(fact, 'webhook');
      const second = await applier.apply(fact, 'reconciliation');

      expect(second.outcome).toBe('duplicate');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.capture.count())).toBe(1);
    });

    it('does not double-decrement stock on redelivery', async () => {
      const fact = captureFact(fx, 5000n);

      await applier.apply(fact, 'webhook');
      await applier.apply(fact, 'return_url');

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(8);
    });

    it('creates exactly one order under two parallel deliveries', async () => {
      const other = createAdditionalClient();

      try {
        const otherApplier = new PaymentFactApplier(
          other as never,
          new LedgerService(other as never),
          new OutboxService(),
          new CheckoutFinalizerService(other as never, new OutboxService()),
          new CheckoutSuccessionFundsService(),
        );

        await Promise.allSettled([
          applier.apply(captureFact(fx, 5000n), 'webhook'),
          otherApplier.apply(captureFact(fx, 5000n), 'reconciliation'),
        ]);

        expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
        expect(await withTenant(fx.storeId, 'live', (tx) => tx.capture.count())).toBe(1);
        expect(await ledger.findUnbalancedEntries()).toEqual([]);
      } finally {
        await other.$disconnect();
      }
    });
  });

  describe('when the payment fails', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    };

    beforeEach(async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
    });

    it('creates no order', async () => {
      await applier.apply(failFact(fx), 'webhook');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(0);
    });

    it('releases the held stock', async () => {
      await applier.apply(failFact(fx), 'webhook');

      const reservation = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findFirstOrThrow({}),
      );
      expect(reservation.state).toBe('released');

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(10);
    });

    it('marks the checkout failed and posts nothing', async () => {
      await applier.apply(failFact(fx), 'webhook');

      const checkout = await asTenant((tx) => tx.checkout.findFirstOrThrow({}));
      expect(checkout.status).toBe('failed');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.journalEntry.count())).toBe(0);
    });

    /*
     * ROUND 10 — this test used to assert the opposite, and the
     * opposite is what took a customer's money and gave them no order.
     *
     * The behaviour it demanded ("ignore a capture that arrives after a
     * failure") was reproduced live on Moyasar: the payer's card was
     * declined, they paid again on the same invoice, and the capture
     * was discarded as `terminal_state` — the provider had the money
     * and this system had no order. Round 5/6 fixed that in
     * `fact-decision.ts`, and its unit tests ("applies a capture that
     * arrives after a failed attempt") have asserted the corrected rule
     * ever since. This integration test was never reconciled with it.
     *
     * The invariant, stated properly: a capture is real money. It is
     * applied whatever came before it, the order is created, and a
     * redelivery of the same capture changes nothing.
     */
    it('applies a capture arriving after the failure — real money always yields an order', async () => {
      await applier.apply(failFact(fx), 'webhook');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(0);

      const late = await applier.apply(captureFact(fx, 5000n), 'webhook');
      expect(late.outcome).toBe('applied');

      const orders = await withTenant(fx.storeId, 'live', (tx) =>
        tx.order.findMany({}),
      );
      expect(orders).toHaveLength(1);
      expect(orders[0].payment_status).toBe('PAID');

      const intent = await withTenant(fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('captured');

      // The stock the failure released is taken again by the sale, and
      // never below zero (Round 9's guarded decrement).
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(8);
      expect(variant.inventory_qty).toBeGreaterThanOrEqual(0);

      // Idempotent: the same capture redelivered creates no second order.
      const again = await applier.apply(captureFact(fx, 5000n), 'webhook');
      expect(again.outcome).toBe('duplicate');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     ROUND 5 — the succession funds invariant.

       A checkout with any descendant that has secured funds must not
       itself secure funds again.

     Every test here builds a REAL chain through CheckoutService (so
     `supersedes_id` is written by the code that owns that rule, not by
     the test) and then delivers a real capture to the PREDECESSOR
     through the real applier.
     ══════════════════════════════════════════════════════════════════ */
  describe('a superseded checkout may not secure funds again', () => {
    const REF_A = 'pi_spec_pred';
    const REF_B = 'pi_spec_succ';
    const REF_C = 'pi_spec_third';

    const surface = (gatewayReference: string): InitializeResult => ({
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference },
    });

    /** Creates a checkout, optionally as the successor of another. */
    async function createCheckout(
      gatewayReference: string,
      supersedesToken?: string,
    ) {
      const service = buildCheckout(surface(gatewayReference));
      return service.createAndCommit(SLUG, {
        ...body(fx, fx.gatewayOfferingId),
        ...(supersedesToken
          ? { supersedes_checkout_token: supersedesToken }
          : {}),
      } as never);
    }

    const orderCount = () =>
      withTenant(fx.storeId, 'live', (tx) =>
        tx.order.count({ where: { store_id: fx.storeId } }),
      );

    const checkoutRow = (token: string) =>
      withTenant(fx.storeId, 'live', (tx) =>
        tx.checkout.findFirst({
          where: { store_id: fx.storeId, token },
          select: { id: true, status: true, order_id: true, supersedes_id: true },
        }),
      );

    it('links the successor to the predecessor it replaced', async () => {
      // The premise every other test here rests on. If this breaks, the
      // rest are testing nothing.
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);

      const rowA = await checkoutRow(a.checkout_token);
      const rowB = await checkoutRow(b.checkout_token);

      expect(rowB?.supersedes_id).toBe(rowA?.id);
    });

    it('BLOCKS a capture on the predecessor once the successor is PAID', async () => {
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);

      // B is paid. This is the write that makes A blocked.
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');
      expect(await orderCount()).toBe(1);

      // Money now arrives on A anyway — the residual race.
      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

      // THE INVARIANT: no second order.
      expect(await orderCount()).toBe(1);

      const rowA = await checkoutRow(a.checkout_token);
      expect(rowA?.order_id).toBeNull();
      expect(rowA?.status).not.toBe('committed');

      const rowB = await checkoutRow(b.checkout_token);
      expect(rowB?.order_id).not.toBeNull();
    });

    it('records the money rather than pretending it never arrived', async () => {
      // Option 2. Dropping the fact would leave a real charge that
      // appears nowhere in the books.
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

      const result = await applier.apply(
        captureFactFor(fx, REF_A, 5000n),
        'webhook',
      );
      expect(result.outcome).toBe('applied');

      const intent = await withTenant(fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirst({
          where: { store_id: fx.storeId, id: result.intentId as bigint },
          select: { status: true, captured_total_minor: true },
        }),
      );

      expect(intent?.status).toBe('captured');
      expect(intent?.captured_total_minor).toBe(5000n);

      const captures = await withTenant(fx.storeId, 'live', (tx) =>
        tx.capture.count({ where: { intent_id: result.intentId as bigint } }),
      );
      expect(captures).toBe(1);
    });

    it('queues the funds to be returned, in the same transaction', async () => {
      // The refund leg. Refusing the order and keeping the money would
      // be worse than the duplicate order it prevents.
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');
      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

      const events = await withTenant(fx.storeId, 'live', (tx) =>
        tx.outboxMessage.findMany({
          where: {
            store_id: fx.storeId,
            event_type: 'payment.superseded_funds_detected',
          },
          select: { payload: true },
        }),
      );

      expect(events).toHaveLength(1);
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.capturedTotalMinor).toBe('5000');
      expect(payload.gatewayReference).toBe(REF_A);
    });

    it('keeps the blocked fact auditable', async () => {
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');
      const result = await applier.apply(
        captureFactFor(fx, REF_A, 5000n),
        'webhook',
      );

      const events = await withTenant(fx.storeId, 'live', (tx) =>
        tx.paymentEvent.findMany({
          where: { intent_id: result.intentId as bigint },
          select: { event_type: true, applied: true },
        }),
      );

      // The historical fact is never erased.
      expect(events.some((e) => e.event_type === 'attempt_captured')).toBe(true);
    });

    it('does not create a second order when the blocked fact is redelivered', async () => {
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');
      const again = await applier.apply(
        captureFactFor(fx, REF_A, 5000n),
        'webhook',
      );

      // Idempotency is untouched: the same fact is still a duplicate.
      expect(again.outcome).toBe('duplicate');
      expect(await orderCount()).toBe(1);

      const events = await withTenant(fx.storeId, 'live', (tx) =>
        tx.outboxMessage.count({
          where: {
            store_id: fx.storeId,
            event_type: 'payment.superseded_funds_detected',
          },
        }),
      );
      expect(events).toBe(1);
    });

    /* ── The states that must NOT block ───────────────────────────── */

    it('ALLOWS the predecessor when the successor is still open', async () => {
      const a = await createCheckout(REF_A);
      await createCheckout(REF_B, a.checkout_token);

      // B holds nothing. A customer who went back to finish the first
      // payment must not be stranded.
      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

      expect(await orderCount()).toBe(1);
      const rowA = await checkoutRow(a.checkout_token);
      expect(rowA?.order_id).not.toBeNull();
    });

    it('ALLOWS the predecessor when the successor FAILED', async () => {
      // The ordinary retry-declined case, and the one a naive
      // "block whenever supersedes_id is set" guard would have broken.
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);

      await applier.apply(failFactFor(fx, REF_B), 'webhook');
      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

      expect(await orderCount()).toBe(1);
      const rowA = await checkoutRow(a.checkout_token);
      expect(rowA?.order_id).not.toBeNull();
    });

    it('BLOCKS on an AUTHORIZED successor, before any capture', async () => {
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);

      await applier.apply(
        {
          dedupeKey: buildFactDedupeKey({
            accountId: fx.gatewayAccountId,
            gatewayReference: REF_B,
            factType: 'attempt_authorized',
            currency: 'USD',
          }),
          accountId: fx.gatewayAccountId,
          gatewayReference: REF_B,
          factType: 'attempt_authorized',
          currency: 'USD',
        },
        'webhook',
      );

      // An authorisation is a real hold, and finalize() already made an
      // order for it.
      const ordersAfterAuth = await orderCount();

      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');
      expect(await orderCount()).toBe(ordersAfterAuth);

      const rowA = await checkoutRow(a.checkout_token);
      expect(rowA?.order_id).toBeNull();
    });

    it('blocks EVERY ancestor in a chain A -> B -> C when only C is paid', async () => {
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);
      const c = await createCheckout(REF_C, b.checkout_token);

      await applier.apply(captureFactFor(fx, REF_C, 5000n), 'webhook');
      expect(await orderCount()).toBe(1);

      // Transitivity: a one-hop check would let A straight through.
      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

      expect(await orderCount()).toBe(1);
      expect((await checkoutRow(a.checkout_token))?.order_id).toBeNull();
      expect((await checkoutRow(b.checkout_token))?.order_id).toBeNull();
    });

    /* ══════════════════════════════════════════════════════════════
       F-04 — THE CART ARM: when the browser lost the token.

       Every test above hands the retry a `supersedes_checkout_token`,
       and every one of them therefore proves only that the CHAIN arm
       works. That token lives in a `useRef` on the checkout page —
       browser memory — so a reload between the failed attempt and the
       retry loses it, the server never learns the two checkouts are the
       same purchase, and the whole protection above is silently absent.

       Round 8 already recorded the answer server-side: `Checkout.
       cart_id`. These tests are the wire between the two.
       ══════════════════════════════════════════════════════════════ */

    describe('the cart arm — no supersession token, one basket', () => {
      /** A fresh server-side cart holding one unit. */
      const newCart = async () =>
        (
          await carts.addItem(fx.storeId, 'live', null, {
            variantId: fx.variantId.toString(),
            quantity: 2,
          })
        ).token;

      /**
       * A checkout priced from a server cart, with NO supersession
       * token — exactly what the browser sends after a reload.
       */
      const checkoutOnCart = (gatewayReference: string, cartToken: string) =>
        buildCheckout(surface(gatewayReference)).createAndCommit(
          SLUG,
          body(fx, fx.gatewayOfferingId) as never,
          'live',
          undefined,
          cartToken,
        );

      /**
       * The full production sequence: A is created, its payment fails so
       * the slot goes back, the shopper reloads (losing the token) and
       * retries as B, and B is paid.
       */
      async function retryAfterReloadAndPay(cartToken: string) {
        const a = await checkoutOnCart(REF_A, cartToken);

        // The decline. `abandon()` releases the hold and returns the
        // cart slot, leaving the cart ACTIVE so the retry can claim it —
        // which is exactly the state that lets B be created at all.
        await applier.apply(failFactFor(fx, REF_A), 'webhook');

        // The reload. No supersedes token: `supersedesTokenRef` was a
        // ref, and the document was torn down.
        const b = await checkoutOnCart(REF_B, cartToken);

        const rowA = await checkoutRow(a.checkout_token);
        const rowB = await checkoutRow(b.checkout_token);

        // THE PREMISE. If these ever became linked, these tests would be
        // re-proving the chain arm instead of the cart arm.
        expect(rowB?.supersedes_id).toBeNull();
        expect(rowA?.id).not.toBe(rowB?.id);

        await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

        return { a, b };
      }

      it('creates exactly ONE order when A pays late and B already converted the cart', async () => {
        const cartToken = await newCart();
        const { a, b } = await retryAfterReloadAndPay(cartToken);

        expect(await orderCount()).toBe(1);

        // Money now arrives on the stale checkout A.
        await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

        // THE INVARIANT. Before the cart arm existed this was 2: two
        // Orders and two real charges for one basket.
        expect(await orderCount()).toBe(1);

        const rowA = await checkoutRow(a.checkout_token);
        expect(rowA?.order_id).toBeNull();
        expect(rowA?.status).not.toBe('committed');

        // B owns the purchase.
        const rowB = await checkoutRow(b.checkout_token);
        expect(rowB?.order_id).not.toBeNull();

        const cart = await withTenant(fx.storeId, 'live', (tx) =>
          tx.cart.findFirst({
            where: { store_id: fx.storeId, token: cartToken },
            select: { status: true, converted_order_id: true },
          }),
        );
        expect(cart?.status).toBe('converted');
        expect(cart?.converted_order_id).toBe(rowB?.order_id);
      });

      it('records the money and queues it for return rather than dropping it', async () => {
        const cartToken = await newCart();
        await retryAfterReloadAndPay(cartToken);

        const result = await applier.apply(
          captureFactFor(fx, REF_A, 5000n),
          'webhook',
        );

        // Applied, not ignored: refusing the order AND losing the record
        // of the charge would be the worst outcome of all.
        expect(result.outcome).toBe('applied');

        const intent = await withTenant(fx.storeId, 'live', (tx) =>
          tx.paymentIntent.findFirst({
            where: { store_id: fx.storeId, id: result.intentId as bigint },
            select: { status: true, captured_total_minor: true },
          }),
        );
        expect(intent?.status).toBe('captured');
        expect(intent?.captured_total_minor).toBe(5000n);

        // The remediation leg — the same event and the same operator
        // alarm the chain arm raises.
        const events = await withTenant(fx.storeId, 'live', (tx) =>
          tx.outboxMessage.findMany({
            where: {
              store_id: fx.storeId,
              event_type: 'payment.superseded_funds_detected',
            },
            select: { payload: true },
          }),
        );
        expect(events).toHaveLength(1);
        const payload = events[0].payload as Record<string, unknown>;
        expect(payload.capturedTotalMinor).toBe('5000');
        expect(payload.gatewayReference).toBe(REF_A);
      });

      it('stays idempotent when the late capture is redelivered', async () => {
        const cartToken = await newCart();
        await retryAfterReloadAndPay(cartToken);

        await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');
        const again = await applier.apply(
          captureFactFor(fx, REF_A, 5000n),
          'webhook',
        );

        // A redelivery carries nothing new, so it never reaches the
        // guard at all.
        expect(again.outcome).toBe('duplicate');
        expect(await orderCount()).toBe(1);

        const events = await withTenant(fx.storeId, 'live', (tx) =>
          tx.outboxMessage.count({
            where: {
              store_id: fx.storeId,
              event_type: 'payment.superseded_funds_detected',
            },
          }),
        );
        expect(events).toBe(1);
      });

      it('G1: withholds the payable surface for the stale checkout', async () => {
        const cartToken = await newCart();
        const a = await checkoutOnCart(REF_A, cartToken);

        const service = buildCheckout(surface(REF_A));
        expect(
          (await service.getCheckoutStatus(SLUG, a.checkout_token)).next_action,
        ).not.toBeNull();

        await applier.apply(failFactFor(fx, REF_A), 'webhook');
        const b = await checkoutOnCart(REF_B, cartToken);
        await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

        // The gate that actually PREVENTS a charge, rather than
        // containing one after the fact. `next_action` is the payload
        // the provider's form mounts from, so emitting it is handing the
        // browser a working way to charge the card.
        const after = await service.getCheckoutStatus(SLUG, a.checkout_token);
        expect(after.next_action).toBeNull();
        expect((await checkoutRow(b.checkout_token))?.order_id).not.toBeNull();
      });

      it('leaves a DIFFERENT cart entirely alone — a legitimate repeat purchase', async () => {
        // The guard must be inert for the overwhelmingly common shape:
        // two genuinely different baskets, each paying once.
        const firstCart = await newCart();
        const a = await checkoutOnCart(REF_A, firstCart);
        await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

        // A brand-new cart is what a repeat purchase looks like: the
        // converted one is terminal and is never revived.
        const secondCart = await newCart();
        expect(secondCart).not.toBe(firstCart);

        const b = await checkoutOnCart(REF_B, secondCart);
        await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

        // Both real purchases, both orders, no interference.
        expect(await orderCount()).toBe(2);
        expect((await checkoutRow(a.checkout_token))?.order_id).not.toBeNull();
        expect((await checkoutRow(b.checkout_token))?.order_id).not.toBeNull();

        const events = await withTenant(fx.storeId, 'live', (tx) =>
          tx.outboxMessage.count({
            where: {
              store_id: fx.storeId,
              event_type: 'payment.superseded_funds_detected',
            },
          }),
        );
        expect(events).toBe(0);
      });

      it('leaves the COOKIELESS stateless path on the chain arm alone', async () => {
        // No cart at all, so `cart_id` is NULL and the cart arm can say
        // nothing. This is the path a cookieless browser takes, and it
        // must behave exactly as it did before.
        const a = await createCheckout(REF_A);
        await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

        expect(await orderCount()).toBe(1);
        expect((await checkoutRow(a.checkout_token))?.order_id).not.toBeNull();
      });
    });

    it('leaves an unsuperseded checkout completely unaffected', async () => {
      // The overwhelmingly common shape. The guard must be inert.
      const a = await createCheckout(REF_A);
      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'webhook');

      expect(await orderCount()).toBe(1);
      expect((await checkoutRow(a.checkout_token))?.order_id).not.toBeNull();
    });

    it('G1: withholds the payable surface once the successor is paid', async () => {
      // The gate that actually PREVENTS a charge. `next_action` carries
      // the payload the provider's form mounts from, so emitting it is
      // handing the browser a working way to charge the card.
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);
      const service = buildCheckout(surface(REF_A));

      const before = await service.getCheckoutStatus(SLUG, a.checkout_token);
      expect(before.next_action).not.toBeNull();

      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

      const after = await service.getCheckoutStatus(SLUG, a.checkout_token);
      expect(after.next_action).toBeNull();
      // And it still says where to go instead.
      expect(after.superseded_by_token).toBe(b.checkout_token);
    });

    it('G1: still issues the surface while the successor is unpaid', async () => {
      const a = await createCheckout(REF_A);
      await createCheckout(REF_B, a.checkout_token);
      const service = buildCheckout(surface(REF_A));

      const status = await service.getCheckoutStatus(SLUG, a.checkout_token);
      expect(status.next_action).not.toBeNull();
    });

    it('blocks the RECONCILIATION path identically', async () => {
      // Every entry path funnels through applier.apply(); this pins the
      // reconciliation source explicitly rather than by construction.
      const a = await createCheckout(REF_A);
      await createCheckout(REF_B, a.checkout_token);
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'reconciliation');

      expect(await orderCount()).toBe(1);
      expect((await checkoutRow(a.checkout_token))?.order_id).toBeNull();
    });

    it('blocks the CONFIRM/return path identically', async () => {
      const a = await createCheckout(REF_A);
      await createCheckout(REF_B, a.checkout_token);
      await applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook');

      await applier.apply(captureFactFor(fx, REF_A, 5000n), 'return_url');

      expect(await orderCount()).toBe(1);
    });

    it('CONCURRENCY: one order when predecessor and successor settle at once', async () => {
      // The test the advisory lock exists for. Without the chain lock
      // these two transactions touch no common row, run at READ
      // COMMITTED, and each sees the other as unpaid.
      const a = await createCheckout(REF_A);
      const b = await createCheckout(REF_B, a.checkout_token);

      const [first, second] = await Promise.allSettled([
        applier.apply(captureFactFor(fx, REF_B, 5000n), 'webhook'),
        applier.apply(captureFactFor(fx, REF_A, 5000n), 'return_url'),
      ]);

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');

      // Whichever won, exactly one order exists.
      expect(await orderCount()).toBe(1);
    });
  });

  describe('offline commitment is unaffected', () => {
    const offline: InitializeResult = {
      kind: 'no_gateway',
      commitmentKind: 'promise_accepted',
    };

    it('creates a cash-on-delivery order immediately', async () => {
      const result = await buildCheckout(offline).createAndCommit(
        SLUG,
        body(fx, fx.codOfferingId),
      );

      expect(result.order).not.toBeNull();
      expect(result.order?.status).toBe('PENDING');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.journalEntry.count())).toBe(1);

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(8);
    });

    it('marks a bank transfer order as awaiting payment', async () => {
      const result = await buildCheckout(offline).createAndCommit(
        SLUG,
        body(fx, fx.bankOfferingId),
      );

      expect(result.order?.status).toBe('AWAITING_PAYMENT');
      expect(result.order?.payment_status).toBe('UNPAID');
    });
  });

  describe('concurrent finalization', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    };

    /** A second checkout, so two captures can finalise at once. */
    const SECOND_REF = 'pi_spec_2';

    it('gives two simultaneous orders distinct numbers', async () => {
      // Two independent checkouts, each awaiting its own capture.
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      await buildCheckout({
        kind: 'requires_action',
        nextAction: { kind: 'client_sdk', clientSecret: 'cs_2' },
        refs: { gatewayReference: SECOND_REF },
      }).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId, 1));

      const second = createAdditionalClient();

      try {
        const otherApplier = new PaymentFactApplier(
          second as never,
          new LedgerService(second as never),
          new OutboxService(),
          new CheckoutFinalizerService(second as never, new OutboxService()),
          new CheckoutSuccessionFundsService(),
        );

        const secondFact = {
          ...captureFact(fx, 2500n),
          gatewayReference: SECOND_REF,
          dedupeKey: buildFactDedupeKey({
            accountId: fx.gatewayAccountId,
            gatewayReference: SECOND_REF,
            factType: 'attempt_captured',
            cumulativeAmountMinor: 2500n,
            currency: 'USD',
          }),
        };

        await Promise.all([
          applier.apply(captureFact(fx, 5000n), 'webhook'),
          otherApplier.apply(secondFact, 'reconciliation'),
        ]);

        const orders = await withTenant(fx.storeId, 'live', (tx) => tx.order.findMany({
          orderBy: { id: 'asc' },
          select: { order_number: true },
        }));

        // count(*) + 1001 gave both the same number, and the unique
        // constraint then rejected one outright — a paid customer with
        // no order.
        expect(orders).toHaveLength(2);
        expect(new Set(orders.map((o) => o.order_number)).size).toBe(2);
      } finally {
        await second.$disconnect();
      }
    });

    it('continues numbering from the highest existing order', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      const first = await withTenant(fx.storeId, 'live', (tx) => tx.order.findFirstOrThrow({}));
      expect(first.order_number).toBe('1001');

      await buildCheckout({
        kind: 'requires_action',
        nextAction: { kind: 'client_sdk', clientSecret: 'cs_2' },
        refs: { gatewayReference: SECOND_REF },
      }).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId, 1));

      await applier.apply(
        {
          ...captureFact(fx, 2500n),
          gatewayReference: SECOND_REF,
          dedupeKey: buildFactDedupeKey({
            accountId: fx.gatewayAccountId,
            gatewayReference: SECOND_REF,
            factType: 'attempt_captured',
            cumulativeAmountMinor: 2500n,
            currency: 'USD',
          }),
        },
        'webhook',
      );

      const numbers = await withTenant(fx.storeId, 'live', (tx) => tx.order.findMany({
        orderBy: { id: 'asc' },
        select: { order_number: true },
      }));
      expect(numbers.map((o) => o.order_number)).toEqual(['1001', '1002']);
    });
  });

  describe('the gateway reference reaches the attempt', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF, gatewayPaymentId: STRIPE_REF },
    };

    // This is the whole point of removing linkAttempt(): the reference
    // has to be written by commit(), because that is what lets a webhook
    // or a reconciliation sweep find the attempt later. A test that set
    // it by hand proved nothing.
    it('persists what the provider returned', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      const attempt = await withTenant(fx.storeId, 'live', (tx) => tx.paymentAttempt.findFirstOrThrow({}));
      expect(attempt.gateway_reference).toBe(STRIPE_REF);
      expect(attempt.gateway_payment_id).toBe(STRIPE_REF);
    });

    it('leaves it null for a method with no provider', async () => {
      await buildCheckout({
        kind: 'no_gateway',
        commitmentKind: 'promise_accepted',
      }).createAndCommit(SLUG, body(fx, fx.codOfferingId));

      const attempt = await withTenant(fx.storeId, 'live', (tx) => tx.paymentAttempt.findFirstOrThrow({}));
      expect(attempt.gateway_reference).toBeNull();
    });

    it('lets a fact match without any test fixture', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      const result = await applier.apply(captureFact(fx, 5000n), 'webhook');
      expect(result.outcome).toBe('applied');
    });
  });

  describe('abandoned checkouts release their stock', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    };

    let expiry: CheckoutExpiryJob;

    beforeEach(() => {
      expiry = new CheckoutExpiryJob(prisma as never);
    });

    /** Moves the checkout's expiry into the past. */
    async function expireIt(): Promise<void> {
      await asTenant((tx) => tx.checkout.updateMany({
        data: { expires_at: new Date(Date.now() - 60_000) },
      }));
    }

    it('releases held stock once the checkout expires', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      await expireIt();

      expect(await expiry.releaseExpired()).toBe(1);

      const reservation = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findFirstOrThrow({}),
      );
      expect(reservation.state).toBe('expired');

      const checkout = await asTenant((tx) => tx.checkout.findFirstOrThrow({}));
      expect(checkout.status).toBe('expired');
    });

    it('leaves inventory available again', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      await expireIt();
      await expiry.releaseExpired();

      // Stock was only held, never decremented, so the count is intact
      // and the reservation no longer claims any of it.
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(variant.inventory_qty).toBe(10);

      expect(
        await withTenant(fx.storeId, 'live', (tx) => tx.inventoryReservation.count({ where: { state: 'held' } })),
      ).toBe(0);
    });

    it('terminates the abandoned payment intent', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      await expireIt();
      await expiry.releaseExpired();

      const intent = await withTenant(fx.storeId, 'live', (tx) => tx.paymentIntent.findFirstOrThrow({}));
      expect(intent.status).toBe('expired');
      expect(intent.terminal_at).not.toBeNull();
    });

    it('does not touch a checkout that has not expired', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      expect(await expiry.releaseExpired()).toBe(0);

      const reservation = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findFirstOrThrow({}),
      );
      expect(reservation.state).toBe('held');
    });

    it('does not release a checkout that already produced an order', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      await applier.apply(captureFact(fx, 5000n), 'webhook');
      await expireIt();

      // The money is secured and the order exists; expiry must not claw
      // the stock back out from under it.
      expect(await expiry.releaseExpired()).toBe(0);

      const reservation = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findFirstOrThrow({}),
      );
      expect(reservation.state).toBe('converted');
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
    });

    it('is safe to run twice', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );
      await expireIt();

      expect(await expiry.releaseExpired()).toBe(1);
      expect(await expiry.releaseExpired()).toBe(0);
    });

    it('leaves offline checkouts alone', async () => {
      await buildCheckout({
        kind: 'no_gateway',
        commitmentKind: 'promise_accepted',
      }).createAndCommit(SLUG, body(fx, fx.codOfferingId));
      await expireIt();

      // Cash on delivery converts its reservation at commitment, so
      // there is nothing held and the order already exists.
      expect(await expiry.releaseExpired()).toBe(0);
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     THE CART ACROSS A REAL PAYMENT.

     Everything here is about what happens to `Cart.active_checkout_id`
     and `Cart.status` when money actually moves — the half of cart
     identity that the checkout spec cannot see, because it takes a real
     capture or a real decline to reach these paths.
     ══════════════════════════════════════════════════════════════════ */
  describe('cart identity across a settled payment', () => {
    const REF = 'pi_cart_funds';

    const surface: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_cart' },
      refs: { gatewayReference: REF },
    };

    /** A cart holding two of the fixture variant. */
    async function newCart() {
      const added = await carts.addItem(fx.storeId, 'live', null, {
        variantId: fx.variantId.toString(),
        quantity: 2,
      });

      const row = await withTenant(fx.storeId, 'live', (tx) =>
        tx.cart.findFirst({
          where: { token: added.token },
          select: { id: true },
        }),
      );

      return { token: added.token, id: row!.id };
    }

    const cartRow = (id: bigint) =>
      withTenant(fx.storeId, 'live', (tx) =>
        tx.cart.findFirst({ where: { id } }),
      );

    const place = (cartToken: string | null, result = surface) =>
      buildCheckout(result).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId) as never,
        'live',
        undefined,
        cartToken,
      );

    /* ── 3. One tab pays → the other cannot ───────────────────────── */

    it('converts the cart in the SAME transaction that creates the order', async () => {
      const cart = await newCart();
      await place(cart.token);

      await applier.apply(captureFactFor(fx, REF, 5000n), 'webhook');

      const row = await cartRow(cart.id);
      const orders = await withTenant(fx.storeId, 'live', (tx) =>
        tx.order.findMany({ select: { id: true } }),
      );

      expect(orders).toHaveLength(1);
      expect(row!.status).toBe('converted');
      expect(row!.active_checkout_id).toBeNull();
      expect(row!.converted_order_id).toBe(orders[0].id);
      expect(row!.converted_at).not.toBeNull();
    });

    it('refuses a second purchase on that cart, and the ledger does not move', async () => {
      const cart = await newCart();
      await place(cart.token);
      await applier.apply(captureFactFor(fx, REF, 5000n), 'webhook');

      const entriesBefore = await withTenant(fx.storeId, 'live', (tx) =>
        tx.journalEntry.count({ where: { store_id: fx.storeId, mode: 'live' } }),
      );

      await expect(place(cart.token)).rejects.toMatchObject({
        response: { code: 'cart_converted' },
      });

      // ONE order, and not one further posting for the refused attempt.
      expect(
        await withTenant(fx.storeId, 'live', (tx) => tx.order.count()),
      ).toBe(1);
      expect(
        await withTenant(fx.storeId, 'live', (tx) =>
          tx.journalEntry.count({ where: { store_id: fx.storeId, mode: 'live' } }),
        ),
      ).toBe(entriesBefore);
    });

    /* ── 6. Retry after a failure still works ─────────────────────── */

    it('hands the slot back on a decline, so the retry succeeds on the SAME cart', async () => {
      const cart = await newCart();
      const first = await place(cart.token);

      // The card is declined. `abandon()` runs inside the applier.
      await applier.apply(failFactFor(fx, REF), 'webhook');

      const afterDecline = await cartRow(cart.id);
      // The basket is still the shopper's: only the attempt ended.
      expect(afterDecline!.status).toBe('active');
      expect(afterDecline!.active_checkout_id).toBeNull();

      const second = await buildCheckout({
        kind: 'requires_action',
        nextAction: { kind: 'client_sdk', clientSecret: 'cs_retry' },
        refs: { gatewayReference: 'pi_cart_retry' },
      }).createAndCommit(
        SLUG,
        {
          ...body(fx, fx.gatewayOfferingId),
          supersedes_checkout_token: first.checkout_token,
        } as never,
        'live',
        undefined,
        cart.token,
      );

      expect(second.checkout_token).not.toBe(first.checkout_token);
      expect((second as { converged?: boolean }).converged).toBeUndefined();

      const rows = await withTenant(fx.storeId, 'live', (tx) =>
        tx.checkout.findMany({
          where: { store_id: fx.storeId },
          select: {
            id: true,
            token: true,
            cart_id: true,
            supersedes_id: true,
          },
          orderBy: { id: 'asc' },
        }),
      );

      const predecessor = rows.find((r) => r.token === first.checkout_token)!;
      const successor = rows.find((r) => r.token === second.checkout_token)!;

      // TWO COLUMNS, TWO QUESTIONS. Same basket, so `cart_id` is equal;
      // the retry replaced the decline, so `supersedes_id` points at it.
      expect(successor.cart_id).toBe(predecessor.cart_id);
      expect(successor.cart_id).toBe(cart.id);
      expect(successor.supersedes_id).toBe(predecessor.id);

      /*
       * And cart identity is NEVER written into the succession column.
       *
       * Asserted structurally rather than by comparing the two numbers
       * — in a fresh database the first cart and the first checkout can
       * legitimately both be id 1, and an assertion that they differ
       * would be testing the sequence, not the design. What must hold
       * is that every `supersedes_id` names an actual CHECKOUT.
       */
      const checkoutIds = new Set(rows.map((row) => row.id));
      for (const row of rows) {
        if (row.supersedes_id !== null) {
          expect(checkoutIds.has(row.supersedes_id)).toBe(true);
        }
      }
      expect(predecessor.supersedes_id).toBeNull();

      // The slot is the successor's now.
      const afterRetry = await cartRow(cart.id);
      expect(afterRetry!.active_checkout_id).toBe(successor.id);
      expect(afterRetry!.status).toBe('active');
    });

    /* ── 15. Expiry hands the slot back too ───────────────────────── */

    it('hands the slot back when the checkout expires', async () => {
      const cart = await newCart();
      await place(cart.token);

      await withTenant(fx.storeId, 'live', (tx) =>
        tx.$executeRaw`UPDATE checkouts SET expires_at = now() - interval '1 hour'`,
      );

      const expiry = new CheckoutExpiryJob(prisma as never);
      expect(await expiry.releaseExpired()).toBe(1);

      const row = await cartRow(cart.id);
      expect(row!.active_checkout_id).toBeNull();
      // Still the shopper's basket — expiry is not a statement about it.
      expect(row!.status).toBe('active');

      // So a fresh attempt on the same cart is simply allowed.
      const again = await place(cart.token, {
        kind: 'requires_action',
        nextAction: { kind: 'client_sdk', clientSecret: 'cs_again' },
        refs: { gatewayReference: 'pi_cart_again' },
      });
      expect(again.checkout_token).toBeTruthy();
    });
  });

  /* ══════════════════════════════════════════════════════════════
     ROUND 9 §11 — THE CONVERSION GUARD.

     The decrement at conversion is the last place a sale can be
     invented. It is also the ONE place where "refuse the sale" is the
     wrong answer: the customer has already paid, so the order must
     stand and the shortfall must be made visible instead of written as
     a negative on a variant whose merchant said "stop selling when out
     of stock".
     ══════════════════════════════════════════════════════════════ */

  describe('the conversion guard', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_guard' },
      refs: { gatewayReference: STRIPE_REF },
    };

    /** The checkout that legitimately takes the stock first. */
    const RESOLD_REF = 'pi_spec_resold';

    it('10 — a late capture whose stock was re-sold still creates the order, never goes negative, and records the oversell', async () => {
      // Exactly two units exist, and one checkout holds both.
      await prisma.productVariant.update({
        where: { id: fx.variantId },
        data: { inventory_qty: 2 },
      });

      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      // The card is declined; `abandon()` releases the hold, and the
      // units are honestly available again.
      await applier.apply(failFact(fx), 'webhook');

      // Someone else buys them and pays.
      await buildCheckout({
        ...pending,
        refs: { gatewayReference: RESOLD_REF },
      }).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId));

      await applier.apply(captureFactFor(fx, RESOLD_REF, 5000n), 'webhook');

      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(0);

      // ...and only THEN does the first checkout's capture arrive.
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      // The money is real, so both orders exist.
      const orders = await withTenant(fx.storeId, 'live', (tx) =>
        tx.order.findMany({}),
      );
      expect(orders).toHaveLength(2);

      // But stock was not conjured out of nothing.
      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(0);

      // And the shortfall is on the outbox, not just in a log line.
      const oversold = await withTenant(fx.storeId, 'live', (tx) =>
        tx.outboxMessage.findMany({
          where: { store_id: fx.storeId, event_type: 'inventory.oversold' },
          select: { payload: true },
        }),
      );

      expect(oversold).toHaveLength(1);
      const payload = oversold[0].payload as Record<string, unknown>;
      expect(payload.orderNumber).toBeTruthy();
      expect(payload.lines).toHaveLength(1);
    });

    it('11 — a redelivered capture decrements exactly once', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      const fact = captureFact(fx, 5000n);

      await applier.apply(fact, 'webhook');
      await applier.apply(fact, 'webhook');

      // 10 - 2, once. A second decrement would read 6.
      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(8);

      const orders = await withTenant(fx.storeId, 'live', (tx) =>
        tx.order.findMany({}),
      );
      expect(orders).toHaveLength(1);

      const reservations = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findMany({}),
      );
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe('converted');
    });

    /* ── F-05 — the third reservation state ────────────────────────
       Test 10 covers a hold that `abandon()` RELEASED. The expiry
       sweep reaches the same place by a different route and writes
       `expired` instead, and that state was missing from the two
       selections in `finalize()`.

       The failure was silent, which is what makes it worth two tests:
       the selection came back empty, so no decrement was attempted, no
       shortfall was recorded, and no `inventory.oversold` was emitted.
       The order was created and marked PAID with inventory untouched —
       goods sold twice with nothing anywhere saying so.
       ──────────────────────────────────────────────────────────── */

    it('13 — a late capture over EXPIRED reservations still takes the stock', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      // The shopper walks away and the sweep reclaims the hold. This is
      // the real job, not a hand-written UPDATE, so the state it writes
      // is the state production writes.
      await asTenant((tx) => tx.checkout.updateMany({
        data: { expires_at: new Date(Date.now() - 60_000) },
      }));
      expect(await new CheckoutExpiryJob(prisma as never).releaseExpired()).toBe(1);

      const swept = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findMany({}),
      );
      expect(swept).toHaveLength(1);
      expect(swept[0].state).toBe('expired');

      // Stock is back in the pool, untouched: a hold was never a
      // decrement.
      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(10);

      // ...and only now does the payment land.
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      // The money is real, so the order exists and is paid.
      const orders = await withTenant(fx.storeId, 'live', (tx) =>
        tx.order.findMany({}),
      );
      expect(orders).toHaveLength(1);
      expect(orders[0].payment_status).toBe('PAID');

      // THE ASSERTION THAT WAS MISSING. The two units are actually
      // taken. Before the fix this read 10 — order created, stock never
      // moved, and nothing to notice it by.
      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(8);

      // The reservation is settled, so a redelivery cannot take them
      // again.
      const after = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findMany({}),
      );
      expect(after).toHaveLength(1);
      expect(after[0].state).toBe('converted');

      // Stock was available, so this is NOT an oversell and must not be
      // reported as one — an alert that fires on the ordinary case is an
      // alert people learn to ignore.
      const oversold = await withTenant(fx.storeId, 'live', (tx) =>
        tx.outboxMessage.findMany({
          where: { store_id: fx.storeId, event_type: 'inventory.oversold' },
        }),
      );
      expect(oversold).toHaveLength(0);

      // Redelivery stays idempotent across the expiry path too.
      await applier.apply(captureFact(fx, 5000n), 'webhook');
      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(8);
      expect(
        await withTenant(fx.storeId, 'live', (tx) => tx.order.count({})),
      ).toBe(1);
    });

    it('14 — a late capture over EXPIRED reservations whose stock was re-sold records the oversell', async () => {
      // Two units, and the first checkout holds both.
      await prisma.productVariant.update({
        where: { id: fx.variantId },
        data: { inventory_qty: 2 },
      });

      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      );

      // Expired by the sweep — the units go back to the pool.
      await asTenant((tx) => tx.checkout.updateMany({
        data: { expires_at: new Date(Date.now() - 60_000) },
      }));
      expect(await new CheckoutExpiryJob(prisma as never).releaseExpired()).toBe(1);

      // Someone else legitimately buys them and pays.
      await buildCheckout({
        ...pending,
        refs: { gatewayReference: RESOLD_REF },
      }).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId));

      await applier.apply(captureFactFor(fx, RESOLD_REF, 5000n), 'webhook');

      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(0);

      // ...and only THEN does the expired checkout's payment arrive.
      await applier.apply(captureFact(fx, 5000n), 'webhook');

      // The money is real, so the order stands. Refusing it would mean
      // taking payment and recording nothing, which is strictly worse.
      const orders = await withTenant(fx.storeId, 'live', (tx) =>
        tx.order.findMany({}),
      );
      expect(orders).toHaveLength(2);

      // But stock is not conjured: the guard refuses to go below zero on
      // a variant whose merchant said "stop selling when out of stock".
      expect(
        (
          await prisma.productVariant.findFirstOrThrow({
            where: { id: fx.variantId },
          })
        ).inventory_qty,
      ).toBe(0);

      // THE POINT OF THE FIX. The shortfall reaches the merchant as an
      // event, not just a log line — and before the fix this array was
      // empty, because the expired reservation was never even read.
      const oversold = await withTenant(fx.storeId, 'live', (tx) =>
        tx.outboxMessage.findMany({
          where: { store_id: fx.storeId, event_type: 'inventory.oversold' },
          select: { payload: true },
        }),
      );
      expect(oversold).toHaveLength(1);
      const payload = oversold[0].payload as Record<string, unknown>;
      expect(payload.orderNumber).toBeTruthy();
      expect(payload.lines).toHaveLength(1);

      // Redelivery must not emit a second oversell or a third order.
      await applier.apply(captureFact(fx, 5000n), 'webhook');
      expect(
        await withTenant(fx.storeId, 'live', (tx) => tx.order.count({})),
      ).toBe(2);
      expect(
        await withTenant(fx.storeId, 'live', (tx) =>
          tx.outboxMessage.count({
            where: { store_id: fx.storeId, event_type: 'inventory.oversold' },
          }),
        ),
      ).toBe(1);
    });
  });

  describe('rejection before anything is payable', () => {
    it('refuses a declined initialisation and leaves no LIVE checkout', async () => {
      const declined: InitializeResult = {
        kind: 'failed',
        errorCode: 'declined_insufficient_funds',
      };

      await expect(
        buildCheckout(declined).createAndCommit(
          SLUG,
          body(fx, fx.gatewayOfferingId),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      /*
       * A DECLINE IS THE PROVIDER-FAILURE CONTRACT, NOT AN EXCEPTION TO
       * IT.
       *
       * Round 9 commits the checkout and its inventory hold before the
       * provider is called, so a decline cannot un-write them. What it
       * must do — and now does, because `interpretResult()` was brought
       * inside the compensated region — is leave nothing live: the
       * checkout is terminal, no order exists, and every unit it was
       * holding is released back for the next shopper.
       */
      expect(await withTenant(fx.storeId, 'live', (tx) => tx.order.count())).toBe(0);

      const checkouts = await asTenant((tx) => tx.checkout.findMany());
      expect(checkouts).toHaveLength(1);
      expect(checkouts[0].status).toBe('failed');
      expect(checkouts[0].order_id).toBeNull();

      const reservations = await withTenant(fx.storeId, 'live', (tx) =>
        tx.inventoryReservation.findMany(),
      );
      expect(reservations.length).toBeGreaterThan(0);
      expect(reservations.every((r) => r.state === 'released')).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_funds',
      email: 'spec_funds@example.test',
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
    },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      store_id: store.id,
      title: 'Spec Product',
      handle: 'spec-product',
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

  async function withTenant<T>(
    storeId: bigint,
    mode: 'live' | 'test',
    cb: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId.toString()}, true), set_config('app.mode', ${mode}, true)`;
      return cb(tx);
    });
  }

  const account = async (gateway: PaymentProviderKey) =>
    withTenant(store.id, 'live', (tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: store.id,
          mode: 'live',
          gateway,
          display_name: 'Default',
          status: 'active',
          settlement_currency: 'USD',
        },
        select: { id: true },
      }),
    );

  const offering = async (
    accountId: bigint,
    method: PaymentMethodKey,
    commitmentKind: CommitmentKind,
    position: number,
  ) =>
    withTenant(store.id, 'live', (tx) =>
      tx.paymentMethodOffering.create({
        data: {
          account_id: accountId,
          store_id: store.id,
          mode: 'live',
          method,
          enabled: true,
          position,
          commitment_kind: commitmentKind,
          capture_mode: 'automatic',
        },
        select: { id: true },
      }),
    );

  const codAccount = await account('cod');
  const bankAccount = await account('bank_transfer');
  const gatewayAccount = await account('stripe');

  const cod = await offering(codAccount.id, 'cod', 'promise_accepted', 0);
  const bank = await offering(
    bankAccount.id,
    'bank_transfer',
    'awaiting_offline_settlement',
    1,
  );
  const gateway = await offering(gatewayAccount.id, 'card', 'funds_secured', 2);

  return {
    storeId: store.id,
    variantId: variant.id,
    codOfferingId: cod.id,
    bankOfferingId: bank.id,
    gatewayOfferingId: gateway.id,
    gatewayAccountId: gatewayAccount.id,
  };
}

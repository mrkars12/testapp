import { appConfigStub } from '../../../test/config.stub';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  CaptureMode,
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentCaptureService } from './payment-capture.service';
import { RefundService } from './refund.service';
import { PaymentCollectionService } from './payment-collection.service';
import { OrderCancellationService } from './order-cancellation.service';
import { PaymentFactApplier } from './facts/payment-fact.applier';
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from './facts/checkout-succession-funds.service';
import { CheckoutService } from '../checkout/checkout.service';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import {
  buildFactDedupeKey,
  type CaptureInput,
  type InitializeResult,
  type ObservedFact,
  type PaymentCallContext,
} from './gateways/provider.types';
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  createTestIdempotencyService,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness';

/**
 * Integration coverage for manual capture, void, and operation-level
 * idempotency.
 *
 * Two invariants are under test here:
 *
 *  1. An offering configured `capture_mode: manual` authorises without
 *     taking the money, and the money only moves when the merchant
 *     captures. Getting this wrong charges a customer at checkout for a
 *     payment the merchant meant to review first.
 *
 *  2. A retried mutation produces one effect, not two. The guarantee is
 *     the unique constraint on payment_idempotency_records, so these run
 *     against a real database with real concurrent connections — a stub
 *     would assert nothing about it.
 */

const SLUG = 'spec-store';
const REF = 'pi_capture_spec';

interface Fixture {
  storeId: bigint;
  variantId: bigint;
  manualOfferingId: bigint;
  autoOfferingId: bigint;
  codOfferingId: bigint;
  gatewayAccountId: bigint;
  codAccountId: bigint;
}

/** What the stubbed adapter reports back, and what it was asked. */
interface AdapterSpy {
  captureMethods: (CaptureMode | undefined)[];
  captureCalls: CaptureInput[];
  voidCalls: number;
  /** Cumulative captured totals the provider will report, in order. */
  captureQueue: bigint[];
  captureError: Error | null;
}

let spy: AdapterSpy;

function resetSpy(): void {
  spy = {
    captureMethods: [],
    captureCalls: [],
    voidCalls: 0,
    captureQueue: [],
    captureError: null,
  };
}

/**
 * A Stripe-shaped adapter.
 *
 * `initializePayment` mirrors the real one: manual capture yields an
 * authorisation, automatic yields an immediate capture. That is what
 * makes the capture-mode assertions meaningful rather than circular.
 */
function fakeRegistry(fx: () => Fixture) {
  const gatewayAdapter = {
    capabilities: {
      gateway: 'stripe',
      methods: ['card'],
      currencies: 'all' as const,
      exponentOverrides: {},
      automaticCapture: true,
      manualCapture: true,
      partialCapture: true,
      multiCapture: false,
      refundSupported: true,
      partialRefund: true,
      voidSupported: true,
      authorizationExpiry: false,
      vaulting: false,
      merchantInitiated: false,
      threeDSecure: false,
      webhooks: true,
      statusPolling: true,
      settlementReports: false,
      webhookResolution: 'endpoint_scoped' as const,
      nextActionKinds: ['client_sdk' as const],
      offlineCommitmentKind: null,
    },
    validateCredentials: async () => ({ valid: true }),
    initializePayment: async (
      context: PaymentCallContext,
    ): Promise<InitializeResult> => {
      spy.captureMethods.push(context.captureMethod);

      if (context.captureMethod === 'manual') {
        return {
          kind: 'authorized',
          authorizedAmountMinor: context.amountMinor,
          refs: { gatewayReference: REF, gatewayPaymentId: REF },
        };
      }

      return {
        kind: 'succeeded',
        capturedAmountMinor: context.amountMinor,
        refs: { gatewayReference: REF, gatewayPaymentId: REF },
      };
    },
    fetchStatus: async () => [],
    parseWebhook: async () => [],
    capture: async (input: CaptureInput): Promise<ObservedFact[]> => {
      spy.captureCalls.push(input);
      if (spy.captureError) throw spy.captureError;
      const cumulative = spy.captureQueue.shift() ?? input.amountMinor;
      return [captureFact(fx(), cumulative)];
    },
    voidAuthorization: async (): Promise<ObservedFact[]> => {
      spy.voidCalls += 1;
      return [voidFact(fx())];
    },
    refund: async (): Promise<ObservedFact[]> => [refundFact(fx(), 5000n)],
  };

  const codAdapter = {
    capabilities: {
      ...gatewayAdapter.capabilities,
      gateway: 'cod',
      methods: ['cod'],
      manualCapture: false,
      partialCapture: false,
      partialRefund: false,
      voidSupported: false,
      webhooks: false,
      statusPolling: false,
      webhookResolution: 'none' as const,
      offlineCommitmentKind: 'promise_accepted' as const,
    },
    validateCredentials: async () => ({ valid: true }),
    initializePayment: async (): Promise<InitializeResult> => ({
      kind: 'no_gateway',
      commitmentKind: 'promise_accepted',
    }),
    fetchStatus: async () => [],
  };

  const byGateway: Record<string, unknown> = {
    stripe: gatewayAdapter,
    cod: codAdapter,
  };

  return {
    has: (gateway: string) => gateway in byGateway,
    get: (gateway: string) => byGateway[gateway],
    assertCanHandle: (input: { gateway: string }) => byGateway[input.gateway],
  } as never;
}

function captureFact(fx: Fixture, cumulativeMinor: bigint): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference: REF,
      factType: 'attempt_captured',
      cumulativeAmountMinor: cumulativeMinor,
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference: REF,
    factType: 'attempt_captured',
    cumulativeAmountMinor: cumulativeMinor,
    currency: 'USD',
    refs: { gatewayCaptureRef: `ch_${cumulativeMinor}` },
  };
}

function voidFact(fx: Fixture): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference: REF,
      factType: 'attempt_voided',
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference: REF,
    factType: 'attempt_voided',
    currency: 'USD',
  };
}

function refundFact(fx: Fixture, cumulativeMinor: bigint): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference: REF,
      factType: 'refund_succeeded',
      cumulativeAmountMinor: cumulativeMinor,
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference: REF,
    factType: 'refund_succeeded',
    cumulativeAmountMinor: cumulativeMinor,
    currency: 'USD',
    refs: { gatewayCaptureRef: `re_${cumulativeMinor}` },
  };
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({ secret_key: 'sk_test' }),
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

describe('Capture / void / operation idempotency (integration)', () => {
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let applier: PaymentFactApplier;
  let captures: PaymentCaptureService;
  let refunds: RefundService;
  let collection: PaymentCollectionService;
  let cancellation: OrderCancellationService;
  let checkout: CheckoutService;
  let fx: Fixture;

  let intentCounter = 70_000n;

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

    captures = new PaymentCaptureService(
      prisma as never,
      fakeRegistry(() => fx),
      fakeAccounts,
      applier,
      idempotency,
    );
    refunds = new RefundService(
      prisma as never,
      fakeRegistry(() => fx),
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
    cancellation = new OrderCancellationService(
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
      fakeRegistry(() => fx),
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
    resetSpy();
    fx = await seed(prisma);
  });

  /** Places a card order against the given offering and returns its id. */
  async function placeCardOrder(offeringId: bigint): Promise<string> {
    await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: offeringId.toString(),
    });

    const order = await withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.order.findFirstOrThrow({}),
    );

    return order.id.toString();
  }

  async function placeCodOrder(): Promise<string> {
    const result = await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.codOfferingId.toString(),
    });

    return result.order!.id;
  }

  function readIntent() {
    return withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.paymentIntent.findFirstOrThrow({}),
    );
  }

  /* ================================================================ */

  describe('capture mode', () => {
    it('leaves automatic capture behaving exactly as before', async () => {
      const orderId = await placeCardOrder(fx.autoOfferingId);

      expect(spy.captureMethods).toEqual(['automatic']);

      const intent = await readIntent();
      expect(intent.capture_method).toBe('automatic');
      expect(intent.status).toBe('captured');
      expect(intent.captured_total_minor).toBe(5000n);

      const order = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.order.findFirstOrThrow({ where: { id: BigInt(orderId) } }),
      );
      expect(order.payment_status).toBe('PAID');
    });

    it('tells the adapter to capture manually when the merchant configured manual', async () => {
      await placeCardOrder(fx.manualOfferingId);

      expect(spy.captureMethods).toEqual(['manual']);
    });

    it('authorises without taking the money under manual capture', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const intent = await readIntent();
      expect(intent.capture_method).toBe('manual');
      expect(intent.status).toBe('authorized');
      expect(intent.captured_total_minor).toBe(0n);

      // The order exists — funds are secured — but is not paid.
      const order = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.order.findFirstOrThrow({ where: { id: BigInt(orderId) } }),
      );
      expect(order.payment_status).toBe('UNPAID');

      // Nothing captured means nothing in the gateway receivable yet.
      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(0n);
    });
  });

  describe('capture', () => {
    it('captures an authorised payment in full', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const result = await captures.captureOrder(fx.storeId, orderId);

      expect(result.applied).toBe(true);
      expect(result.captured_amount_minor).toBe('5000');
      expect(result.captured_total_minor).toBe('5000');
      expect(result.payment_status).toBe('captured');

      const order = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.order.findFirstOrThrow({ where: { id: BigInt(orderId) } }),
      );
      expect(order.payment_status).toBe('PAID');
    });

    it('asks the provider for the authorised amount by default', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      await captures.captureOrder(fx.storeId, orderId);

      expect(spy.captureCalls).toHaveLength(1);
      expect(spy.captureCalls[0].amountMinor).toBe(5000n);
      expect(spy.captureCalls[0].gatewayReference).toBe(REF);
    });

    it('posts the captured money to the gateway receivable', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);
      await captures.captureOrder(fx.storeId, orderId);

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

    it('supports a partial capture', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);
      spy.captureQueue = [2000n];

      const result = await captures.captureOrder(fx.storeId, orderId, {
        amountMinor: 2000n,
      });

      expect(result.payment_status).toBe('partially_captured');
      expect(result.captured_total_minor).toBe('2000');
      expect(spy.captureCalls[0].amountMinor).toBe(2000n);
    });

    it('sends a deterministic provider idempotency key', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);
      await captures.captureOrder(fx.storeId, orderId);

      expect(spy.captureCalls[0].idempotencyKey).toMatch(/^psp:/);
      expect(spy.captureCalls[0].idempotencyKey).toContain('capture:5000');
    });
  });

  describe('void', () => {
    it('voids an authorised payment', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const result = await captures.voidOrder(fx.storeId, orderId);

      expect(result.applied).toBe(true);
      expect(result.payment_status).toBe('cancelled');
      expect(spy.voidCalls).toBe(1);

      const intent = await readIntent();
      expect(intent.status).toBe('cancelled');
      expect(intent.captured_total_minor).toBe(0n);
    });

    it('moves no money when voiding', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);
      await captures.voidOrder(fx.storeId, orderId);

      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(0n);

      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });
  });

  describe('invalid state transitions', () => {
    it('refuses to capture a payment that was already captured', async () => {
      const orderId = await placeCardOrder(fx.autoOfferingId);

      await expect(
        captures.captureOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to capture more than was authorised', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      await expect(
        captures.captureOrder(fx.storeId, orderId, { amountMinor: 9000n }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(spy.captureCalls).toHaveLength(0);
    });

    it('refuses to void a payment that was already captured', async () => {
      const orderId = await placeCardOrder(fx.autoOfferingId);

      await expect(
        captures.voidOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(spy.voidCalls).toBe(0);
    });

    it('refuses to void a payment that was already voided', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);
      await captures.voidOrder(fx.storeId, orderId);

      await expect(
        captures.voidOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to capture on a gateway with no manual-capture support', async () => {
      const orderId = await placeCodOrder();

      await expect(
        captures.captureOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('idempotency', () => {
    it('replays a capture rather than capturing twice', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const first = await captures.captureOrder(fx.storeId, orderId, {
        idempotencyKey: 'cap-key-1',
      });
      const second = await captures.captureOrder(fx.storeId, orderId, {
        idempotencyKey: 'cap-key-1',
      });

      expect(second).toEqual(first);
      // One provider call, one capture row: the retry never reached Stripe.
      expect(spy.captureCalls).toHaveLength(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.capture.count()),
      ).toBe(1);
    });

    it('replays a void rather than voiding twice', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const first = await captures.voidOrder(fx.storeId, orderId, {
        idempotencyKey: 'void-key-1',
      });
      const second = await captures.voidOrder(fx.storeId, orderId, {
        idempotencyKey: 'void-key-1',
      });

      expect(second).toEqual(first);
      expect(spy.voidCalls).toBe(1);
    });

    it('replays a collection rather than collecting twice', async () => {
      const orderId = await placeCodOrder();

      const first = await collection.recordCollection(fx.storeId, orderId, {
        idempotencyKey: 'collect-key-1',
      });
      const second = await collection.recordCollection(fx.storeId, orderId, {
        idempotencyKey: 'collect-key-1',
      });

      expect(second).toEqual(first);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.capture.count()),
      ).toBe(1);
    });

    it('replays a cancellation rather than cancelling twice', async () => {
      const orderId = await placeCodOrder();

      const first = await cancellation.cancelOrder(fx.storeId, orderId, {
        idempotencyKey: 'cancel-key-1',
      });
      const second = await cancellation.cancelOrder(fx.storeId, orderId, {
        idempotencyKey: 'cancel-key-1',
      });

      expect(second).toEqual(first);
    });

    /*
     * ROUND 9 §11.12 — restock is a WRITE to inventory, so it needs the
     * same "exactly once" proof the decrement gets. Two DIFFERENT
     * idempotency keys on purpose: idempotency answers "same request?",
     * and this asserts the other mechanism — the compare-and-set on the
     * order's status, which is what stops a second cancellation
     * restocking a second time.
     */
    it('12 — a concurrent duplicate cancellation restocks exactly once', async () => {
      const orderId = await placeCodOrder();

      const beforeCancel = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });
      expect(beforeCancel.inventory_qty).toBe(8);

      const second = createAdditionalClient();

      try {
        const otherCancellation = new OrderCancellationService(
          second as never,
          new LedgerService(second as never),
          new OutboxService(),
          createTestIdempotencyService(second),
        );

        const results = await Promise.allSettled([
          cancellation.cancelOrder(fx.storeId, orderId, {
            idempotencyKey: 'cancel-race-a',
          }),
          otherCancellation.cancelOrder(fx.storeId, orderId, {
            idempotencyKey: 'cancel-race-b',
          }),
        ]);

        // One cancels; the other finds an already-cancelled order.
        expect(
          results.filter((r) => r.status === 'fulfilled').length,
        ).toBeGreaterThanOrEqual(1);

        // Back to where it started — exactly once. Twice would read 12.
        const after = await prisma.productVariant.findFirstOrThrow({
          where: { id: fx.variantId },
        });
        expect(after.inventory_qty).toBe(10);
      } finally {
        await second.$disconnect();
      }
    });

    it('replays a refund rather than refunding twice', async () => {
      const orderId = await placeCardOrder(fx.autoOfferingId);

      const first = await refunds.refundOrder(fx.storeId, orderId, {
        idempotencyKey: 'refund-key-1',
      });
      const second = await refunds.refundOrder(fx.storeId, orderId, {
        idempotencyKey: 'refund-key-1',
      });

      expect(second).toEqual(first);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.refund.count()),
      ).toBe(1);
    });

    it('rejects the same key carrying a different request', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      await captures.captureOrder(fx.storeId, orderId, {
        amountMinor: 2000n,
        idempotencyKey: 'cap-key-2',
      });

      // Same key, different amount: a client bug, not a retry.
      await expect(
        captures.captureOrder(fx.storeId, orderId, {
          amountMinor: 3000n,
          idempotencyKey: 'cap-key-2',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('keeps the key usable after a failed operation', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      spy.captureError = new Error('provider exploded');

      await expect(
        captures.captureOrder(fx.storeId, orderId, {
          idempotencyKey: 'cap-key-3',
        }),
      ).rejects.toThrow('provider exploded');

      // A failure must not poison the key into replaying a result that
      // never existed — the retry has to actually run.
      spy.captureError = null;

      const retried = await captures.captureOrder(fx.storeId, orderId, {
        idempotencyKey: 'cap-key-3',
      });

      expect(retried.applied).toBe(true);
      expect(spy.captureCalls).toHaveLength(2);
    });

    it('runs one operation only under a concurrent duplicate submission', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const second = createAdditionalClient();

      try {
        const otherCaptures = new PaymentCaptureService(
          second as never,
          fakeRegistry(() => fx),
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
          captures.captureOrder(fx.storeId, orderId, {
            idempotencyKey: 'cap-concurrent',
          }),
          otherCaptures.captureOrder(fx.storeId, orderId, {
            idempotencyKey: 'cap-concurrent',
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');

        // Whichever lost the race is rejected rather than executing: the
        // unique constraint on the idempotency record is what decides.
        expect(fulfilled).toHaveLength(1);
        expect(spy.captureCalls).toHaveLength(1);
        expect(
          await withTenant(prisma, fx.storeId, 'live', (tx) =>
            tx.capture.count(),
          ),
        ).toBe(1);
      } finally {
        await second.$disconnect();
      }
    });

    it('leaves an operation without a key working exactly as before', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      const result = await captures.captureOrder(fx.storeId, orderId);

      expect(result.applied).toBe(true);
      // No key means no record was written at all.
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) =>
          tx.paymentIdempotencyRecord.count(),
        ),
      ).toBe(0);
    });

    it('keeps keys separate per operation scope', async () => {
      const orderId = await placeCardOrder(fx.manualOfferingId);

      // The same key on two different operations must not collide: the
      // scope is part of the unique constraint.
      await captures.captureOrder(fx.storeId, orderId, {
        idempotencyKey: 'shared-key',
      });

      const refunded = await refunds.refundOrder(fx.storeId, orderId, {
        idempotencyKey: 'shared-key',
      });

      expect(refunded.applied).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_capture',
      email: 'spec_capture@example.test',
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
      handle: 'spec-capture',
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

  const gatewayAccount = await withTenant(prisma, store.id, 'live', (tx) =>
    tx.paymentAccount.create({
      data: {
        store_id: store.id,
        mode: 'live',
        gateway: 'stripe' as PaymentProviderKey,
        display_name: 'Default',
        status: 'active',
        settlement_currency: 'USD',
      },
      select: { id: true },
    }),
  );

  const codAccount = await withTenant(prisma, store.id, 'live', (tx) =>
    tx.paymentAccount.create({
      data: {
        store_id: store.id,
        mode: 'live',
        gateway: 'cod' as PaymentProviderKey,
        display_name: 'Default',
        status: 'active',
        settlement_currency: 'USD',
      },
      select: { id: true },
    }),
  );

  const makeOffering = (
    accountId: bigint,
    method: string,
    captureMode: CaptureMode,
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
          gateway_method_config: `cfg-${position}`,
          enabled: true,
          position,
          commitment_kind: commitment,
          capture_mode: captureMode,
        },
        select: { id: true },
      }),
    );

  const manualOffering = await makeOffering(
    gatewayAccount.id,
    'card',
    'manual',
    'funds_secured' as CommitmentKind,
    0,
  );

  const autoOffering = await makeOffering(
    gatewayAccount.id,
    'card',
    'automatic',
    'funds_secured' as CommitmentKind,
    1,
  );

  const codOffering = await makeOffering(
    codAccount.id,
    'cod',
    'automatic',
    'promise_accepted' as CommitmentKind,
    2,
  );

  return {
    storeId: store.id,
    variantId: variant.id,
    manualOfferingId: manualOffering.id,
    autoOfferingId: autoOffering.id,
    codOfferingId: codOffering.id,
    gatewayAccountId: gatewayAccount.id,
    codAccountId: codAccount.id,
  };
}

import { appConfigStub } from '../../../test/config.stub';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client';
import { PaymentFactApplier } from './facts/payment-fact.applier';
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from './facts/checkout-succession-funds.service';
import { CheckoutService } from '../checkout/checkout.service';
import { PaymentQueryService } from './payment-query.service';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import { factsFromEvent } from './gateways/adapters/stripe/stripe-fact-map';
import {
  buildFactDedupeKey,
  type InitializeResult,
  type ObservedFact,
} from './gateways/provider.types';
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness';

/**
 * Integration coverage for the dispute lifecycle.
 *
 * A dispute moves real money twice — once when the provider withholds it
 * and once when the outcome lands — and both movements are driven by
 * events that providers redeliver freely. The invariants under test are
 * that each transition posts exactly one balanced entry, that a
 * redelivery posts none, and that a resolution can never fire without a
 * matching hold (which would drive disputes_held negative).
 */

const SLUG = 'spec-store';
const REF = 'pi_dispute_spec';
const DISPUTE_REF = 'dp_1';

interface Fixture {
  storeId: bigint;
  variantId: bigint;
  offeringId: bigint;
  accountId: bigint;
}

const gatewayResult: InitializeResult = {
  kind: 'succeeded',
  capturedAmountMinor: 5000n,
  refs: { gatewayReference: REF, gatewayPaymentId: REF },
};

function fakeRegistry() {
  const adapter = {
    capabilities: {
      gateway: 'stripe',
      methods: ['card'],
      currencies: 'all' as const,
      exponentOverrides: {},
      manualCapture: true,
      partialCapture: true,
      multiCapture: false,
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
      offlineCommitmentKind: null,
    },
    validateCredentials: async () => ({ valid: true }),
    initializePayment: async () => gatewayResult,
    fetchStatus: async () => [],
    parseWebhook: async () => [],
  };

  return {
    has: (gateway: string) => gateway === 'stripe',
    get: () => adapter,
    assertCanHandle: () => adapter,
  } as never;
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({ secret_key: 'sk_test' }),
} as never;

/**
 * Dispute facts built through the real Stripe mapper.
 *
 * Going through factsFromEvent rather than hand-rolling an ObservedFact
 * is deliberate: it means these tests also cover the event mapping, so a
 * change to either side cannot drift unnoticed.
 */
function disputeEvent(
  type: 'charge.dispute.created' | 'charge.dispute.closed',
  options: {
    status?: string;
    amount?: number;
    disputeId?: string;
    eventId?: string;
  } = {},
) {
  return {
    id: options.eventId ?? `evt_${type}_${options.status ?? 'new'}`,
    type,
    created: 1_700_000_000,
    data: {
      object: {
        id: options.disputeId ?? DISPUTE_REF,
        payment_intent: REF,
        currency: 'usd',
        amount: options.amount ?? 5000,
        status: options.status ?? 'needs_response',
        reason: 'fraudulent',
      },
    },
  };
}

function factFor(
  accountId: bigint,
  type: 'charge.dispute.created' | 'charge.dispute.closed',
  options: Parameters<typeof disputeEvent>[1] = {},
): ObservedFact {
  const [fact] = factsFromEvent({
    accountId,
    event: disputeEvent(type, options),
  });
  return fact;
}

function captureFact(accountId: bigint, amountMinor: bigint): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId,
      gatewayReference: REF,
      factType: 'attempt_captured',
      cumulativeAmountMinor: amountMinor,
      currency: 'USD',
    }),
    accountId,
    gatewayReference: REF,
    factType: 'attempt_captured',
    cumulativeAmountMinor: amountMinor,
    currency: 'USD',
  };
}

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

describe('Disputes (integration)', () => {
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let applier: PaymentFactApplier;
  let checkout: CheckoutService;
  let query: PaymentQueryService;
  let fx: Fixture;

  let intentCounter = 130_000n;

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
    query = new PaymentQueryService(prisma as never, ledger);
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
      fakeRegistry(),
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
    fx = await seed(prisma);

    // A captured card payment: 2 x 25.00, taken in full.
    await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });
  });

  function balance(accountType: string, paymentAccountId?: bigint) {
    return ledger.balance({
      storeId: fx.storeId,
      mode: 'live',
      currency: 'USD',
      accountType: accountType as never,
      ...(paymentAccountId === undefined ? {} : { paymentAccountId }),
    });
  }

  function disputes() {
    return withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.dispute.findMany({ orderBy: { id: 'asc' } }),
    );
  }

  function entriesOfType(type: string) {
    return withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.journalEntry.findMany({ where: { entry_type: type } }),
    );
  }

  const open = () => applier.apply(factFor(fx.accountId, 'charge.dispute.created'), 'webhook');

  const resolve = (status: 'won' | 'lost', eventId?: string) =>
    applier.apply(
      factFor(fx.accountId, 'charge.dispute.closed', { status, eventId }),
      'webhook',
    );

  /* ================================================================ */

  describe('opened', () => {
    it('holds the disputed amount against the gateway receivable', async () => {
      // The capture put 5000 into psp_receivable.
      expect(await balance('psp_receivable', fx.accountId)).toBe(5000n);

      const result = await open();

      expect(result.outcome).toBe('applied');
      expect(await balance('disputes_held')).toBe(5000n);
      expect(await balance('psp_receivable', fx.accountId)).toBe(0n);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('records the dispute against the intent, capture and order context', async () => {
      await open();

      const [dispute] = await disputes();

      expect(dispute.amount_minor).toBe(5000n);
      expect(dispute.currency).toBe('USD');
      expect(dispute.status).toBe('open');
      expect(dispute.reason).toBe('fraudulent');
      expect(dispute.gateway_dispute_ref).toBe(DISPUTE_REF);
      expect(dispute.store_id).toBe(fx.storeId);
      expect(dispute.mode).toBe('live');
      // Linked to the capture the disputed money came from.
      expect(dispute.capture_id).not.toBeNull();
      expect(dispute.resolved_at).toBeNull();
    });

    it('leaves the sale and the payment itself untouched', async () => {
      await open();

      // A dispute is not a refund: revenue stands until it is lost, and
      // even then it is an expense rather than a reversal.
      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('captured');
      expect(intent.captured_total_minor).toBe(5000n);
      expect(intent.refunded_total_minor).toBe(0n);
    });

    it('is idempotent on redelivery', async () => {
      await open();
      const second = await open();

      expect(second.outcome).toBe('duplicate');
      expect(await disputes()).toHaveLength(1);
      expect(await balance('disputes_held')).toBe(5000n);
      expect(await entriesOfType('payment.dispute.open')).toHaveLength(1);
    });

    it('does not open twice when the same dispute arrives under a new event', async () => {
      await open();

      // Different event id, same dispute: the fact dedupe key differs, so
      // only the dispute row's own uniqueness stops a second hold.
      const second = await applier.apply(
        factFor(fx.accountId, 'charge.dispute.created', {
          eventId: 'evt_again',
          amount: 5000,
        }),
        'reconciliation',
      );

      expect(second.outcome).toBe('duplicate');
      expect(await disputes()).toHaveLength(1);
      expect(await balance('disputes_held')).toBe(5000n);
    });

    it('refuses a dispute with no amount to hold', async () => {
      const fact = factFor(fx.accountId, 'charge.dispute.created');

      const result = await applier.apply(
        { ...fact, cumulativeAmountMinor: undefined },
        'webhook',
      );

      expect(result.outcome).toBe('ignored');
      expect(result.reason).toBe('amount_missing');
      expect(await disputes()).toHaveLength(0);
    });
  });

  describe('won', () => {
    it('releases the hold back to the gateway receivable', async () => {
      await open();

      const result = await resolve('won');

      expect(result.outcome).toBe('applied');
      expect(await balance('disputes_held')).toBe(0n);
      expect(await balance('psp_receivable', fx.accountId)).toBe(5000n);
      expect(await balance('chargeback_loss')).toBe(0n);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('marks the dispute won and stamps the resolution', async () => {
      await open();
      await resolve('won');

      const [dispute] = await disputes();
      expect(dispute.status).toBe('won');
      expect(dispute.resolved_at).not.toBeNull();
    });

    it('is idempotent on redelivery', async () => {
      await open();
      await resolve('won');

      const second = await resolve('won');

      expect(second.outcome).toBe('duplicate');
      expect(await balance('psp_receivable', fx.accountId)).toBe(5000n);
      expect(await entriesOfType('payment.dispute.won')).toHaveLength(1);
    });
  });

  describe('lost', () => {
    it('writes the held amount off as a chargeback loss', async () => {
      await open();

      const result = await resolve('lost');

      expect(result.outcome).toBe('applied');
      expect(await balance('disputes_held')).toBe(0n);
      expect(await balance('chargeback_loss')).toBe(5000n);
      // The money never comes back, so the receivable stays cleared.
      expect(await balance('psp_receivable', fx.accountId)).toBe(0n);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('leaves revenue on the books', async () => {
      await open();
      await resolve('lost');

      // balance() is signed debit-minus-credit, so revenue reads negative.
      // The sale happened; the loss sits beside it as an expense.
      const beneficiary = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.beneficiary.findFirstOrThrow({}),
      );

      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'sales_revenue',
          beneficiaryId: beneficiary.id,
        }),
      ).toBe(-5000n);
    });

    it('is idempotent on redelivery', async () => {
      await open();
      await resolve('lost');

      const second = await resolve('lost');

      expect(second.outcome).toBe('duplicate');
      expect(await balance('chargeback_loss')).toBe(5000n);
      expect(await entriesOfType('payment.dispute.lost')).toHaveLength(1);
    });
  });

  describe('invalid transitions', () => {
    it('refuses to resolve a dispute that was never opened', async () => {
      const result = await resolve('lost');

      expect(result.outcome).toBe('ignored');
      expect(result.reason).toBe('dispute_not_open');
      // Nothing posted: a write-off with no hold would drive
      // disputes_held negative.
      expect(await balance('chargeback_loss')).toBe(0n);
      expect(await balance('disputes_held')).toBe(0n);
    });

    it('refuses to lose a dispute that was already won', async () => {
      await open();
      await resolve('won');

      const result = await resolve('lost', 'evt_late_loss');

      expect(result.outcome).toBe('duplicate');
      expect(await balance('chargeback_loss')).toBe(0n);
      expect(await balance('psp_receivable', fx.accountId)).toBe(5000n);
    });

    it('refuses to win a dispute that was already lost', async () => {
      await open();
      await resolve('lost');

      const result = await resolve('won', 'evt_late_win');

      expect(result.outcome).toBe('duplicate');
      expect(await balance('psp_receivable', fx.accountId)).toBe(0n);
      expect(await balance('chargeback_loss')).toBe(5000n);
    });

    it('records a close with no outcome without moving money', async () => {
      await open();

      const result = await applier.apply(
        factFor(fx.accountId, 'charge.dispute.closed', {
          status: 'warning_closed',
        }),
        'webhook',
      );

      // Recognised, recorded, but not a financial outcome.
      expect(result.outcome).toBe('recorded');
      expect(await balance('disputes_held')).toBe(5000n);
      expect((await disputes())[0].status).toBe('open');
    });
  });

  describe('concurrency and isolation', () => {
    it('posts one effect when the same outcome arrives twice at once', async () => {
      await open();

      const second = createAdditionalClient();

      try {
        const otherApplier = new PaymentFactApplier(
          second as never,
          new LedgerService(second as never),
          new OutboxService(),
          new CheckoutFinalizerService(second as never, new OutboxService()),
          new CheckoutSuccessionFundsService(),
        );

        const results = await Promise.allSettled([
          resolve('lost'),
          otherApplier.apply(
            factFor(fx.accountId, 'charge.dispute.closed', {
              status: 'lost',
              eventId: 'evt_concurrent',
            }),
            'reconciliation',
          ),
        ]);

        const applied = results.filter(
          (r) => r.status === 'fulfilled' && r.value.outcome === 'applied',
        );

        expect(applied).toHaveLength(1);
        expect(await balance('chargeback_loss')).toBe(5000n);
        expect(await ledger.findUnbalancedEntries()).toEqual([]);
      } finally {
        await second.$disconnect();
      }
    });

    it('keeps a dispute invisible to another tenant', async () => {
      await open();

      const otherStore = fx.storeId + 5_000n;

      const visible = await withTenant(prisma, otherStore, 'live', (tx) =>
        tx.dispute.findMany({}),
      );

      expect(visible).toHaveLength(0);
    });

    it('keeps a dispute invisible in the other mode', async () => {
      await open();

      const visible = await withTenant(prisma, fx.storeId, 'test', (tx) =>
        tx.dispute.findMany({}),
      );

      expect(visible).toHaveLength(0);
    });

    it('never posts a dispute entry across stores or modes', async () => {
      await open();
      await resolve('lost');

      const entries = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.journalEntry.findMany({
          where: { source_kind: 'dispute' },
        }),
      );

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.store_id).toBe(fx.storeId);
        expect(entry.mode).toBe('live');
      }
    });
  });

  describe('merchant visibility', () => {
    it('surfaces disputes on the existing payment trail', async () => {
      await open();

      const order = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.order.findFirstOrThrow({}),
      );

      const trail = await query.orderPayment(
        fx.storeId,
        order.id.toString(),
        'live',
      );

      expect(trail.disputes).toHaveLength(1);
      expect(trail.disputes[0]).toMatchObject({
        status: 'open',
        amount_minor: '5000',
        currency: 'USD',
        reference: DISPUTE_REF,
      });
    });
  });
});

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_dispute',
      email: 'spec_dispute@example.test',
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
      handle: 'spec-dispute',
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

  const account = await withTenant(prisma, store.id, 'live', (tx) =>
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

  const offering = await withTenant(prisma, store.id, 'live', (tx) =>
    tx.paymentMethodOffering.create({
      data: {
        account_id: account.id,
        store_id: store.id,
        mode: 'live',
        method: 'card' as PaymentMethodKey,
        enabled: true,
        position: 0,
        commitment_kind: 'funds_secured' as CommitmentKind,
        capture_mode: 'automatic',
      },
      select: { id: true },
    }),
  );

  return {
    storeId: store.id,
    variantId: variant.id,
    offeringId: offering.id,
    accountId: account.id,
  };
}

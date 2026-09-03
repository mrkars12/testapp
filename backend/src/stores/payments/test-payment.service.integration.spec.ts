import { PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { TestPaymentService } from './test-payment.service';
import { PaymentFactApplier } from './facts/payment-fact.applier';
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from './facts/checkout-succession-funds.service';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
  withTestTenant,
} from '../../../test/db-test-harness';
import type { Prisma } from '@prisma/client';
import type {
  FetchStatusInput,
  InitializeResult,
  ObservedFact,
  PaymentCallContext,
} from './gateways/provider.types';

/**
 * Integration coverage for merchant-only test payments — proving the
 * central guarantee: this flow never creates an Order, no matter the
 * outcome, and is fully store-isolated.
 *
 * Uses a controllable fake provider (same pattern as
 * checkout.service.integration.spec.ts's fakeRegistry) so each test
 * dictates the exact outcome (succeeded/failed/requires_action) without
 * any real network call — the provider-facing contract
 * (`initializePayment`/`fetchStatus`) is exercised for real; only the
 * actual gateway HTTP call is faked, exactly like the checkout spec
 * fakes cash-on-delivery's "provider".
 */

const SLUG = 'test-payment-spec-store';

/** Like withTestTenant, but installs app.mode = 'test' for RLS. */
async function withTestTenantTestMode<T>(
  prisma: PrismaClient,
  storeId: bigint,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.store_id', ${storeId.toString()}, true),
             set_config('app.mode', 'test', true)
    `;
    return callback(tx);
  });
}

let nextResult: InitializeResult = {
  kind: 'succeeded',
  capturedAmountMinor: 100n,
  refs: { gatewayReference: 'ref_1', gatewayPaymentId: 'pi_1' },
};
let nextStatusFacts: ObservedFact[] = [];
let lastInitializeContext: PaymentCallContext | null = null;

const fakeProvider = {
  capabilities: { statusPolling: true } as any,
  initializePayment: async (ctx: PaymentCallContext) => {
    lastInitializeContext = ctx;
    return nextResult;
  },
  fetchStatus: async (_input: FetchStatusInput) => nextStatusFacts,
} as any;

const fakeRegistry = {
  has: (gateway: string) => gateway === 'stripe',
  get: () => fakeProvider,
  assertCanHandle: () => fakeProvider,
} as never;

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({ secret_key: 'sk_test_fake' }),
} as never;

let reservedId = 900_000n;
const fakeIds = { reserve: async () => ++reservedId } as never;

describe('TestPaymentService (integration)', () => {
  let prisma: PrismaClient;
  let service: TestPaymentService;
  let storeId: bigint;
  let accountId: bigint;

  beforeAll(async () => {
    prisma = await startTestDatabase();

    service = new TestPaymentService(
      prisma as never,
      fakeAccounts,
      fakeRegistry,
      fakeIds,
      new PaymentFactApplier(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        new CheckoutFinalizerService(prisma as never, new OutboxService()),
        new CheckoutSuccessionFundsService(),
      ),
    );
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    nextResult = {
      kind: 'succeeded',
      capturedAmountMinor: 100n,
      refs: { gatewayReference: `ref_${Date.now()}`, gatewayPaymentId: `pi_${Date.now()}` },
    };
    nextStatusFacts = [];
    lastInitializeContext = null;

    const user = await prisma.users.create({
      data: {
        username: `tpspec_${Date.now()}`,
        email: `tpspec_${Date.now()}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });

    const store = await prisma.store.create({
      data: {
        name: 'Test Payment Spec Store',
        slug: `${SLUG}-${Date.now()}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    storeId = store.id;

    const account = await withTestTenantTestMode(prisma, storeId, (tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: storeId,
          mode: 'test',
          gateway: 'stripe',
          display_name: 'Default',
          status: 'active',
          settlement_currency: 'USD',
        },
        select: { id: true },
      }),
    );
    accountId = account.id;

    await withTestTenantTestMode(prisma, storeId, (tx) =>
      tx.paymentMethodOffering.create({
        data: {
          account_id: accountId,
          store_id: storeId,
          mode: 'test',
          method: 'card',
          enabled: true,
          position: 0,
          commitment_kind: 'funds_secured',
          capture_mode: 'automatic',
        },
      }),
    );
  });

  it('a successful test payment does not create an Order', async () => {
    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    expect(result.status).toBe('captured');

    const orders = await withTestTenant(storeId, (tx) => tx.order.findMany({}));
    expect(orders).toHaveLength(0);
  });

  it('embeds the authoritative token into the return URL handed to the provider', async () => {
    // Regression: the merchant used to be sent back to the TEST start
    // page with no token at all, because the return_url was forwarded to
    // the adapter verbatim. The token must be appended server-side (the
    // same one this call returns and that `sync`/`status` key off of),
    // mirroring how checkout.service.ts embeds `checkoutToken` before its
    // own adapter call — never a second, independently-generated token.
    const result = await service.initiate(storeId, 'USD', {
      gateway: 'stripe',
      return_url: 'https://merchant.example/stores-building/settings/payments/test/result',
    });

    expect(lastInitializeContext?.returnUrl).toBeTruthy();
    const returnUrl = new URL(lastInitializeContext!.returnUrl!);
    expect(returnUrl.pathname).toBe(
      '/stores-building/settings/payments/test/result',
    );
    expect(returnUrl.searchParams.get('token')).toBe(result.token);
  });

  it('a failed test payment does not create an Order', async () => {
    nextResult = { kind: 'failed', errorCode: 'declined_do_not_honor' };

    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    expect(result.status).toBe('failed');
    expect(result.error_code).toBe('declined_do_not_honor');
    // The merchant-visible reason must be a human sentence, never the bare
    // code and never the literal string "unknown".
    expect(result.failure_message).toBeTruthy();
    expect(result.failure_message).not.toBe('declined_do_not_honor');
    expect(result.failure_message).not.toBe('unknown');

    const orders = await withTestTenant(storeId, (tx) => tx.order.findMany({}));
    expect(orders).toHaveLength(0);
  });

  it('never shows the literal string "unknown" as a failure reason', async () => {
    nextResult = { kind: 'failed', errorCode: 'unknown' };

    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    expect(result.status).toBe('failed');
    expect(result.error_code).toBe('unknown');
    expect(result.failure_message).toBeTruthy();
    expect(result.failure_message).not.toBe('unknown');
  });

  it('never decrements inventory or touches OrderItem', async () => {
    await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    const items = await withTestTenant(storeId, (tx) => tx.orderItem.findMany({}));
    expect(items).toHaveLength(0);
  });

  it('creates no ledger/revenue postings', async () => {
    await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    const entries = await withTestTenant(storeId, (tx) => tx.journalEntry.findMany({}));
    expect(entries).toHaveLength(0);
  });

  it('a requires_action result stays pending until the actual result is known', async () => {
    nextResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'secret_x', sdkHints: { publishable_key: 'pk_test_x' } },
      refs: { gatewayReference: 'ref_pending', gatewayPaymentId: 'pi_pending' },
    };

    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });
    expect(result.status).toBe('requires_action');
    expect(result.next_action?.kind).toBe('client_sdk');

    // The provider hasn't concluded — sync must not fabricate an outcome.
    nextStatusFacts = [];
    const synced = await service.sync(storeId, result.token);
    expect(synced.status).toBe('requires_action');
  });

  it('sync reflects the real provider result — not a client-asserted one', async () => {
    nextResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'secret_y', sdkHints: { publishable_key: 'pk_test_y' } },
      refs: { gatewayReference: 'ref_sync', gatewayPaymentId: 'pi_sync' },
    };
    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });
    expect(result.status).toBe('requires_action');

    // The provider now reports the real captured fact.
    nextStatusFacts = [
      {
        dedupeKey: 'fact:sync:1',
        accountId,
        gatewayReference: 'ref_sync',
        factType: 'attempt_captured',
        cumulativeAmountMinor: 100n,
        currency: 'USD',
        refs: { gatewayReference: 'ref_sync', gatewayPaymentId: 'pi_sync' },
      },
    ];

    const synced = await service.sync(storeId, result.token);
    expect(synced.status).toBe('captured');

    // Still no Order — the fact applier only creates one for
    // context_kind 'checkout', never 'manual'.
    const orders = await withTestTenant(storeId, (tx) => tx.order.findMany({}));
    expect(orders).toHaveLength(0);
  });

  it('sync resolves a declined/rejected attempt to FAILURE, not stuck pending', async () => {
    nextResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'secret_z', sdkHints: { publishable_key: 'pk_test_z' } },
      refs: { gatewayReference: 'ref_declined', gatewayPaymentId: 'pi_declined' },
    };
    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });
    expect(result.status).toBe('requires_action');

    // What the real Stripe adapter now reports for a declined TEST
    // confirmation (requires_payment_method + last_payment_error) —
    // see stripe-fact-map.spec's "reports a failure" case.
    nextStatusFacts = [
      {
        dedupeKey: 'fact:sync:declined',
        accountId,
        gatewayReference: 'ref_declined',
        factType: 'attempt_failed',
        currency: 'USD',
        rawRedacted: { message: 'Your card was declined.' },
      },
    ];

    const synced = await service.sync(storeId, result.token);
    expect(synced.status).toBe('failed');
    expect(synced.attempt_status).toBe('failed');

    const orders = await withTestTenant(storeId, (tx) => tx.order.findMany({}));
    expect(orders).toHaveLength(0);
  });

  it('polling stays idempotent across repeated syncs of the same terminal fact', async () => {
    nextResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'secret_dup', sdkHints: { publishable_key: 'pk_test_dup' } },
      refs: { gatewayReference: 'ref_dup', gatewayPaymentId: 'pi_dup' },
    };
    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    nextStatusFacts = [
      {
        dedupeKey: 'fact:sync:dup',
        accountId,
        gatewayReference: 'ref_dup',
        factType: 'attempt_captured',
        cumulativeAmountMinor: 100n,
        currency: 'USD',
        refs: { gatewayReference: 'ref_dup', gatewayPaymentId: 'pi_dup' },
      },
    ];

    const first = await service.sync(storeId, result.token);
    expect(first.status).toBe('captured');

    // A second poll delivering the identical fact (e.g. the browser
    // retried, or a redelivered webhook races the poll) must not double
    // apply or move the state a second time.
    const second = await service.sync(storeId, result.token);
    expect(second.status).toBe('captured');

    const orders = await withTestTenant(storeId, (tx) => tx.order.findMany({}));
    expect(orders).toHaveLength(0);
  });

  it('a merchant from another store cannot read this store’s test result (store isolation)', async () => {
    const result = await service.initiate(storeId, 'USD', { gateway: 'stripe' });

    const otherUser = await prisma.users.create({
      data: {
        username: `other_${Date.now()}`,
        email: `other_${Date.now()}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    });
    const otherStore = await prisma.store.create({
      data: {
        name: 'Other Store',
        slug: `other-${Date.now()}`,
        currency: 'USD',
        ownerId: otherUser.id,
        updatedAt: new Date(),
      },
      select: { id: true },
    });

    await expect(service.status(otherStore.id, result.token)).rejects.toThrow(NotFoundException);
    await expect(service.sync(otherStore.id, result.token)).rejects.toThrow(NotFoundException);
  });

  it('a token that never went through this flow is rejected, not forged into a result', async () => {
    await expect(service.status(storeId, 'not-a-real-token')).rejects.toThrow(NotFoundException);
    await expect(service.status(storeId, 'mtest:00000000000000000000000000000000')).rejects.toThrow(
      NotFoundException,
    );
  });
});

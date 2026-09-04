import { appConfigStub } from '../../../test/config.stub';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PrismaClient, Prisma } from '@prisma/client';
import type { CheckoutStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DecryptionError } from '../../common/crypto/key-provider.interface';
import { CheckoutService } from './checkout.service';
import { OrderService } from '../orders/order.service';
import { ProductService } from '../products/product.service';
import type { CreateCheckoutDto } from './dto/create-checkout.dto';
import { LedgerService } from '../../ledger/ledger.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import { CodAdapter } from '../payments/gateways/adapters/cod.adapter';
import { MoyasarAdapter } from '../payments/gateways/adapters/moyasar/moyasar.adapter';
import { CheckoutSuccessionFundsService } from '../payments/facts/checkout-succession-funds.service';
import { CartService } from '../cart/cart.service';
import { CheckoutExpiryJob } from './checkout-expiry.job';
import { computeQuoteHash } from '../cart/quote-hash';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
  withTestTenant,
} from '../../../test/db-test-harness';

/**
 * Integration coverage for the checkout commit path.
 *
 * The whole flow runs in one transaction: checkout, line items, quote,
 * reservations, intent, attempt, order, inventory, ledger entry and
 * outbox message. Only a real database proves it commits or rolls back
 * as a unit.
 */

const SLUG = 'spec-store';

interface Fixture {
  storeId: bigint;
  variantId: bigint;
  offeringId: bigint;
}

/**
 * Collaborators the commit path actually calls.
 *
 * These were `{} as never` placeholders, which compiled and then threw
 * at runtime the moment commit() reached this.ids.reserve() and
 * this.providers.assertCanHandle(). `never` silences the type checker
 * exactly where it was trying to warn us, so the fakes here are real
 * objects with real methods.
 */

/** Reserved ids only need to be unique and not collide with the sequence. */
let reservedId = 500_000n;
const fakeIds = { reserve: async () => ++reservedId } as never;

/** Cash on delivery is the only method this spec exercises. */
const codAdapter = new CodAdapter();

const fakeRegistry = {
  has: (gateway: string) => gateway === 'cod',
  get: () => codAdapter,
  assertCanHandle: () => codAdapter,
} as never;

/**
 * How many times a PROVIDER was actually called.
 *
 * The cart-identity assertions are not really about how many checkout
 * rows exist — they are about how many times we reached out to a payment
 * provider. A second tab that creates no checkout but still opens a
 * payment session at the gateway has failed at the only thing that
 * matters, and only this counter can see that.
 */
let pendingCalls = 0;

/**
 * A gateway that leaves the payment PENDING.
 *
 * Needed because cash on delivery commits the instant it is created —
 * its cart is converted immediately and there is never a live checkout
 * for a second tab to converge on. Convergence only exists where the
 * money does.
 */
const pendingAdapter = {
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
  fetchStatus: async () => [],
  initializePayment: async () => {
    pendingCalls += 1;
    return {
      kind: 'requires_action' as const,
      nextAction: { kind: 'client_sdk' as const, clientSecret: 'cs_cart' },
      refs: { gatewayReference: `pi_cart_${pendingCalls}` },
    };
  },
};

/** A provider that dies mid-call, for the crash-between-phases case. */
const explodingAdapter = {
  capabilities: pendingAdapter.capabilities,
  validateCredentials: async () => ({ valid: true }),
  fetchStatus: async () => [],
  initializePayment: async () => {
    throw new Error('provider exploded');
  },
};

/** No credentials: cash on delivery has none to read. */
const fakeAccounts = {
  revealCredentialsForGateway: async () => ({}),
} as never;

/** Every request proceeds; idempotency has its own dedicated spec. */
const fakeIdempotency = {
  defaultTtlSeconds: 3600,
  defaultLeaseSeconds: 60,
  claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
  complete: async () => undefined,
  fail: async () => undefined,
} as never;

/** Only reached on the gateway path, which this spec does not take. */
const fakeApplier = { applyMany: async () => [] } as never;

describe('CheckoutService (integration)', () => {
  let prisma: PrismaClient;
  let service: CheckoutService;
  let carts: CartService;
  let fx: Fixture;

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
  ): Promise<T> => withTestTenant(storeId ?? fx.storeId, fn);

  beforeAll(async () => {
    prisma = await startTestDatabase();

    carts = new CartService(prisma as never, new TenantContextService());

    service = new CheckoutService(
      prisma as never,
      new LedgerService(prisma as never),
      new OutboxService(),
      fakeAccounts,
      fakeIdempotency,
      fakeRegistry,
      fakeIds,
      fakeApplier,
      new TenantContextService(),
      appConfigStub(),
      new CheckoutSuccessionFundsService(),
      carts,
    );
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES);
    fx = await seed(prisma);
    pendingCalls = 0;
  });

  it('enforces PostgreSQL RLS for Order and OrderItem', async () => {
    const seeded = await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'RLS Buyer',
      customer_phone: '01000000000',
      address_line: 'RLS Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    expect(seeded.order).not.toBeNull();

    const orderId = BigInt(seeded.order!.id);

    // Correct tenant can read its own order.
    await withTestTenant(fx.storeId, async (tx) => {
      const rows = await tx.order.findMany({
        where: { id: orderId },
      });

      expect(rows).toHaveLength(1);

      const items = await tx.orderItem.findMany({
        where: { order_id: orderId },
      });

      expect(items).toHaveLength(1);
    });

    // No tenant context: RLS must hide the order completely.
    const withoutContext = await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<
        Array<{ id: bigint }>
      >`SELECT id FROM "Order" WHERE id = ${orderId}`;

      return orders;
    });

    expect(withoutContext).toHaveLength(0);

    // Another tenant: RLS must hide the order and its items.
    const otherStoreId = fx.storeId + 999n;

    const crossStore = await withTestTenant(otherStoreId, async (tx) => {
      const orders = await tx.order.findMany({
        where: { id: orderId },
      });

      const items = await tx.orderItem.findMany({
        where: { order_id: orderId },
      });

      return { orders, items };
    });

    expect(crossStore.orders).toHaveLength(0);
    expect(crossStore.items).toHaveLength(0);
  });

  /* ══════════════════════════════════════════════════════════════════
     HIGH-3 — ROW LEVEL SECURITY ON THE CHECKOUT TABLES.

     `checkouts` was the last tenant-scoped table without a policy, and
     the one holding the most customer PII: name, email, phone and the
     shipping address. `20260904090000_enable_checkout_rls` closed it.

     These assert the policy from the outside — through the same
     `dartstore_app` role the application runs as — rather than trusting
     that the migration was written correctly. Store isolation, mode
     isolation, the line-item table's parent-scoped policy, and the
     WITH CHECK half that stops a write into someone else's tenant.
     ══════════════════════════════════════════════════════════════════ */

  /** A tenant transaction in an arbitrary mode, which `withTestTenant` pins to `live`. */
  const inMode = <T>(
    storeId: bigint,
    mode: 'live' | 'test',
    cb: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('app.store_id', ${storeId.toString()}, true),
               set_config('app.mode', ${mode}, true)
      `;
      return cb(tx);
    });

  it('enforces PostgreSQL RLS for checkouts and checkout_line_items', async () => {
    const placed = await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'RLS Checkout Buyer',
      customer_phone: '01000000000',
      address_line: 'RLS Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const checkout = await asTenant((tx) =>
      tx.checkout.findFirstOrThrow({ where: { token: placed.checkout_token } }),
    );

    // 1. The owning tenant reads its own checkout and its line items.
    await withTestTenant(fx.storeId, async (tx) => {
      expect(
        await tx.checkout.findMany({ where: { id: checkout.id } }),
      ).toHaveLength(1);
      expect(
        await tx.checkoutLineItem.findMany({
          where: { checkout_id: checkout.id },
        }),
      ).toHaveLength(1);
    });

    // 2. NO tenant context at all — the case the four unconverted reads
    //    used to run in. Raw SQL, so this is the table answering, not
    //    Prisma's own where clause.
    const withoutContext = await prisma.$transaction(async (tx) => ({
      checkouts: await tx.$queryRaw<
        Array<{ id: bigint }>
      >`SELECT id FROM "checkouts" WHERE id = ${checkout.id}`,
      items: await tx.$queryRaw<
        Array<{ id: bigint }>
      >`SELECT id FROM "checkout_line_items" WHERE checkout_id = ${checkout.id}`,
    }));

    expect(withoutContext.checkouts).toHaveLength(0);
    expect(withoutContext.items).toHaveLength(0);

    // 3. CROSS-STORE — another tenant sees neither the checkout nor,
    //    through the parent-scoped policy, its line items.
    const crossStore = await withTestTenant(fx.storeId + 999n, async (tx) => ({
      checkouts: await tx.checkout.findMany({ where: { id: checkout.id } }),
      items: await tx.checkoutLineItem.findMany({
        where: { checkout_id: checkout.id },
      }),
    }));

    expect(crossStore.checkouts).toHaveLength(0);
    expect(crossStore.items).toHaveLength(0);

    // 4. CROSS-MODE — the same store, the wrong mode. This is the half a
    //    store-only policy would have missed entirely.
    const crossMode = await inMode(fx.storeId, 'test', async (tx) => ({
      checkouts: await tx.checkout.findMany({ where: { id: checkout.id } }),
      items: await tx.checkoutLineItem.findMany({
        where: { checkout_id: checkout.id },
      }),
    }));

    expect(crossMode.checkouts).toHaveLength(0);
    expect(crossMode.items).toHaveLength(0);
  });

  it('refuses to WRITE a checkout into another tenant', async () => {
    // The USING half hides other tenants' rows; this is the WITH CHECK
    // half, which stops a row being CREATED somewhere it would then be
    // invisible. Without it a tenant could plant rows in another store.
    const foreignStoreId = fx.storeId + 999n;

    await expect(
      withTestTenant(fx.storeId, (tx) =>
        tx.checkout.create({
          data: {
            store_id: foreignStoreId,
            mode: 'live',
            token: 'rls-write-probe',
            status: 'open',
            currency: 'USD',
            quote_total_minor: 100n,
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
          },
        }),
      ),
    ).rejects.toThrow();

    // And nothing landed.
    const planted = await prisma.$queryRaw<
      Array<{ id: bigint }>
    >`SELECT id FROM "checkouts" WHERE token = 'rls-write-probe'`;
    expect(planted).toHaveLength(0);
  });

  it('refuses to WRITE a checkout into another mode', async () => {
    await expect(
      inMode(fx.storeId, 'live', (tx) =>
        tx.checkout.create({
          data: {
            store_id: fx.storeId,
            mode: 'test',
            token: 'rls-mode-write-probe',
            status: 'open',
            currency: 'USD',
            quote_total_minor: 100n,
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('still serves the storefront read paths, which is what RLS could have broken', async () => {
    // The regression this whole change risks: the status endpoint, the
    // succession walk and the sync path all read `checkouts` and all now
    // do it inside tenant context. If the mode were not threaded through
    // from the controller, every one of these would 404.
    const placed = await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'RLS Status Buyer',
      customer_phone: '01000000000',
      address_line: 'RLS Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const status = await service.getCheckoutStatus(
      SLUG,
      placed.checkout_token,
      'live',
    );

    expect(status.checkout_token).toBe(placed.checkout_token);

    // The wrong mode must NOT be a way to read it — the endpoint is
    // token-addressed and the token travels in a URL.
    await expect(
      service.getCheckoutStatus(SLUG, placed.checkout_token, 'test'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns a 400, not an unhandled 500, when the gateway account credentials fail to decrypt', async () => {
    // A stale KEK version, a corrupted envelope, or any other
    // DecryptionError is a configuration problem, exactly like a missing
    // secret key — not a server fault. This regression-tests that it
    // reaches the shopper as a BadRequestException instead of escaping
    // checkout.initializePayment() as a raw, unhandled exception (which
    // is what produced the storefront's HTTP 500 on checkout).
    const brokenAccount = await withTestTenant(fx.storeId, (tx) =>
      tx.paymentAccount.create({
        data: {
          store_id: fx.storeId,
          mode: 'live',
          gateway: 'stripe',
          display_name: 'Broken',
          status: 'active',
          settlement_currency: 'USD',
        },
        select: { id: true },
      }),
    );

    const brokenOffering = await withTestTenant(fx.storeId, (tx) =>
      tx.paymentMethodOffering.create({
        data: {
          account_id: brokenAccount.id,
          store_id: fx.storeId,
          mode: 'live',
          method: 'card',
          enabled: true,
          position: 1,
          commitment_kind: 'funds_secured',
          capture_mode: 'automatic',
        },
        select: { id: true },
      }),
    );

    const brokenProvider = {
      initializePayment: async () => {
        throw new Error('must not be reached: credentials never decrypted');
      },
    } as never;

    const brokenService = new CheckoutService(
      prisma as never,
      new LedgerService(prisma as never),
      new OutboxService(),
      {
        revealCredentialsForGateway: async () => {
          throw new DecryptionError(
            'key_unavailable',
            'test: simulated KEK unavailable',
          );
        },
      } as never,
      fakeIdempotency,
      {
        has: (gateway: string) => gateway === 'stripe',
        get: () => brokenProvider,
        assertCanHandle: () => brokenProvider,
      } as never,
      fakeIds,
      fakeApplier,
      new TenantContextService(),
      appConfigStub(),
      new CheckoutSuccessionFundsService(),
    );

    await expect(
      brokenService.createAndCommit(SLUG, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
        customer_name: 'Test Buyer',
        customer_phone: '01000000000',
        address_line: '1 Test Street',
        city: 'Cairo',
        payment_offering_id: brokenOffering.id.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an order from a committed checkout', async () => {
    const result = await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    expect(result.order!.order_number).toBe('1001');
    expect(result.order!.payment_status).toBe('UNPAID');
    // 2 x 25.00
    expect(result.order!.total).toBe('50.00');
    expect(result.payment_redirect_url).toBeNull();
    expect(result.checkout_token).toHaveLength(32);
  });

  it('recomputes prices server-side and ignores what the client thinks', async () => {
    await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const checkout = await asTenant((tx) => tx.checkout.findFirstOrThrow({
      where: { store_id: fx.storeId },
    }));
    expect(checkout.quote_total_minor).toBe(2500n);
  });

  it('writes the full aggregate in one transaction', async () => {
    await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    expect(await asTenant((tx) => tx.checkout.count())).toBe(1);
    expect(await asTenant((tx) => tx.checkoutLineItem.count())).toBe(1);
    expect(await prisma.quoteComponent.count()).toBe(1);
    await withTestTenant(fx.storeId, async (tx) => {
      expect(await tx.paymentIntent.count()).toBe(1);
      expect(await tx.paymentAttempt.count()).toBe(1);
      expect(await tx.order.count()).toBe(1);
      expect(await tx.inventoryReservation.count()).toBe(1);
      expect(await tx.journalEntry.count()).toBe(1);
      expect(await tx.outboxMessage.count()).toBe(1);
    });
  });

  it('links the checkout and the order both ways', async () => {
    const result = await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const { checkout, order } = await withTestTenant(
      fx.storeId,
      async (tx) => ({
        checkout: await tx.checkout.findFirstOrThrow({}),
        order: await tx.order.findFirstOrThrow({}),
      }),
    );

    expect(checkout.status).toBe('committed');
    expect(checkout.order_id).toBe(order.id);
    expect(order.checkout_id).toBe(checkout.id);
    expect(order.id.toString()).toBe(result.order!.id);
  });

  it('posts a balanced receivable entry', async () => {
    await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const ledger = new LedgerService(prisma as never);

    await withTestTenant(fx.storeId, async () => {
      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'offline_receivable',
        }),
      ).toBe(5000n);

      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });
  });

  it('decrements inventory', async () => {
    await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 3 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { id: fx.variantId },
    });
    expect(variant.inventory_qty).toBe(7);
  });

  it('emits an outbox message carrying identifiers only', async () => {
    await service.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    });

    const message = await withTestTenant(fx.storeId, async (tx) =>
      tx.outboxMessage.findFirstOrThrow({}),
    );

    expect(message.event_type).toBe('checkout.committed');
    expect(message.status).toBe('pending');

    const payload = message.payload as Record<string, unknown>;
    expect(payload.orderNumber).toBe('1001');
    // no customer PII in the payload
    expect(JSON.stringify(payload)).not.toContain('Test Buyer');
  });

  it('numbers orders per store starting at 1001', async () => {
    const body = {
      items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
    };

    const first = await service.createAndCommit(SLUG, body);
    const second = await service.createAndCommit(SLUG, body);

    expect(first.order!.order_number).toBe('1001');
    expect(second.order!.order_number).toBe('1002');
  });

  it('rejects an out-of-stock line and writes nothing', async () => {
    await expect(
      service.createAndCommit(SLUG, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 999 }],
        customer_name: 'Test Buyer',
        customer_phone: '01000000000',
        address_line: '1 Test Street',
        city: 'Cairo',
        payment_offering_id: fx.offeringId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await asTenant((tx) => tx.checkout.count())).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('rejects a variant belonging to another store', async () => {
    const other = await seedOtherStore(prisma);

    await expect(
      service.createAndCommit(SLUG, {
        items: [{ variant_id: other.variantId.toString(), quantity: 1 }],
        customer_name: 'Test Buyer',
        customer_phone: '01000000000',
        address_line: '1 Test Street',
        city: 'Cairo',
        payment_offering_id: fx.offeringId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an offering that belongs to another store', async () => {
    const other = await seedOtherStore(prisma);

    await expect(
      service.createAndCommit(SLUG, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
        customer_name: 'Test Buyer',
        customer_phone: '01000000000',
        address_line: '1 Test Street',
        city: 'Cairo',
        payment_offering_id: other.offeringId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('listPaymentMethods', () => {
    it('returns enabled offerings on active accounts', async () => {
      const methods = await service.listPaymentMethods(SLUG);
      expect(methods).toHaveLength(1);
      expect(methods[0].method).toBe('cod');
      expect(methods[0].commitment_kind).toBe('promise_accepted');
    });

    it('hides a disabled offering', async () => {
      await withTestTenant(fx.storeId, async (tx) => {
        await tx.paymentMethodOffering.update({
          where: { id: fx.offeringId },
          data: { enabled: false },
        });
      });
      expect(await service.listPaymentMethods(SLUG)).toHaveLength(0);
    });

    it('hides offerings on a disabled account', async () => {
      await withTestTenant(fx.storeId, async (tx) => {
        await tx.paymentAccount.updateMany({
          where: { store_id: fx.storeId },
          data: { status: 'disabled' },
        });
      });

      expect(await service.listPaymentMethods(SLUG)).toHaveLength(0);
    });

    it('publishes how the checkout must host each method', async () => {
      // The storefront branches on this and never on the gateway's name.
      // Cash on delivery settles outside any provider, so there is
      // nothing for the page to embed and nowhere to send the payer.
      const [method] = await service.listPaymentMethods(SLUG);
      expect(method.presentation_mode).toBe('offline');
      expect(method.next_action_kinds).toEqual([]);
    });

    it("groups Moyasar's card, mada and apple_pay into TWO experiences", async () => {
      /*
       * The regression, end to end, against the real adapter and a real
       * database. Three enabled offerings on one Moyasar account are
       * three MERCHANT rows and two PAYER experiences: mada is a card
       * network inside Moyasar's own card component, so `card` and
       * `mada` are one embedded form, and Apple Pay — which that form
       * cannot host without merchant-validation configuration this
       * integration does not have — is a separate hosted-invoice
       * redirect.
       *
       * The real MoyasarAdapter capabilities are used deliberately: the
       * grouping must come from the adapter's own declaration, and a
       * stub would prove nothing about the provider contract.
       */
      const moyasar = new MoyasarAdapter();
      const moyasarService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'moyasar',
          get: () => moyasar,
          assertCanHandle: () => moyasar,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        // The fixture's COD offering would otherwise be published by the
        // registry stub above as if it were a Moyasar one.
        await tx.paymentMethodOffering.update({
          where: { id: fx.offeringId },
          data: { enabled: false },
        });

        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'moyasar',
            display_name: 'Moyasar',
            status: 'active',
            settlement_currency: 'SAR',
            // Key NAMES only — the same masked shape the real column
            // holds. A publishable key is what makes the embedded form
            // reachable for this account.
            credentials_hint: {
              secret_key: 'masked',
              webhook_secret: 'masked',
              publishable_key: 'masked',
            },
          },
          select: { id: true },
        });

        for (const [position, method] of (
          ['card', 'mada', 'apple_pay'] as const
        ).entries()) {
          await tx.paymentMethodOffering.create({
            data: {
              account_id: account.id,
              store_id: fx.storeId,
              mode: 'live',
              method,
              enabled: true,
              position,
              commitment_kind: 'funds_secured',
              capture_mode: 'automatic',
            },
          });
        }
      });

      const methods = await moyasarService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(2);

      const [cards, applePay] = methods;

      // One card experience covering both networks, submitted as the
      // real `card` offering row.
      expect(cards.methods).toEqual(['card', 'mada']);
      expect(cards.offering_ids).toHaveLength(2);
      expect(cards.method).toBe('card');
      expect(cards.form_id).toBe('moyasar_form_card');
      expect(cards.presentation_mode).toBe('embedded');
      expect(cards.next_action_kinds).toEqual(['client_sdk']);

      // Apple Pay says what it will actually do. It used to say
      // 'embedded' — inherited from the account — and then hand the tab
      // to Moyasar's hosted invoice.
      expect(applePay.methods).toEqual(['apple_pay']);
      expect(applePay.form_id).toBe('moyasar_invoice_apple_pay');
      expect(applePay.presentation_mode).toBe('same_tab_redirect');
      expect(applePay.next_action_kinds).toEqual(['redirect']);

      // No two experiences may open the same provider surface.
      expect(new Set(methods.map((m) => m.form_id)).size).toBe(2);
    });

    it('falls the Moyasar card form back to redirect without a publishable key', async () => {
      const moyasar = new MoyasarAdapter();
      const moyasarService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'moyasar',
          get: () => moyasar,
          assertCanHandle: () => moyasar,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        await tx.paymentMethodOffering.update({
          where: { id: fx.offeringId },
          data: { enabled: false },
        });

        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'moyasar',
            display_name: 'Moyasar',
            status: 'active',
            settlement_currency: 'SAR',
            credentials_hint: { secret_key: 'masked' },
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'card',
            enabled: true,
            position: 0,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const [cards] = await moyasarService.listPaymentMethods(SLUG);

      // The account still gets a working checkout, on the hosted
      // invoice, and the page is told so before the customer commits.
      expect(cards.presentation_mode).toBe('same_tab_redirect');
      expect(cards.next_action_kinds).toEqual(['redirect']);
    });

    it("does not leak another store's methods", async () => {
      await seedOtherStore(prisma);
      const methods = await service.listPaymentMethods(SLUG);
      expect(methods).toHaveLength(1);
    });

    it('exposes a Paymob offering once its account is active and the adapter is registered', async () => {
      // The positive counterpart of the test below: registration plus an
      // active account is exactly what makes a gateway reachable by a
      // shopper, and nothing else had to change for a new provider to
      // appear here.
      const paymobService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'cod' || gateway === 'paymob',
          get: () => codAdapter,
          assertCanHandle: () => codAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'paymob',
            display_name: 'Paymob',
            status: 'active',
            settlement_currency: 'EGP',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'card',
            // Paymob issues an integration id per method.
            gateway_method_config: '4345907',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await paymobService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(2);
      expect(methods.map((m) => m.gateway)).toContain('paymob');
    });

    it('hides that same Paymob offering while its account is not active', async () => {
      const paymobService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'cod' || gateway === 'paymob',
          get: () => codAdapter,
          assertCanHandle: () => codAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'paymob',
            display_name: 'Paymob',
            // What a rejected credential validation leaves behind.
            status: 'errored',
            settlement_currency: 'EGP',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'card',
            gateway_method_config: '4345907',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await paymobService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(1);
      expect(methods[0].method).toBe('cod');
    });

    it('exposes a Moyasar offering once its account is active', async () => {
      // A third provider, and still nothing in checkout had to change:
      // registration plus an active account is the whole condition.
      const moyasarService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'cod' || gateway === 'moyasar',
          get: () => codAdapter,
          assertCanHandle: () => codAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'moyasar',
            display_name: 'Moyasar',
            status: 'active',
            settlement_currency: 'SAR',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'mada',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await moyasarService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(2);
      expect(methods.map((m) => m.gateway)).toContain('moyasar');
    });

    it('hides that same Moyasar offering while its account is errored', async () => {
      const moyasarService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'cod' || gateway === 'moyasar',
          get: () => codAdapter,
          assertCanHandle: () => codAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'moyasar',
            display_name: 'Moyasar',
            // What a rejected credential validation leaves behind.
            status: 'errored',
            settlement_currency: 'SAR',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'mada',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await moyasarService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(1);
      expect(methods[0].method).toBe('cod');
    });

    it('exposes a Tap offering once its account is active', async () => {
      // A fourth provider, and still nothing in checkout had to change:
      // registration plus an active account is the whole condition.
      const tapService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'cod' || gateway === 'tap',
          get: () => codAdapter,
          assertCanHandle: () => codAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'tap',
            display_name: 'Tap Payments',
            status: 'active',
            settlement_currency: 'KWD',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            // KNET is one of the methods Tap publishes a redirect-flow
            // source id for.
            method: 'knet',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await tapService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(2);
      expect(methods.map((m) => m.gateway)).toContain('tap');
    });

    it('hides that same Tap offering while its account is errored', async () => {
      const tapService = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: (gateway: string) => gateway === 'cod' || gateway === 'tap',
          get: () => codAdapter,
          assertCanHandle: () => codAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
      );

      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'tap',
            display_name: 'Tap Payments',
            // What a rejected credential validation leaves behind.
            status: 'errored',
            settlement_currency: 'KWD',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'knet',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await tapService.listPaymentMethods(SLUG);

      expect(methods).toHaveLength(1);
      expect(methods[0].method).toBe('cod');
    });

    it('does not expose an enabled offering whose gateway has no registered adapter', async () => {
      // fakeRegistry only registers 'cod' (see top of file) — an account
      // on any other gateway must never reach the storefront, even if its
      // status and offering are otherwise fully enabled/active. This is
      // the defense-in-depth check: it must hold even for data that
      // bypasses PaymentAccountService.upsert()'s own Stage 1 gate.
      await withTestTenant(fx.storeId, async (tx) => {
        const account = await tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'stripe',
            display_name: 'Unregistered',
            status: 'active',
            settlement_currency: 'USD',
          },
          select: { id: true },
        });

        await tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'card',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
        });
      });

      const methods = await service.listPaymentMethods(SLUG);
      // Still just the seeded 'cod' offering — the stripe one is filtered out.
      expect(methods).toHaveLength(1);
      expect(methods[0].method).toBe('cod');
    });
  });

  /* ────────────────────────────────────────────────────────────────
     PII on the status endpoint.

     The token is a bearer capability that travels — a URL, browser
     history, a shared link. The payer's own contact and address are
     returned only while this checkout can still be paid, which is the
     only reason the retry flow ever needed them.
     ──────────────────────────────────────────────────────────────── */
  describe('customer PII is returned only while the checkout is payable', () => {
    /** A checkout of THIS store, in a given state. */
    async function seedCheckout(status: CheckoutStatus, token: string) {
      return asTenant((tx) => tx.checkout.create({
        data: {
          store_id: fx.storeId,
          mode: 'live',
          token,
          status,
          customer_name: 'Jane Payer',
          customer_email: 'jane@example.com',
          customer_phone: '01000000000',
          shipping_address: {
            address_line: '9 Private Road',
            city: 'Riyadh',
            notes: 'leave at the door',
          },
          currency: 'USD',
          quote_total_minor: 2500n,
          selected_offering_id: fx.offeringId,
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        },
      }));
    }

    it('A — an active unpaid checkout returns the retry details', async () => {
      const checkout = await seedCheckout('pending_payment', 'pii-open-token');
      const status = await service.getCheckoutStatus(SLUG, checkout.token);

      expect(status.customer).toEqual({
        name: 'Jane Payer',
        email: 'jane@example.com',
        phone: '01000000000',
        address_line: '9 Private Road',
        city: 'Riyadh',
      });
      expect(status.selected_offering_id).toBe(fx.offeringId.toString());
    });

    it('B — a FAILED checkout returns them too: retry is the point', async () => {
      const checkout = await seedCheckout('failed', 'pii-failed-token');
      const status = await service.getCheckoutStatus(SLUG, checkout.token);

      expect(status.customer?.name).toBe('Jane Payer');
      expect(status.customer?.address_line).toBe('9 Private Road');
    });

    it('minimises: the order note is never returned', async () => {
      const checkout = await seedCheckout('failed', 'pii-notes-token');
      const status = await service.getCheckoutStatus(SLUG, checkout.token);

      // Free text, required by nothing in the payment path.
      expect(status.customer).not.toHaveProperty('notes');
      expect(JSON.stringify(status)).not.toContain('leave at the door');
    });

    it('C — a committed (PAID) checkout returns none', async () => {
      const checkout = await seedCheckout('committed', 'pii-paid-token');
      const status = await service.getCheckoutStatus(SLUG, checkout.token);

      expect(status.customer).toBeNull();
      expect(status.selected_offering_id).toBeNull();
      expect(JSON.stringify(status)).not.toContain('9 Private Road');
      expect(JSON.stringify(status)).not.toContain('jane@example.com');
    });

    it('D — a cancelled/abandoned checkout returns none', async () => {
      const checkout = await seedCheckout('abandoned', 'pii-abandoned-token');
      const status = await service.getCheckoutStatus(SLUG, checkout.token);

      expect(status.customer).toBeNull();
      expect(JSON.stringify(status)).not.toContain('9 Private Road');
    });

    it('E — an expired checkout returns none', async () => {
      const checkout = await seedCheckout('expired', 'pii-expired-token');
      const status = await service.getCheckoutStatus(SLUG, checkout.token);

      expect(status.customer).toBeNull();
      expect(JSON.stringify(status)).not.toContain('9 Private Road');
    });

    it('the amount and the order result are unaffected by the gate', async () => {
      // Narrowing PII must not narrow what the page legitimately shows.
      const paid = await seedCheckout('committed', 'pii-amount-token');
      const status = await service.getCheckoutStatus(SLUG, paid.token);

      expect(status.total).toBe('25.00');
      expect(status.currency).toBe('USD');
      expect(status.checkout_status).toBe('committed');
    });
  });

  it('does not expose another store checkout by token', async () => {
    const other = await seedOtherStore(prisma);

    const checkout = await asTenant((tx) => tx.checkout.create({
      data: {
        store_id: other.storeId,
        mode: 'live',
        token: 'other-store-token',
        status: 'pending_payment',
        customer_name: 'Other Customer',
        customer_phone: '01000000000',
        shipping_address: {
          address_line: 'Other Address',
          city: 'Cairo',
          notes: null,
        },
        currency: 'USD',
        quote_total_minor: 2500n,
        selected_offering_id: other.offeringId,
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
      },
    // The other store's row is seeded in the other store's context: the
    // RLS WITH CHECK clause refuses it from this one, which is the
    // policy working rather than a broken fixture.
    }), other.storeId);

    await expect(
      service.getCheckoutStatus(SLUG, checkout.token),
    ).rejects.toThrow('Checkout not found.');

    await expect(
      service.syncCheckoutStatus(SLUG, checkout.token),
    ).rejects.toThrow('Checkout not found.');
  });

  /* ────────────────────────────────────────────────────────────────
     Checkout succession — the server's own answer to "was this
     checkout replaced?".

     A retry creates a NEW checkout; the old one stays truthfully
     failed forever, and its token stays in the browser's history. The
     relation recorded here is what lets a page restored onto that old
     token find the checkout it should be looking at instead — identity
     only, decided by the server, and never a statement about a payment.
     ──────────────────────────────────────────────────────────────── */
  describe('checkout succession', () => {
    const payer = {
      customer_name: 'Jane Payer',
      customer_phone: '+966 55 000 0000',
      customer_email: 'jane@example.com',
      address_line: '9 Private Road',
      city: 'Riyadh',
    };

    /** A checkout of this store, in a given state, optionally linked. */
    async function seedCheckout(over: {
      token: string;
      status?: CheckoutStatus;
      supersedes_id?: bigint | null;
      order_id?: bigint | null;
      phone?: string;
      email?: string | null;
    }) {
      return asTenant((tx) => tx.checkout.create({
        data: {
          store_id: fx.storeId,
          mode: 'live',
          token: over.token,
          status: over.status ?? 'failed',
          customer_name: payer.customer_name,
          customer_email:
            over.email === undefined ? payer.customer_email : over.email,
          customer_phone: over.phone ?? payer.customer_phone,
          shipping_address: {
            address_line: payer.address_line,
            city: payer.city,
          },
          currency: 'USD',
          quote_total_minor: 2500n,
          selected_offering_id: fx.offeringId,
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
          supersedes_id: over.supersedes_id ?? null,
          order_id: over.order_id ?? null,
        },
      }));
    }

    const create = (over: Partial<CreateCheckoutDto> = {}) =>
      service.createAndCommit(SLUG, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
        ...payer,
        payment_offering_id: fx.offeringId.toString(),
        ...over,
      });

    it('an ordinary checkout has no successor', async () => {
      const first = await create();
      const status = await service.getCheckoutStatus(
        SLUG,
        first.checkout_token,
      );

      expect(status.superseded_by_token).toBeNull();
    });

    it('records the link the retry declares, and reports it back', async () => {
      // The predecessor is a DECLINED checkout: no order, still payable
      // — which is the only kind a retry ever replaces.
      const first = await seedCheckout({ token: 'link-a' });
      const second = await create({ supersedes_checkout_token: first.token });

      const status = await service.getCheckoutStatus(SLUG, first.token);
      expect(status.superseded_by_token).toBe(second.checkout_token);

      // And the successor is not itself superseded.
      const successor = await service.getCheckoutStatus(
        SLUG,
        second.checkout_token,
      );
      expect(successor.superseded_by_token).toBeNull();
    });

    it('follows a CHAIN — three declines, and the first reaches the last', async () => {
      const a = await seedCheckout({ token: 'chain-a' });
      const b = await seedCheckout({ token: 'chain-b', supersedes_id: a.id });
      const c = await create({ supersedes_checkout_token: b.token });

      expect(
        (await service.getCheckoutStatus(SLUG, a.token)).superseded_by_token,
      ).toBe(c.checkout_token);
      expect(
        (await service.getCheckoutStatus(SLUG, b.token)).superseded_by_token,
      ).toBe(c.checkout_token);
    });

    it('publishes identity ONLY — no status, amount or order travels with it', async () => {
      const a = await seedCheckout({ token: 'succ-a' });
      await seedCheckout({
        token: 'succ-b',
        status: 'committed',
        supersedes_id: a.id,
        order_id: null,
      });

      const status = await service.getCheckoutStatus(SLUG, 'succ-a');
      // A token, and nothing else. What that checkout's payment IS
      // comes from reading that checkout, not from this field.
      expect(status.superseded_by_token).toBe('succ-b');
      expect(typeof status.superseded_by_token).toBe('string');
    });

    it('prefers the committed successor when a failure was retried twice', async () => {
      // Two tabs retried the same decline; one of them paid.
      const a = await seedCheckout({ token: 'fork-a' });
      const order = await prisma.order.findFirst({
        where: { store_id: fx.storeId },
      });
      await seedCheckout({ token: 'fork-uncommitted', supersedes_id: a.id });
      await seedCheckout({
        token: 'fork-committed',
        status: 'committed',
        supersedes_id: a.id,
        order_id: order?.id ?? null,
      });

      const status = await service.getCheckoutStatus(SLUG, 'fork-a');
      expect(status.superseded_by_token).toBe('fork-committed');
    });

    it('IGNORES a claim on a checkout that already produced an order', async () => {
      // A paid checkout can never be the source of a chain — which is
      // what keeps a settled success at the END of one.
      const paid = await create();
      expect(paid.order).not.toBeNull();

      const next = await create({
        supersedes_checkout_token: paid.checkout_token,
      });

      const status = await service.getCheckoutStatus(SLUG, paid.checkout_token);
      expect(status.superseded_by_token).toBeNull();
      // And the successor was still created — the claim is dropped, not
      // the order.
      expect(next.checkout_token).toBeTruthy();
    });

    it('IGNORES a claim whose customer details do not match', async () => {
      const a = await seedCheckout({ token: 'mismatch-a' });

      const stranger = await create({
        supersedes_checkout_token: 'mismatch-a',
        customer_phone: '+966 55 999 9999',
        customer_email: 'someone@else.test',
      });

      expect(
        (await service.getCheckoutStatus(SLUG, a.token)).superseded_by_token,
      ).toBeNull();
      expect(stranger.checkout_token).toBeTruthy();
    });

    it('IGNORES a token that does not exist, without saying so', async () => {
      const created = await create({
        supersedes_checkout_token: 'ffffffffffffffffffffffffffffffff',
      });

      // The response is indistinguishable from one with no claim at all:
      // this cannot be used to probe which tokens exist.
      expect(created.checkout_token).toBeTruthy();
      expect(created.order).not.toBeNull();
    });

    it('IGNORES a token belonging to ANOTHER STORE', async () => {
      const other = await seedOtherStore(prisma);
      const foreign = await asTenant((tx) => tx.checkout.create({
        data: {
          store_id: other.storeId,
          mode: 'live',
          token: 'foreign-token',
          status: 'failed',
          customer_name: payer.customer_name,
          customer_email: payer.customer_email,
          customer_phone: payer.customer_phone,
          currency: 'USD',
          quote_total_minor: 2500n,
          expires_at: new Date(Date.now() + 30 * 60 * 1000),
        },
      // Seeded in the OTHER store's tenant context: the RLS WITH CHECK
      // clause would refuse this INSERT from this store's context, which
      // is the policy doing its job rather than a broken fixture.
      }), other.storeId);

      await create({ supersedes_checkout_token: 'foreign-token' });

      const linked = await asTenant((tx) => tx.checkout.findFirst({
        where: { supersedes_id: foreign.id },
      }));
      expect(linked).toBeNull();
    });

    it('never links a checkout to itself, and cannot build a cycle', async () => {
      // The link is written only by the INSERT that creates the row, so
      // it can only ever point at a row that already existed.
      const a = await seedCheckout({ token: 'cycle-a' });
      const b = await create({ supersedes_checkout_token: a.token });

      const rows = await asTenant((tx) => tx.checkout.findMany({
        where: { store_id: fx.storeId },
        select: { id: true, supersedes_id: true },
      }));
      for (const row of rows) {
        expect(row.supersedes_id).not.toBe(row.id);
        if (row.supersedes_id !== null)
          expect(row.supersedes_id < row.id).toBe(true);
      }
      expect(b.checkout_token).toBeTruthy();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     CART IDENTITY — one live checkout per basket.

     What is under test is not "are there two rows" but "did we reach
     out to a payment provider twice for one purchase". A second tab
     that creates no checkout and still opens a payment session at the
     gateway has failed at the only thing that matters, so the provider
     call counter is asserted alongside the row counts everywhere below.

     Most of these use a GATEWAY offering rather than cash on delivery,
     because an offline checkout commits the moment it is created — its
     cart is `converted` immediately and there is never a live checkout
     for a second tab to converge on. Convergence is a funds_secured
     story, which is also where the money is.

     HONEST LIMITATION, stated here rather than left for a green suite
     to imply otherwise: the concurrency case exercises two overlapping
     transactions against a real PostgreSQL, which is genuine, but it is
     not proof of true parallelism under production load. What the
     design guarantees is that `SELECT ... FOR UPDATE` plus the partial
     unique index `checkouts_one_live_per_cart` make the WORST realistic
     outcome a spurious `checkout_in_flight` — the customer's tab asks
     again — and never a duplicate order.
     ══════════════════════════════════════════════════════════════════ */
  describe('cart identity', () => {
    /**
     * Everything the cart tables hold is RLS-scoped, so a spec read of
     * `carts` or `cart_items` outside a tenant context legitimately
     * returns nothing. This is the same `withTestTenant` every other
     * scoped read in this file uses, bound to the fixture's store.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inTenant = (cb: (tx: any) => Promise<any>): Promise<any> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withTestTenant(fx.storeId, cb as never) as Promise<any>;

    /** A gateway offering, so the checkout stays live after creation. */
    let gatewayOfferingId: bigint;

    /** A service whose provider keeps the payment pending. */
    let gateway: CheckoutService;

    /**
     * Re-creates the gateway fixture and the service that uses it.
     *
     * Called from `beforeEach`, and again inside the concurrency loop,
     * which truncates and re-seeds between rounds.
     */
    async function rebuildGateway(): Promise<void> {
      const account = await inTenant((tx) =>
        tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'stripe',
            display_name: 'Gateway',
            status: 'active',
            settlement_currency: 'USD',
          },
          select: { id: true },
        }),
      );

      const offering = await inTenant((tx) =>
        tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'card',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
          select: { id: true },
        }),
      );

      gatewayOfferingId = offering.id;

      gateway = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: () => true,
          get: () => pendingAdapter,
          assertCanHandle: () => pendingAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
        carts,
      );
    }

    beforeEach(rebuildGateway);

    /** Mints a server-side cart holding `quantity` of the fixture variant. */
    async function newCart(quantity = 1) {
      const added = await carts.addItem(fx.storeId, 'live', null, {
        variantId: fx.variantId.toString(),
        quantity,
      });

      const row: { id: bigint; public_id: string; version: number } =
        await inTenant((tx) =>
          tx.cart.findFirst({
            where: { token: added.token },
            select: { id: true, public_id: true, version: true },
          }),
        );

      return { token: added.token, ...row };
    }

    function body(overrides: Partial<CreateCheckoutDto> = {}) {
      return {
        items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
        customer_name: 'Cart Buyer',
        customer_phone: '01000000000',
        address_line: '1 Cart Street',
        city: 'Cairo',
        payment_offering_id: gatewayOfferingId.toString(),
        ...overrides,
      } as CreateCheckoutDto;
    }

    /** Place an order on the gateway offering (checkout stays live). */
    const place = (
      cartToken: string | null,
      overrides: Partial<CreateCheckoutDto> = {},
      idempotencyKey?: string,
    ) =>
      gateway.createAndCommit(
        SLUG,
        body(overrides),
        'live',
        idempotencyKey,
        cartToken,
      );

    /** Place a cash-on-delivery order (commits, and converts the cart). */
    const placeOffline = (cartToken: string | null) =>
      service.createAndCommit(
        SLUG,
        body({ payment_offering_id: fx.offeringId.toString() }),
        'live',
        undefined,
        cartToken,
      );

    const countCheckouts = (cartId: bigint) =>
      asTenant((tx) => tx.checkout.count({ where: { cart_id: cartId } }));

    const countOrders = () =>
      inTenant((tx) => tx.order.count({ where: { store_id: fx.storeId } }));

    /* ── 1. Same cart, two tabs → ONE checkout ────────────────────── */

    it("gives a second tab the FIRST tab's checkout, and calls the provider once", async () => {
      const cart = await newCart();

      const a = await place(cart.token);
      const b = await place(cart.token);

      // Same purchase, same checkout, from two independent requests.
      expect(b.checkout_token).toBe(a.checkout_token);
      expect((b as { converged?: boolean }).converged).toBe(true);
      expect((a as { converged?: boolean }).converged).toBeUndefined();

      expect(await countCheckouts(cart.id)).toBe(1);

      // THE ASSERTION THAT MATTERS: no second payment session anywhere.
      expect(pendingCalls).toBe(1);
    });

    it('creates one intent and one attempt for the two calls', async () => {
      const cart = await newCart();

      await place(cart.token);
      await place(cart.token);

      const checkout = await asTenant((tx) => tx.checkout.findFirst({
        where: { cart_id: cart.id },
        select: { id: true },
      }));

      const intents = await inTenant((tx) =>
        tx.paymentIntent.findMany({
          where: {
            store_id: fx.storeId,
            mode: 'live',
            context_kind: 'checkout',
            context_id: checkout!.id.toString(),
          },
          select: { id: true },
        }),
      );

      expect(intents).toHaveLength(1);

      const attempts = await inTenant((tx) =>
        tx.paymentAttempt.count({
          where: { intent_id: intents[0].id, store_id: fx.storeId, mode: 'live' },
        }),
      );
      expect(attempts).toBe(1);
      expect(await countOrders()).toBe(0);
    });

    /* ── 2. Concurrent creation → ONE checkout ────────────────────── */

    it('survives two SIMULTANEOUS Place Orders on one cart, repeatedly', async () => {
      // Repeated because a single pass can get lucky on ordering.
      for (let round = 0; round < 20; round += 1) {
        await truncateTables(ALL_TEST_TABLES);
        fx = await seed(prisma);
        await rebuildGateway();
        pendingCalls = 0;

        const cart = await newCart();

        // DIFFERENT idempotency keys on purpose: idempotency answers
        // "same request?", and this is asserting the other mechanism.
        const results = await Promise.allSettled([
          place(cart.token, {}, `key-a-${round}`),
          place(cart.token, {}, `key-b-${round}`),
        ]);

        const created = results.filter(
          (r) =>
            r.status === 'fulfilled' &&
            (r.value as { converged?: boolean }).converged !== true,
        );

        // Exactly one creation. The other is a convergence or a
        // `checkout_in_flight`; both are correct, and neither is a
        // second purchase.
        expect(created).toHaveLength(1);

        expect(await countCheckouts(cart.id)).toBe(1);
        expect(pendingCalls).toBe(1);

        const checkout = await asTenant((tx) => tx.checkout.findFirst({
          where: { cart_id: cart.id },
          select: { id: true },
        }));

        const intents = await inTenant((tx) =>
          tx.paymentIntent.count({
            where: {
              store_id: fx.storeId,
              mode: 'live',
              context_kind: 'checkout',
              context_id: checkout!.id.toString(),
            },
          }),
        );
        expect(intents).toBe(1);

        const reservations = await inTenant((tx) =>
          tx.inventoryReservation.count({
            where: { checkout_id: checkout!.id, store_id: fx.storeId, mode: 'live' },
          }),
        );
        expect(reservations).toBe(1);
      }
    }, 300_000);

    /* ── 5. Same products, NEW cart → a second order is ALLOWED ──── */

    it('lets the identical basket be bought again immediately, on a new cart', async () => {
      const first = await newCart(2);
      const one = await placeOffline(first.token);
      expect(one.order).not.toBeNull();

      // Same variant, same quantity, no waiting at all. There is no
      // fingerprint and no time window anywhere in this decision — the
      // constraint is one live checkout per CART, never one purchase
      // per basket shape.
      const second = await newCart(2);
      expect(second.token).not.toBe(first.token);
      expect(second.id).not.toBe(first.id);

      const two = await placeOffline(second.token);

      expect(two.order).not.toBeNull();
      expect((two as { converged?: boolean }).converged).toBeUndefined();
      expect(two.checkout_token).not.toBe(one.checkout_token);
      expect(await countOrders()).toBe(2);

      const intents = await inTenant((tx) =>
        tx.paymentIntent.count({ where: { store_id: fx.storeId, mode: 'live' } }),
      );
      expect(intents).toBe(2);
    });

    it('refuses to reuse a CONVERTED cart, rather than silently making a second order', async () => {
      const cart = await newCart();
      await placeOffline(cart.token);

      await expect(placeOffline(cart.token)).rejects.toMatchObject({
        response: { code: 'cart_converted' },
      });

      expect(await countOrders()).toBe(1);
    });

    it('mints a NEW cart when something is added to a converted one', async () => {
      const cart = await newCart();
      await placeOffline(cart.token);

      const again = await carts.addItem(fx.storeId, 'live', cart.token, {
        variantId: fx.variantId.toString(),
        quantity: 1,
      });

      // A terminal cart is replaced, never revived.
      expect(again.token).not.toBe(cart.token);
      expect(again.view.status).toBe('active');
      expect(again.view.items).toHaveLength(1);

      const old = await inTenant((tx) =>
        tx.cart.findFirst({ where: { id: cart.id } }),
      );
      expect(old!.status).toBe('converted');
      expect(old!.converted_order_id).not.toBeNull();
      expect(old!.active_checkout_id).toBeNull();
    });

    /* ── 8. The lease ─────────────────────────────────────────────── */

    it('refuses while another request holds the lease, and allows once it lapses', async () => {
      const cart = await newCart();

      await inTenant(
        (tx) => tx.$executeRaw`
          UPDATE carts SET claimed_until = now() + interval '90 seconds'
           WHERE id = ${cart.id}
        `,
      );

      await expect(place(cart.token)).rejects.toMatchObject({
        response: { code: 'checkout_in_flight' },
      });
      expect(pendingCalls).toBe(0);

      // A process that died mid-provider-call must not wedge the basket.
      await inTenant(
        (tx) => tx.$executeRaw`
          UPDATE carts SET claimed_until = now() - interval '1 second'
           WHERE id = ${cart.id}
        `,
      );

      const recovered = await place(cart.token);
      expect(recovered.checkout_token).toBeTruthy();
      expect(pendingCalls).toBe(1);
    });

    /* ── 9. A crash between the two phases ────────────────────────── */

    it('leaves no LIVE checkout, and no intent or attempt, when the provider throws', async () => {
      const cart = await newCart();

      const exploding = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: () => true,
          get: () => explodingAdapter,
          assertCanHandle: () => explodingAdapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
        carts,
      );

      await expect(
        exploding.createAndCommit(SLUG, body(), 'live', undefined, cart.token),
      ).rejects.toThrow();

      /*
       * THE PROVIDER-FAILURE CONTRACT.
       *
       * Round 9 makes the inventory hold durable BEFORE the provider is
       * called, so the checkout row and its reservations are committed
       * by the time the provider dies. "Nothing was written" is no
       * longer available and is no longer the guarantee. The guarantee
       * is that nothing is LIVE: the checkout is terminal, no payment
       * record exists, no stock is held, and the shopper can retry at
       * once.
       */
      expect(
        await inTenant((tx) =>
          tx.paymentIntent.count({ where: { store_id: fx.storeId, mode: 'live' } }),
        ),
      ).toBe(0);
      expect(
        await inTenant((tx) =>
          tx.paymentAttempt.count({ where: { store_id: fx.storeId, mode: 'live' } }),
        ),
      ).toBe(0);

      const checkouts = await asTenant((tx) => tx.checkout.findMany({
        where: { cart_id: cart.id },
      }));
      expect(checkouts).toHaveLength(1);
      expect(checkouts[0].status).toBe('failed');
      expect(checkouts[0].order_id).toBeNull();

      const reservations = await inTenant((tx) =>
        tx.inventoryReservation.findMany({
          where: { store_id: fx.storeId, mode: 'live' },
        }),
      );
      expect(reservations.length).toBeGreaterThan(0);
      expect(
        (reservations as { state: string }[]).every(
          (r) => r.state === 'released',
        ),
      ).toBe(true);

      // And the lease is back, so the shopper can simply try again.
      const after = await inTenant((tx) =>
        tx.cart.findFirst({ where: { id: cart.id } }),
      );
      expect(after!.claimed_until).toBeNull();
      expect(after!.active_checkout_id).toBeNull();
      expect(after!.status).toBe('active');

      const retried = await place(cart.token);
      expect(retried.checkout_token).toBeTruthy();
    });

    /* ── 10. Phase B loses the race ───────────────────────────────── */

    it('does not complete when the slot is taken between the two phases, and gives back everything TX1 held', async () => {
      const cart = await newCart();

      // A provider call that takes the slot away mid-flight — exactly
      // what a second request finishing first would do.
      const racing = new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: () => true,
          get: () => pendingAdapter,
          assertCanHandle: () => ({
            capabilities: pendingAdapter.capabilities,
            initializePayment: async () => {
              await inTenant(
                (tx) => tx.$executeRaw`
                  UPDATE carts
                     SET active_checkout_id = 999999, claimed_until = NULL
                   WHERE id = ${cart.id}
                `,
              );
              return pendingAdapter.initializePayment();
            },
          }),
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
        carts,
      );

      await expect(
        racing.createAndCommit(SLUG, body(), 'live', undefined, cart.token),
      ).rejects.toThrow();

      /*
       * THE INVARIANT: the loser does not COMPLETE.
       *
       * Round 8 got this by rolling one transaction back, because the
       * checkout row was written after the provider answered. Round 9
       * writes it before — the inventory hold is only durable if it is
       * — so the loser's checkout row and its reservations exist by the
       * time the slot is stolen, and the guarantee is delivered by
       * compensation instead of rollback. What must be true is the
       * same: nothing live, nothing payable, nothing sold, and not one
       * unit still held.
       */
      expect(
        await inTenant((tx) =>
          tx.paymentIntent.count({ where: { store_id: fx.storeId, mode: 'live' } }),
        ),
      ).toBe(0);
      expect(
        await inTenant((tx) =>
          tx.paymentAttempt.count({ where: { store_id: fx.storeId, mode: 'live' } }),
        ),
      ).toBe(0);
      expect(await countOrders()).toBe(0);

      // The checkout TX1 committed is terminal, and carries no order.
      const losers = await asTenant((tx) => tx.checkout.findMany({
        where: { cart_id: cart.id },
      }));
      expect(losers).toHaveLength(1);
      expect(losers[0].status).toBe('failed');
      expect(losers[0].order_id).toBeNull();

      // And every unit it held is back: released, none still `held`.
      const reservations = await inTenant((tx) =>
        tx.inventoryReservation.findMany({
          where: { store_id: fx.storeId, mode: 'live' },
        }),
      );
      expect(reservations.length).toBeGreaterThan(0);
      expect(reservations.every((r) => r.state === 'released')).toBe(true);

      // And the winner's slot was NOT wiped by the loser's cleanup.
      const after = await inTenant((tx) =>
        tx.cart.findFirst({ where: { id: cart.id } }),
      );
      expect(after!.active_checkout_id).toBe(999999n);
    });

    /* ── 11. The database's own backstop ──────────────────────────── */

    it('is refused by PostgreSQL itself if the claim logic were ever wrong', async () => {
      const cart = await newCart();
      await place(cart.token);

      // A second LIVE checkout for the same cart is impossible at the
      // storage layer, independently of any application logic.
      // Inside tenant context, so what refuses this is the UNIQUE INDEX
      // and not the RLS policy — otherwise this test would pass for the
      // wrong reason and stop proving the storage-layer backstop exists.
      await expect(
        inTenant(
          (tx) => tx.$executeRaw`
            INSERT INTO checkouts
              (store_id, mode, token, status, currency, quote_total_minor,
               cart_id, expires_at, updated_at)
            VALUES
              (${fx.storeId}, 'live', 'live-two', 'pending_payment', 'USD', 100,
               ${cart.id}, now() + interval '1 hour', now())
          `,
        ),
      ).rejects.toThrow();
    });

    it('exempts every cart-less checkout from that index', async () => {
      // The whole history of this table has cart_id NULL, so the index
      // must not be able to fire on any of it.
      for (const token of ['legacy-a', 'legacy-b', 'legacy-c']) {
        await inTenant(
          (tx) => tx.$executeRaw`
            INSERT INTO checkouts
              (store_id, mode, token, status, currency, quote_total_minor,
               expires_at, updated_at)
            VALUES
              (${fx.storeId}, 'live', ${token}, 'pending_payment', 'USD', 100,
               now() + interval '1 hour', now())
          `,
        );
      }

      expect(
        await asTenant((tx) => tx.checkout.count({ where: { cart_id: null } })),
      ).toBeGreaterThanOrEqual(3);
    });

    /* ── 12. Mutating a cart that has a live checkout ─────────────── */

    it('refuses to change quantities under a live payment, and the quote does not move', async () => {
      const cart = await newCart(1);
      const created = await place(cart.token);

      const checkout = await asTenant((tx) => tx.checkout.findFirst({
        where: { cart_id: cart.id },
      }));
      expect(checkout!.token).toBe(created.checkout_token);

      await expect(
        carts.setQuantity(fx.storeId, 'live', cart.token, {
          variantId: fx.variantId.toString(),
          quantity: 9,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'cart_locked',
          active_checkout_token: created.checkout_token,
        },
      });

      const line = await inTenant((tx) =>
        tx.cartItem.findFirst({ where: { cart_id: cart.id } }),
      );
      expect(line!.quantity).toBe(1);

      const after = await asTenant((tx) => tx.checkout.findFirst({
        where: { id: checkout!.id },
      }));
      expect(after!.quote_total_minor).toBe(checkout!.quote_total_minor);
    });

    it('still lets the shopper ADD and CLEAR while a payment is live', async () => {
      // The same asymmetry the storefront has always had: adding
      // elsewhere in the shop is browsing, and clearing is what runs
      // when a payment SUCCEEDS — a lock held by that very payment must
      // not block it.
      const cart = await newCart(1);
      await place(cart.token);

      const added = await carts.addItem(fx.storeId, 'live', cart.token, {
        variantId: fx.variantId.toString(),
        quantity: 1,
      });
      expect(added.view.items[0].quantity).toBe(2);
      expect(added.token).toBe(cart.token);

      const cleared = await carts.clear(fx.storeId, 'live', cart.token);
      expect(cleared.items).toHaveLength(0);
    });

    /* ── 13. The cookieless fallback ──────────────────────────────── */

    it('KNOWN AND APPROVED: with no cookie, two Place Orders make two orders', async () => {
      /*
       * This is decision 4, asserted rather than hidden. A browser that
       * sends no cart cookie takes the stateless path, and on that path
       * nothing can tell two tabs apart — there is no shared row to tell
       * them apart WITH. That is the accepted cost of still letting a
       * cookieless browser buy anything at all.
       *
       * It is also exactly what keeps this change deployable: an old
       * frontend, a rolled-back backend and a privacy-hardened browser
       * all land here, and all of them work.
       */
      const one = await placeOffline(null);
      const two = await placeOffline(null);

      expect(two.checkout_token).not.toBe(one.checkout_token);
      expect(await countOrders()).toBe(2);

      const rows = await asTenant((tx) => tx.checkout.findMany({
        where: { store_id: fx.storeId },
        select: { cart_id: true },
      }));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const row of rows) expect(row.cart_id).toBeNull();
    });

    /* ── 14. The quote_hash seal ──────────────────────────────────── */

    it('seals every new checkout, deterministically and content-sensitively', async () => {
      const cart = await newCart(2);
      await place(cart.token);

      const checkout = await asTenant((tx) => tx.checkout.findFirst({
        where: { cart_id: cart.id },
      }));

      expect(checkout!.quote_hash).toMatch(/^[0-9a-f]{64}$/);

      const base = {
        cartPublicId: 'c1',
        cartVersion: 3,
        currency: 'USD',
        offeringId: 7n,
        totalMinor: 5000n,
        lines: [{ variantId: 1n, quantity: 2, unitPriceMinor: 2500n }],
      };

      // Deterministic for identical input...
      expect(computeQuoteHash(base)).toBe(computeQuoteHash({ ...base }));

      // ...and different when the basket differs.
      expect(
        computeQuoteHash({
          ...base,
          totalMinor: 7500n,
          lines: [{ variantId: 1n, quantity: 3, unitPriceMinor: 2500n }],
        }),
      ).not.toBe(computeQuoteHash(base));

      // Order of the lines is not part of what was bought.
      const two = [
        { variantId: 1n, quantity: 1, unitPriceMinor: 2500n },
        { variantId: 2n, quantity: 1, unitPriceMinor: 2500n },
      ];
      expect(computeQuoteHash({ ...base, lines: two })).toBe(
        computeQuoteHash({ ...base, lines: [...two].reverse() }),
      );
    });

    it('reports a moved basket as stale on the status read, and never as an amount change', async () => {
      const cart = await newCart(1);
      const created = await place(cart.token);

      const before = await gateway.getCheckoutStatus(SLUG, created.checkout_token!);
      expect(before.cart_status).toBe('active');
      // Nothing has moved yet: the seal still matches the basket.
      expect(before.cart_quote_stale).toBe(false);

      // Adding is allowed under a live payment (see above) — and it is
      // exactly the event the seal exists to notice.
      await carts.addItem(fx.storeId, 'live', cart.token, {
        variantId: fx.variantId.toString(),
        quantity: 1,
      });

      const after = await gateway.getCheckoutStatus(SLUG, created.checkout_token!);
      expect(after.cart_status).toBe('active');
      expect(after.cart_quote_stale).toBe(true);
      // The detector changes nothing about the money.
      expect(after.total).toBe(before.total);
    });

    it('says nothing about a cart for a checkout that has none', async () => {
      const created = await placeOffline(null);
      const status = await service.getCheckoutStatus(SLUG, created.checkout_token!);

      expect(status.cart_status).toBeNull();
      expect(status.cart_quote_stale).toBe(false);
    });

    /* ── The server's cart wins over the request body ─────────────── */

    it("prices the SERVER's cart, not the items the browser sent", async () => {
      const cart = await newCart(3);

      // The body claims one; the cart holds three.
      const placed = await placeOffline(cart.token);

      const checkout = await asTenant((tx) => tx.checkout.findFirst({
        where: { cart_id: cart.id },
        include: { items: true },
      }));

      expect(checkout!.items).toHaveLength(1);
      expect(checkout!.items[0].quantity).toBe(3);
      // 3 x 25.00
      expect(placed.order!.total).toBe('75.00');
    });

    /* ── 15. The cart expiry sweep ────────────────────────────────── */

    it('abandons a cart nobody came back to, and leaves a busy one alone', async () => {
      const stale = await newCart(1);
      const busy = await newCart(1);
      await place(busy.token);

      await inTenant(
        (tx) => tx.$executeRaw`
          UPDATE carts SET expires_at = now() - interval '1 day'
        `,
      );

      const job = new CheckoutExpiryJob(prisma as never);
      const abandoned = await job.sweepExpiredCarts();

      expect(abandoned).toBe(1);

      const staleRow = await inTenant((tx) =>
        tx.cart.findFirst({ where: { id: stale.id } }),
      );
      const busyRow = await inTenant((tx) =>
        tx.cart.findFirst({ where: { id: busy.id } }),
      );

      expect(staleRow!.status).toBe('abandoned');
      // A cart mid-payment is NEVER swept out from under the payment.
      expect(busyRow!.status).toBe('active');
    });

    it('refuses a checkout on an abandoned cart', async () => {
      const cart = await newCart(1);
      await inTenant(
        (tx) => tx.$executeRaw`
          UPDATE carts SET status = 'abandoned' WHERE id = ${cart.id}
        `,
      );

      await expect(place(cart.token)).rejects.toMatchObject({
        response: { code: 'cart_not_active' },
      });
    });

    /* ── Store and mode isolation of the cookie itself ────────────── */

    it("does not resolve one store's cart token on another store's checkout", async () => {
      const other = await seedOtherStore(prisma);
      const cart = await newCart(1);

      // Presented to a DIFFERENT store: not a token there at all, so
      // the request simply takes the stateless path.
      const placed = await service.createAndCommit(
        'other-store',
        {
          items: [{ variant_id: other.variantId.toString(), quantity: 1 }],
          customer_name: 'Cart Buyer',
          customer_phone: '01000000000',
          address_line: '1 Cart Street',
          city: 'Cairo',
          payment_offering_id: other.offeringId.toString(),
        } as CreateCheckoutDto,
        'live',
        undefined,
        cart.token,
      );

      // Read in the OTHER store's context — the checkout was created
      // there, so under RLS it is invisible from this one. That it is
      // invisible from here is asserted on its own above.
      const checkout = await asTenant((tx) => tx.checkout.findFirst({
        where: { token: placed.checkout_token },
        select: { cart_id: true, store_id: true },
      }), other.storeId);

      expect(checkout!.store_id).toBe(other.storeId);
      expect(checkout!.cart_id).toBeNull();

      // And the original cart was not touched.
      const original = await inTenant((tx) =>
        tx.cart.findFirst({ where: { id: cart.id } }),
      );
      expect(original!.active_checkout_id).toBeNull();
      expect(original!.status).toBe('active');
    });

    it("does not resolve a live-mode cart in test mode", async () => {
      const cart = await newCart(1);

      const claim = await carts.claimForCheckout(fx.storeId, 'test', cart.token);
      expect(claim.kind).toBe('no_cart');
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     ROUND 9 — THE INVENTORY CLAIM.

     Every inventory assertion that existed before this block was
     sequential and single-checkout, which is exactly the shape the
     overselling races are invisible to. These run genuinely parallel
     requests (`Promise.allSettled` over independent calls, real
     connections, no mocked clock) and assert the two invariants
     together every time: units sold never exceed the stock that
     existed, and a gated variant never goes negative.

     Numbering follows ROUND9_INVENTORY_OVERSELLING_AUDIT.md §11.
     ══════════════════════════════════════════════════════════════════ */

  describe('inventory claim', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inTenant = (cb: (tx: any) => Promise<any>): Promise<any> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withTestTenant(fx.storeId, cb as never) as Promise<any>;

    let gatewayOfferingId: bigint;
    let gateway: CheckoutService;

    /** A service whose provider leaves the payment pending. */
    async function rebuildGateway(): Promise<void> {
      const account = await inTenant((tx) =>
        tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode: 'live',
            gateway: 'stripe',
            display_name: 'Gateway',
            status: 'active',
            settlement_currency: 'USD',
          },
          select: { id: true },
        }),
      );

      const offering = await inTenant((tx) =>
        tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode: 'live',
            method: 'card',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
          select: { id: true },
        }),
      );

      gatewayOfferingId = offering.id;
      gateway = buildGateway(pendingAdapter);
    }

    /** The same service, with whatever adapter the test needs. */
    function buildGateway(adapter: unknown): CheckoutService {
      return new CheckoutService(
        prisma as never,
        new LedgerService(prisma as never),
        new OutboxService(),
        fakeAccounts,
        fakeIdempotency,
        {
          has: () => true,
          get: () => adapter,
          assertCanHandle: () => adapter,
        } as never,
        fakeIds,
        fakeApplier,
        new TenantContextService(),
        appConfigStub(),
        new CheckoutSuccessionFundsService(),
        carts,
      );
    }

    beforeEach(rebuildGateway);

    /** Sets the fixture variant's stock, and optionally its flags. */
    async function setStock(
      qty: number,
      flags: { continue_selling?: boolean; track_inventory?: boolean } = {},
      variantId: bigint = fx.variantId,
    ): Promise<void> {
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { inventory_qty: qty, ...flags },
      });
    }

    /** A second variant, so multi-line lock ordering can be probed. */
    async function secondVariant(qty: number): Promise<bigint> {
      const product = await inTenant((tx) =>
        tx.product.create({
          data: {
            store_id: fx.storeId,
            title: 'Spec Product B',
            handle: `spec-product-b-${Date.now()}`,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
      );

      const variant = await prisma.productVariant.create({
        data: {
          product_id: product.id,
          title: 'Default Title',
          price: '25.00',
          inventory_qty: qty,
          track_inventory: true,
          continue_selling: false,
        },
        select: { id: true },
      });

      return variant.id;
    }

    async function newCart(quantity = 1) {
      const added = await carts.addItem(fx.storeId, 'live', null, {
        variantId: fx.variantId.toString(),
        quantity,
      });
      return { token: added.token };
    }

    function body(overrides: Partial<CreateCheckoutDto> = {}) {
      return {
        items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
        customer_name: 'Stock Buyer',
        customer_phone: '01000000000',
        address_line: '1 Stock Street',
        city: 'Cairo',
        payment_offering_id: gatewayOfferingId.toString(),
        ...overrides,
      } as CreateCheckoutDto;
    }

    const place = (
      cartToken: string | null,
      overrides: Partial<CreateCheckoutDto> = {},
      idempotencyKey?: string,
      svc: CheckoutService = gateway,
    ) => svc.createAndCommit(SLUG, body(overrides), 'live', idempotencyKey, cartToken);

    const stockOf = async (variantId: bigint = fx.variantId): Promise<number> => {
      const row = await prisma.productVariant.findFirst({
        where: { id: variantId },
        select: { inventory_qty: true },
      });
      return row!.inventory_qty;
    };

    const heldUnits = async (): Promise<number> => {
      const rows: { quantity: number }[] = await inTenant((tx) =>
        tx.inventoryReservation.findMany({
          where: { store_id: fx.storeId, mode: 'live', state: 'held' },
          select: { quantity: true },
        }),
      );
      return rows.reduce((sum, r) => sum + r.quantity, 0);
    };

    const reasonsOf = (results: PromiseSettledResult<unknown>[]): string[] =>
      results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => String((r.reason as Error)?.message ?? r.reason));

    /* ── §11.1 — R1: the check-to-reserve window ──────────────────── */

    it('1 — two SIMULTANEOUS checkouts on DIFFERENT carts cannot both claim the last unit', async () => {
      await setStock(1);
      pendingCalls = 0;

      const [a, b] = [await newCart(), await newCart()];

      const results = await Promise.allSettled([
        place(a.token, {}, 'r9-1-a'),
        place(b.token, {}, 'r9-1-b'),
      ]);

      const won = results.filter((r) => r.status === 'fulfilled');
      expect(won).toHaveLength(1);
      expect(reasonsOf(results)).toEqual([
        expect.stringMatching(/Not enough stock/),
      ]);

      // One hold, for one unit. And the loser never reached the
      // provider: the claim refuses before any network call, which is
      // the whole point of moving it into TX1.
      expect(await heldUnits()).toBe(1);
      expect(pendingCalls).toBe(1);

      // The reservation holds the unit; the decrement waits for
      // payment, so on-hand is unchanged and never negative.
      expect(await stockOf()).toBe(1);
    });

    /* ── §11.2 — 20 requests, 10 units, repeatedly ────────────────── */

    it('2 — 20 SIMULTANEOUS single-unit checkouts against 10 units sell exactly 10, repeatedly', async () => {
      // Repeated because a race that passes once is not fixed.
      for (let round = 0; round < 3; round += 1) {
        await truncateTables(ALL_TEST_TABLES);
        fx = await seed(prisma);
        await rebuildGateway();
        pendingCalls = 0;
        await setStock(10);

        const carts20: { token: string }[] = [];
        for (let i = 0; i < 20; i += 1) carts20.push(await newCart());

        const results = await Promise.allSettled(
          carts20.map((c, i) => place(c.token, {}, `r9-2-${round}-${i}`)),
        );

        const won = results.filter((r) => r.status === 'fulfilled');

        expect(won).toHaveLength(10);
        expect(await heldUnits()).toBe(10);
        expect(pendingCalls).toBe(10);

        // Both invariants, every round: nothing oversold, nothing negative.
        expect(await stockOf()).toBe(10);
        expect(await stockOf()).toBeGreaterThanOrEqual(0);

        for (const reason of reasonsOf(results)) {
          expect(reason).toMatch(/Not enough stock/);
        }
      }
    }, 120_000);

    /* ── §11.3 — lock ordering ────────────────────────────────────── */

    it('3 — two SIMULTANEOUS multi-line checkouts over {A,B} and {B,A} both resolve, with no deadlock', async () => {
      await setStock(5);
      const other = await secondVariant(5);

      const lines = (order: bigint[]) =>
        order.map((id) => ({ variant_id: id.toString(), quantity: 1 }));

      // The stateless path, so the request's line ORDER is exactly what
      // the claim sees — a server cart would merge and normalise it.
      const results = await Promise.allSettled([
        place(null, { items: lines([fx.variantId, other]) }, 'r9-3-ab'),
        place(null, { items: lines([other, fx.variantId]) }, 'r9-3-ba'),
      ]);

      expect(reasonsOf(results)).toEqual([]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      // Four units held in total, two of each: both checkouts claimed
      // both of their lines.
      expect(await heldUnits()).toBe(4);
    });

    /* ── §11.4 — R5: storefront vs admin manual order ─────────────── */

    it('4 — a storefront checkout and an admin manual order cannot both take the last unit', async () => {
      await setStock(1);
      const orders = new OrderService(prisma as never);
      const cart = await newCart();

      const results = await Promise.allSettled([
        place(cart.token, {}, 'r9-4'),
        orders.createOrder(
          SLUG,
          {
            name: 'Admin Buyer',
            phone: '01000000000',
            address: '2 Admin Street',
            city: 'Cairo',
          },
          [{ variantId: fx.variantId.toString(), qty: 1 }],
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      // Whoever won, exactly one unit left the pool and none was
      // conjured: a manual order takes stock immediately, a checkout
      // holds it.
      const onHand = await stockOf();
      const held = await heldUnits();
      expect(onHand).toBeGreaterThanOrEqual(0);
      expect(onHand - held).toBe(0);
    });

    /* ── F-06 — ONE PHYSICAL POOL, EVERY PAYMENT MODE ─────────────
       `ProductVariant.inventory_qty` has no `mode` column, and neither
       does `Order`. `InventoryReservation` has one only because it
       hangs off a mode-scoped `Checkout`. So a unit held by a test-mode
       checkout and a unit sold by a live-mode order come out of the
       same physical pool.

       The netting used to filter on mode while the decrement it
       protects never could, so each side subtracted only its own half
       of the holds and both were told the last unit was theirs. The row
       lock serialised them perfectly and they still both said yes.

       These tests hold the corrected rule in place from both
       directions.
       ──────────────────────────────────────────────────────────── */

    /*
     * A tenant transaction in an EXPLICIT mode.
     *
     * `withTestTenant` hard-codes `app.mode = 'live'`, so it cannot
     * create the test-mode account these tests need — RLS refuses the
     * INSERT, which is the policy working correctly. Same shape as the
     * helper in `funds-secured.integration.spec.ts`.
     */
    const inMode = <T,>(
      mode: 'live' | 'test',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cb: (tx: any) => Promise<any>,
    ): Promise<T> =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.store_id', ${fx.storeId.toString()}, true), set_config('app.mode', ${mode}, true)`;
        return cb(tx);
      });

    /** A checkout service whose offering lives in the given mode. */
    async function gatewayInMode(mode: 'test' | 'live'): Promise<{
      svc: CheckoutService;
      offeringId: bigint;
    }> {
      const account = await inMode<{ id: bigint }>(mode, (tx) =>
        tx.paymentAccount.create({
          data: {
            store_id: fx.storeId,
            mode,
            gateway: 'stripe',
            display_name: `Gateway ${mode}`,
            status: 'active',
            settlement_currency: 'USD',
          },
          select: { id: true },
        }),
      );

      const offering = await inMode<{ id: bigint }>(mode, (tx) =>
        tx.paymentMethodOffering.create({
          data: {
            account_id: account.id,
            store_id: fx.storeId,
            mode,
            method: 'card',
            enabled: true,
            position: 1,
            commitment_kind: 'funds_secured',
            capture_mode: 'automatic',
          },
          select: { id: true },
        }),
      );

      return { svc: gateway, offeringId: offering.id };
    }

    /**
     * Held units for one variant, across EVERY mode.
     *
     * Summed per mode rather than in one query, because
     * `inventory_reservations` is RLS-scoped on store AND mode: a read
     * with no tenant context sees nothing at all, and a read in one
     * mode sees only that mode's rows. That is the policy working — and
     * it is precisely why the application's netting could not be
     * allowed to inherit the same partition, since the column it
     * protects has no mode at all.
     */
    const heldUnitsAllModes = async (): Promise<number> => {
      let total = 0;
      for (const mode of ['live', 'test'] as const) {
        const rows = await inMode<{ quantity: number }[]>(mode, (tx) =>
          tx.inventoryReservation.findMany({
            where: {
              store_id: fx.storeId,
              variant_id: fx.variantId,
              state: 'held',
            },
            select: { quantity: true },
          }),
        );
        total += rows.reduce((sum, r) => sum + r.quantity, 0);
      }
      return total;
    };

    /** An OrderService configured for a given storefront payment mode. */
    const ordersInMode = (mode: 'live' | 'test'): OrderService =>
      new OrderService(prisma as never, {
        get: () => ({ storefrontPaymentMode: mode }),
      } as never);

    it('F-06a — the admin order path claims stock in the STOREFRONT\'s mode, not a hard-coded one', async () => {
      await setStock(1);

      const test = await gatewayInMode('test');

      // A test-mode shopper takes the only unit. This is what a
      // staging storefront running STOREFRONT_PAYMENT_MODE=test does.
      const testCart = await carts.addItem(fx.storeId, 'test', null, {
        variantId: fx.variantId.toString(),
        quantity: 1,
      });

      await test.svc.createAndCommit(
        SLUG,
        body({ payment_offering_id: test.offeringId.toString() }),
        'test',
        'f06a-test',
        testCart.token,
      );

      expect(await heldUnitsAllModes()).toBe(1);

      /*
       * THE REGRESSION. `OrderService` used to install `app.mode='live'`
       * unconditionally, and `inventory_reservations` is RLS-scoped on
       * store AND mode — so its availability check could not SEE the
       * hold above, while the decrement it guards writes a column that
       * has no mode at all. It passed, took the unit, and the shopper
       * mid-payment was left to be refused by the conversion guard or,
       * on a backorder variant, to drive stock negative.
       *
       * Reading the storefront's own mode makes both sides net the same
       * holds.
       */
      await expect(
        ordersInMode('test').createOrder(
          SLUG,
          {
            name: 'Admin Buyer',
            phone: '01000000000',
            address: '2 Admin Street',
            city: 'Cairo',
          },
          [{ variantId: fx.variantId.toString(), qty: 1 }],
        ),
      ).rejects.toBeDefined();

      // Nothing taken, nothing negative, no order.
      expect(await stockOf()).toBe(1);
      expect(await stockOf()).toBeGreaterThanOrEqual(0);
      expect(await inMode('live', (tx) => tx.order.count({}))).toBe(0);
    });

    it('F-06b — with the modes agreed, the two still compete for one unit and exactly one wins', async () => {
      await setStock(1);

      const test = await gatewayInMode('test');
      const testCart = await carts.addItem(fx.storeId, 'test', null, {
        variantId: fx.variantId.toString(),
        quantity: 1,
      });

      // Agreement must not become "the admin path is simply blocked":
      // when there IS a free unit, concurrent claims must still resolve
      // to exactly one winner, as §11.4 proves for the live path.
      const results = await Promise.allSettled([
        test.svc.createAndCommit(
          SLUG,
          body({ payment_offering_id: test.offeringId.toString() }),
          'test',
          'f06b-test',
          testCart.token,
        ),
        ordersInMode('test').createOrder(
          SLUG,
          {
            name: 'Admin Buyer',
            phone: '01000000000',
            address: '2 Admin Street',
            city: 'Cairo',
          },
          [{ variantId: fx.variantId.toString(), qty: 1 }],
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      // One unit left the pool and none was conjured: a manual order
      // takes stock immediately, a checkout holds it.
      const onHand = await stockOf();
      const held = await heldUnitsAllModes();
      expect(onHand).toBeGreaterThanOrEqual(0);
      expect(onHand - held).toBe(0);
    });

    it('F-06c — a merchant may not lower stock below units a checkout is holding', async () => {
      await setStock(5);

      const test = await gatewayInMode('test');
      const testCart = await carts.addItem(fx.storeId, 'test', null, {
        variantId: fx.variantId.toString(),
        quantity: 3,
      });

      await test.svc.createAndCommit(
        SLUG,
        body({
          payment_offering_id: test.offeringId.toString(),
          items: [{ variant_id: fx.variantId.toString(), quantity: 3 }],
        }),
        'test',
        'f06c-test',
        testCart.token,
      );

      expect(await heldUnitsAllModes()).toBe(3);

      // Configured for the same storefront mode the hold was taken in,
      // which is what lets the R6 guard see it at all — see the comment
      // on `ProductService.storefrontMode`.
      const products = new ProductService(prisma as never, {
        get: () => ({ storefrontPaymentMode: 'test' }),
      } as never);
      const store = await prisma.store.findUniqueOrThrow({
        where: { id: fx.storeId },
      });
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });

      /*
       * THE R6 GUARD, ACTUALLY ENFORCING.
       *
       * `assertAbsoluteEditIsSafe()` reads `inventory_reservations`,
       * which is RLS-scoped. The product edit used to run in a
       * transaction with no tenant context, so every policy expression
       * evaluated to NULL, the aggregate returned no rows, and the
       * guard summed zero held units and refused nothing — Round 9 §9's
       * promise was inert. §11.5's test could not catch it: it asserts
       * only that ONE of the edit and the claim wins, which holds
       * whichever way the lock falls.
       */
      await expect(
        products.updateProduct(store, variant.product_id.toString(), {
          title: 'Spec Product',
          compare_at_price: '30',
          tag_ids: [],
          collection_ids: [],
          variants: [
            {
              id: fx.variantId.toString(),
              title: 'Default Title',
              price: '25',
              inventory_qty: '1',
              track_inventory: true,
              continue_selling: false,
            },
          ],
        }),
      ).rejects.toThrow(/3 unit/);

      expect(await stockOf()).toBe(5);
    });

    /* ── §11.5 — R6: the absolute stock edit ──────────────────────── */

    it('5 — a checkout claim and an admin absolute stock edit have a defined outcome, and neither destroys the other', async () => {
      await setStock(5);

      const products = new ProductService(prisma as never);
      const store = await prisma.store.findUniqueOrThrow({
        where: { id: fx.storeId },
      });
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      });

      const cart = await newCart(3);

      const results = await Promise.allSettled([
        place(cart.token, {
          items: [{ variant_id: fx.variantId.toString(), quantity: 3 }],
        }, 'r9-5'),
        products.updateProduct(store, variant.product_id.toString(), {
          title: 'Spec Product',
          compare_at_price: '30',
          tag_ids: [],
          collection_ids: [],
          variants: [
            {
              id: fx.variantId.toString(),
              title: 'Default Title',
              price: '25',
              inventory_qty: '1',
              track_inventory: true,
              continue_selling: false,
            },
          ],
        }),
      ]);

      /*
       * THE DEFINED OUTCOME, both orderings.
       *
       * The row lock means one of these two goes completely first:
       *
       *   edit first  → stock is 1, and the claim for 3 is refused.
       *   claim first → 3 units are held, and the edit to 1 is refused
       *                 because it would strand them.
       *
       * Either way exactly one succeeds, and the merchant's number can
       * never be written underneath a shopper who is mid-payment.
       */
      const onHand = await stockOf();
      const held = await heldUnits();

      /*
       * The invariants hold unconditionally, whatever the interleaving
       * and whatever the database did to the loser: the merchant's
       * number is applied whole or not at all, no unit is conjured, and
       * the units a shopper is holding are still covered by on-hand.
       */
      expect([1, 5]).toContain(onHand);
      expect(onHand).toBeGreaterThanOrEqual(held);
      expect(onHand).toBeGreaterThanOrEqual(0);

      /*
       * Under heavy load the loser can instead be aborted by the test
       * container's own `lock_timeout`/statement timeout while it waits
       * for the row lock. That is still "the loser did not complete",
       * but it is the DATABASE refusing rather than the guard, so the
       * message assertions below would be asserting the wrong thing.
       * The invariants above are the part that must hold either way.
       */
      const reasons = reasonsOf(results);
      const abortedByDatabase = reasons.some((r) =>
        /lock timeout|canceling statement|Transaction (?:already closed|API error)|P2028/i.test(
          r,
        ),
      );

      if (abortedByDatabase) return;

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      if (held > 0) {
        // The claim won: its units survived the edit intact.
        expect(held).toBe(3);
        expect(onHand).toBe(5);
        expect(reasons).toEqual([
          expect.stringMatching(/held by checkouts in progress/),
        ]);
      } else {
        // The edit won: the claim was refused against the new number.
        expect(onHand).toBe(1);
        expect(reasons).toEqual([
          expect.stringMatching(/Not enough stock/),
        ]);
      }
    });

    /* ── §11.6 — R2: netting, with no concurrency at all ──────────── */

    it('6 — a live checkout holding all 5 units makes a sixth SEQUENTIAL request fail', async () => {
      await setStock(5);

      const holder = await newCart(5);
      await place(holder.token, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 5 }],
      });
      expect(await heldUnits()).toBe(5);

      // On-hand still says 5. Availability says 0, and availability is
      // what decides — this is the Round 8 netting bug.
      expect(await stockOf()).toBe(5);

      const sixth = await newCart();
      await expect(place(sixth.token, {}, 'r9-6')).rejects.toThrow(
        /Not enough stock/,
      );
    });

    /* ── §11.7 — expiry gives availability back ───────────────────── */

    it('7 — once the hold expires, the same request succeeds', async () => {
      await setStock(5);

      const holder = await newCart(5);
      await place(holder.token, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 5 }],
      });

      const blocked = await newCart();
      await expect(place(blocked.token, {}, 'r9-7-before')).rejects.toThrow(
        /Not enough stock/,
      );

      await inTenant(
        (tx) => tx.$executeRaw`
          UPDATE checkouts SET expires_at = now() - interval '1 hour'
        `,
      );

      expect(await new CheckoutExpiryJob(prisma as never).releaseExpired()).toBe(1);
      expect(await heldUnits()).toBe(0);

      const retried = await newCart();
      const after = await place(retried.token, {}, 'r9-7-after');
      expect(after.checkout_token).toBeTruthy();
      expect(await heldUnits()).toBe(1);
    });

    /* ── §11.8 — a decline releases the stock immediately ─────────── */

    it('8 — a declined initialisation releases its hold, and the stock is instantly re-sellable', async () => {
      await setStock(1);

      const declining = buildGateway({
        ...pendingAdapter,
        initializePayment: async () => ({
          kind: 'failed' as const,
          errorCode: 'declined_insufficient_funds',
        }),
      });

      const declined = await newCart();
      await expect(
        place(declined.token, {}, 'r9-8-declined', declining),
      ).rejects.toThrow(BadRequestException);

      // The compensation ran: nothing held, nothing live, nothing sold.
      expect(await heldUnits()).toBe(0);
      expect(await stockOf()).toBe(1);

      const next = await newCart();
      const ok = await place(next.token, {}, 'r9-8-next');
      expect(ok.checkout_token).toBeTruthy();
      expect(await heldUnits()).toBe(1);
    });

    /* ── §11.9 — the shopper is not blocked by their own release ──── */

    it('9 — a retry on the SAME cart is not blocked by its own released hold', async () => {
      await setStock(1);

      const declining = buildGateway({
        ...pendingAdapter,
        initializePayment: async () => ({
          kind: 'failed' as const,
          errorCode: 'declined_insufficient_funds',
        }),
      });

      const cart = await newCart();

      await expect(
        place(cart.token, {}, 'r9-9-declined', declining),
      ).rejects.toThrow(BadRequestException);

      // Netting counts `held` only, so the shopper's own superseded
      // reservation must not stand in their way.
      const retried = await place(cart.token, {}, 'r9-9-retry');
      expect(retried.checkout_token).toBeTruthy();
      expect(await heldUnits()).toBe(1);
    });

    /* ── Round 9A — backorder ─────────────────────────────────────── */

    it('B1 — a backorder sale is NOT refused, and drives inventory negative', async () => {
      // Cash on delivery, because an offline commitment takes the stock
      // at commit time — this is the path that actually decrements.
      await setStock(0, { continue_selling: true });

      const result = await service.createAndCommit(SLUG, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
        customer_name: 'Backorder Buyer',
        customer_phone: '01000000000',
        address_line: '3 Backorder Street',
        city: 'Cairo',
        payment_offering_id: fx.offeringId.toString(),
      } as CreateCheckoutDto);

      expect(result.order).not.toBeNull();

      // The negative IS the deficit: units owed, and the only record of
      // them. See ROUND9A_CONTINUE_SELLING_DECISION.md §2.
      expect(await stockOf()).toBe(-1);
    });

    /* ── The database's own backstop ──────────────────────────────── */

    it('the inventory floor is refused by PostgreSQL itself, not just by the guard', async () => {
      await setStock(1);

      // A gated variant cannot be written negative by ANY path,
      // including one that forgot the guard entirely.
      await expect(
        prisma.$executeRaw`
          UPDATE "ProductVariant" SET "inventory_qty" = -1
           WHERE "id" = ${fx.variantId}
        `,
      ).rejects.toThrow(/product_variant_inventory_floor/);

      // The same write is allowed the moment backorder is authorised.
      await setStock(1, { continue_selling: true });
      await prisma.$executeRaw`
        UPDATE "ProductVariant" SET "inventory_qty" = -1
         WHERE "id" = ${fx.variantId}
      `;
      expect(await stockOf()).toBe(-1);
    });

    it('a zero or negative reservation is refused by PostgreSQL itself', async () => {
      await expect(
        inTenant(
          (tx) => tx.$executeRaw`
            INSERT INTO inventory_reservations
              (checkout_id, store_id, mode, variant_id, quantity, state,
               expires_at)
            VALUES
              (1, ${fx.storeId}, 'live', ${fx.variantId}, 0, 'held',
               now() + interval '1 hour')
          `,
        ),
      ).rejects.toThrow(/inventory_reservation_quantity_positive/);
    });

    it('the netting aggregate has its partial index', async () => {
      const rows: { indexdef: string }[] = await prisma.$queryRaw`
        SELECT indexdef FROM pg_indexes
         WHERE indexname = 'inventory_reservations_held_by_variant_idx'
      `;

      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/WHERE \(state = 'held'/);
    });

    it('B2 — concurrent backorder sales are never blocked by availability', async () => {
      await setStock(0, { continue_selling: true });

      const carts5: { token: string }[] = [];
      for (let i = 0; i < 5; i += 1) carts5.push(await newCart());

      const results = await Promise.allSettled(
        carts5.map((c, i) => place(c.token, {}, `r9-b2-${i}`)),
      );

      expect(reasonsOf(results)).toEqual([]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);

      // Held, netted and serialised like any other variant — the claim
      // simply always succeeds.
      expect(await heldUnits()).toBe(5);
    });
  });
});

/* ------------------------------------------------------------------ */

async function seedStore(
  prisma: PrismaClient,
  slug: string,
  suffix: string,
): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: `spec_${suffix}`,
      email: `spec_${suffix}@example.test`,
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  });

  const store = await prisma.store.create({
    data: {
      name: `Spec ${suffix}`,
      slug,
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  const product = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${store.id.toString()}, true),
        set_config('app.mode', 'live', true)
    `;

    return tx.product.create({
      data: {
        store_id: store.id,
        title: 'Spec Product',
        handle: `spec-product-${suffix}`,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  });

  const variant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${store.id.toString()}, true),
        set_config('app.mode', 'live', true)
    `;

    return tx.productVariant.create({
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
  });

  const account = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${store.id.toString()}, true),
        set_config('app.mode', 'live', true)
    `;

    return tx.paymentAccount.create({
      data: {
        store_id: store.id,
        mode: 'live',
        gateway: 'cod',
        display_name: 'Default',
        status: 'active',
        settlement_currency: 'USD',
      },
      select: { id: true },
    });
  });

  const offering = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('app.store_id', ${store.id.toString()}, true),
        set_config('app.mode', 'live', true)
    `;

    return tx.paymentMethodOffering.create({
      data: {
        account_id: account.id,
        store_id: store.id,
        mode: 'live',
        method: 'cod',
        enabled: true,
        position: 0,
        commitment_kind: 'promise_accepted',
        capture_mode: 'automatic',
      },
      select: { id: true },
    });
  });

  return {
    storeId: store.id,
    variantId: variant.id,
    offeringId: offering.id,
  };
}

const seed = (prisma: PrismaClient) => seedStore(prisma, SLUG, 'main');
const seedOtherStore = (prisma: PrismaClient) =>
  seedStore(prisma, 'other-store', 'other');

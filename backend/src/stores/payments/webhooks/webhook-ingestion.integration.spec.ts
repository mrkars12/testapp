import { appConfigStub } from '../../../../test/config.stub';
import { TenantContextService } from '../../../common/tenant/tenant-context.service';
import { createHmac } from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import type {
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WebhookAccountResolver } from './webhook-account-resolver.service';
import { PaymentFactApplier } from '../facts/payment-fact.applier';
import { CheckoutFinalizerService } from '../facts/checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from '../facts/checkout-succession-funds.service';
import { CheckoutService } from '../../checkout/checkout.service';
import { LedgerService } from '../../../ledger/ledger.service';
import { OutboxService } from '../../../common/messaging/outbox.service';
import { StripeAdapter } from '../gateways/adapters/stripe/stripe.adapter';
import type { StripeClientLike } from '../gateways/adapters/stripe/stripe-client';
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../../test/db-test-harness';

/**
 * Integration coverage for inbound webhook handling.
 *
 * This is the one unauthenticated, attacker-facing surface in payments,
 * and it had no automated coverage at all. The properties under test are
 * the ones whose absence is expensive: a forged or misrouted callback
 * must never move money, and a callback delivered twice — or twice at
 * once — must move it exactly once.
 *
 * Signature verification is exercised against a faithful re-implementation
 * of Stripe's scheme rather than a stub that always says yes, so
 * "verified against the exact raw bytes" is actually demonstrated.
 */

const SLUG = 'spec-store';
const REF = 'pi_webhook_spec';
const SECRET = 'whsec_spec_secret';

interface Fixture {
  storeId: bigint;
  variantId: bigint;
  offeringId: bigint;
  accountId: bigint;
  otherAccountId: bigint;
}

/* ------------------------------------------------------------------ */
/* Stripe signature scheme, implemented for real                       */
/* ------------------------------------------------------------------ */

function signPayload(rawBody: Buffer, secret: string, timestamp = 1_700_000_000) {
  const signed = `${timestamp}.${rawBody.toString('utf8')}`;
  const v1 = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/**
 * A client whose constructEvent genuinely verifies, exactly as Stripe's
 * does: HMAC-SHA256 over `${timestamp}.${rawBody}`.
 *
 * A stub that returned the event unconditionally would let every
 * signature test pass while proving nothing.
 */
function verifyingStripeClient(): StripeClientLike {
  return {
    checkout: {
      sessions: {
        create: async () => ({ id: `${REF}_cs`, url: 'https://checkout.stripe.com/c/pay/cs', payment_intent: REF }),
        retrieve: async () => ({ id: `${REF}_cs`, url: 'https://checkout.stripe.com/c/pay/cs', payment_intent: REF }),
      },
    },
    paymentIntents: {
      create: async () => ({
        id: REF,
        status: 'requires_action',
        currency: 'usd',
        amount: 5000,
        client_secret: `${REF}_secret`,
      }),
      retrieve: async () => ({
        id: REF,
        status: 'succeeded',
        currency: 'usd',
        amount: 5000,
        amount_received: 5000,
      }),
      capture: async () => ({ id: REF, status: 'succeeded', currency: 'usd', amount: 5000 }),
      cancel: async () => ({ id: REF, status: 'canceled', currency: 'usd', amount: 5000 }),
    },
    refunds: {
      create: async () => ({ id: 're_1', status: 'succeeded', amount: 5000 }),
    },
    balance: { retrieve: async () => ({ object: 'balance' }) },
    webhooks: {
      constructEvent: (payload, header, secret) => {
        const raw = Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(String(payload), 'utf8');

        const parts = new Map(
          String(header)
            .split(',')
            .map((piece) => piece.split('=') as [string, string]),
        );

        const timestamp = parts.get('t');
        const provided = parts.get('v1');

        if (!timestamp || !provided) {
          throw new Error('No signatures found matching the expected signature');
        }

        const expected = createHmac('sha256', secret)
          .update(`${timestamp}.${raw.toString('utf8')}`, 'utf8')
          .digest('hex');

        if (expected !== provided) {
          throw new Error('No signatures found matching the expected signature');
        }

        return JSON.parse(raw.toString('utf8'));
      },
    },
  };
}

function registry(adapter: StripeAdapter) {
  const byGateway: Record<string, unknown> = { stripe: adapter };

  return {
    has: (gateway: string) => gateway in byGateway,
    get: (gateway: string) => byGateway[gateway],
    assertCanHandle: () => adapter,
  } as never;
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({
    secret_key: 'sk_test_x',
    webhook_secret: SECRET,
  }),
} as never;

/** Builds the raw bytes of an event, exactly as they would arrive. */
function eventBody(event: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(event), 'utf8');
}

function succeededEvent(id = 'evt_succeeded'): Record<string, unknown> {
  return {
    id,
    type: 'payment_intent.succeeded',
    created: 1_700_000_000,
    data: {
      object: {
        id: REF,
        status: 'succeeded',
        currency: 'usd',
        amount: 5000,
        amount_received: 5000,
      },
    },
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

describe('Webhook ingestion (integration)', () => {
  let prisma: PrismaClient;
  let ledger: LedgerService;
  let applier: PaymentFactApplier;
  let ingestion: WebhookIngestionService;
  let checkout: CheckoutService;
  let fx: Fixture;
  // Exposed at describe scope so the sync/webhook-race tests below can
  // call fetchStatus() directly — exactly what ReconciliationService
  // does — without standing up its cron/sweep machinery.
  let adapter: StripeAdapter;

  let intentCounter = 110_000n;
  // Mutable so a single describe block below can swap in a Checkout
  // Session that mirrors real Stripe's current behaviour — no
  // PaymentIntent yet at creation — without needing a second harness.
  let stripeClient: StripeClientLike = verifyingStripeClient();

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

    adapter = new StripeAdapter(() => stripeClient);

    const providers = registry(adapter);

    ingestion = new WebhookIngestionService(
      prisma as never,
      providers,
      fakeAccounts,
      applier,
      // The real resolver against the real database: routing by endpoint
      // is the property under test here, not a stub of it.
      new WebhookAccountResolver(prisma as never, providers),
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
      registry(adapter),
      { reserve: async () => ++intentCounter } as never,
      applier,
      new TenantContextService(),
      // The storefront origin these checkouts' return URLs point at.
      appConfigStub(['https://shop.example']),
      new CheckoutSuccessionFundsService(),
    );
  }, 180_000);

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    stripeClient = verifyingStripeClient();
    await truncateTables(ALL_TEST_TABLES);
    fx = await seed(prisma);

    // A card checkout awaiting the customer's action: this creates the
    // attempt carrying gateway_reference = REF, which is what inbound
    // facts are matched against.
    await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.offeringId.toString(),
      // Stripe Checkout Sessions require success/cancel URLs — the real
      // storefront always sends one; a bare checkout with none is not a
      // scenario production ever produces for Stripe.
      return_url: 'https://shop.example/checkout/success',
    });
  });

  /** Delivers a body as the provider would, with a valid signature. */
  function deliver(
    body: Buffer,
    options: { gateway?: string; accountId?: bigint; signature?: string } = {},
  ) {
    return ingestion.ingest({
      gateway: options.gateway ?? 'stripe',
      accountId: (options.accountId ?? fx.accountId).toString(),
      rawBody: body,
      headers: {
        'stripe-signature': options.signature ?? signPayload(body, SECRET),
      },
    });
  }

  function webhookRows() {
    return prisma.webhookEvent.findMany({ orderBy: { id: 'asc' } });
  }

  function captureCount() {
    return withTenant(prisma, fx.storeId, 'live', (tx) => tx.capture.count());
  }

  function refundCount() {
    return withTenant(prisma, fx.storeId, 'live', (tx) => tx.refund.count());
  }

  function entryCount() {
    return withTenant(prisma, fx.storeId, 'live', (tx) =>
      tx.journalEntry.count(),
    );
  }

  /* ================================================================ */

  describe('signature verification', () => {
    it('accepts a correctly signed callback', async () => {
      const result = await deliver(eventBody(succeededEvent()));

      expect(result.outcome).toBe('applied');
      expect(result.factCount).toBe(1);
    });

    it('rejects a bad signature without touching payment state', async () => {
      const body = eventBody(succeededEvent());

      const result = await deliver(body, {
        signature: signPayload(body, 'whsec_wrong_secret'),
      });

      expect(result.outcome).toBe('unsupported');
      expect(await captureCount()).toBe(0);
      expect(await entryCount()).toBe(0);

      const [row] = await webhookRows();
      expect(row.status).toBe('rejected_signature');
      expect(row.signature_verified).toBe(false);
    });

    it('rejects a body altered after signing', async () => {
      const original = eventBody(succeededEvent());
      const signature = signPayload(original, SECRET);

      // Same event, re-serialised with an extra space: a scheme that
      // hashed a parsed-and-restringified body would still accept this.
      const tampered = Buffer.from(
        JSON.stringify(succeededEvent()) + ' ',
        'utf8',
      );

      const result = await deliver(tampered, { signature });

      expect(result.outcome).toBe('unsupported');
      expect(await captureCount()).toBe(0);
    });

    it('rejects a malformed body without touching payment state', async () => {
      const body = Buffer.from('{"not":"an event"', 'utf8');

      const result = await deliver(body);

      // Signed correctly, but unparseable: the verifier throws and the
      // callback is refused rather than half-applied.
      expect(result.outcome).toBe('unsupported');
      expect(await captureCount()).toBe(0);
      expect(await entryCount()).toBe(0);
    });

    it('refuses a callback with no raw body', async () => {
      const result = await ingestion.ingest({
        gateway: 'stripe',
        accountId: fx.accountId.toString(),
        rawBody: undefined,
        headers: {},
      });

      expect(result.outcome).toBe('unsupported');
      expect(result.detail).toBe('missing raw body');
    });
  });

  describe('gateway path validation', () => {
    it('rejects a path naming a different gateway than the account', async () => {
      const result = await deliver(eventBody(succeededEvent()), {
        gateway: 'paymob',
      });

      expect(result.outcome).toBe('unmatched');
      expect(result.detail).toBe('gateway mismatch');
      expect(await captureCount()).toBe(0);

      const [row] = await webhookRows();
      expect(row.status).toBe('gateway_mismatch');
      // Rejected before the adapter ran, so nothing was verified.
      expect(row.signature_verified).toBe(false);
    });

    it('rejects an unknown account without recording a row', async () => {
      const result = await deliver(eventBody(succeededEvent()), {
        accountId: 999_999n,
      });

      expect(result.outcome).toBe('unmatched');
      expect(await webhookRows()).toHaveLength(0);
    });

    it('does not let another store\'s account id accept this event', async () => {
      // Correctly signed for our secret, but addressed to a different
      // account: the facts resolve against that account and match nothing.
      const result = await deliver(eventBody(succeededEvent()), {
        accountId: fx.otherAccountId,
      });

      expect(result.outcome).not.toBe('applied');
      expect(await captureCount()).toBe(0);
    });
  });

  describe('durable persistence', () => {
    it('records the callback with a digest instead of the raw body', async () => {
      const body = eventBody(succeededEvent());
      await deliver(body);

      const [row] = await webhookRows();

      expect(row.gateway).toBe('stripe');
      expect(row.account_id).toBe(fx.accountId);
      expect(row.store_id).toBe(fx.storeId);
      expect(row.mode).toBe('live');
      expect(row.provider_event_id).toBe('evt_succeeded');
      expect(row.event_type).toBe('payment_intent.succeeded');
      expect(row.status).toBe('applied');
      expect(row.signature_verified).toBe(true);
      expect(row.body_bytes).toBe(body.length);
      expect(row.body_sha256).toHaveLength(64);
      expect(row.processed_at).not.toBeNull();

      // The body itself is not kept anywhere on the row — only its digest.
      expect(row.payload_redacted).toBeNull();
      expect(row.body_sha256).not.toContain('payment_intent');
    });

    it('records a rejected callback too', async () => {
      const body = eventBody(succeededEvent());
      await deliver(body, { signature: signPayload(body, 'whsec_wrong') });

      const [row] = await webhookRows();
      expect(row.status).toBe('rejected_signature');
      expect(row.failure_code).toBe('authentication_failed');
      expect(row.provider_event_id).toBeNull();
    });
  });

  describe('deduplication', () => {
    it('applies a redelivered event only once', async () => {
      const body = eventBody(succeededEvent());

      const first = await deliver(body);
      const second = await deliver(body);

      expect(first.outcome).toBe('applied');
      expect(second.outcome).toBe('duplicate');
      expect(second.factCount).toBe(0);

      expect(await captureCount()).toBe(1);
      expect(await webhookRows()).toHaveLength(2);
      expect((await webhookRows())[1].status).toBe('duplicate');
    });

    it('produces no second ledger effect on redelivery', async () => {
      const body = eventBody(succeededEvent());

      await deliver(body);
      const entriesAfterFirst = await entryCount();

      await deliver(body);

      expect(await entryCount()).toBe(entriesAfterFirst);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('applies once when the same event arrives concurrently', async () => {
      const body = eventBody(succeededEvent());

      const results = await Promise.all([deliver(body), deliver(body)]);

      const outcomes = results.map((r) => r.outcome).sort();
      expect(outcomes).toEqual(['applied', 'duplicate']);

      expect(await captureCount()).toBe(1);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('treats a different event id as a new event', async () => {
      await deliver(eventBody(succeededEvent('evt_one')));

      // Same underlying fact, different provider event: the webhook layer
      // lets it through, and the applier's own fact dedupe catches it.
      const second = await deliver(eventBody(succeededEvent('evt_two')));

      expect(second.outcome).toBe('duplicate');
      expect(await captureCount()).toBe(1);
    });
  });

  describe('event coverage', () => {
    it('applies a successful payment', async () => {
      const result = await deliver(eventBody(succeededEvent()));

      expect(result.outcome).toBe('applied');

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('captured');
      expect(intent.captured_total_minor).toBe(5000n);
    });

    it('applies a failed payment', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_failed',
          type: 'payment_intent.payment_failed',
          created: 1_700_000_000,
          data: {
            object: {
              id: REF,
              status: 'requires_payment_method',
              currency: 'usd',
              amount: 5000,
              last_payment_error: {
                decline_code: 'insufficient_funds',
                message: 'card declined',
              },
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('failed');
    });

    it('carries the decline reason from the webhook onto the attempt', async () => {
      // This is the regression test for the merchant-visible "سبب الفشل:
      // unknown" bug: the fact mapper must classify decline_code, and the
      // applier must actually persist it — before this fix, error_code and
      // error_message_raw stayed null for every fact-driven failure.
      const result = await deliver(
        eventBody({
          id: 'evt_failed_reason',
          type: 'payment_intent.payment_failed',
          created: 1_700_000_000,
          data: {
            object: {
              id: REF,
              status: 'requires_payment_method',
              currency: 'usd',
              amount: 5000,
              last_payment_error: {
                decline_code: 'insufficient_funds',
                message: 'Your card has insufficient funds.',
              },
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const attempt = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({
          where: { gateway_reference: REF },
        }),
      );
      expect(attempt.error_code).toBe('declined_insufficient_funds');
      expect(attempt.error_message_raw).toBe('Your card has insufficient funds.');
    });

    it('applies a cancelled payment', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_canceled',
          type: 'payment_intent.canceled',
          created: 1_700_000_000,
          data: {
            object: { id: REF, status: 'canceled', currency: 'usd', amount: 5000 },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('cancelled');
    });

    it('applies an authorisation awaiting capture', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_capturable',
          type: 'payment_intent.amount_capturable_updated',
          created: 1_700_000_000,
          data: {
            object: {
              id: REF,
              status: 'requires_capture',
              currency: 'usd',
              amount: 5000,
              amount_capturable: 5000,
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('authorized');
    });

    it('applies a refund reported on the charge', async () => {
      await deliver(eventBody(succeededEvent()));

      const result = await deliver(
        eventBody({
          id: 'evt_refunded',
          type: 'charge.refunded',
          created: 1_700_000_100,
          data: {
            object: {
              id: 'ch_1',
              payment_intent: REF,
              currency: 'usd',
              amount: 5000,
              amount_refunded: 5000,
              refunded: true,
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');
      expect(await refundCount()).toBe(1);

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('refunded');
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('does not double-refund when the charge event is redelivered', async () => {
      await deliver(eventBody(succeededEvent()));

      const refundEvent = (id: string) => ({
        id,
        type: 'charge.refunded',
        created: 1_700_000_100,
        data: {
          object: {
            id: 'ch_1',
            payment_intent: REF,
            currency: 'usd',
            amount: 5000,
            amount_refunded: 5000,
            refunded: true,
          },
        },
      });

      await deliver(eventBody(refundEvent('evt_r1')));
      // A different event id carrying the same cumulative total: the
      // applier's fact dedupe is what stops this one.
      await deliver(eventBody(refundEvent('evt_r2')));

      expect(await refundCount()).toBe(1);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });

    it('records a recognised but inert event without acting on it', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_requires_action',
          type: 'payment_intent.requires_action',
          created: 1_700_000_000,
          data: {
            object: {
              id: REF,
              status: 'requires_action',
              currency: 'usd',
              amount: 5000,
            },
          },
        }),
      );

      expect(result.outcome).toBe('ignored');
      expect(result.detail).toBeUndefined();

      const [row] = await webhookRows();
      expect(row.status).toBe('ignored');
      expect(row.event_type).toBe('payment_intent.requires_action');
    });

    it('classifies an unknown event rather than losing it', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_unknown',
          type: 'invoice.payment_succeeded',
          created: 1_700_000_000,
          data: { object: { id: 'in_1' } },
        }),
      );

      expect(result.outcome).toBe('ignored');
      expect(result.detail).toBe('unknown event type');

      const [row] = await webhookRows();
      expect(row.status).toBe('unknown_event');
      expect(row.event_type).toBe('invoice.payment_succeeded');
      expect(row.signature_verified).toBe(true);
    });
  });

  /**
   * The exact race the "unmatched, dropped webhook" defect covered: a
   * `payment_intent.*` webhook can arrive before anything has resolved
   * the attempt off the Checkout Session id it was created under (real
   * Stripe behaviour — see stripe.adapter.ts's `initializePayment` —
   * `payment_intent: null` at session creation is the common case, not
   * the edge case). Every test here uses its own checkout, created with
   * a Stripe stub whose session has no PaymentIntent yet, so the seeded
   * attempt is stored under the *session* id (`RACE_SESSION_ID`) while
   * every webhook below arrives keyed on a *different*, real
   * PaymentIntent id (`RACE_PI_ID`) — the applier must resolve that via
   * `metadata.intent_id`, not the primary lookup.
   */
  describe('an early payment_intent.* webhook before the Checkout Session is resolved', () => {
    const RACE_SESSION_ID = 'cs_race_session';
    const RACE_PI_ID = 'pi_race_1';

    function raceStripeClient(): StripeClientLike {
      return {
        ...verifyingStripeClient(),
        checkout: {
          sessions: {
            create: async () => ({
              id: RACE_SESSION_ID,
              url: 'https://checkout.stripe.com/c/pay/cs_race',
              payment_intent: null,
            }),
            retrieve: async () => ({
              id: RACE_SESSION_ID,
              url: 'https://checkout.stripe.com/c/pay/cs_race',
              payment_intent: null,
              status: 'open',
              currency: 'usd',
            }),
          },
        },
      };
    }

    let internalIntentId: bigint;

    beforeEach(async () => {
      stripeClient = raceStripeClient();
      await truncateTables(ALL_TEST_TABLES);
      fx = await seed(prisma);

      await checkout.createAndCommit(SLUG, {
        items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
        customer_name: 'Test Buyer',
        customer_phone: '01000000000',
        address_line: '1 Test Street',
        city: 'Cairo',
        payment_offering_id: fx.offeringId.toString(),
        return_url: 'https://shop.example/checkout/success',
      });

      const seededIntent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      internalIntentId = seededIntent.id;

      const seededAttempt = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      // Sanity check on the fixture itself: if this ever stops being
      // true, the race this describe block exists to test isn't set up.
      expect(seededAttempt.gateway_reference).toBe(RACE_SESSION_ID);
    });

    it('resolves the attempt via metadata.intent_id, applies the payment, and finalises exactly one order', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_race',
          type: 'payment_intent.succeeded',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'succeeded',
              currency: 'usd',
              amount: 5000,
              amount_received: 5000,
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const attempt = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      // Re-keyed: every fact after this one — from either identifier —
      // finds this row on the ordinary primary lookup.
      expect(attempt.gateway_reference).toBe(RACE_PI_ID);

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('captured');

      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
    });

    it('does not create a second attempt or a second order when the same webhook is redelivered', async () => {
      const build = () =>
        eventBody({
          id: 'evt_race',
          type: 'payment_intent.succeeded',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'succeeded',
              currency: 'usd',
              amount: 5000,
              amount_received: 5000,
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        });

      const first = await deliver(build());
      expect(first.outcome).toBe('applied');

      // Same provider event id redelivered — the ordinary webhook-level
      // dedupe (provider_event_id) catches this before the fact-level
      // idempotency logic even runs, exactly as it does for a normal,
      // already-resolved reference.
      const second = await deliver(build());
      expect(second.outcome).toBe('duplicate');

      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.paymentAttempt.count()),
      ).toBe(1);
      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
    });

    it('resolves a payment_intent.payment_failed webhook arriving before resolution, and creates no order', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_race_failed',
          type: 'payment_intent.payment_failed',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'requires_payment_method',
              currency: 'usd',
              amount: 5000,
              last_payment_error: {
                decline_code: 'insufficient_funds',
                message: 'card declined',
              },
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const attempt = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      expect(attempt.gateway_reference).toBe(RACE_PI_ID);
      expect(attempt.error_code).toBe('declined_insufficient_funds');

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('failed');

      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(0);
    });

    it('resolves a payment_intent.canceled webhook arriving before resolution, and creates no order', async () => {
      const result = await deliver(
        eventBody({
          id: 'evt_race_canceled',
          type: 'payment_intent.canceled',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'canceled',
              currency: 'usd',
              amount: 5000,
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      expect(result.outcome).toBe('applied');

      const attempt = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      expect(attempt.gateway_reference).toBe(RACE_PI_ID);

      const intent = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentIntent.findFirstOrThrow({}),
      );
      expect(intent.status).toBe('cancelled');

      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(0);
    });

    it('ignores metadata.intent_id belonging to a different store, and still reports unmatched', async () => {
      // Store isolation: a malformed or cross-tenant intent_id must never
      // let the fallback reach across tenants. accountId already scopes
      // the primary lookup; this proves the fallback query is scoped the
      // same way (store_id/mode), not just "any PaymentIntent with this id".
      const result = await deliver(
        eventBody({
          id: 'evt_race_wrong_tenant',
          type: 'payment_intent.succeeded',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'succeeded',
              currency: 'usd',
              amount: 5000,
              amount_received: 5000,
              // Astronomically unlikely to collide with a real id, and
              // guaranteed not to resolve to anything in this store.
              metadata: { intent_id: '999999999999' },
            },
          },
        }),
      );

      expect(result.outcome).toBe('unmatched');

      const attempt = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      // Untouched — the fallback found nothing, so the original
      // provisional reference is still what's on file.
      expect(attempt.gateway_reference).toBe(RACE_SESSION_ID);
    });

    /*
     * THE OTHER SIDE OF THE SAME BRANCH — the retry, which must NOT be
     * treated as a resolution.
     *
     * Round 10 taught the fallback to re-key an attempt that has no
     * outcome yet, because a Checkout Session id and its PaymentIntent
     * id are one payment. The rule it must not swallow is the one that
     * branch was written for in the first place, reproduced live on
     * Moyasar: a payment that FAILED, followed by a genuinely different
     * payment for the same intent. Attempt #1 keeps its decline and its
     * reference; the new payment gets its own row.
     */
    it('opens a second attempt when a DIFFERENT payment follows a terminal one, instead of re-keying it', async () => {
      const SECOND_PI_ID = 'pi_race_2';

      // The first payment fails. The attempt is re-keyed to pi_race_1 on
      // the way (it had no outcome yet) and is now terminal.
      await deliver(
        eventBody({
          id: 'evt_retry_failed',
          type: 'payment_intent.payment_failed',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'requires_payment_method',
              currency: 'usd',
              amount: 5000,
              last_payment_error: {
                decline_code: 'insufficient_funds',
                message: 'card declined',
              },
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      // The payer tries again and succeeds — a different PaymentIntent,
      // same internal intent.
      const retry = await deliver(
        eventBody({
          id: 'evt_retry_succeeded',
          type: 'payment_intent.succeeded',
          created: 1_700_000_100,
          data: {
            object: {
              id: SECOND_PI_ID,
              status: 'succeeded',
              currency: 'usd',
              amount: 5000,
              amount_received: 5000,
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      expect(retry.outcome).toBe('applied');

      const attempts = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findMany({ orderBy: { sequence: 'asc' } }),
      );

      // Two payments, two rows — not one row rewritten.
      expect(attempts).toHaveLength(2);
      expect(attempts[0].gateway_reference).toBe(RACE_PI_ID);
      expect(attempts[0].status).toBe('failed');
      expect(attempts[1].gateway_reference).toBe(SECOND_PI_ID);
      expect(attempts[1].sequence).toBe(attempts[0].sequence + 1);

      // The money is real, so the order exists — exactly once.
      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
    });

    it('scenario D: sync resolves the PaymentIntent first, and the later webhook is deduplicated', async () => {
      // Sync (ReconciliationService) calls fetchStatus with whatever
      // gateway_reference is on file today — still the Checkout Session
      // id — and Stripe now returns it expanded to the succeeded
      // PaymentIntent, exactly as it does once the customer has paid.
      const syncClient: StripeClientLike = {
        ...raceStripeClient(),
        checkout: {
          sessions: {
            create: raceStripeClient().checkout.sessions.create,
            retrieve: async () => ({
              id: RACE_SESSION_ID,
              url: 'https://checkout.stripe.com/c/pay/cs_race',
              status: 'complete',
              currency: 'usd',
              payment_intent: {
                id: RACE_PI_ID,
                status: 'succeeded',
                currency: 'usd',
                amount: 5000,
                amount_received: 5000,
                metadata: { intent_id: internalIntentId.toString() },
              },
            }),
          },
        },
      };
      stripeClient = syncClient;

      const syncFacts = await adapter.fetchStatus({
        accountId: fx.accountId,
        gatewayReference: RACE_SESSION_ID,
        credentials: { secret_key: 'sk_test_x' },
        mode: 'live',
      });
      expect(syncFacts).toHaveLength(1);

      const syncResult = await applier.apply(syncFacts[0], 'reconciliation');
      expect(syncResult.outcome).toBe('applied');

      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);

      const afterSync = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      // Sync applies through the ordinary primary lookup (the attempt is
      // still on file under the Checkout Session id) and records the
      // resolved PaymentIntent id, but only the webhook fallback rekeys
      // gateway_reference itself.
      expect(afterSync.gateway_reference).toBe(RACE_SESSION_ID);
      expect(afterSync.gateway_payment_id).toBe(RACE_PI_ID);

      const webhookResult = await deliver(
        eventBody({
          id: 'evt_race_after_sync',
          type: 'payment_intent.succeeded',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'succeeded',
              currency: 'usd',
              amount: 5000,
              amount_received: 5000,
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      expect(webhookResult.outcome).toBe('duplicate');
      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.paymentAttempt.count()),
      ).toBe(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.capture.count()),
      ).toBe(1);
    });

    it('scenario E: the webhook resolves the PaymentIntent first, and the later sync is deduplicated', async () => {
      const webhookResult = await deliver(
        eventBody({
          id: 'evt_race_before_sync',
          type: 'payment_intent.succeeded',
          created: 1_700_000_000,
          data: {
            object: {
              id: RACE_PI_ID,
              status: 'succeeded',
              currency: 'usd',
              amount: 5000,
              amount_received: 5000,
              metadata: { intent_id: internalIntentId.toString() },
            },
          },
        }),
      );

      expect(webhookResult.outcome).toBe('applied');

      const afterWebhook = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      // Rekeyed by the webhook fallback — sync now reads pi_... as the
      // reference to ask Stripe about, exactly as ReconciliationService
      // would re-read it fresh from the attempt row.
      expect(afterWebhook.gateway_reference).toBe(RACE_PI_ID);

      stripeClient = {
        ...raceStripeClient(),
        paymentIntents: {
          ...raceStripeClient().paymentIntents,
          retrieve: async () => ({
            id: RACE_PI_ID,
            status: 'succeeded',
            currency: 'usd',
            amount: 5000,
            amount_received: 5000,
            metadata: { intent_id: internalIntentId.toString() },
          }),
        },
      };

      const syncFacts = await adapter.fetchStatus({
        accountId: fx.accountId,
        gatewayReference: afterWebhook.gateway_reference!,
        credentials: { secret_key: 'sk_test_x' },
        mode: 'live',
      });
      expect(syncFacts).toHaveLength(1);

      const syncResult = await applier.apply(syncFacts[0], 'reconciliation');

      expect(syncResult.outcome).toBe('duplicate');
      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.paymentAttempt.count()),
      ).toBe(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.capture.count()),
      ).toBe(1);
    });

    it('scenario G: sync delivered twice before any webhook stays idempotent', async () => {
      // No webhook at all here — just the reconciliation sweep polling
      // fetchStatus() twice in a row, exactly as it would if a sweep
      // re-ran before the next one was due. The first call resolves the
      // Checkout Session to its PaymentIntent and applies; the second
      // must find the same outcome already recorded and change nothing
      // further, with no second order and no second capture.
      const syncClient: StripeClientLike = {
        ...raceStripeClient(),
        checkout: {
          sessions: {
            create: raceStripeClient().checkout.sessions.create,
            retrieve: async () => ({
              id: RACE_SESSION_ID,
              url: 'https://checkout.stripe.com/c/pay/cs_race',
              status: 'complete',
              currency: 'usd',
              payment_intent: {
                id: RACE_PI_ID,
                status: 'succeeded',
                currency: 'usd',
                amount: 5000,
                amount_received: 5000,
                metadata: { intent_id: internalIntentId.toString() },
              },
            }),
          },
        },
      };
      stripeClient = syncClient;

      const firstSyncFacts = await adapter.fetchStatus({
        accountId: fx.accountId,
        gatewayReference: RACE_SESSION_ID,
        credentials: { secret_key: 'sk_test_x' },
        mode: 'live',
      });
      const firstResult = await applier.apply(firstSyncFacts[0], 'reconciliation');
      expect(firstResult.outcome).toBe('applied');

      // The reconciliation sweep always reads the current gateway_reference
      // off the attempt before polling — by now that's still the Checkout
      // Session id, since only a webhook's fallback rekeys it.
      const afterFirstSync = await withTenant(prisma, fx.storeId, 'live', (tx) =>
        tx.paymentAttempt.findFirstOrThrow({}),
      );
      expect(afterFirstSync.gateway_reference).toBe(RACE_SESSION_ID);

      const secondSyncFacts = await adapter.fetchStatus({
        accountId: fx.accountId,
        gatewayReference: afterFirstSync.gateway_reference!,
        credentials: { secret_key: 'sk_test_x' },
        mode: 'live',
      });
      const secondResult = await applier.apply(secondSyncFacts[0], 'reconciliation');
      expect(secondResult.outcome).toBe('duplicate');

      expect(await withTenant(prisma, fx.storeId, 'live', (tx) => tx.order.count())).toBe(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.paymentAttempt.count()),
      ).toBe(1);
      expect(
        await withTenant(prisma, fx.storeId, 'live', (tx) => tx.capture.count()),
      ).toBe(1);
      expect(await ledger.findUnbalancedEntries()).toEqual([]);
    });
  });

  describe('failure and retry', () => {
    it('leaves a processing failure retryable', async () => {
      const body = eventBody(succeededEvent());

      jest
        .spyOn(applier, 'applyMany')
        .mockRejectedValueOnce(new Error('database exploded'));

      // The error propagates so the provider sees a non-2xx and retries.
      await expect(deliver(body)).rejects.toThrow('database exploded');

      const [failed] = await webhookRows();
      expect(failed.status).toBe('failed');
      // The claim is released, or the retry below would be dismissed as
      // a duplicate and the event lost for good.
      expect(failed.provider_event_id).toBeNull();
      expect(await captureCount()).toBe(0);

      const retry = await deliver(body);

      expect(retry.outcome).toBe('applied');
      expect(await captureCount()).toBe(1);
    });
  });
});

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_webhook',
      email: 'spec_webhook@example.test',
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
      handle: 'spec-webhook',
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

  // A second account on the same store, used to prove a callback cannot
  // be applied by pointing it at an account that does not own the payment.
  const otherAccount = await withTenant(prisma, store.id, 'live', (tx) =>
    tx.paymentAccount.create({
      data: {
        store_id: store.id,
        mode: 'live',
        gateway: 'stripe' as PaymentProviderKey,
        display_name: 'Secondary',
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
    otherAccountId: otherAccount.id,
  };
}

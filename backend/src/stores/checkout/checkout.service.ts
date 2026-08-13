import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  Mode,
  OrderStatus,
  StorePaymentMode,
  PaymentAttemptStatus,
  PaymentMethodKey,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import { LedgerService } from '../../ledger/ledger.service';
import { offlineCommitment } from '../../ledger/posting-rules';
import {
  money,
  parseDecimal,
  toDecimalString,
} from '../../common/money/money.util';
import type { Money } from '../../common/money/money.types';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import {
  IdReservationService,
  PAYMENT_INTENTS_TABLE,
} from '../../common/ids/id-reservation.service';
import { fingerprintRequest } from '../../common/idempotency/idempotency.types';
import { PaymentAccountService } from '../payments/payment-account.service';
import {
  OfferingPolicyError,
  checkPolicy,
  computeFeeMinor,
  describePolicy,
  feeLabel,
  parseOfferingPolicy,
} from './offering-policy';
import { ProviderRegistry } from '../payments/gateways/provider-registry.service';
import { PaymentFactApplier } from '../payments/facts/payment-fact.applier';
import {
  ProviderError,
  buildFactDedupeKey,
  nextActionKindName,
  nextActionPayload,
  pspIdempotencyKey,
  type GatewayRefs,
  type InitializeResult,
  type NextAction,
  type ObservedFact,
} from '../payments/gateways/provider.types';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

/** How long a checkout, and the stock it holds, stays alive. */
const CHECKOUT_TTL_MINUTES = 30;

/** Idempotency scope for storefront checkout. */
const CHECKOUT_SCOPE = 'checkout.create';

/**
 * The provider's identifiers, where the result carries any.
 *
 * `no_gateway` has none, so this narrows rather than reaching for an
 * optional property the union does not universally have.
 */
function providerRefs(result: InitializeResult): GatewayRefs | undefined {
  switch (result.kind) {
    case 'requires_action':
    case 'authorized':
    case 'succeeded':
    case 'pending':
      return result.refs;
    default:
      return undefined;
  }
}

/** Account states a customer may pay against. Mirrors listPaymentMethods. */
const USABLE_ACCOUNT_STATUSES: readonly string[] = ['active', 'verifying'];

interface ResolvedLine {
  variantId: bigint;
  productId: bigint;
  title: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPrice: Money;
  quantity: number;
  trackInventory: boolean;
  continueSelling: boolean;
  inventoryQty: number;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly accounts: PaymentAccountService,
    private readonly idempotency: IdempotencyService,
    private readonly providers: ProviderRegistry,
    private readonly ids: IdReservationService,
    private readonly applier: PaymentFactApplier,
  ) {}

  /**
   * Payment methods a shopper can pick, for one storefront.
   *
   * Only enabled offerings on active accounts, ordered by the merchant's
   * chosen position.
   */
  async listPaymentMethods(slug: string, mode: Mode = 'live') {
    const store = await this.findStore(slug);

    const offerings = await this.prisma
      .guarded()
      .paymentMethodOffering.findMany({
        where: { store_id: store.id, mode, enabled: true },
        orderBy: { position: 'asc' },
      });

    if (offerings.length === 0) return [];

    const accounts = await this.prisma.guarded().paymentAccount.findMany({
      where: {
        store_id: store.id,
        mode,
        status: { in: ['active', 'verifying'] },
      },
    });
    const byId = new Map(accounts.map((a) => [a.id.toString(), a]));

    return offerings
      .filter((o) => byId.has(o.account_id.toString()))
      .map((o) => ({
        id: o.id.toString(),
        method: o.method,
        gateway: byId.get(o.account_id.toString())?.gateway,
        name_ar: o.display_name_ar,
        name_en: o.display_name_en,
        commitment_kind: o.commitment_kind,
        position: o.position,
        // Limits and fees the storefront should show before the customer
        // commits to a method. A malformed policy is reported as null
        // rather than breaking the whole list.
        policy: this.safeDescribePolicy(o.constraints),
      }));
  }

  /**
   * Creates a checkout, commits it, and produces the order.
   *
   * Single-shot on purpose: the storefront posts a complete cart and
   * expects an order back. Prices are always recomputed server-side.
   *
   * Note this deviates from the outbox-consumer design for order
   * creation: the order is written inside the same transaction so the
   * response can carry it. The outbox event is still emitted, for
   * downstream consumers only (notifications, analytics).
   */
  async createAndCommit(
    slug: string,
    dto: CreateCheckoutDto,
    mode: Mode = 'live',
    idempotencyKey?: string,
  ) {
    const store = await this.findStore(slug);

    // Without this, a double-tapped Place Order button produces two
    // orders, two ledger entries and two inventory decrements. The
    // interceptor cannot be reused here: it needs a store in the tenant
    // context, and storefront routes have no ActiveStoreGuard, so the
    // store is only known after the slug is resolved.
    if (!idempotencyKey) {
      return this.commit(store, dto, mode);
    }

    const claim = await this.idempotency.claim({
      storeId: store.id,
      mode,
      scope: CHECKOUT_SCOPE,
      idempotencyKey,
      fingerprint: fingerprintRequest({
        method: 'POST',
        path: `/storefront/${slug}/checkout`,
        body: dto as unknown as Record<string, unknown>,
      }),
      ttlSeconds: this.idempotency.defaultTtlSeconds,
      leaseSeconds: this.idempotency.defaultLeaseSeconds,
    });

    if (claim.outcome === 'conflict') {
      throw new ConflictException(claim.detail);
    }

    if (claim.outcome === 'in_flight') {
      throw new ConflictException(
        'This order is already being placed. Please wait a moment.',
      );
    }

    if (claim.outcome === 'replay') {
      return claim.body as Awaited<ReturnType<CheckoutService['commit']>>;
    }

    try {
      const response = await this.commit(store, dto, mode);
      await this.idempotency.complete(
        claim.recordId,
        store.id,
        mode,
        201,
        response,
      );
      return response;
    } catch (error) {
      await this.idempotency
        .fail(claim.recordId, store.id, mode)
        .catch(() => undefined);
      throw error;
    }
  }

  /** The actual commit. Split out so idempotency can wrap it. */
  private async commit(
    store: { id: bigint; currency: string; payment_mode: StorePaymentMode },
    dto: CreateCheckoutDto,
    mode: Mode,
  ) {
    const currency = (store.currency || 'USD').toUpperCase();

    const offering = await this.prisma
      .guarded()
      .paymentMethodOffering.findFirst({
        where: {
          id: BigInt(dto.payment_offering_id),
          store_id: store.id,
          mode,
          enabled: true,
        },
      });

    if (!offering) {
      throw new BadRequestException(
        'Selected payment method is not available.',
      );
    }

    // The gateway key lives on the account, and it selects the adapter.
    const account = await this.prisma.guarded().paymentAccount.findFirst({
      where: { id: offering.account_id, store_id: store.id, mode },
      select: { id: true, gateway: true, status: true },
    });

    // Must match what listPaymentMethods advertises, or a customer could
    // commit against a draft or errored account by posting its offering id.
    if (!account || !USABLE_ACCOUNT_STATUSES.includes(account.status)) {
      throw new BadRequestException(
        'Selected payment method is not available.',
      );
    }

    // No commitment-kind gate here any more. Whether a method can be
    // honoured is decided by the adapter registry, which rejects an
    // unregistered gateway or an unsupported method/currency, and by
    // interpretResult, which rejects a result this flow cannot complete.
    // A hardcoded allow-list here silently made every gateway
    // unreachable no matter what was registered.

    const lines = await this.resolveLines(store.id, currency, dto);
    const subtotalMinor = lines.reduce(
      (acc, l) => acc + l.unitPrice.amountMinor * BigInt(l.quantity),
      0n,
    );

    if (subtotalMinor <= 0n) {
      throw new BadRequestException('Cart total must be greater than zero.');
    }

    // Limits and fees the merchant configured on this method. Until now
    // the constraints column was written and never read.
    const policy = this.readPolicy(offering.constraints);

    const violation = checkPolicy(policy, {
      subtotalMinor,
      currency,
      city: dto.city,
    });

    if (violation) {
      throw new BadRequestException(violation.message);
    }

    const feeMinor = computeFeeMinor(policy, subtotalMinor);
    const totalMinor = subtotalMinor + feeMinor;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000);
    const beneficiaryId = await this.ensureStoreBeneficiary(
      store.id,
      mode,
      currency,
    );

    // The intent id is needed for the deterministic PSP idempotency key,
    // so the intent is created first, then the adapter is called, then the
    // rest of the commit runs. The adapter call stays outside the
    // transaction: never hold a database transaction open across network
    // I/O.
    const intentId = await this.ids.reserve(PAYMENT_INTENTS_TABLE);

    const initializeResult = await this.initializePayment({
      storeId: store.id,
      mode,
      accountId: offering.account_id,
      gateway: account.gateway,
      offeringId: offering.id,
      method: offering.method,
      gatewayMethodConfig: offering.gateway_method_config,
      intentId,
      amountMinor: totalMinor,
      currency,
    });

    const { nextAction, attemptStatus, offline } =
      this.interpretResult(initializeResult);

    const gatewayRefs = providerRefs(initializeResult);

    // Bank transfer produces an order that is explicitly not yet paid.
    // Cash on delivery is collected on handover, so it enters the normal
    // fulfilment queue.
    const orderStatus: OrderStatus =
      offering.commitment_kind === 'awaiting_offline_settlement'
        ? 'AWAITING_PAYMENT'
        : 'PENDING';

    const result = await this.prisma.guarded().$transaction(async (tx) => {
      const checkout = await tx.checkout.create({
        data: {
          store_id: store.id,
          mode,
          token: randomUUID().replace(/-/g, ''),
          status: 'pending_payment',
          customer_name: dto.customer_name,
          customer_email: dto.customer_email ?? null,
          customer_phone: dto.customer_phone,
          shipping_address: {
            address_line: dto.address_line,
            city: dto.city,
            notes: dto.notes ?? null,
          } as Prisma.InputJsonValue,
          currency,
          quote_total_minor: totalMinor,
          selected_offering_id: offering.id,
          expires_at: expiresAt,
        },
        select: { id: true, token: true },
      });

      await tx.checkoutLineItem.createMany({
        data: lines.map((l) => ({
          checkout_id: checkout.id,
          product_id: l.productId,
          variant_id: l.variantId,
          title: l.title,
          variant_title: l.variantTitle,
          image_url: l.imageUrl,
          unit_price_minor: l.unitPrice.amountMinor,
          quantity: l.quantity,
        })),
      });

      // Invariant: quote_total_minor equals the sum of its components.
      await tx.quoteComponent.create({
        data: {
          checkout_id: checkout.id,
          kind: 'line_subtotal',
          label: 'Items',
          amount_minor: subtotalMinor,
          source_ref: 'checkout.lines',
          position: 0,
        },
      });

      if (feeMinor > 0n) {
        await tx.quoteComponent.create({
          data: {
            checkout_id: checkout.id,
            kind: 'payment_fee',
            label: feeLabel(policy),
            amount_minor: feeMinor,
            source_ref: `offering:${offering.id}`,
            position: 1,
          },
        });
      }

      // Reservations are recorded and immediately converted: this phase
      // commits in one request, so stock never sits held.
      await tx.inventoryReservation.createMany({
        data: lines
          .filter((l) => l.trackInventory)
          .map((l) => ({
            checkout_id: checkout.id,
            store_id: store.id,
            mode,
            variant_id: l.variantId,
            quantity: l.quantity,
            // Offline commitment takes the stock now. A gateway
            // checkout only holds it until the money is secured, because
            // the customer may abandon the payment.
            state: offline ? ('converted' as const) : ('held' as const),
            expires_at: expiresAt,
            settled_at: offline ? now : null,
          })),
      });

      // Created here with the reserved id, so a checkout that fails
      // before this point leaves nothing behind.
      const intent = await tx.paymentIntent.create({
        data: {
          id: intentId,
          store_id: store.id,
          mode,
          context_kind: 'checkout',
          context_id: checkout.id.toString(),
          amount_minor: totalMinor,
          currency,
          capture_method: offering.capture_mode,
          usage: 'one_time',
          status: 'processing',
          // Snapshotted, not read from the store at refund time. A store
          // that switches payment mode must still refund old payments
          // through the route that actually took them.
          payment_mode: store.payment_mode,
          offering_id: offering.id,
          account_id: offering.account_id,
          expires_at: expiresAt,
        },
        select: { id: true },
      });

      const storedPayload = nextActionPayload(nextAction);

      await tx.paymentAttempt.create({
        data: {
          intent_id: intent.id,
          store_id: store.id,
          mode,
          sequence: 1,
          account_id: offering.account_id,
          offering_id: offering.id,
          status: attemptStatus,
          // The applier matches inbound facts on
          // (account_id, gateway_reference). Without this the reference
          // stays null, every webhook and every reconciliation sweep
          // fails to match, and a customer who paid never gets an order.
          gateway_reference: gatewayRefs?.gatewayReference ?? null,
          gateway_payment_id: gatewayRefs?.gatewayPaymentId ?? null,
          next_action_kind: nextActionKindName(nextAction),
          next_action_payload: storedPayload
            ? (storedPayload as Prisma.InputJsonValue)
            : Prisma.DbNull,
          next_action_expires_at: storedPayload ? expiresAt : null,
          psp_idempotency_key: pspIdempotencyKey({
            storeId: store.id,
            intentId,
            attemptSequence: 1,
            operation: 'initialize',
          }),
        },
      });

      if (!offline) {
        // No order yet. It is created by the fact applier when the
        // provider confirms the money, which is what makes "an order
        // exists" mean "the money is secured".
        return { checkout, order: null };
      }

      const orderNumber = await this.nextOrderNumber(
        tx as unknown as Prisma.TransactionClient,
        store.id,
      );

      const order = await tx.order.create({
        data: {
          store_id: store.id,
          order_number: orderNumber,
          status: orderStatus,
          payment_status: 'UNPAID',
          payment_method: offering.method === 'cod' ? 'cod' : 'bank_transfer',
          currency,
          checkout_id: checkout.id,
          customer_name: dto.customer_name,
          customer_phone: dto.customer_phone,
          customer_email: dto.customer_email ?? null,
          address_line: dto.address_line,
          city: dto.city,
          notes: dto.notes ?? null,
          subtotal: toDecimalString(money(subtotalMinor, currency)),
          total: toDecimalString(money(totalMinor, currency)),
          items: {
            create: lines.map((l) => ({
              product_id: l.productId,
              variant_id: l.variantId,
              title: l.title,
              variant_title: l.variantTitle,
              price: toDecimalString(l.unitPrice),
              qty: l.quantity,
              image_url: l.imageUrl,
            })),
          },
        },
        select: { id: true, order_number: true },
      });

      await tx.checkout.update({
        where: {
          id: checkout.id,
          store_id: store.id,
          mode,
        },
        data: {
          status: 'committed',
          committed_at: now,
          order_id: order.id,
        },
      });

      for (const line of lines) {
        if (!line.trackInventory) continue;
        await tx.productVariant.update({
          where: { id: line.variantId },
          data: { inventory_qty: { decrement: line.quantity } },
        });
      }

      // Revenue is recognised at offline commitment; the matching
      // receivable clears when the merchant records collection. For a
      // gateway the ledger entry is posted by the applier when the money
      // is actually captured, so nothing is posted here.
      await this.ledger.post(tx as unknown as Prisma.TransactionClient, {
        storeId: store.id,
        mode,
        currency,
        entryType: 'checkout.committed.offline',
        sourceKind: 'checkout',
        sourceId: checkout.id.toString(),
        dedupeKey: `checkout:${checkout.id}:commit`,
        occurredAt: now,
        memo: `Order ${order.order_number}`,
        postings: offlineCommitment({
          totalMinor,
          allocations: [{ beneficiaryId, amountMinor: totalMinor }],
        }),
      });

      await this.outbox.emit(tx as unknown as Prisma.TransactionClient, {
        storeId: store.id,
        mode,
        aggregateType: 'checkout',
        aggregateId: checkout.id.toString(),
        eventType: 'checkout.committed',
        payload: {
          checkoutId: checkout.id.toString(),
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          intentId: intent.id.toString(),
          amountMinor: totalMinor.toString(),
          currency,
          commitmentKind: offering.commitment_kind,
        },
        occurredAt: now,
      });

      return { checkout, order };
    });

    // The adapter may have authorised or captured in the same call. That
    // outcome becomes a fact and goes through the applier, so the order
    // is created by the same code path a webhook would use.
    if (!offline) {
      const fact = this.synchronousFact(
        initializeResult,
        offering.account_id,
        currency,
      );

      if (fact) {
        await this.applier.applyMany([fact], 'api');
      }
    }

    const order = result.order
      ? await this.prisma.guarded().order.findFirst({
          where: { id: result.order.id, store_id: store.id },
          select: {
            id: true,
            order_number: true,
            status: true,
            payment_status: true,
          },
        })
      : await this.prisma.guarded().order.findFirst({
          where: { checkout_id: result.checkout.id, store_id: store.id },
          select: {
            id: true,
            order_number: true,
            status: true,
            payment_status: true,
          },
        });

    this.logger.log(
      `Checkout ${result.checkout.id} committed for store ${store.id} ` +
        `(${offering.commitment_kind}${order ? `, order ${order.order_number}` : ', awaiting payment'})`,
    );

    return {
      // Null while the customer still has an action to complete. The
      // storefront polls the checkout token until it appears.
      order: order
        ? {
            id: order.id.toString(),
            order_number: order.order_number,
            status: order.status,
            payment_status: order.payment_status,
            currency,
            subtotal: toDecimalString(money(subtotalMinor, currency)),
            payment_fee: toDecimalString(money(feeMinor, currency)),
            total: toDecimalString(money(totalMinor, currency)),
          }
        : null,
      checkout_token: result.checkout.token,
      payment_redirect_url:
        nextAction.kind === 'redirect' ? nextAction.url : null,
      next_action: (() => {
        const payload = nextActionPayload(nextAction);
        return payload ? { kind: nextAction.kind, ...payload } : null;
      })(),
    };
  }

  /**
   * Re-reads the instructions a customer needs after checkout.
   *
   * The success page needs this on refresh: bank details are not part of
   * the order record, they live on the attempt.
   */
  async getCheckoutStatus(slug: string, token: string) {
    const store = await this.findStore(slug);

    const checkout = await this.prisma.guarded().checkout.findFirst({
      where: { store_id: store.id, token },
    });

    if (!checkout) throw new NotFoundException('Checkout not found.');

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        store_id: store.id,
        mode: checkout.mode,
        context_kind: 'checkout',
        context_id: checkout.id.toString(),
      },
      select: { id: true, status: true },
    });

    const attempt = intent
      ? await this.prisma.guarded().paymentAttempt.findFirst({
          where: {
            intent_id: intent.id,
            store_id: store.id,
            mode: checkout.mode,
          },
          orderBy: { sequence: 'desc' },
          select: { next_action_kind: true, next_action_payload: true },
        })
      : null;

    const order = checkout.order_id
      ? await this.prisma.guarded().order.findFirst({
          where: { id: checkout.order_id, store_id: store.id },
          select: {
            id: true,
            order_number: true,
            status: true,
            payment_status: true,
            total: true,
          },
        })
      : null;

    return {
      checkout_token: checkout.token,
      checkout_status: checkout.status,
      currency: checkout.currency,
      payment_status: intent?.status ?? null,
      next_action:
        attempt && attempt.next_action_kind !== 'none'
          ? {
              kind: attempt.next_action_kind,
              ...((attempt.next_action_payload ?? {}) as Record<
                string,
                unknown
              >),
            }
          : null,
      order: order
        ? {
            id: order.id.toString(),
            order_number: order.order_number,
            status: order.status,
            payment_status: order.payment_status,
            total: String(order.total),
          }
        : null,
    };
  }

  /**
   * Asks the provider directly, then returns the refreshed status.
   *
   * This is what the customer's return from a gateway calls. Redirecting
   * back and then waiting for a webhook is the single most common cause
   * of "I paid but the page says it failed": the customer is often back
   * before the callback arrives. Asking synchronously removes the race.
   *
   * Safe to call repeatedly. The facts go through the same applier, so a
   * status the webhook already applied is recognised as a duplicate.
   */
  async syncCheckoutStatus(slug: string, token: string) {
    const store = await this.findStore(slug);

    const checkout = await this.prisma.guarded().checkout.findFirst({
      where: { store_id: store.id, token },
      select: { id: true, mode: true },
    });

    if (!checkout) throw new NotFoundException('Checkout not found.');

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        store_id: store.id,
        mode: checkout.mode,
        context_kind: 'checkout',
        context_id: checkout.id.toString(),
      },
      select: { id: true, account_id: true },
    });

    if (intent?.account_id) {
      await this.pullProviderStatus(
        store.id,
        checkout.mode,
        intent.id,
        intent.account_id,
      );
    }

    return this.getCheckoutStatus(slug, token);
  }

  /**
   * Pulls status from the provider and applies whatever comes back.
   *
   * Failures are swallowed on purpose: this runs on the customer's
   * return, and a provider being slow must not turn a successful payment
   * into an error page. Reconciliation will catch up.
   */
  private async pullProviderStatus(
    storeId: bigint,
    mode: Mode,
    intentId: bigint,
    accountId: bigint,
  ): Promise<void> {
    try {
      const account = await this.prisma.guarded().paymentAccount.findFirst({
        where: { id: accountId, store_id: storeId, mode },
        select: { id: true, gateway: true },
      });

      if (!account || !this.providers.has(account.gateway)) return;

      const provider = this.providers.get(account.gateway);
      if (!provider.capabilities.statusPolling) return;

      const attempt = await this.prisma.guarded().paymentAttempt.findFirst({
        where: { intent_id: intentId, store_id: storeId, mode },
        orderBy: { sequence: 'desc' },
        select: { gateway_reference: true },
      });

      if (!attempt?.gateway_reference) return;

      const credentials = await this.accounts.revealCredentialsForGateway(
        storeId,
        mode,
        account.id,
      );

      const facts = await provider.fetchStatus({
        accountId: account.id,
        gatewayReference: attempt.gateway_reference,
        credentials,
        mode,
      });

      if (facts.length > 0) {
        await this.applier.applyMany(facts, 'return_url');
      }
    } catch (error) {
      this.logger.warn(
        `Status sync failed for intent ${intentId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Starts the payment through the gateway adapter.
   *
   * Cash on delivery and bank transfer used to be `if` branches here.
   * They are adapters now, so this method is identical for a manual
   * method and for a gateway that redirects: the difference lives in the
   * adapter and in the shape of the result it returns.
   */
  private async initializePayment(input: {
    storeId: bigint;
    mode: Mode;
    accountId: bigint;
    gateway: string;
    offeringId: bigint;
    method: PaymentMethodKey;
    gatewayMethodConfig: string;
    intentId: bigint;
    amountMinor: bigint;
    currency: string;
  }): Promise<InitializeResult> {
    let provider;

    try {
      provider = this.providers.assertCanHandle({
        gateway: input.gateway,
        method: input.method,
        currency: input.currency,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.error(
          `Adapter cannot handle this request (${error.code}): ${error.message}`,
        );
        throw new BadRequestException(
          'Selected payment method is not available.',
        );
      }
      throw error;
    }

    // Credentials are decrypted here and handed to the adapter. Adapters
    // never reach into the credential store themselves, which keeps the
    // encryption path in exactly one place.
    const credentials = await this.accounts.revealCredentialsForGateway(
      input.storeId,
      input.mode,
      input.accountId,
    );

    try {
      return await provider.initializePayment({
        storeId: input.storeId,
        mode: input.mode,
        accountId: input.accountId,
        offeringId: input.offeringId,
        method: input.method,
        gatewayMethodConfig: input.gatewayMethodConfig,
        intentId: input.intentId,
        attemptId: null,
        attemptSequence: 1,
        amountMinor: input.amountMinor,
        currency: input.currency,
        credentials,
      });
    } catch (error) {
      // A ProviderError is a domain outcome, not a server fault. Letting
      // it escape would turn a misconfigured payment method into a 500.
      if (error instanceof ProviderError) {
        this.logger.error(
          `Adapter "${input.gateway}" refused to initialise (${error.code}): ${error.message}`,
        );
        throw new BadRequestException(
          error.code === 'configuration_error'
            ? 'This payment method is not configured. Please choose another.'
            : 'Payment could not be started. Please choose another method.',
        );
      }
      throw error;
    }
  }

  /**
   * Reduces an adapter result to the attempt row plus the customer
   * response.
   *
   * This phase can only honour results that need no funds movement.
   * Anything else means a gateway adapter arrived before the machinery
   * that drives it, and failing loudly is safer than committing an order
   * against a payment that was never taken.
   */
  private interpretResult(result: InitializeResult): {
    nextAction: NextAction;
    attemptStatus: PaymentAttemptStatus;
    /** True when the merchant accepted an unfunded promise. */
    offline: boolean;
  } {
    switch (result.kind) {
      case 'no_gateway':
        return {
          nextAction: result.nextAction ?? { kind: 'none' },
          attemptStatus: 'requires_action',
          offline: true,
        };

      case 'requires_action':
        return {
          nextAction: result.nextAction,
          attemptStatus: 'requires_action',
          offline: false,
        };

      case 'pending':
        return {
          nextAction: {
            kind: 'poll',
            pollAfterSeconds: result.pollAfterSeconds,
          },
          attemptStatus: 'processing',
          offline: false,
        };

      case 'authorized':
        return {
          nextAction: { kind: 'none' },
          attemptStatus: 'authorized',
          offline: false,
        };

      case 'succeeded':
        return {
          nextAction: { kind: 'none' },
          attemptStatus: 'succeeded',
          offline: false,
        };

      case 'failed':
        throw new BadRequestException(
          `Payment could not be started (${result.errorCode}).`,
        );
    }
  }

  /**
   * Turns a synchronous provider outcome into a fact.
   *
   * The adapter may authorise or capture in the same call. Rather than a
   * second order-creation path, that outcome is expressed as an
   * ObservedFact and run through the applier, so every funds_secured
   * order is created in exactly one place. A webhook later reporting the
   * same thing dedupes against it.
   */
  private synchronousFact(
    result: InitializeResult,
    accountId: bigint,
    currency: string,
  ): ObservedFact | null {
    if (result.kind !== 'authorized' && result.kind !== 'succeeded')
      return null;

    const reference = result.refs?.gatewayReference;
    if (!reference) return null;

    const factType =
      result.kind === 'succeeded' ? 'attempt_captured' : 'attempt_authorized';

    const cumulativeAmountMinor =
      result.kind === 'succeeded'
        ? result.capturedAmountMinor
        : result.authorizedAmountMinor;

    return {
      dedupeKey: buildFactDedupeKey({
        accountId,
        gatewayReference: reference,
        factType,
        cumulativeAmountMinor,
        currency: currency.toUpperCase(),
      }),
      accountId,
      gatewayReference: reference,
      factType,
      cumulativeAmountMinor,
      currency: currency.toUpperCase(),
      refs: result.refs,
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Parses the merchant's constraints, refusing the checkout if they are
   * malformed.
   *
   * Silently ignoring a broken "max 5000" rule would let through orders
   * the merchant explicitly refused, so a bad policy fails loudly.
   */
  private readPolicy(raw: unknown) {
    try {
      return parseOfferingPolicy(raw);
    } catch (error) {
      if (error instanceof OfferingPolicyError) {
        this.logger.error(
          `Malformed payment method constraints: ${error.message}`,
        );
        throw new BadRequestException(
          'This payment method is misconfigured. Please choose another.',
        );
      }
      throw error;
    }
  }

  /** Policy for display. Never throws: one bad row must not hide the rest. */
  private safeDescribePolicy(raw: unknown) {
    try {
      return describePolicy(parseOfferingPolicy(raw));
    } catch {
      return null;
    }
  }

  private async findStore(slug: string) {
    const store = await this.prisma
      .guarded()
      .store.findFirst({ where: { slug } });
    if (!store) throw new NotFoundException('Store not found.');
    return store;
  }

  /**
   * Loads variants and recomputes prices from the database.
   * Client-supplied prices are never trusted.
   */
  private async resolveLines(
    storeId: bigint,
    currency: string,
    dto: CreateCheckoutDto,
  ): Promise<ResolvedLine[]> {
    const ids = dto.items.map((i) => BigInt(i.variant_id));

    const variants = await this.prisma.guarded().productVariant.findMany({
      where: { id: { in: ids }, product: { store_id: storeId } },
      include: { product: true },
    });

    const byId = new Map(variants.map((v: any) => [v.id.toString(), v]));
    const lines: ResolvedLine[] = [];

    for (const item of dto.items) {
      const variant: any = byId.get(item.variant_id);

      if (!variant) {
        throw new BadRequestException(
          `Product variant ${item.variant_id} is unavailable.`,
        );
      }

      const priceRaw = variant.price === null ? '0' : String(variant.price);
      const unitPrice = parseDecimal(priceRaw, currency);

      if (
        variant.track_inventory &&
        !variant.continue_selling &&
        variant.inventory_qty < item.quantity
      ) {
        throw new BadRequestException(
          `Not enough stock for "${variant.product.title}".`,
        );
      }

      lines.push({
        variantId: variant.id,
        productId: variant.product_id,
        title: variant.product.title,
        variantTitle: variant.title ?? null,
        imageUrl: variant.image_url ?? null,
        unitPrice,
        quantity: item.quantity,
        trackInventory: variant.track_inventory,
        continueSelling: variant.continue_selling,
        inventoryQty: variant.inventory_qty,
      });
    }

    return lines;
  }

  /** Store-scoped beneficiary, created on first use. */
  private async ensureStoreBeneficiary(
    storeId: bigint,
    mode: Mode,
    currency: string,
  ): Promise<bigint> {
    const existing = await this.prisma.guarded().beneficiary.findFirst({
      where: { store_id: storeId, mode, kind: 'store', external_ref: null },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await this.prisma.guarded().beneficiary.create({
      data: {
        store_id: storeId,
        mode,
        kind: 'store',
        external_ref: null,
        default_currency: currency,
      },
      select: { id: true },
    });

    return created.id;
  }

  /**
   * Next per-store order number.
   *
   * The unique constraint on (store_id, order_number) is the real
   * guarantee; this only picks a starting point.
   */
  /**
   * Next per-store order number.
   *
   * Was `count(*) + 1001`, which two concurrent finalisations both read
   * as the same value. The unique constraint on
   * (store_id, order_number) then rejected one of them outright, so a
   * paid customer's order failed rather than simply taking the next
   * number.
   *
   * A row lock on the store serialises the read within the transaction.
   * Same visible format, no schema change, and the unique constraint
   * remains the real guarantee.
   */
  private async nextOrderNumber(
    tx: Prisma.TransactionClient,
    storeId: bigint,
  ): Promise<string> {
    await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`;

    const highest = await tx.order.findFirst({
      where: { store_id: storeId },
      orderBy: { id: 'desc' },
      select: { order_number: true },
    });

    const previous = highest ? Number.parseInt(highest.order_number, 10) : NaN;

    return String(Number.isFinite(previous) ? previous + 1 : 1001);
  }
}

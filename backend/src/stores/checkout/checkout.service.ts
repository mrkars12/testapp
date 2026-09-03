import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../common/config/configuration';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  CaptureMode,
  Mode,
  OrderStatus,
  StorePaymentMode,
  PaymentAttemptStatus,
  PaymentMethodKey,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DecryptionError } from '../../common/crypto/key-provider.interface';
import { OutboxService } from '../../common/messaging/outbox.service';
import { LedgerService } from '../../ledger/ledger.service';
import { offlineCommitment } from '../../ledger/posting-rules';
import {
  money,
  parseDecimal,
  toDecimalString,
} from '../../common/money/money.util';
import type { Money } from '../../common/money/money.types';
import { canExposeCheckoutPii } from './checkout-pii-policy';
import {
  chooseSuccessor,
  contactMatches,
  mayBeSuperseded,
  MAX_SUCCESSION_DEPTH,
  MAX_SUCCESSION_NODES,
} from './checkout-succession';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import {
  IdReservationService,
  PAYMENT_INTENTS_TABLE,
} from '../../common/ids/id-reservation.service';
import { fingerprintRequest } from '../../common/idempotency/idempotency.types';
import { PaymentAccountService } from '../payments/payment-account.service';
import { attemptAwaitsSubmission } from '../payments/payment-attempt-start';
import {
  OfferingPolicyError,
  checkPolicy,
  computeFeeMinor,
  describePolicy,
  feeLabel,
  parseOfferingPolicy,
} from './offering-policy';
import { nextOrderNumber } from './order-numbering';
import { ProviderRegistry } from '../payments/gateways/provider-registry.service';
import { outboundIdempotencyKey } from '../payments/gateways/payment-provider.interface';
import { PaymentFactApplier } from '../payments/facts/payment-fact.applier';
import { CheckoutSuccessionFundsService } from '../payments/facts/checkout-succession-funds.service';
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
import {
  enabledFormMethods,
  groupOfferingsIntoExperiences,
} from '../payments/gateways/payment-forms';
import { sanitizeReturnUrl } from './return-url';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CartService, type CartClaim } from '../cart/cart.service';
import { computeQuoteHash } from '../cart/quote-hash';
import { convertCartForCheckout, releaseCartSlot } from '../cart/cart-slot';
import {
  assertAvailable,
  decrementInventory,
  InsufficientStockError,
} from '../inventory/inventory-claim';

/**
 * Whether a commit answered with an INCUMBENT checkout rather than a
 * new one.
 *
 * Used only to record the right HTTP status against an idempotency key:
 * converging on an existing checkout is not a creation.
 */
function isConvergedResponse(response: unknown): boolean {
  return (
    !!response &&
    typeof response === 'object' &&
    (response as { converged?: unknown }).converged === true
  );
}

/** How long a checkout, and the stock it holds, stays alive. */
const CHECKOUT_TTL_MINUTES = 30;

/** Idempotency scope for storefront checkout. */
const CHECKOUT_SCOPE = 'checkout.create';

/**
 * Appends a query parameter to a URL the client supplied, tolerating a URL
 * that already has its own query string. Falls back to the raw input
 * unchanged if it isn't a parseable absolute URL — a malformed
 * `return_url` should surface as a provider-side validation error, not a
 * silent throw here.
 */
function withQueryParam(url: string, key: string, value: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    return url;
  }
}

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

/**
 * The credential field names configured on an account.
 *
 * Reads `credentials_hint`, whose values are masked last-4 strings, so
 * nothing secret is touched — only the shape of what the merchant filled
 * in.
 */
function configuredCredentialKeys(hint: unknown): readonly string[] {
  if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return [];
  return Object.keys(hint as Record<string, unknown>);
}

/** Account states a customer may pay against. Mirrors listPaymentMethods. */
const USABLE_ACCOUNT_STATUSES: readonly string[] = ['active', 'verifying'];

/**
 * The payer's name, split into the parts a provider may ask for.
 *
 * The checkout collects one `customer_name` field, because that is what a
 * shopper is willing to type. Some providers want it decomposed — Tap's
 * charge API takes `first_name`, `middle_name` and `last_name`, and marks
 * the first of them required.
 *
 * This is a decomposition of what the customer actually supplied, never
 * an invention: with one word there is only a first name, with two there
 * is no middle name, and nothing is substituted when a part is absent.
 * Whitespace-only input yields nothing at all, so a provider that
 * requires a name refuses rather than receiving a blank one.
 */
export function splitCustomerName(raw: string | undefined | null): {
  firstName?: string;
  middleName?: string;
  lastName?: string;
} {
  const parts = (raw ?? '').trim().split(/\s+/).filter((p) => p.length > 0);

  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1] };

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

/**
 * The payer's contact details, in the shape adapters read them from.
 *
 * `PaymentCallContext.metadata` already existed and is already part of
 * the provider contract; this fills it in rather than adding a field, so
 * `IPaymentProvider` is untouched and every existing adapter — Stripe,
 * Paymob, Moyasar, cash on delivery, bank transfer — is unaffected,
 * because none of them reads it.
 *
 * ⚠️ Only keys the checkout genuinely has are emitted. Nothing is
 * defaulted, substituted or padded:
 *
 *   • `customer_email` is optional at checkout. When the shopper did not
 *     give one, the key is absent and a provider that requires an email
 *     refuses before any network call — which is the correct outcome, and
 *     the existing error path handles it.
 *
 *   • the phone keys are deliberately **not** emitted. The checkout
 *     stores one `customer_phone` string with no separate country code,
 *     and providers that want a phone want the two parts separately.
 *     Splitting an arbitrary number into a dialling code and a subscriber
 *     number needs a country table, and guessing at it would be exactly
 *     the fabrication this must avoid. Sending a wrong country code is
 *     worse than sending no phone at all, and no provider used here
 *     requires one.
 *
 *   • `customer_id` is a provider-side identifier the checkout has never
 *     seen, so it is never emitted.
 */
export function payerMetadata(input: {
  customerName?: string | null;
  customerEmail?: string | null;
}): Record<string, string> {
  const metadata: Record<string, string> = {};

  const { firstName, middleName, lastName } = splitCustomerName(
    input.customerName,
  );

  if (firstName) metadata.customer_first_name = firstName;
  if (middleName) metadata.customer_middle_name = middleName;
  if (lastName) metadata.customer_last_name = lastName;

  const email = (input.customerEmail ?? '').trim();

  if (email.length > 0) metadata.customer_email = email;

  return metadata;
}

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

/**
 * One string field out of a `jsonb` blob, or null.
 *
 * The column is untyped at the database boundary, so every read of it is
 * a claim about shape. Anything that is not a non-empty string reads as
 * absent rather than as a value.
 */
function readOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
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
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    private readonly succession: CheckoutSuccessionFundsService,
    /**
     * The server-authoritative cart, and the two-phase claim on it.
     *
     * Optional so that a caller which does not exercise cart identity —
     * an older wiring, a spec constructing this service by hand — gets
     * exactly the behaviour that existed before: `cartToken` is never
     * supplied, so the claim is never taken and every checkout follows
     * the stateless path.
     */
    private readonly carts?: CartService,
  ) {}

  /**
   * Origins this deployment will let a provider redirect a payer back to.
   *
   * The CORS allowlist, reused rather than duplicated — see return-url.ts.
   * Read through `get` (not `getOrThrow`) with an empty fallback so a
   * config-less test harness degrades to "accept no client return URL",
   * which falls back to the merchant's configured one, instead of
   * throwing inside a checkout.
   */
  private get allowedReturnOrigins(): readonly string[] {
    return this.config.get<AppConfig>('app')?.corsOrigins ?? [];
  }

  /**
   * Payment methods a shopper can pick, for one storefront.
   *
   * Only enabled offerings on active accounts, ordered by the merchant's
   * chosen position.
   */
  async listPaymentMethods(slug: string, mode: Mode = 'live') {
    const store = await this.findStore(slug);

    return this.prisma.$transaction(async (tx) => {
      // RLS context must be installed on the transaction connection.
      await tx.$executeRaw`
        SELECT
          set_config('app.store_id', ${store.id.toString()}, true),
          set_config('app.mode', ${mode}, true)
      `;

      const offerings = await tx.paymentMethodOffering.findMany({
        where: {
          store_id: store.id,
          mode,
          enabled: true,
        },
        orderBy: { position: 'asc' },
      });

      if (offerings.length === 0) {
        return [];
      }

      const accounts = await tx.paymentAccount.findMany({
        where: {
          store_id: store.id,
          mode,
          status: { in: ['active', 'verifying'] },
        },
        select: {
          id: true,
          gateway: true,
          status: true,
          // Key NAMES only. `credentials_hint` holds a masked last-4 per
          // configured field and no secret values, so this tells us
          // which credentials exist without decrypting anything — which
          // is exactly what deciding embedded-vs-redirect needs.
          credentials_hint: true,
        },
      });

      const byId = new Map(
        accounts.map((account) => [account.id.toString(), account]),
      );

      const usable = offerings.filter((offering) => {
        const account = byId.get(offering.account_id.toString());
        // Defense-in-depth: an account can only reach this query with
        // status active/verifying, which today should already imply a
        // registered adapter (PaymentAccountService.upsert() gates on
        // that). Checking again here means a gateway losing its adapter
        // — or a row saved before that gate existed — can never reach
        // the storefront, without needing to touch account status.
        return account !== undefined && this.providers.has(account.gateway);
      });

      /*
       * Offerings are grouped into PAYMENT EXPERIENCES before they are
       * published.
       *
       * A PaymentMethodOffering is a merchant record — one row per
       * method the merchant switched on. What the customer picks from is
       * a list of provider SURFACES, and the two are not the same
       * granularity: Moyasar's Payment Form is one card component that
       * accepts mada as a network, so `card` and `mada` are two networks
       * of one form. Publishing them as two choices produced two radio
       * buttons that mounted a byte-identical form.
       *
       * The grouping is the adapter's declaration
       * (`capabilities.providerForms`), never this service's opinion,
       * and an adapter that declares nothing gets exactly the old
       * one-entry-per-offering behaviour. Merchant settings are
       * untouched: they stay method-oriented, and this read model is
       * allowed to be coarser.
       */
      const byAccount = new Map<string, typeof usable>();
      for (const offering of usable) {
        const key = offering.account_id.toString();
        const bucket = byAccount.get(key);
        if (bucket) bucket.push(offering);
        else byAccount.set(key, [offering]);
      }

      const published: {
        id: string;
        method: string;
        methods: string[];
        offering_ids: string[];
        form_id: string;
        gateway: string | undefined;
        name_ar: string | null;
        name_en: string | null;
        commitment_kind: string;
        position: number;
        policy: unknown;
        presentation_mode: string;
        next_action_kinds: string[];
      }[] = [];

      for (const [accountId, accountOfferings] of byAccount) {
        const account = byId.get(accountId);
        // Safe: `usable` already dropped every offering whose account
        // has no registered adapter.
        const capabilities = this.providers.get(account!.gateway).capabilities;
        const credentialKeys = configuredCredentialKeys(
          account?.credentials_hint,
        );

        const experiences = groupOfferingsIntoExperiences(
          accountOfferings,
          capabilities,
          credentialKeys,
        );

        for (const experience of experiences) {
          const offering = experience.representative;

          published.push({
            id: offering.id.toString(),
            method: offering.method,
            /**
             * Every method this one experience covers. A single-method
             * experience publishes a single-entry list, so the shape
             * does not depend on whether an adapter declares forms.
             */
            methods: experience.members.map((member) => member.method),
            /**
             * The merchant rows behind it. Published so the storefront
             * (and anything reading this endpoint) can tell that two
             * enabled offerings became one payment experience, rather
             * than having to infer that a method disappeared.
             */
            offering_ids: experience.members.map((member) =>
              member.id.toString(),
            ),
            form_id: experience.formId,
            gateway: account?.gateway,
            name_ar: offering.display_name_ar,
            name_en: offering.display_name_en,
            commitment_kind: offering.commitment_kind,
            position: offering.position,
            policy: this.safeDescribePolicy(offering.constraints),
            /**
             * How the checkout page has to host this experience —
             * derived from the adapter's declared capabilities, never
             * from the gateway's name. For a declared form this is the
             * mode of the ONE action kind that form produces, which is
             * what makes it honest per method: Moyasar's Apple Pay goes
             * to the hosted invoice, so it is published as
             * `same_tab_redirect` and no longer claims to be embedded
             * just because the same account's card form is.
             */
            presentation_mode: experience.presentationMode,
            /**
             * The concrete customer-action kinds this experience can
             * produce. A declared form narrows it to the single kind it
             * will actually emit; an adapter without forms publishes
             * everything it can emit, as before. The storefront must be
             * able to render every one of them before it offers the
             * method.
             */
            next_action_kinds:
              experience.nextActionKind !== null
                ? [experience.nextActionKind]
                : [...capabilities.nextActionKinds],
          });
        }
      }

      return published.sort((a, b) => a.position - b.position);
    });
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
    /**
     * The opaque cart cookie, when the browser sent one.
     *
     * Absent means the stateless path, byte for byte what this method
     * did before carts existed. That is not a fallback bolted on for
     * safety — it is a supported path (a cookieless browser must still
     * be able to buy), and it is the reason this whole change can be
     * deployed and rolled back one layer at a time.
     */
    cartToken?: string | null,
  ) {
    const store = await this.findStore(slug);
    this.tenantContext.setMode(mode);

    // Without this, a double-tapped Place Order button produces two
    // orders, two ledger entries and two inventory decrements. The
    // interceptor cannot be reused here: it needs a store in the tenant
    // context, and storefront routes have no ActiveStoreGuard, so the
    // store is only known after the slug is resolved.
    //
    // IDEMPOTENCY AND CART IDENTITY ARE TWO MECHANISMS ANSWERING TWO
    // DIFFERENT QUESTIONS, and they are deliberately not merged. The
    // key is per tab, per attempt, and it answers "is this the same
    // REQUEST again?" — a double click, a network retry. The cart
    // answers "is this the same PURCHASE?" — a second tab, a second
    // window. Deriving the key from the cart would make it stable
    // across a retry of an unchanged basket, so a customer whose card
    // was declined and who pressed "try again" would be replayed the
    // original failure instead of getting a new attempt. That is why
    // the key below is untouched by any of this.
    if (!idempotencyKey) {
      return this.commit(store, dto, mode, cartToken);
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
      const response = await this.commit(store, dto, mode, cartToken);
      await this.idempotency.complete(
        claim.recordId,
        store.id,
        mode,
        // A converged answer is the incumbent checkout's state, not a
        // creation. Recorded with the status it was actually served
        // with, so a replay of this key says the same thing.
        isConvergedResponse(response) ? 200 : 201,
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
    cartToken?: string | null,
  ) {
    const currency = (store.currency || 'USD').toUpperCase();

    /* ══════════════════════════════════════════════════════════════
       PHASE A — THE CART CLAIM, TAKEN BEFORE THE PROVIDER IS CALLED.

       This is where a duplicate purchase dies, and it dies before a
       single byte reaches the gateway. Two tabs sharing one cart cookie
       serialise on the cart row here: one wins and creates the
       checkout, the other is handed the winner's checkout token and
       renders that.

       It has to happen here rather than in the transaction below,
       because the provider call sits between the two transactions —
       correctly, since a database transaction must never be held open
       across network I/O. A claim taken only in the second transaction
       would let BOTH tabs call the gateway and discover the loser
       afterwards, leaving a real payment session at the provider with
       no checkout behind it.
       ══════════════════════════════════════════════════════════════ */
    const claim = await this.claimCart(store.id, mode, cartToken);

    switch (claim.kind) {
      case 'converged': {
        /*
         * TAB B'S WHOLE STORY.
         *
         * No second checkout, no second intent, no second call to the
         * provider. What comes back is the INCUMBENT's own record, read
         * from the same status endpoint every other reading on the
         * storefront comes from — so this response asserts nothing
         * about the payment that the server did not already know.
         *
         * `payment_redirect_url` is carried alongside so the converging
         * tab can dispatch the incumbent's pending action through the
         * exact same code path it uses for a checkout it created
         * itself. Same fields, same switch, one behaviour.
         */
        const incumbent = await this.getCheckoutStatus(
          await this.slugFor(store.id),
          claim.checkoutToken,
        );

        const action = incumbent.next_action as
          | { kind?: string; url?: unknown }
          | null;

        return {
          ...incumbent,
          payment_redirect_url:
            action?.kind === 'redirect' && typeof action.url === 'string'
              ? action.url
              : null,
          converged: true as const,
        };
      }

      case 'converted':
        // The basket was already bought. A repeat purchase is a NEW
        // cart, minted by the next add-to-cart — never this one revived.
        throw new ConflictException({
          code: 'cart_converted',
          order_number: claim.orderNumber,
        });

      case 'not_active':
        throw new ConflictException({ code: 'cart_not_active' });

      case 'in_flight':
        // Another request is between Phase A and Phase B for this very
        // cart. Identical semantics to the idempotency service's own
        // `in_flight`: wait and ask again.
        throw new ConflictException({ code: 'checkout_in_flight' });

      default:
        break;
    }

    /** The cart this checkout is being priced from, when there is one. */
    const cart =
      claim.kind === 'claimed'
        ? {
            id: claim.cartId,
            publicId: claim.cartPublicId,
            version: claim.version,
          }
        : null;

    /*
     * THE LINES THIS PURCHASE IS PRICED FROM.
     *
     * When a cart exists, the SERVER'S cart wins outright — `dto.items`
     * is not consulted at all. The browser has never been trusted for
     * prices, and with a server-side cart it is no longer trusted for
     * contents either. Without a cart the request body is authoritative
     * exactly as it has always been, which is the stateless path.
     */
    const requestedItems =
      claim.kind === 'claimed'
        ? claim.lines.map((line) => ({
            variant_id: line.variantId.toString(),
            quantity: line.quantity,
          }))
        : dto.items;

    try {
      return await this.commitWithCart(
        store,
        dto,
        mode,
        currency,
        requestedItems,
        cart,
      );
    } catch (error) {
      /*
       * THE FAILURE PATH BETWEEN THE TWO PHASES.
       *
       * The provider threw, or the second transaction rolled back.
       * Nothing was written, so the lease must go back or the shopper's
       * basket is unusable until it expires. Guarded inside
       * `releaseLease` on `active_checkout_id IS NULL`, so a late
       * failure can never wipe a slot a successful attempt has since
       * taken.
       */
      if (cart) {
        await this.carts?.releaseLease(store.id, mode, cart.id);
      }
      throw error;
    }
  }

  /**
   * Runs a step that happens AFTER the inventory hold is durable, and
   * undoes the hold if it fails.
   *
   * Round 9 moved the checkout row, its reservations and its cart slot
   * into the transaction that commits BEFORE the provider is called —
   * that is what makes the hold real while the network call is in
   * flight, and it is what closes the check-to-reserve race. The cost
   * is that "the provider threw" no longer means "nothing was
   * written": it means a committed checkout is sitting on stock and on
   * the shopper's basket.
   *
   * So the failure path compensates rather than relying on rollback,
   * because there is nothing left to roll back. The shape is exactly
   * `CheckoutFinalizerService.abandon()`: mark the checkout failed,
   * release its held reservations, give the cart its slot back and
   * leave the cart ACTIVE so «المحاولة مرة أخرى» works immediately
   * instead of after the expiry sweep.
   *
   * The compensation is guarded on `order_id IS NULL` and on a
   * non-terminal status, so it can never unwind a checkout that
   * succeeded in the meantime. Its own failure is swallowed and logged:
   * the caller's error is the one the shopper needs to see, and
   * `CheckoutExpiryJob` remains the backstop for a compensation that
   * could not run.
   */
  private async releaseHoldOnFailure<T>(
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
    step: () => Promise<T>,
  ): Promise<T> {
    try {
      return await step();
    } catch (error) {
      try {
        await this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
          const claimed = await tx.checkout.updateMany({
            where: {
              id: checkoutId,
              store_id: storeId,
              mode,
              order_id: null,
              status: { in: ['open', 'pending_payment'] },
            },
            data: { status: 'failed' },
          });

          if (claimed.count === 0) return;

          await tx.inventoryReservation.updateMany({
            where: {
              checkout_id: checkoutId,
              store_id: storeId,
              mode,
              state: 'held',
            },
            data: { state: 'released', settled_at: new Date() },
          });

          await releaseCartSlot(tx, { checkoutId, storeId, mode });
        });
      } catch (cleanupError) {
        this.logger.error(
          `Could not release the hold for checkout ${checkoutId} after a ` +
            `failed commit: ${(cleanupError as Error).message}. ` +
            'CheckoutExpiryJob will sweep it.',
        );
      }

      throw error;
    }
  }

  /**
   * Phase A, or nothing at all.
   *
   * Returns `no_cart` — the stateless path — whenever cart identity is
   * not in play: no cookie, or no CartService wired in. Both are
   * supported, and both produce exactly the behaviour that existed
   * before this shipped.
   */
  private async claimCart(
    storeId: bigint,
    mode: Mode,
    cartToken: string | null | undefined,
  ): Promise<CartClaim> {
    if (!cartToken || !this.carts) return { kind: 'no_cart' };
    return this.carts.claimForCheckout(storeId, mode, cartToken);
  }

  /**
   * Phase B's question, asked again after the provider has answered:
   * does this checkout still own its cart's slot?
   *
   * Round 8 claimed the slot in the transaction that ran AFTER the
   * provider call, so a slot stolen mid-flight made `attachCheckout()`
   * affect zero rows and rolled the loser's whole transaction back.
   * Round 9 had to move that claim into TX1 — the hold is only durable
   * if the checkout it hangs off is committed before the provider is
   * called — and moving it left nothing looking at the slot afterwards.
   *
   * So the claim stays in TX1 and the OWNERSHIP CHECK comes back here,
   * at the point in the flow where Round 8 made it. Zero rows means
   * another checkout took the cart between the two phases, and this one
   * must not go on to write an intent, an attempt or an order.
   *
   * `FOR UPDATE` rather than a bare read: an unlocked check is the same
   * race one line further down. The row stays locked for the rest of
   * TX2, so a concurrent Phase A claim waits for this transaction to
   * finish instead of slipping in between this statement and the
   * commit.
   *
   * This reads the cart; it does not change how the slot is claimed,
   * released or converted. `claimForCheckout`, `attachCheckout`,
   * `releaseLease`, `releaseCartSlot` and `checkouts_one_live_per_cart`
   * are all exactly as Round 8 left them.
   */
  private async assertStillOwnsCartSlot(
    tx: Prisma.TransactionClient,
    input: { cartId: bigint; storeId: bigint; mode: Mode; checkoutId: bigint },
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id
        FROM carts
       WHERE id = ${input.cartId}
         AND store_id = ${input.storeId}
         AND mode::text = ${input.mode}
         AND status = 'active'
         AND active_checkout_id = ${input.checkoutId}
       FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new ConflictException(
        'This cart already has a checkout in progress.',
      );
    }
  }

  /** The slug for a resolved store — only needed to re-read a checkout. */
  private async slugFor(storeId: bigint): Promise<string> {
    const store = await this.prisma
      .guarded()
      .store.findFirst({ where: { id: storeId }, select: { slug: true } });

    if (!store) throw new NotFoundException('Store not found.');
    return store.slug;
  }

  /**
   * Everything from pricing to the committed order.
   *
   * Split out of `commit()` only so the cart lease has a single, honest
   * `try`/`catch` around every way this can fail. The body below is the
   * pre-existing commit path with two additions, both inside the
   * transaction that already writes the checkout: `cart_id` and
   * `quote_hash` on the INSERT, and the Phase B claim.
   */
  private async commitWithCart(
    store: { id: bigint; currency: string; payment_mode: StorePaymentMode },
    dto: CreateCheckoutDto,
    mode: Mode,
    currency: string,
    requestedItems: readonly { variant_id: string; quantity: number }[],
    cart: { id: bigint; publicId: string; version: number } | null,
  ) {

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000);

    // Generated here, before the transaction and before the adapter call,
    // rather than left to `tx.checkout.create()`'s default: a
    // redirect-based gateway (Paymob/Moyasar/Tap, and now Stripe Checkout
    // Sessions) is handed the return URL *before* the customer comes
    // back, so without this the URL the customer is eventually sent to
    // would carry no way to identify which checkout attempt it belongs
    // to. The same value is used as the row's actual `token` below, so
    // this is not a second identifier competing with the real one.
    const checkoutToken = randomUUID().replace(/-/g, '');
    // Validated against this deployment's own origins before it is handed
    // to a provider: `return_url` arrives on an unauthenticated public
    // body and becomes a redirect a third party performs for us, so
    // "parses as a URL" (all the DTO can assert) is not enough. An
    // untrusted value is dropped, which is the same path as sending none
    // — the adapter falls back to the merchant's configured URL.
    const requestedReturnUrl = sanitizeReturnUrl(
      dto.return_url,
      this.allowedReturnOrigins,
    );
    const returnUrl = requestedReturnUrl
      ? withQueryParam(requestedReturnUrl, 'token', checkoutToken)
      : undefined;

    /*
     * ══════════════════════════════════════════════════════════════
     * TX1 — EVERYTHING THAT DECIDES WHETHER THIS SALE MAY HAPPEN,
     * AND THE DURABLE HOLD THAT SAYS IT DID.
     * ══════════════════════════════════════════════════════════════
     *
     * The stock check and the inventory claim are in ONE transaction,
     * and that transaction COMMITS BEFORE the provider is called. This
     * is the whole point of Round 9. Previously stock was read here,
     * the PSP was called, and the reservation was written in a second
     * transaction afterwards — so two shoppers could both read the
     * same number, both be told yes, and both pay, with the entire
     * provider round-trip sitting in the window between the check and
     * the hold.
     *
     * The checkout row and its line items move here with the claim,
     * because reservations are foreign-keyed to the checkout. That is
     * a boundary move, not a new architecture: the same rows in the
     * same order, one transaction earlier.
     *
     * The PSP/network call still stays strictly outside — a database
     * transaction is never held open across network I/O. A checkout
     * whose provider call then fails is already handled: it holds its
     * stock until `CheckoutExpiryJob` sweeps it, exactly like a
     * shopper who closed the tab.
     *
     * All tenant-scoped reads execute with PostgreSQL's tenant context
     * installed on this same transaction.
     */
    const prepared = (await this.prisma.withTenantTransaction(
      store.id,
      mode,
      async (tx) => {
        const offering = await tx.paymentMethodOffering.findFirst({
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

        const account = await tx.paymentAccount.findFirst({
          where: {
            id: offering.account_id,
            store_id: store.id,
            mode,
          },
          select: {
            id: true,
            gateway: true,
            status: true,
          },
        });

        if (!account || !USABLE_ACCOUNT_STATUSES.includes(account.status)) {
          throw new BadRequestException(
            'Selected payment method is not available.',
          );
        }

        /*
         * The other methods this merchant has enabled on the SAME
         * account.
         *
         * A provider form can host several of our methods, and the
         * provider usually wants that set named: Moyasar's card
         * component takes `supported_networks`, so a merchant with
         * `card` but not `mada` must get a form that does not advertise
         * mada. Read here, inside the tenant transaction, because it is
         * a tenant-scoped read like every other one before the PSP call.
         */
        const accountMethods = (
          await tx.paymentMethodOffering.findMany({
            where: {
              account_id: offering.account_id,
              store_id: store.id,
              mode,
              enabled: true,
            },
            select: { method: true },
          })
        ).map((row) => row.method);

        const lines = await this.resolveLines(
          tx,
          store.id,
          currency,
          requestedItems,
        );

        const subtotalMinor = lines.reduce(
          (acc, l) => acc + l.unitPrice.amountMinor * BigInt(l.quantity),
          0n,
        );

        if (subtotalMinor <= 0n) {
          throw new BadRequestException(
            'Cart total must be greater than zero.',
          );
        }

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

        const beneficiaryId = await this.ensureStoreBeneficiary(
          tx,
          store.id,
          mode,
          currency,
        );

        /*
         * THE INVENTORY CLAIM.
         *
         * Locks every tracked variant FOR UPDATE in ascending id order,
         * nets the quantity live `held` reservations are already
         * holding, and refuses the whole checkout if any gated line
         * does not fit. A refusal throws, which rolls this transaction
         * back in its entirety — so a multi-line checkout claims all of
         * its stock or none of it, and no half-written hold can exist.
         *
         * Deliberately AFTER pricing and policy: those can also refuse,
         * and refusing before taking locks keeps them held for the
         * shortest possible time. Deliberately BEFORE the checkout row
         * is written, so nothing at all is created for a sale that
         * cannot happen.
         */
        try {
          await assertAvailable(tx, {
            storeId: store.id,
            // No `mode`: one variant has one physical pool, and a hold
            // taken in either payment mode consumes from it. See the
            // rule stated in `heldQuantities()`.
            lines: lines.map((line: ResolvedLine) => ({
              variantId: line.variantId,
              quantity: line.quantity,
              trackInventory: line.trackInventory,
              continueSelling: line.continueSelling,
            })),
          });
        } catch (error) {
          // Translated to the message the storefront has always shown,
          // naming the product rather than the variant id. The claim
          // layer knows ids; only the priced line knows titles.
          if (error instanceof InsufficientStockError) {
            const line = lines.find(
              (l: ResolvedLine) => l.variantId === error.variantId,
            );
            throw new BadRequestException(
              `Not enough stock for "${line?.title ?? 'this product'}".`,
            );
          }
          throw error;
        }

        /*
         * THE CHECKOUT THIS ONE REPLACES, if the caller named one and
         * the claim holds up.
         *
         * Resolved inside the same transaction that creates the row, so
         * the link is written by the INSERT itself: one statement, no
         * update of an existing row, and nothing to race. A claim that
         * does not check out simply produces `null` — see
         * `resolveSupersededCheckoutId` for why it is ignored rather
         * than refused.
         */
        const supersedesId = await this.resolveSupersededCheckoutId(
          tx,
          store.id,
          mode,
          dto.supersedes_checkout_token,
          { phone: dto.customer_phone, email: dto.customer_email },
        );

        const checkout = await tx.checkout.create({
          data: {
            store_id: store.id,
            mode,
            token: checkoutToken,
            status: 'pending_payment',
            supersedes_id: supersedesId,
            /*
             * THE CART THIS WAS PRICED FROM — identity, nothing else.
             *
             * Written by the INSERT itself and never updated, the
             * identical discipline `supersedes_id` follows. Note that
             * the two are separate columns answering separate
             * questions: "which basket is this?" and "which attempt did
             * this replace?". A retry of the same basket writes the
             * SAME `cart_id` and a NEW `supersedes_id`, and cart
             * identity is never written into `supersedes_id`.
             *
             * NULL on the stateless path, which is what makes the
             * partial unique index below exempt every checkout that
             * existed before this shipped.
             */
            cart_id: cart?.id ?? null,
            /*
             * THE SEAL ON THE QUOTE.
             *
             * Computed from the PRICED result — the amounts this server
             * just resolved out of ProductVariant — so it is a
             * statement about what was quoted, never about what a
             * browser asked for. Read later to notice that the basket
             * moved after pricing; it is a DETECTOR, not a lock. The
             * lock is the cart endpoints' own refusal to mutate a cart
             * with a live checkout.
             */
            quote_hash: computeQuoteHash({
              cartPublicId: cart?.publicId ?? null,
              cartVersion: cart?.version ?? 0,
              currency,
              offeringId: offering.id,
              totalMinor,
              lines: lines.map((line: ResolvedLine) => ({
                variantId: line.variantId,
                quantity: line.quantity,
                unitPriceMinor: line.unitPrice.amountMinor,
              })),
            }),
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

        /* ══════════════════════════════════════════════════════════
           PHASE B — the lease becomes the real claim.

           In the SAME transaction that just created this checkout and
           its line items, quote and reservations. If the slot was taken
           between the two phases this throws, the whole transaction
           rolls back, and none of those rows ever existed — there is no
           half-written checkout to clean up, because there is nothing
           to clean up.

           The partial unique index `checkouts_one_live_per_cart` backs
           this up at the storage layer: even a future path that forgot
           to come through here cannot produce a second live checkout
           for one cart.
           ══════════════════════════════════════════════════════════ */
        if (cart) {
          await this.carts!.attachCheckout(tx, {
            cartId: cart.id,
            storeId: store.id,
            mode,
            checkoutId: checkout.id,
          });
        }

        await tx.checkoutLineItem.createMany({
          data: lines.map((l: ResolvedLine) => ({
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

        /*
         * THE HOLD ITSELF — always `held`, on every path.
         *
         * Previously the offline path wrote `converted` straight away,
         * because it decremented inventory in the same transaction. It
         * no longer can: whether a commitment is offline is decided by
         * the ADAPTER RESULT (`interpretResult`), which does not exist
         * until after the provider call, which is now after this
         * transaction has committed. So offline holds are `held` here
         * and converted below, in the transaction that creates their
         * order and takes their stock — which is exactly what the
         * gateway path already does in `CheckoutFinalizerService`. Same
         * end state, one uniform rule.
         *
         * Untracked lines get no row at all, which is what makes
         * `track_inventory = false` mean "not counted" rather than
         * "counted as zero".
         */
        await tx.inventoryReservation.createMany({
          data: lines
            .filter((l: ResolvedLine) => l.trackInventory)
            .map((l: ResolvedLine) => ({
              checkout_id: checkout.id,
              store_id: store.id,
              mode,
              variant_id: l.variantId,
              quantity: l.quantity,
              state: 'held' as const,
              expires_at: expiresAt,
              settled_at: null,
            })),
        });

        return {
          offering,
          account,
          accountMethods,
          lines,
          subtotalMinor,
          feeMinor,
          totalMinor,
          beneficiaryId,
          policy,
          checkout,
        };
      },
    )) as any;

    const {
      offering,
      account,
      accountMethods,
      lines,
      subtotalMinor,
      feeMinor,
      totalMinor,
      beneficiaryId,
      policy,
      checkout,
    } = prepared;

    // The intent id is needed for the deterministic PSP idempotency key,
    // so it is reserved first, then the adapter is called, then the rest
    // of the commit runs. The adapter call stays outside any transaction:
    // never hold a database transaction open across network I/O.
    const intentId = await this.ids.reserve(PAYMENT_INTENTS_TABLE);

    /*
     * FROM HERE ON THE HOLD IS REAL, SO EVERY FAILURE MUST UNDO IT.
     *
     * TX1 has committed: a checkout row exists, it holds stock, and it
     * holds its cart's slot. That is the point — the provider is called
     * with the inventory already secured. But it also means a provider
     * that throws no longer leaves "nothing written": it leaves a
     * checkout holding units and a basket nobody can retry.
     *
     * `CheckoutExpiryJob` would eventually clear both, but "eventually"
     * is a minute at best and the shopper is standing there now. So the
     * failure path compensates immediately, in exactly the shape
     * `CheckoutFinalizerService.abandon()` uses for a declined payment:
     * the checkout is marked failed, its holds are released, and the
     * cart's slot goes back with the cart left ACTIVE so the retry can
     * claim it again.
     */
    const { initializeResult, interpreted } = await this.releaseHoldOnFailure(
      store.id,
      mode,
      checkout.id,
      async () => {
        const result = await this.initializePayment({
      storeId: store.id,
      mode,
      accountId: offering.account_id,
      gateway: account.gateway,
      offeringId: offering.id,
      method: offering.method,
      gatewayMethodConfig: offering.gateway_method_config,
      // Every method this merchant has enabled on the same account.
      // Narrowed to the ones the provider FORM hosts inside
      // initializePayment, where the resolved adapter is already in
      // hand — doing it here would mean a second registry lookup before
      // the provider has been validated.
      accountMethods,
      intentId,
      amountMinor: totalMinor,
      currency,
      captureMethod: offering.capture_mode,
      // The payer the shopper just identified. Passed through the
      // metadata field that already exists on the call context, so a
      // provider requiring a name or an email has it, and one that does
      // not simply ignores it.
      metadata: payerMetadata({
        customerName: dto.customer_name,
        customerEmail: dto.customer_email,
      }),
      // Where the storefront wants the payer sent back. Only when this
      // checkout actually carries one; otherwise the adapter falls back
      // to the merchant's configured URL. Carries `?token=` (see above)
      // so the return page can identify this checkout without trusting
      // anything else client-supplied.
      returnUrl,
        });

        /*
         * INTERPRETED INSIDE THE COMPENSATED REGION, DELIBERATELY.
         *
         * `interpretResult()` THROWS on a `failed` adapter result — a
         * decline is not an exception the provider raised, it is an
         * answer this method refuses. Left outside, that throw skipped
         * the compensation entirely and a declined shopper was left
         * with a LIVE checkout sitting on their stock and their cart
         * slot until `CheckoutExpiryJob` swept it a minute later.
         *
         * A decline and a provider crash are the same situation for
         * everything TX1 committed: no funds moved, nothing may be
         * sold, give the units and the basket back now. So the
         * interpretation happens here, where the compensation can see
         * it.
         */
        return { initializeResult: result, interpreted: this.interpretResult(result) };
      },
    );

    const { nextAction, attemptStatus, offline } = interpreted;

    const gatewayRefs = providerRefs(initializeResult);

    const orderStatus: OrderStatus =
      offering.commitment_kind === 'awaiting_offline_settlement'
        ? 'AWAITING_PAYMENT'
        : 'PENDING';

    const result = await this.releaseHoldOnFailure(
      store.id,
      mode,
      checkout.id,
      () =>
        this.prisma.withTenantTransaction(
      store.id,
      mode,
      async (tx) => {
        /*
         * TX2 — THE PAYMENT RECORD, AND THE OFFLINE ORDER.
         *
         * Everything that decides whether this sale may happen already
         * happened in TX1, and the stock it claimed is committed and
         * durable. What is left here is what could only be known after
         * the provider answered: the intent, the attempt, and — when
         * the merchant accepted an unfunded promise — the order.
         */
        /*
         * THE SLOT, RE-CHECKED — the Round 8 invariant, restored.
         *
         * If another checkout acquired this cart's slot while the
         * provider was being called, this checkout has lost and must
         * not complete. Throwing rolls TX2 back, so no intent, attempt
         * or order is written, and hands `releaseHoldOnFailure` the
         * compensation for what TX1 already committed: the checkout is
         * marked failed and its units are released. The winner's slot
         * survives untouched — `releaseCartSlot` only clears a slot
         * this checkout still holds.
         */
        if (cart) {
          await this.assertStillOwnsCartSlot(tx, {
            cartId: cart.id,
            storeId: store.id,
            mode,
            checkoutId: checkout.id,
          });
        }

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
          return { checkout, order: null };
        }

        const orderNumber = await nextOrderNumber(
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
          select: {
            id: true,
            order_number: true,
            status: true,
            payment_status: true,
          },
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

        /*
         * THE CART BECAME AN ORDER — terminal, in this same transaction.
         *
         * Only on the offline path, because only here does commitment
         * itself produce the Order: cash on delivery and bank transfer
         * accept an unfunded promise, so the purchase is complete the
         * moment the customer confirms. A gateway checkout creates no
         * order here and its cart is converted later, by
         * `CheckoutFinalizerService.finalize()`, in the transaction
         * that creates the order there.
         *
         * Without this the cart would sit `active` holding a slot that
         * points at a COMMITTED checkout — and the next claim, seeing
         * that checkout is no longer live, would free the slot and let
         * the same basket be ordered a second time.
         */
        if (cart) {
          await convertCartForCheckout(tx, {
            checkoutId: checkout.id,
            storeId: store.id,
            mode,
            orderId: order.id,
            occurredAt: now,
          });
        }

        /*
         * THE OFFLINE PATH TAKES ITS STOCK — guarded, and converting
         * the holds TX1 took.
         *
         * Cash on delivery and bank transfer accept an unfunded
         * promise, so commitment itself produces the order and the
         * stock is taken now rather than at a payment that will never
         * come through a gateway. Same end state as before this
         * changed; the difference is that the units were already held
         * by a committed reservation, and the decrement is now
         * conditional.
         *
         * A refusal here throws and rolls TX2 back. That is the right
         * answer for this path specifically: no money has moved — the
         * whole point of an offline commitment is that none has — so
         * failing closed costs the shopper an error, not a payment. The
         * gateway path, where the customer HAS paid, cannot do this and
         * does something different in `CheckoutFinalizerService`.
         *
         * In practice the guard cannot refuse here: TX1 committed a
         * `held` reservation for exactly these units, and nothing
         * between then and now consumes a hold. It is a backstop
         * against a future path that forgets, which is what a guard is
         * for.
         */
        for (const line of lines) {
          if (!line.trackInventory) continue;

          const taken = await decrementInventory(tx, {
            storeId: store.id,
            variantId: line.variantId,
            quantity: line.quantity,
          });

          if (!taken) {
            throw new ConflictException(
              `Not enough stock for "${line.title}".`,
            );
          }
        }

        await tx.inventoryReservation.updateMany({
          where: {
            checkout_id: checkout.id,
            store_id: store.id,
            mode,
            state: 'held',
          },
          data: { state: 'converted', settled_at: now },
        });

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
            allocations: [
              {
                beneficiaryId,
                amountMinor: totalMinor,
              },
            ],
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
      },
        ),
    );

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

    const order = result.order;

    this.logger.log(
      `Checkout ${result.checkout.id} committed for store ${store.id} ` +
        `(${offering.commitment_kind}${
          order ? `, order ${order.order_number}` : ', awaiting payment'
        })`,
    );

    return {
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
  /**
   * The id of the checkout a new one is being created to replace, or
   * null.
   *
   * Every failure mode is `null`, and that is deliberate: an absent
   * claim, a malformed one, a token from another store or mode, a token
   * that does not exist, a checkout that has already been paid, and a
   * claim whose customer details do not match all produce exactly the
   * same result and exactly the same response. A caller cannot learn
   * whether a token exists by watching what this does, and a link that
   * cannot be established costs a history-entry convenience — never a
   * payment, an order, or an error the customer has to read.
   *
   * Store- and mode-scoped in the query itself, so a token belonging to
   * another merchant is not a token here at all.
   */
  private async resolveSupersededCheckoutId(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    token: string | undefined,
    contact: { phone?: string | null; email?: string | null },
  ): Promise<bigint | null> {
    if (!token) return null;

    const previous = await tx.checkout.findFirst({
      where: { store_id: storeId, mode, token },
      select: {
        id: true,
        order_id: true,
        customer_phone: true,
        customer_email: true,
      },
    });

    if (!previous) return null;
    if (!mayBeSuperseded(previous)) return null;
    if (!contactMatches(previous, contact)) return null;

    return previous.id;
  }

  /**
   * G1 — may this checkout still be handed a way to pay?
   *
   *   A checkout with any descendant that has secured funds must not
   *   itself secure funds again.
   *
   * This is the PREVENTION half of that rule, and it is the half that
   * actually stops charges. By the time Payment Core sees a fact the
   * card is already charged — on the embedded surface the provider's
   * form takes the money in the browser — so a guard in the applier can
   * only contain the damage. The only place a charge can still be
   * prevented is here, before a payable surface is handed out at all.
   *
   * Read WITHOUT the chain lock, deliberately. This runs on every status
   * poll, and serialising those would put a lock acquisition on the
   * hottest read in the storefront for no gain: a verdict that is one
   * moment stale can at worst let a surface be issued, which G2 then
   * contains under the lock. The authoritative, serialised read is the
   * applier's; this one is an early refusal.
   */
  private async isSupersededByFundsSecured(
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<boolean> {
    return this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      /*
       * Both arms, same as the applier's authoritative check — the
       * chain (client-declared succession) and the cart (Round 8's
       * server-authoritative purchase identity).
       *
       * Without the cart arm here, a shopper whose basket was already
       * converted by another checkout could still be handed a payable
       * surface for the stale one, and G2 would then be left containing
       * a charge that G1 could have prevented outright.
       *
       * Read WITHOUT either lock, deliberately, exactly as before: this
       * runs on every status poll, and a verdict that is one moment
       * stale can at worst let a surface be issued, which G2 then
       * contains under the locks.
       */
      if (await this.succession.isBlocked(tx, storeId, mode, checkoutId)) {
        return true;
      }

      return this.succession.isCartConvertedElsewhere(
        tx,
        storeId,
        mode,
        checkoutId,
      );
    });
  }

  /**
   * The token of the checkout that replaced this one, or null.
   *
   * IDENTITY, and only identity. It answers "which checkout should you
   * be looking at instead?" and says nothing whatsoever about that
   * checkout's payment — the caller reads that from the checkout's own
   * status, through this same endpoint, and only a terminal success
   * there may be treated as one.
   *
   * Follows the chain, because three declines make three links and a
   * page restored onto the FIRST one must reach the last. Bounded in
   * both depth and rows visited, and cycle-safe by construction (a link
   * is written only at INSERT, so it can only ever point backwards) and
   * by the `seen` set regardless.
   */
  private async resolveSupersededByToken(
    storeId: bigint,
    mode: Mode,
    checkoutId: bigint,
  ): Promise<string | null> {
    const db = this.prisma.guarded();
    const seen = new Set<string>([checkoutId.toString()]);
    const found: { id: bigint; token: string; committed: boolean }[] = [];
    let frontier: bigint[] = [checkoutId];

    for (let depth = 0; depth < MAX_SUCCESSION_DEPTH; depth += 1) {
      if (frontier.length === 0) break;

      const rows = await db.checkout.findMany({
        where: { store_id: storeId, mode, supersedes_id: { in: frontier } },
        select: { id: true, token: true, order_id: true },
        orderBy: { id: 'asc' },
        take: MAX_SUCCESSION_NODES,
      });

      frontier = [];
      for (const row of rows) {
        const key = row.id.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          id: row.id,
          token: row.token,
          // An Order exists only where funds were secured. Used to
          // CHOOSE between successors, never reported as an outcome.
          committed: row.order_id !== null,
        });
        frontier.push(row.id);
      }

      if (seen.size >= MAX_SUCCESSION_NODES) break;
    }

    return chooseSuccessor(found)?.token ?? null;
  }

  async getCheckoutStatus(slug: string, token: string) {
    const store = await this.findStore(slug);

    const checkout = await this.prisma.guarded().checkout.findFirst({
      where: { store_id: store.id, token },
    });

    if (!checkout) throw new NotFoundException('Checkout not found.');

    const intent = await this.prisma.withTenantTransaction(
      store.id,
      checkout.mode,
      (tx) =>
        tx.paymentIntent.findFirst({
          where: {
            store_id: store.id,
            mode: checkout.mode,
            context_kind: 'checkout',
            context_id: checkout.id.toString(),
          },
          select: { id: true, status: true },
        }),
    );

    const attempt = intent
      ? await this.prisma.withTenantTransaction(
          store.id,
          checkout.mode,
          (tx) =>
            tx.paymentAttempt.findFirst({
              where: {
                intent_id: intent.id,
                store_id: store.id,
                mode: checkout.mode,
              },
              orderBy: { sequence: 'desc' },
              select: {
                sequence: true,
                status: true,
                next_action_kind: true,
                next_action_payload: true,
                // Read only to answer "has the payer actually submitted
                // anything?" — see `attemptAwaitsSubmission`. Neither id
                // is published; only the boolean derived from them is.
                gateway_reference: true,
                gateway_payment_id: true,
              },
            }),
        )
      : null;

    // Narrowed to a local: TS control-flow narrowing of a property (the
    // ternary check below) does not survive into a nested closure, and
    // this read now runs inside withTenantTransaction's callback.
    const orderId = checkout.order_id;

    /*
     * The shipping address as it was stored: a small JSON object with
     * `address_line`, `city` and `notes`. Read defensively — it is a
     * `jsonb` column, so its shape is a convention rather than a type,
     * and a row written by an older version is not a reason to fail a
     * status read.
     */
    const rawShipping = checkout.shipping_address;
    const shippingAddress =
      rawShipping &&
      typeof rawShipping === 'object' &&
      !Array.isArray(rawShipping)
        ? {
            address_line: readOptionalString(rawShipping, 'address_line'),
            city: readOptionalString(rawShipping, 'city'),
            notes: readOptionalString(rawShipping, 'notes'),
          }
        : null;

    const order = orderId
      ? await this.prisma.withTenantTransaction(
          store.id,
          checkout.mode,
          (tx) =>
            tx.order.findFirst({
              where: { id: orderId, store_id: store.id },
              select: {
                id: true,
                order_number: true,
                status: true,
                payment_status: true,
                total: true,
              },
            }),
        )
      : null;

    /*
     * Decided here, once, from the authoritative state — never from
     * anything the caller sent.
     */
    /*
     * Was this checkout replaced?
     *
     * Asked for every status read, because the caller that most needs
     * the answer is a page restored from browser history onto an old
     * token — and that page looks exactly like any other load. One
     * indexed lookup that returns no rows for the ordinary checkout,
     * which is every checkout nobody retried.
     */
    const supersededByToken = await this.resolveSupersededByToken(
      store.id,
      checkout.mode,
      checkout.id,
    );

    /*
     * And the money half of the same question. Asked only when this
     * checkout was actually replaced — `superseded_by_token` is null for
     * almost every checkout there has ever been, and this costs nothing
     * for those.
     */
    const supersededByFundsSecured =
      supersededByToken === null
        ? false
        : await this.isSupersededByFundsSecured(
            store.id,
            checkout.mode,
            checkout.id,
          );

    /*
     * THE CART THIS CHECKOUT WAS PRICED FROM — its state, and whether
     * it has moved since.
     *
     * This is what a second tab reads on reconciliation. It is identity
     * and state of a BASKET, never a payment verdict: `converted` means
     * the basket became an order, and whether that order was paid is
     * still read from the order itself, on this same response.
     *
     * `null` for every checkout with no cart, which is every checkout
     * created before this shipped and every one on the stateless path.
     */
    const cartFacts = await this.readCartFacts(store.id, checkout);

    const exposePii = canExposeCheckoutPii({
      checkoutStatus: checkout.status,
      intentStatus: intent?.status ?? null,
    });

    return {
      checkout_token: checkout.token,
      checkout_status: checkout.status,
      /*
       * THE CHECKOUT THAT REPLACED THIS ONE — identity, never a verdict.
       *
       * Present when this checkout was retried or its payment method
       * changed, which is the only way a successor is ever recorded. A
       * client that receives it has learned one thing: which checkout to
       * ask about next. It has learned nothing about that checkout's
       * payment, and it cannot: the answer comes from that checkout's
       * own reading of this same endpoint, and only a terminal success
       * there is a success.
       *
       * `null` for every checkout nothing replaced, which is almost all
       * of them.
       */
      superseded_by_token: supersededByToken,
      /*
       * The state of the BASKET behind this checkout.
       *
       * A tab whose cart was bought in another tab learns it here and
       * stops offering to pay — and, far more importantly, tears the
       * provider's form out of its document. The server refuses that
       * tab's Place Order anyway (`cart_converted`); this field is what
       * lets the screen stop lying before the customer presses it.
       */
      cart_status: cartFacts.status,
      /*
       * The basket moved after this checkout was priced.
       *
       * Recomputed from the cart as it stands now and compared with the
       * `quote_hash` sealed at pricing time. A DETECTOR: it says the
       * amount on screen is no longer what this basket would cost, so
       * the tab should resync rather than show a stale figure. It
       * refuses nothing and it changes no amount — the checkout's own
       * total remains exactly what was quoted and what any payment is
       * for.
       */
      cart_quote_stale: cartFacts.stale,
      currency: checkout.currency,
      /*
       * THE CHECKOUT'S OWN AUTHORITATIVE TOTAL.
       *
       * `order.total` below only exists once a payment has succeeded —
       * an Order is created at commit, and a checkout whose payment was
       * declined has `order_id = NULL`. So on the failed-payment screen
       * there was no server amount at all, and the storefront had
       * nothing left to show but its "amount unknown" placeholder,
       * beside a decline for a checkout whose price was never in doubt.
       *
       * A declined payment does not make the amount unknown. This is the
       * figure the checkout was quoted and priced at, it is what any
       * retry will be for, and it is already stored on the row.
       *
       * Formatted through the money helpers rather than divided by 100,
       * so the currency's own exponent decides the decimals (JPY has 0,
       * KWD has 3). Read-only, derived, and additive: no existing field
       * changes meaning and nothing about the payment is altered.
       */
      total: toDecimalString(
        money(checkout.quote_total_minor, checkout.currency),
      ),
      /*
       * The details this checkout was created with — returned ONLY while
       * it can still be paid.
       *
       * Needed because a declined 3DS payment returns the payer through
       * a REDIRECT: the page that renders the failure is a brand-new
       * document, its form is empty, and these values exist nowhere in
       * the browser. Without them "try again" can only ask the customer
       * to type their contact and shipping details a second time.
       *
       * That need ends the moment the checkout does. `canExposeCheckoutPii`
       * is the single authority — server-side, read from the stored
       * state, with no request parameter able to influence it — and a
       * paid, expired or abandoned checkout answers `null` here however
       * valid the token is. See `checkout-pii-policy.ts`.
       *
       * The field set is the minimum a retry needs (name, email, phone,
       * address line, city). `notes` is not returned: nothing in the
       * payment path requires it.
       */
      customer: exposePii
        ? {
            name: checkout.customer_name,
            email: checkout.customer_email,
            phone: checkout.customer_phone,
            address_line: shippingAddress?.address_line ?? null,
            city: shippingAddress?.city ?? null,
          }
        : null,
      /*
       * Travels with the details, and under the same gate: on its own it
       * is not PII, but it is only ever used to re-start a payment, and
       * a checkout that may not be retried has no use for it.
       */
      selected_offering_id: exposePii
        ? (checkout.selected_offering_id?.toString() ?? null)
        : null,
      payment_status: intent?.status ?? null,
      /*
       * The latest attempt's own outcome, alongside the intent's.
       *
       * The two are different questions and the checkout page needs both.
       * The intent answers "can this order still be paid?"; the attempt
       * answers "what happened to the try the customer just made?". A
       * declined card leaves the intent open on purpose — the payer may
       * present another one — but the page must still say *this attempt
       * failed* and offer a retry, rather than showing the customer an
       * unending "processing" spinner for a payment that is already over.
       *
       * `attempt_sequence` travels with it so a client can tell a fresh
       * attempt from a stale reading of the previous one.
       */
      attempt_status: attempt?.status ?? null,
      attempt_sequence: attempt?.sequence ?? null,
      /*
       * Whether a payment was actually SUBMITTED, as opposed to merely
       * prepared.
       *
       * The two are different events and only the server can tell them
       * apart. An embedded attempt exists — with a row, an intent and a
       * `processing` status — from the moment the provider's form is
       * handed to the browser, which is *before* the payer has typed
       * anything. A checkout page that reconciled on that would put
       * itself into "جارٍ التحقق" because someone opened a form and
       * switched tabs, which is exactly the bug this field closes.
       *
       * Published as a boolean rather than the underlying references: a
       * storefront needs to know whether to reconcile, not which
       * provider object it would be reconciling.
       */
      payment_attempt_started: attempt ? !attemptAwaitsSubmission(attempt) : false,
      /*
       * G1.1 — THE PAYABLE SURFACE, withheld once a successor has been
       * paid for.
       *
       * `next_action` is not a hint. For the embedded surface it carries
       * the payload the provider's form mounts from, so emitting it is
       * literally handing the browser a working way to charge the card.
       * Before this guard, reloading a superseded checkout's URL got one
       * from the server no matter what the page chose to render — the
       * server armed it and the UI was merely polite enough not to fire.
       *
       * Withheld here, on the server, for a checkout whose descendant
       * already secured funds. The client is not being trusted to
       * refuse: `superseded_by_token` above already tells it where to
       * go, and this makes that advice enforceable.
       */
      next_action:
        attempt &&
        attempt.next_action_kind !== 'none' &&
        !supersededByFundsSecured
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
   * The cart facts published on a status read.
   *
   * Two questions, both answered from the server's own rows:
   *
   *   - what STATE is the basket in (`active`, `converted`,
   *     `abandoned`, or `null` when this checkout has no cart);
   *   - has it MOVED since this checkout was priced?
   *
   * The second is the `quote_hash` seal doing its one job. The hash is
   * recomputed from the cart's current lines at their current prices
   * and compared with the one sealed at pricing time. It is a detector:
   * a mismatch means the tab should resync, and nothing here refuses,
   * cancels, or reprices anything.
   *
   * Both are cheap for the ordinary checkout: a checkout with no cart
   * does one nullable column read and stops.
   */
  private async readCartFacts(
    storeId: bigint,
    checkout: {
      id: bigint;
      mode: Mode;
      cart_id: bigint | null;
      currency: string;
      quote_total_minor: bigint;
      quote_hash: string | null;
      selected_offering_id: bigint | null;
    },
  ): Promise<{
    status: 'active' | 'converted' | 'abandoned' | null;
    stale: boolean;
  }> {
    const cartId = checkout.cart_id;
    if (cartId === null) return { status: null, stale: false };

    return this.prisma.withTenantTransaction(
      storeId,
      checkout.mode,
      async (tx) => {
        const cart = await tx.cart.findFirst({
          where: { id: cartId, store_id: storeId, mode: checkout.mode },
          select: { public_id: true, status: true, version: true },
        });

        if (!cart) return { status: null, stale: false };

        const status = cart.status as 'active' | 'converted' | 'abandoned';

        /*
         * A seal can only be compared against a live basket. Once the
         * cart is terminal its lines are history, and "the basket
         * moved" is not the question any more — `status` is.
         */
        if (status !== 'active' || checkout.quote_hash === null) {
          return { status, stale: false };
        }

        const items = await tx.cartItem.findMany({
          where: { cart_id: cartId },
          select: { variant_id: true, quantity: true },
        });

        const variants = await tx.productVariant.findMany({
          where: {
            id: { in: items.map((item) => item.variant_id) },
            product: { store_id: storeId },
          },
          select: { id: true, price: true },
        });

        const priceById = new Map(
          variants.map((variant) => [
            variant.id.toString(),
            parseDecimal(
              variant.price === null ? '0' : String(variant.price),
              checkout.currency,
            ).amountMinor,
          ]),
        );

        const lines = items.map((item) => ({
          variantId: item.variant_id,
          quantity: item.quantity,
          unitPriceMinor: priceById.get(item.variant_id.toString()) ?? 0n,
        }));

        /*
         * Recomputed with the cart's CURRENT version, because the
         * version is part of what was sealed: any mutation the cart
         * endpoints accepted bumped it, which is precisely the event
         * this is meant to notice.
         */
        const current = computeQuoteHash({
          cartPublicId: cart.public_id,
          cartVersion: cart.version,
          currency: checkout.currency,
          offeringId: checkout.selected_offering_id ?? 0n,
          totalMinor: checkout.quote_total_minor,
          lines,
        });

        return { status, stale: current !== checkout.quote_hash };
      },
    );
  }

  /**
   * Binds a browser-created (embedded) payment to this checkout.
   *
   * The embedded flow inverts who creates the provider object: the
   * provider's own form, running in the customer's browser, creates the
   * payment, and the id only becomes known here when the browser reports
   * it. That id arrives over an unauthenticated public endpoint, so it
   * is treated as a claim, never as evidence.
   *
   * Nothing about it is trusted. The reference is re-fetched from the
   * provider **with this store's own credentials** — so a payment
   * belonging to another merchant's account simply is not found — and
   * the resulting facts are checked against this intent before a single
   * one is allowed near the applier:
   *
   *   1. the payment must name this intent (`metadata.intent_id`, which
   *      the adapter surfaces as `internalIntentRef`);
   *   2. its currency must be the currency the order was priced in;
   *   3. a payment that secured funds must be for the order's full
   *      amount — paying 1 and claiming 500 is the whole attack this
   *      endpoint exists to stop.
   *
   * Only then does it go through the same `PaymentFactApplier` every
   * webhook goes through, on the same dedupe keys, so confirming twice —
   * or confirming while the webhook is landing — converges rather than
   * double-applying.
   */
  async confirmEmbeddedPayment(
    slug: string,
    token: string,
    paymentReference: string,
  ) {
    const store = await this.findStore(slug);

    const checkout = await this.prisma.guarded().checkout.findFirst({
      where: { store_id: store.id, token },
      select: { id: true, mode: true },
    });

    if (!checkout) throw new NotFoundException('Checkout not found.');

    const intent = await this.prisma.withTenantTransaction(
      store.id,
      checkout.mode,
      (tx) =>
        tx.paymentIntent.findFirst({
          where: {
            store_id: store.id,
            mode: checkout.mode,
            context_kind: 'checkout',
            context_id: checkout.id.toString(),
          },
          select: {
            id: true,
            account_id: true,
            amount_minor: true,
            currency: true,
          },
        }),
    );

    if (!intent?.account_id) {
      throw new NotFoundException('No payment to confirm for this checkout.');
    }

    /*
     * G1.3 — refuse BEFORE the provider is asked anything.
     *
     * This does not stop a charge on its own: the embedded form takes
     * the money in the browser, so by the time a confirmation arrives
     * the card may already have been charged, and that residue is what
     * G2 contains. What it does stop is this endpoint being the thing
     * that drives a frozen checkout to settlement, and it denies a
     * prober the ability to make a superseded checkout do work.
     *
     * Placed above the provider call deliberately — asking the gateway
     * about a payment we have already decided we may not act on gains
     * nothing and leaks a probe.
     */
    if (
      await this.isSupersededByFundsSecured(store.id, checkout.mode, checkout.id)
    ) {
      throw new ConflictException(
        'This checkout was replaced by one that has already been paid.',
      );
    }


    const account = await this.prisma.withTenantTransaction(
      store.id,
      checkout.mode,
      (tx) =>
        tx.paymentAccount.findFirst({
          where: {
            id: intent.account_id as bigint,
            store_id: store.id,
            mode: checkout.mode,
          },
          select: { id: true, gateway: true },
        }),
    );

    if (!account || !this.providers.has(account.gateway)) {
      throw new BadRequestException('This payment method is unavailable.');
    }

    const provider = this.providers.get(account.gateway);

    const credentials = await this.accounts.revealCredentialsForGateway(
      store.id,
      checkout.mode,
      account.id,
    );

    let facts: ObservedFact[];
    try {
      facts = await provider.fetchStatus({
        accountId: account.id,
        gatewayReference: paymentReference,
        credentials,
        mode: checkout.mode,
        referenceKind: 'client_sdk',
      });
    } catch (error) {
      // A reference the provider will not return under these credentials
      // is not ours. Reported as a rejected confirmation, not a server
      // fault, and deliberately without the provider's wording — which
      // would otherwise tell a prober what does and does not exist.
      this.logger.warn(
        `Embedded confirmation rejected for checkout ${checkout.id}: ` +
          `${(error as Error).message}`,
      );
      throw new BadRequestException('This payment could not be verified.');
    }

    for (const fact of facts) {
      this.assertFactBelongsToIntent(fact, intent);
    }

    if (facts.length > 0) {
      await this.applier.applyMany(facts, 'return_url');
    }

    return this.getCheckoutStatus(slug, token);
  }

  /**
   * The three checks that stand between a client-supplied payment id and
   * an order being marked paid.
   *
   * Deliberately a hard rejection rather than a silently ignored fact:
   * unlike a webhook, which may legitimately carry something unrelated,
   * every fact here was fetched for a reference the browser explicitly
   * offered as this checkout's payment. A mismatch is a claim that is
   * wrong, and the caller should be told so.
   */
  private assertFactBelongsToIntent(
    fact: ObservedFact,
    intent: { id: bigint; amount_minor: bigint; currency: string },
  ): void {
    if (
      fact.internalIntentRef !== undefined &&
      fact.internalIntentRef !== intent.id.toString()
    ) {
      throw new BadRequestException('This payment belongs to another order.');
    }

    if (
      fact.currency !== undefined &&
      fact.currency.toUpperCase() !== intent.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        'This payment was made in a different currency.',
      );
    }

    const securesFunds =
      fact.factType === 'attempt_authorized' ||
      fact.factType === 'attempt_captured';

    if (
      securesFunds &&
      fact.cumulativeAmountMinor !== undefined &&
      fact.cumulativeAmountMinor !== intent.amount_minor
    ) {
      throw new BadRequestException(
        'This payment is not for the order total.',
      );
    }
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

    const intent = await this.prisma.withTenantTransaction(
      store.id,
      checkout.mode,
      (tx) =>
        tx.paymentIntent.findFirst({
          where: {
            store_id: store.id,
            mode: checkout.mode,
            context_kind: 'checkout',
            context_id: checkout.id.toString(),
          },
          select: { id: true, account_id: true },
        }),
    );

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
      const account = await this.prisma.withTenantTransaction(
        storeId,
        mode,
        (tx) =>
          tx.paymentAccount.findFirst({
            where: { id: accountId, store_id: storeId, mode },
            select: { id: true, gateway: true },
          }),
      );

      if (!account || !this.providers.has(account.gateway)) return;

      const provider = this.providers.get(account.gateway);
      if (!provider.capabilities.statusPolling) return;

      const attempt = await this.prisma.withTenantTransaction(
        storeId,
        mode,
        (tx) =>
          tx.paymentAttempt.findFirst({
            where: { intent_id: intentId, store_id: storeId, mode },
            orderBy: { sequence: 'desc' },
            select: { gateway_reference: true, next_action_kind: true },
          }),
      );

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
        // Which resource this reference names is the adapter's business,
        // but only core knows how the attempt was created. An embedded
        // attempt holds a payment id; a redirect one holds whatever the
        // adapter created up front.
        referenceKind: attempt.next_action_kind,
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
    /** Methods enabled on this account; narrowed to the form's below. */
    accountMethods: readonly PaymentMethodKey[];
    intentId: bigint;
    amountMinor: bigint;
    currency: string;
    captureMethod: CaptureMode;
    /** Payer contact details, already reduced to what the checkout has. */
    metadata?: Readonly<Record<string, string>>;
    /** Storefront return URL, when this checkout carries one. */
    returnUrl?: string;
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
    //
    // This can throw DecryptionError (stale/rotated KEK version, a
    // corrupted or tampered envelope, an unsupported envelope version) —
    // a misconfiguration exactly like a missing secret key, not a server
    // fault. Left unguarded, it used to escape as an unhandled exception
    // and turn a bad credential into a raw 500 for the shopper.
    let credentials: Readonly<Record<string, string>>;

    try {
      credentials = await this.accounts.revealCredentialsForGateway(
        input.storeId,
        input.mode,
        input.accountId,
      );
    } catch (error) {
      if (error instanceof DecryptionError) {
        this.logger.error(
          `Could not decrypt credentials for account ${input.accountId} ` +
            `(${error.reason}): ${error.message}`,
        );
        throw new BadRequestException(
          'This payment method is not configured. Please choose another.',
        );
      }
      throw error;
    }

    // Read off the adapter that is about to be called, rather than from
    // a second registry lookup: the two could not disagree, but only one
    // of them is the object handling this payment.
    //
    // The configured key NAMES go with it: a form can host a method
    // only for an account that configured that method's extras (Moyasar
    // Apple Pay), and the grouping the storefront advertised was decided
    // on exactly the same names. Names only — no value is read here.
    const formMethods = enabledFormMethods(
      provider.capabilities,
      input.method,
      input.accountMethods,
      Object.entries(credentials)
        .filter(([, value]) => (value ?? '').trim() !== '')
        .map(([key]) => key),
    );

    try {
      return await provider.initializePayment({
        storeId: input.storeId,
        mode: input.mode,
        accountId: input.accountId,
        offeringId: input.offeringId,
        method: input.method,
        gatewayMethodConfig: input.gatewayMethodConfig,
        // The methods the provider form behind this offering hosts, cut
        // down to the ones this merchant actually enabled. Omitted
        // entirely for an adapter that declares no forms, which is how
        // the adapter knows the caller is not grouping anything and must
        // behave exactly as it did before this field existed.
        ...(formMethods ? { formMethods } : {}),
        intentId: input.intentId,
        attemptId: null,
        attemptSequence: 1,
        amountMinor: input.amountMinor,
        currency: input.currency,
        credentials,
        // The same key recorded on the attempt below. Passing it rather
        // than letting the adapter derive its own is what makes "what we
        // stored" and "what the provider saw" the same string by
        // construction.
        idempotencyKey: outboundIdempotencyKey(provider, {
          operation: 'initialize',
          base: pspIdempotencyKey({
            storeId: input.storeId,
            intentId: input.intentId,
            attemptSequence: 1,
            operation: 'initialize',
          }),
        }),
        captureMethod: input.captureMethod,
        // Both are already part of PaymentCallContext; nothing about the
        // provider contract changes. Omitted entirely when empty, so an
        // adapter cannot tell the difference between "no metadata" and
        // "metadata this checkout could not fill in".
        ...(input.metadata && Object.keys(input.metadata).length > 0
          ? { metadata: input.metadata }
          : {}),
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
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
    // Resolving a storefront tenant by public slug is intentionally
    // cross-tenant: there is no store_id available yet.
    const store = await this.prisma
      .guarded()
      .store.findFirst({ where: { slug } });

    if (!store) throw new NotFoundException('Store not found.');

    // Once the tenant is resolved, every following guarded query is
    // restricted to this store.
    this.tenantContext.setStoreId(store.id.toString());

    return store;
  }

  /**
   * Loads variants and recomputes prices from the database.
   * Client-supplied prices are never trusted.
   */
  private async resolveLines(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    currency: string,
    /**
     * The lines to price — the SERVER's cart when there is one, and the
     * request body only on the stateless path. Taken as a parameter
     * rather than read off the DTO so that the one place which decides
     * whose list wins is `commit()`, in the open, and not buried here.
     */
    items: readonly { variant_id: string; quantity: number }[],
  ): Promise<ResolvedLine[]> {
    const ids = items.map((i) => BigInt(i.variant_id));

    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids }, product: { store_id: storeId } },
      include: { product: true },
    });

    const byId = new Map(variants.map((v: any) => [v.id.toString(), v]));
    const lines: ResolvedLine[] = [];

    for (const item of items) {
      const variant: any = byId.get(item.variant_id);

      if (!variant) {
        throw new BadRequestException(
          `Product variant ${item.variant_id} is unavailable.`,
        );
      }

      const priceRaw = variant.price === null ? '0' : String(variant.price);
      const unitPrice = parseDecimal(priceRaw, currency);

      /*
       * NO STOCK GATE HERE ANY MORE.
       *
       * This used to compare `item.quantity` against a raw, unlocked
       * `inventory_qty` that ignored every live reservation — the
       * Round 8 netting bug — and it decided nothing, because the hold
       * was written in a different transaction after the provider call.
       * Availability is now decided by `assertAvailable()` in the
       * caller: under a row lock, netted against live holds, in the
       * same transaction that writes the reservation.
       *
       * Leaving a second gate of a different shape here would be two
       * answers to one question. This function prices; it no longer
       * judges. The flags travel on the line so the claim can read
       * them.
       */

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
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    currency: string,
  ): Promise<bigint> {
    const existing = await tx.beneficiary.findFirst({
      where: { store_id: storeId, mode, kind: 'store', external_ref: null },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await tx.beneficiary.create({
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
}

import { PrismaClient } from '@prisma/client'
import type {
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client'
import { BadRequestException } from '@nestjs/common'
import { CheckoutService } from './checkout.service'
import { CheckoutExpiryJob } from './checkout-expiry.job'
import { LedgerService } from '../../ledger/ledger.service'
import { OutboxService } from '../../common/messaging/outbox.service'
import { PaymentFactApplier } from '../payments/facts/payment-fact.applier'
import { CheckoutFinalizerService } from '../payments/facts/checkout-finalizer.service'
import {
  buildFactDedupeKey,
  type InitializeResult,
  type ObservedFact,
} from '../payments/gateways/provider.types'
import {
  ALL_TEST_TABLES,
  createAdditionalClient,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness'

/**
 * Integration coverage for the funds_secured flow.
 *
 * The invariant under test is the one the whole design rests on:
 * an order exists only when the money is secured. Everything here is a
 * way that could be false — a declined card, a redelivered capture, an
 * abandoned redirect — and each one is a failure that stays invisible
 * until a merchant notices phantom orders or missing stock.
 */

const SLUG = 'spec-store'
const STRIPE_REF = 'pi_spec_1'

interface Fixture {
  storeId: bigint
  variantId: bigint
  codOfferingId: bigint
  bankOfferingId: bigint
  gatewayOfferingId: bigint
  gatewayAccountId: bigint
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
  }

  const offline = {
    ...provider,
    capabilities: { ...provider.capabilities, gateway: 'cod', methods: ['cod'] },
    initializePayment: async () => ({
      kind: 'no_gateway' as const,
      commitmentKind: 'promise_accepted' as const,
    }),
  }

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
  }

  const byKey: Record<string, unknown> = { stripe: provider, cod: offline, bank_transfer: bank }

  return {
    has: (gateway: string) => gateway in byKey,
    get: (gateway: string) => byKey[gateway],
    assertCanHandle: ({ gateway }: { gateway: string }) => byKey[gateway],
  } as never
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({
    secret_key: 'sk_test',
    bank_name: 'Test Bank',
    account_holder: 'Spec',
  }),
} as never

const fakeIdempotency = {
  defaultTtlSeconds: 3600,
  defaultLeaseSeconds: 60,
  claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
  complete: async () => undefined,
  fail: async () => undefined,
} as never

function body(fx: Fixture, offeringId: bigint, quantity = 2) {
  return {
    items: [{ variant_id: fx.variantId.toString(), quantity }],
    customer_name: 'Test Buyer',
    customer_phone: '01000000000',
    address_line: '1 Test Street',
    city: 'Cairo',
    payment_offering_id: offeringId.toString(),
  }
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
  }
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
  }
}

describe('funds_secured checkout (integration)', () => {
  let prisma: PrismaClient
  let ledger: LedgerService
  let applier: PaymentFactApplier
  let fx: Fixture

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
    )

  let intentCounter = 9000n
  const nextIntentId = () => ++intentCounter

  beforeAll(async () => {
    prisma = await startTestDatabase()
    ledger = new LedgerService(prisma as never)
    applier = new PaymentFactApplier(
      prisma as never,
      ledger,
      new OutboxService(),
      new CheckoutFinalizerService(prisma as never, new OutboxService()),
    )
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    fx = await seed(prisma)
  })

  describe('before the money is secured', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    }

    it('creates no order', async () => {
      const result = await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )

      expect(result.order).toBeNull()
      expect(await prisma.order.count()).toBe(0)
    })

    it('returns the action the customer must complete', async () => {
      const result = await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )

      expect(result.next_action).toMatchObject({ kind: 'client_sdk' })
      expect(result.checkout_token).toHaveLength(32)
    })

    it('holds stock rather than taking it', async () => {
      await buildCheckout(pending).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId))

      const reservation = await prisma.inventoryReservation.findFirstOrThrow({})
      expect(reservation.state).toBe('held')

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      })
      expect(variant.inventory_qty).toBe(10)
    })

    it('posts nothing to the ledger', async () => {
      await buildCheckout(pending).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId))
      expect(await prisma.journalEntry.count()).toBe(0)
    })

    it('leaves the checkout pending', async () => {
      await buildCheckout(pending).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId))
      const checkout = await prisma.checkout.findFirstOrThrow({})
      expect(checkout.status).toBe('pending_payment')
      expect(checkout.order_id).toBeNull()
    })
  })

  describe('when the money is secured', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    }

    beforeEach(async () => {
      await buildCheckout(pending).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId))
    })

    it('creates the order', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook')

      const order = await prisma.order.findFirstOrThrow({})
      expect(order.order_number).toBe('1001')
      expect(order.payment_status).toBe('PAID')
      expect(order.paid_at).not.toBeNull()
      // Prisma Decimal renders without trailing zeros; compare numerically.
      expect(Number(order.total)).toBe(50)
    })

    it('takes the held stock', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook')

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      })
      expect(variant.inventory_qty).toBe(8)

      const reservation = await prisma.inventoryReservation.findFirstOrThrow({})
      expect(reservation.state).toBe('converted')
    })

    it('posts a balanced gateway receivable', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook')

      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(5000n)

      expect(await ledger.findUnbalancedEntries()).toEqual([])
    })

    it('links the checkout to the order', async () => {
      await applier.apply(captureFact(fx, 5000n), 'webhook')

      const checkout = await prisma.checkout.findFirstOrThrow({})
      const order = await prisma.order.findFirstOrThrow({})
      expect(checkout.status).toBe('committed')
      expect(checkout.order_id).toBe(order.id)
      expect(order.checkout_id).toBe(checkout.id)
    })

    it('does not create a second order when the capture is redelivered', async () => {
      const fact = captureFact(fx, 5000n)

      await applier.apply(fact, 'webhook')
      const second = await applier.apply(fact, 'reconciliation')

      expect(second.outcome).toBe('duplicate')
      expect(await prisma.order.count()).toBe(1)
      expect(await prisma.capture.count()).toBe(1)
    })

    it('does not double-decrement stock on redelivery', async () => {
      const fact = captureFact(fx, 5000n)

      await applier.apply(fact, 'webhook')
      await applier.apply(fact, 'return_url')

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      })
      expect(variant.inventory_qty).toBe(8)
    })

    it('creates exactly one order under two parallel deliveries', async () => {
      const other = createAdditionalClient()

      try {
        const otherApplier = new PaymentFactApplier(
          other as never,
          new LedgerService(other as never),
          new OutboxService(),
          new CheckoutFinalizerService(other as never, new OutboxService()),
        )

        await Promise.allSettled([
          applier.apply(captureFact(fx, 5000n), 'webhook'),
          otherApplier.apply(captureFact(fx, 5000n), 'reconciliation'),
        ])

        expect(await prisma.order.count()).toBe(1)
        expect(await prisma.capture.count()).toBe(1)
        expect(await ledger.findUnbalancedEntries()).toEqual([])
      } finally {
        await other.$disconnect()
      }
    })
  })

  describe('when the payment fails', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    }

    beforeEach(async () => {
      await buildCheckout(pending).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId))
    })

    it('creates no order', async () => {
      await applier.apply(failFact(fx), 'webhook')
      expect(await prisma.order.count()).toBe(0)
    })

    it('releases the held stock', async () => {
      await applier.apply(failFact(fx), 'webhook')

      const reservation = await prisma.inventoryReservation.findFirstOrThrow({})
      expect(reservation.state).toBe('released')

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      })
      expect(variant.inventory_qty).toBe(10)
    })

    it('marks the checkout failed and posts nothing', async () => {
      await applier.apply(failFact(fx), 'webhook')

      const checkout = await prisma.checkout.findFirstOrThrow({})
      expect(checkout.status).toBe('failed')
      expect(await prisma.journalEntry.count()).toBe(0)
    })

    it('ignores a capture arriving after the failure', async () => {
      await applier.apply(failFact(fx), 'webhook')
      const late = await applier.apply(captureFact(fx, 5000n), 'webhook')

      expect(late.outcome).toBe('ignored')
      expect(await prisma.order.count()).toBe(0)
    })
  })

  describe('offline commitment is unaffected', () => {
    const offline: InitializeResult = {
      kind: 'no_gateway',
      commitmentKind: 'promise_accepted',
    }

    it('creates a cash-on-delivery order immediately', async () => {
      const result = await buildCheckout(offline).createAndCommit(
        SLUG,
        body(fx, fx.codOfferingId),
      )

      expect(result.order).not.toBeNull()
      expect(result.order?.status).toBe('PENDING')
      expect(await prisma.journalEntry.count()).toBe(1)

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      })
      expect(variant.inventory_qty).toBe(8)
    })

    it('marks a bank transfer order as awaiting payment', async () => {
      const result = await buildCheckout(offline).createAndCommit(
        SLUG,
        body(fx, fx.bankOfferingId),
      )

      expect(result.order?.status).toBe('AWAITING_PAYMENT')
      expect(result.order?.payment_status).toBe('UNPAID')
    })
  })

  describe('concurrent finalization', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    }

    /** A second checkout, so two captures can finalise at once. */
    const SECOND_REF = 'pi_spec_2'

    it('gives two simultaneous orders distinct numbers', async () => {
      // Two independent checkouts, each awaiting its own capture.
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )

      await buildCheckout({
        kind: 'requires_action',
        nextAction: { kind: 'client_sdk', clientSecret: 'cs_2' },
        refs: { gatewayReference: SECOND_REF },
      }).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId, 1))

      const second = createAdditionalClient()

      try {
        const otherApplier = new PaymentFactApplier(
          second as never,
          new LedgerService(second as never),
          new OutboxService(),
          new CheckoutFinalizerService(second as never, new OutboxService()),
        )

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
        }

        await Promise.all([
          applier.apply(captureFact(fx, 5000n), 'webhook'),
          otherApplier.apply(secondFact, 'reconciliation'),
        ])

        const orders = await prisma.order.findMany({
          orderBy: { id: 'asc' },
          select: { order_number: true },
        })

        // count(*) + 1001 gave both the same number, and the unique
        // constraint then rejected one outright — a paid customer with
        // no order.
        expect(orders).toHaveLength(2)
        expect(new Set(orders.map((o) => o.order_number)).size).toBe(2)
      } finally {
        await second.$disconnect()
      }
    })

    it('continues numbering from the highest existing order', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )
      await applier.apply(captureFact(fx, 5000n), 'webhook')

      const first = await prisma.order.findFirstOrThrow({})
      expect(first.order_number).toBe('1001')

      await buildCheckout({
        kind: 'requires_action',
        nextAction: { kind: 'client_sdk', clientSecret: 'cs_2' },
        refs: { gatewayReference: SECOND_REF },
      }).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId, 1))

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
      )

      const numbers = await prisma.order.findMany({
        orderBy: { id: 'asc' },
        select: { order_number: true },
      })
      expect(numbers.map((o) => o.order_number)).toEqual(['1001', '1002'])
    })
  })

  describe('the gateway reference reaches the attempt', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF, gatewayPaymentId: STRIPE_REF },
    }

    // This is the whole point of removing linkAttempt(): the reference
    // has to be written by commit(), because that is what lets a webhook
    // or a reconciliation sweep find the attempt later. A test that set
    // it by hand proved nothing.
    it('persists what the provider returned', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )

      const attempt = await prisma.paymentAttempt.findFirstOrThrow({})
      expect(attempt.gateway_reference).toBe(STRIPE_REF)
      expect(attempt.gateway_payment_id).toBe(STRIPE_REF)
    })

    it('leaves it null for a method with no provider', async () => {
      await buildCheckout({
        kind: 'no_gateway',
        commitmentKind: 'promise_accepted',
      }).createAndCommit(SLUG, body(fx, fx.codOfferingId))

      const attempt = await prisma.paymentAttempt.findFirstOrThrow({})
      expect(attempt.gateway_reference).toBeNull()
    })

    it('lets a fact match without any test fixture', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )

      const result = await applier.apply(captureFact(fx, 5000n), 'webhook')
      expect(result.outcome).toBe('applied')
    })
  })

  describe('abandoned checkouts release their stock', () => {
    const pending: InitializeResult = {
      kind: 'requires_action',
      nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
      refs: { gatewayReference: STRIPE_REF },
    }

    let expiry: CheckoutExpiryJob

    beforeEach(() => {
      expiry = new CheckoutExpiryJob(prisma as never)
    })

    /** Moves the checkout's expiry into the past. */
    async function expireIt(): Promise<void> {
      await prisma.checkout.updateMany({
        data: { expires_at: new Date(Date.now() - 60_000) },
      })
    }

    it('releases held stock once the checkout expires', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )
      await expireIt()

      expect(await expiry.releaseExpired()).toBe(1)

      const reservation = await prisma.inventoryReservation.findFirstOrThrow({})
      expect(reservation.state).toBe('expired')

      const checkout = await prisma.checkout.findFirstOrThrow({})
      expect(checkout.status).toBe('expired')
    })

    it('leaves inventory available again', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )
      await expireIt()
      await expiry.releaseExpired()

      // Stock was only held, never decremented, so the count is intact
      // and the reservation no longer claims any of it.
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { id: fx.variantId },
      })
      expect(variant.inventory_qty).toBe(10)

      expect(
        await prisma.inventoryReservation.count({ where: { state: 'held' } }),
      ).toBe(0)
    })

    it('terminates the abandoned payment intent', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )
      await expireIt()
      await expiry.releaseExpired()

      const intent = await prisma.paymentIntent.findFirstOrThrow({})
      expect(intent.status).toBe('expired')
      expect(intent.terminal_at).not.toBeNull()
    })

    it('does not touch a checkout that has not expired', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )

      expect(await expiry.releaseExpired()).toBe(0)

      const reservation = await prisma.inventoryReservation.findFirstOrThrow({})
      expect(reservation.state).toBe('held')
    })

    it('does not release a checkout that already produced an order', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )
      await applier.apply(captureFact(fx, 5000n), 'webhook')
      await expireIt()

      // The money is secured and the order exists; expiry must not claw
      // the stock back out from under it.
      expect(await expiry.releaseExpired()).toBe(0)

      const reservation = await prisma.inventoryReservation.findFirstOrThrow({})
      expect(reservation.state).toBe('converted')
      expect(await prisma.order.count()).toBe(1)
    })

    it('is safe to run twice', async () => {
      await buildCheckout(pending).createAndCommit(
        SLUG,
        body(fx, fx.gatewayOfferingId),
      )
      await expireIt()

      expect(await expiry.releaseExpired()).toBe(1)
      expect(await expiry.releaseExpired()).toBe(0)
    })

    it('leaves offline checkouts alone', async () => {
      await buildCheckout({
        kind: 'no_gateway',
        commitmentKind: 'promise_accepted',
      }).createAndCommit(SLUG, body(fx, fx.codOfferingId))
      await expireIt()

      // Cash on delivery converts its reservation at commitment, so
      // there is nothing held and the order already exists.
      expect(await expiry.releaseExpired()).toBe(0)
      expect(await prisma.order.count()).toBe(1)
    })
  })

  describe('rejection before anything is written', () => {
    it('refuses a declined initialisation and leaves no checkout', async () => {
      const declined: InitializeResult = {
        kind: 'failed',
        errorCode: 'declined_insufficient_funds',
      }

      await expect(
        buildCheckout(declined).createAndCommit(SLUG, body(fx, fx.gatewayOfferingId)),
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(await prisma.checkout.count()).toBe(0)
      expect(await prisma.order.count()).toBe(0)
    })
  })
})

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
  })

  const store = await prisma.store.create({
    data: {
      name: 'Spec',
      slug: SLUG,
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  })

  const product = await prisma.product.create({
    data: {
      store_id: store.id,
      title: 'Spec Product',
      handle: 'spec-product',
      status: 'ACTIVE',
    },
    select: { id: true },
  })

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
  })

  const account = async (gateway: PaymentProviderKey) =>
    prisma.paymentAccount.create({
      data: {
        store_id: store.id,
        mode: 'live',
        gateway,
        display_name: 'Default',
        status: 'active',
        settlement_currency: 'USD',
      },
      select: { id: true },
    })

  const offering = async (
    accountId: bigint,
    method: PaymentMethodKey,
    commitmentKind: CommitmentKind,
    position: number,
  ) =>
    prisma.paymentMethodOffering.create({
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
    })

  const codAccount = await account('cod')
  const bankAccount = await account('bank_transfer')
  const gatewayAccount = await account('stripe')

  const cod = await offering(codAccount.id, 'cod', 'promise_accepted', 0)
  const bank = await offering(
    bankAccount.id,
    'bank_transfer',
    'awaiting_offline_settlement',
    1,
  )
  const gateway = await offering(gatewayAccount.id, 'card', 'funds_secured', 2)

  return {
    storeId: store.id,
    variantId: variant.id,
    codOfferingId: cod.id,
    bankOfferingId: bank.id,
    gatewayOfferingId: gateway.id,
    gatewayAccountId: gatewayAccount.id,
  }
}
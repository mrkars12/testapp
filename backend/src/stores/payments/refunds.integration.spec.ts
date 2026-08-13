import { PrismaClient } from '@prisma/client'
import type {
  CommitmentKind,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { RefundService } from './refund.service'
import { PaymentFactApplier } from './facts/payment-fact.applier'
import { CheckoutFinalizerService } from './facts/checkout-finalizer.service'
import { CheckoutService } from '../checkout/checkout.service'
import { LedgerService } from '../../ledger/ledger.service'
import { OutboxService } from '../../common/messaging/outbox.service'
import {
  buildFactDedupeKey,
  type InitializeResult,
  type ObservedFact,
} from './gateways/provider.types'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness'

/**
 * Integration coverage for MERCHANT_GATEWAY refunds.
 *
 * The invariant under test is that a refund and its ledger effect are
 * inseparable, and that the same refund reported twice — once by the
 * merchant's own request, once by the provider's webhook — produces one
 * effect, not two. Double-refunding is the failure that costs real money
 * and is invisible until the books are reconciled.
 */

const SLUG = 'spec-store'
const REF = 'pi_refund_spec'

interface Fixture {
  storeId: bigint
  variantId: bigint
  gatewayOfferingId: bigint
  gatewayAccountId: bigint
}

/** Refund amounts the stubbed provider will report back, in order. */
let refundQueue: bigint[] = []

const gatewayResult: InitializeResult = {
  kind: 'requires_action',
  nextAction: { kind: 'client_sdk', clientSecret: 'cs_1' },
  refs: { gatewayReference: REF, gatewayPaymentId: REF },
}

function fakeRegistry(fx: () => Fixture) {
  const adapter = {
    capabilities: {
      gateway: 'stripe',
      methods: ['card'],
      currencies: 'all' as const,
      exponentOverrides: {},
      manualCapture: false,
      partialCapture: false,
      multiCapture: false,
      partialRefund: true,
      voidSupported: false,
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
    /** Reports the cumulative refunded total, exactly as Stripe does. */
    refund: async (): Promise<ObservedFact[]> => {
      const cumulative = refundQueue.shift() ?? 0n
      return [refundFact(fx(), cumulative)]
    },
  }

  return {
    has: (gateway: string) => gateway === 'stripe',
    get: () => adapter,
    assertCanHandle: () => adapter,
  } as never
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
  }
}

function captureFact(fx: Fixture, amountMinor: bigint): ObservedFact {
  return {
    dedupeKey: buildFactDedupeKey({
      accountId: fx.gatewayAccountId,
      gatewayReference: REF,
      factType: 'attempt_captured',
      cumulativeAmountMinor: amountMinor,
      currency: 'USD',
    }),
    accountId: fx.gatewayAccountId,
    gatewayReference: REF,
    factType: 'attempt_captured',
    cumulativeAmountMinor: amountMinor,
    currency: 'USD',
  }
}

const fakeAccounts = {
  revealCredentialsForGateway: async () => ({ secret_key: 'sk_test' }),
} as never

const fakeIdempotency = {
  defaultTtlSeconds: 3600,
  defaultLeaseSeconds: 60,
  claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
  complete: async () => undefined,
  fail: async () => undefined,
} as never

describe('Refunds — MERCHANT_GATEWAY (integration)', () => {
  let prisma: PrismaClient
  let ledger: LedgerService
  let applier: PaymentFactApplier
  let refunds: RefundService
  let fx: Fixture
  let orderId: string

  let intentCounter = 40_000n

  beforeAll(async () => {
    prisma = await startTestDatabase()
    ledger = new LedgerService(prisma as never)
    applier = new PaymentFactApplier(
      prisma as never,
      ledger,
      new OutboxService(),
      new CheckoutFinalizerService(prisma as never, new OutboxService()),
    )
    refunds = new RefundService(
      prisma as never,
      fakeRegistry(() => fx),
      fakeAccounts,
      applier,
    )
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    refundQueue = []
    fx = await seed(prisma)

    const checkout = new CheckoutService(
      prisma as never,
      ledger,
      new OutboxService(),
      fakeAccounts,
      fakeIdempotency,
      fakeRegistry(() => fx),
      { reserve: async () => ++intentCounter } as never,
      applier,
    )

    // A completed card payment: 2 x 25.00, captured in full.
    await checkout.createAndCommit(SLUG, {
      items: [{ variant_id: fx.variantId.toString(), quantity: 2 }],
      customer_name: 'Test Buyer',
      customer_phone: '01000000000',
      address_line: '1 Test Street',
      city: 'Cairo',
      payment_offering_id: fx.gatewayOfferingId.toString(),
    })

    await applier.apply(captureFact(fx, 5000n), 'webhook')

    const order = await prisma.order.findFirstOrThrow({})
    orderId = order.id.toString()
  })

  describe('merchant-initiated', () => {
    it('refunds in full and marks the order refunded', async () => {
      refundQueue = [5000n]

      const result = await refunds.refundOrder(fx.storeId, orderId)

      expect(result.applied).toBe(true)
      expect(result.refunded_total_minor).toBe('5000')
      expect(result.payment_status).toBe('refunded')

      const order = await prisma.order.findFirstOrThrow({})
      expect(order.payment_status).toBe('REFUNDED')
    })

    it('records the refund with a proportional allocation', async () => {
      refundQueue = [5000n]
      await refunds.refundOrder(fx.storeId, orderId)

      const refund = await prisma.refund.findFirstOrThrow({})
      expect(refund.amount_minor).toBe(5000n)
      expect(refund.status).toBe('succeeded')
      expect(refund.initiated_by).toBe('merchant')

      const allocations = await prisma.refundAllocation.findMany({})
      expect(allocations).toHaveLength(1)
      // Allocations must sum exactly to the refund.
      expect(allocations[0].amount_minor).toBe(5000n)
    })

    it('nets the gateway receivable back to zero', async () => {
      refundQueue = [5000n]
      await refunds.refundOrder(fx.storeId, orderId)

      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(0n)

      // The sale itself stays on the books; the refund sits beside it.
      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'refunds_contra',
          beneficiaryId: (await storeBeneficiary(prisma, fx)).id,
        }),
      ).toBe(5000n)

      expect(await ledger.findUnbalancedEntries()).toEqual([])
    })

    it('supports a partial refund', async () => {
      refundQueue = [2000n]

      const result = await refunds.refundOrder(fx.storeId, orderId, {
        amountMinor: 2000n,
      })

      expect(result.payment_status).toBe('partially_refunded')

      const order = await prisma.order.findFirstOrThrow({})
      expect(order.payment_status).toBe('PARTIALLY_REFUNDED')

      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(3000n)
    })

    it('completes the refund across two partials', async () => {
      refundQueue = [2000n, 5000n]

      await refunds.refundOrder(fx.storeId, orderId, { amountMinor: 2000n })
      await refunds.refundOrder(fx.storeId, orderId, { amountMinor: 3000n })

      const order = await prisma.order.findFirstOrThrow({})
      expect(order.payment_status).toBe('REFUNDED')

      expect(await prisma.refund.count()).toBe(2)
      expect(await ledger.findUnbalancedEntries()).toEqual([])
    })

    it('refuses to refund more than remains', async () => {
      await expect(
        refunds.refundOrder(fx.storeId, orderId, { amountMinor: 9000n }),
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(await prisma.refund.count()).toBe(0)
    })

    it('refuses a second refund once fully refunded', async () => {
      refundQueue = [5000n]
      await refunds.refundOrder(fx.storeId, orderId)

      await expect(
        refunds.refundOrder(fx.storeId, orderId, { amountMinor: 100n }),
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('refuses an order from another store', async () => {
      await expect(
        refunds.refundOrder(999n, orderId),
      ).rejects.toBeInstanceOf(Error)
    })
  })

  describe('provider-initiated', () => {
    it('applies a refund reported only by webhook', async () => {
      // A refund issued in the provider dashboard. Before this milestone
      // the fact was recorded and discarded, leaving the ledger wrong.
      const result = await applier.apply(refundFact(fx, 5000n), 'webhook')

      expect(result.outcome).toBe('applied')
      expect(await prisma.refund.count()).toBe(1)

      const refund = await prisma.refund.findFirstOrThrow({})
      expect(refund.initiated_by).toBe('provider')

      const order = await prisma.order.findFirstOrThrow({})
      expect(order.payment_status).toBe('REFUNDED')
    })
  })

  describe('a refund reported twice produces one effect', () => {
    it('collapses the merchant request and its webhook confirmation', async () => {
      refundQueue = [5000n]
      await refunds.refundOrder(fx.storeId, orderId)

      // The provider now delivers the same refund by webhook. Identical
      // content means an identical dedupe key.
      const echo = await applier.apply(refundFact(fx, 5000n), 'webhook')

      expect(echo.outcome).toBe('duplicate')
      expect(await prisma.refund.count()).toBe(1)

      // The money moved once.
      expect(
        await ledger.balance({
          storeId: fx.storeId,
          mode: 'live',
          currency: 'USD',
          accountType: 'psp_receivable',
          paymentAccountId: fx.gatewayAccountId,
        }),
      ).toBe(0n)
      expect(await ledger.findUnbalancedEntries()).toEqual([])
    })

    it('ignores a redelivered partial refund', async () => {
      refundQueue = [2000n]
      await refunds.refundOrder(fx.storeId, orderId, { amountMinor: 2000n })

      const echo = await applier.apply(refundFact(fx, 2000n), 'reconciliation')

      expect(echo.outcome).toBe('duplicate')
      expect(await prisma.refund.count()).toBe(1)
    })
  })

  describe('guards', () => {
    it('refuses a refund on a payment mode with no ledger rule', async () => {
      await prisma.paymentIntent.updateMany({
        data: { payment_mode: 'MERCHANT_MOR' },
      })

      await expect(
        refunds.refundOrder(fx.storeId, orderId),
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(await prisma.refund.count()).toBe(0)
    })

    it('refuses to refund more than was captured, even from the provider', async () => {
      const result = await applier.apply(refundFact(fx, 9000n), 'webhook')

      expect(result.outcome).toBe('ignored')
      expect(result.reason).toBe('refund_exceeds_capture')
      expect(await prisma.refund.count()).toBe(0)
    })
  })
})

/* ------------------------------------------------------------------ */

async function storeBeneficiary(prisma: PrismaClient, fx: Fixture) {
  return prisma.beneficiary.findFirstOrThrow({
    where: { store_id: fx.storeId, mode: 'live', kind: 'store' },
  })
}

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_refund',
      email: 'spec_refund@example.test',
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
      payment_mode: 'MERCHANT_GATEWAY',
    },
    select: { id: true },
  })

  const product = await prisma.product.create({
    data: {
      store_id: store.id,
      title: 'Spec Product',
      handle: 'spec-refund',
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

  const account = await prisma.paymentAccount.create({
    data: {
      store_id: store.id,
      mode: 'live',
      gateway: 'stripe' as PaymentProviderKey,
      display_name: 'Default',
      status: 'active',
      settlement_currency: 'USD',
    },
    select: { id: true },
  })

  const offering = await prisma.paymentMethodOffering.create({
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
  })

  return {
    storeId: store.id,
    variantId: variant.id,
    gatewayOfferingId: offering.id,
    gatewayAccountId: account.id,
  }
}
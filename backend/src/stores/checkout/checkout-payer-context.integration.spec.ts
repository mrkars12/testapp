import { appConfigStub } from '../../../test/config.stub'
import { PrismaClient } from '@prisma/client'
import { BadRequestException } from '@nestjs/common'
import { TenantContextService } from '../../common/tenant/tenant-context.service'
import { CheckoutService } from './checkout.service'
import { LedgerService } from '../../ledger/ledger.service'
import { OutboxService } from '../../common/messaging/outbox.service'
import { TapAdapter } from '../payments/gateways/adapters/tap/tap.adapter'
import { CREATE_CHARGE_RESPONSE } from '../payments/gateways/adapters/tap/tap-fixtures'
import type {
  TapHttp,
  TapRequest,
} from '../payments/gateways/adapters/tap/tap-client'
import type { IPaymentProvider } from '../payments/gateways/payment-provider.interface'
import type { PaymentCallContext } from '../payments/gateways/provider.types'
import { CheckoutSuccessionFundsService } from '../payments/facts/checkout-succession-funds.service'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness'

/**
 * The payer, from the checkout form to the provider's request body.
 *
 * This is the regression test for the core blocker recorded in
 * `tap/STAGE_TAP_ADAPTER_IMPLEMENTATION_REPORT.md`: Tap's Create a Charge
 * requires `customer.first_name` and `customer.email`, and until now
 * nothing in core put the payer into the call context, so a live Tap
 * checkout could only ever fail.
 *
 * It asserts the whole chain rather than either half of it, because the
 * two ends are what actually have to agree:
 *
 *   CreateCheckoutDto → payerMetadata() → PaymentCallContext.metadata
 *                     → TapAdapter → POST /v2/charges body
 *
 * Offline: the Tap transport is a recording stub, and the assertions read
 * what would have gone on the wire.
 */

const SLUG = 'spec-payer'

/** Everything the account holds. `sk_test_` matches the seeded test mode. */
const TAP_CREDENTIALS = {
  secret_key: 'sk_live_payer_spec',
  merchant_id: '599424',
  redirect_url: 'https://merchant.example/configured-return',
  post_url: 'https://api.example/payments/webhooks/tap/1',
}

interface Fixture {
  storeId: bigint
  variantId: bigint
  offeringId: bigint
}

let reservedId = 900_000n
const fakeIds = { reserve: async () => ++reservedId } as never

const fakeAccounts = {
  revealCredentialsForGateway: async () => TAP_CREDENTIALS,
} as never

const fakeIdempotency = {
  defaultTtlSeconds: 3600,
  defaultLeaseSeconds: 60,
  claim: async () => ({ outcome: 'proceed' as const, recordId: 1n }),
  complete: async () => undefined,
  fail: async () => undefined,
} as never

const fakeApplier = { applyMany: async () => [] } as never

/** The Tap transport, plus the contexts core built on the way in. */
function harness() {
  const requests: TapRequest[] = []
  const contexts: PaymentCallContext[] = []

  const http: TapHttp = async (request) => {
    requests.push(request)
    return { status: 200, body: CREATE_CHARGE_RESPONSE }
  }

  const tap = new TapAdapter(http)

  // Delegates to the real adapter and records what core handed it. A
  // stand-in adapter would prove nothing: the point is that the real one
  // receives usable data.
  const recording: IPaymentProvider = {
    capabilities: tap.capabilities,
    validateCredentials: (input) => tap.validateCredentials(input),
    initializePayment: (context) => {
      contexts.push(context)
      return tap.initializePayment(context)
    },
    fetchStatus: (input) => tap.fetchStatus(input),
    parseWebhook: (input) => tap.parseWebhook(input),
    refund: (input) => tap.refund(input),
  }

  const registry = {
    has: (gateway: string) => gateway === 'tap',
    get: () => recording,
    assertCanHandle: () => recording,
  } as never

  /** The body of the charge Tap would have received. */
  const chargeBody = () =>
    requests
      .filter((r) => r.url.endsWith('/charges'))
      .map((r) => r.body as Record<string, any>)[0]

  return { requests, contexts, registry, chargeBody }
}

describe('payer details reach the provider (integration)', () => {
  let prisma: PrismaClient
  let fx: Fixture

  beforeAll(async () => {
    prisma = await startTestDatabase()
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    fx = await seed(prisma)
  })

  const build = (registry: never) =>
    new CheckoutService(
      prisma as never,
      new LedgerService(prisma as never),
      new OutboxService(),
      fakeAccounts,
      fakeIdempotency,
      registry,
      fakeIds,
      fakeApplier,
      new TenantContextService(),
      // The storefront origin this deployment serves. A checkout's
      // `return_url` is only honoured when it points at one of these —
      // see checkout/return-url.ts.
      appConfigStub(['https://shop.example']),
      new CheckoutSuccessionFundsService(),
    )

  const order = (over: Record<string, unknown> = {}) => ({
    items: [{ variant_id: fx.variantId.toString(), quantity: 1 }],
    customer_name: 'Sara Ahmed Ali',
    customer_phone: '0512345678',
    customer_email: 'sara@example.com',
    address_line: '1 Spec Street',
    city: 'Riyadh',
    payment_offering_id: fx.offeringId.toString(),
    ...over,
  })

  describe('CheckoutService → PaymentCallContext', () => {
    it('puts the payer into the call context metadata', async () => {
      const h = harness()

      await build(h.registry).createAndCommit(SLUG, order() as never)

      expect(h.contexts).toHaveLength(1)
      expect(h.contexts[0].metadata).toEqual({
        customer_first_name: 'Sara',
        customer_middle_name: 'Ahmed',
        customer_last_name: 'Ali',
        customer_email: 'sara@example.com',
      })
    })

    it('preserves the return URL the checkout carried, with the checkout token appended', async () => {
      // The token has to be appended (not the raw URL passed through
      // unchanged): a redirect-based provider hands the payer back to
      // this exact URL, and the return page needs a way to identify
      // which checkout it belongs to without trusting anything else
      // client-supplied.
      const h = harness()

      await build(h.registry).createAndCommit(
        SLUG,
        order({ return_url: 'https://shop.example/orders/thanks' }) as never,
      )

      const returnUrl = new URL(h.contexts[0].returnUrl as string)
      expect(returnUrl.origin + returnUrl.pathname).toBe('https://shop.example/orders/thanks')
      expect(returnUrl.searchParams.get('token')).toMatch(/^[0-9a-f]{32}$/)
    })

    it('leaves the return URL unset when the checkout has none', async () => {
      // Every existing client sends no return_url, and must keep
      // producing exactly the call it produced before.
      const h = harness()

      await build(h.registry).createAndCommit(SLUG, order() as never)

      expect(h.contexts[0].returnUrl).toBeUndefined()
    })

    it('still passes the rest of the context unchanged', async () => {
      // The blocker fix adds two fields; it must not disturb the ones
      // orchestration already depends on.
      const h = harness()

      await build(h.registry).createAndCommit(SLUG, order() as never)

      const context = h.contexts[0]

      expect(context.storeId).toBe(fx.storeId)
      expect(context.accountId).toBeDefined()
      expect(context.method).toBe('card')
      expect(context.currency).toBe('USD')
      expect(typeof context.amountMinor).toBe('bigint')
      expect(context.idempotencyKey).toContain('psp:')
      expect(context.captureMethod).toBe('automatic')
    })
  })

  describe('PaymentCallContext → Tap', () => {
    it('sends the first name and the email Tap requires', async () => {
      const h = harness()

      await build(h.registry).createAndCommit(SLUG, order() as never)

      expect(h.chargeBody().customer).toEqual({
        first_name: 'Sara',
        middle_name: 'Ahmed',
        last_name: 'Ali',
        email: 'sara@example.com',
      })
    })

    it('sends a one-word name as the first name alone', async () => {
      const h = harness()

      await build(h.registry).createAndCommit(
        SLUG,
        order({ customer_name: 'Sara' }) as never,
      )

      expect(h.chargeBody().customer).toEqual({
        first_name: 'Sara',
        email: 'sara@example.com',
      })
    })

    it('sends the checkout’s return URL, with token, as the Tap redirect', async () => {
      const h = harness()

      await build(h.registry).createAndCommit(
        SLUG,
        order({ return_url: 'https://shop.example/orders/thanks' }) as never,
      )

      const redirectUrl = new URL(h.chargeBody().redirect.url)
      expect(redirectUrl.origin + redirectUrl.pathname).toBe('https://shop.example/orders/thanks')
      expect(redirectUrl.searchParams.get('token')).toMatch(/^[0-9a-f]{32}$/)
    })

    it('drops a return URL pointing somewhere this deployment does not serve', async () => {
      // The open-redirect case: `return_url` arrives on an
      // unauthenticated public body and becomes a redirect Tap performs
      // for us. An untrusted origin falls back to the merchant's own
      // configured URL rather than sending the payer to it.
      const h = harness()

      await build(h.registry).createAndCommit(
        SLUG,
        order({ return_url: 'https://evil.test/collect' }) as never,
      )

      expect(h.chargeBody().redirect).toEqual({
        url: TAP_CREDENTIALS.redirect_url,
      })
    })

    it('falls back to the merchant’s configured URL when the checkout has none', async () => {
      const h = harness()

      await build(h.registry).createAndCommit(SLUG, order() as never)

      expect(h.chargeBody().redirect).toEqual({
        url: TAP_CREDENTIALS.redirect_url,
      })
    })

    it('completes the checkout and records the redirect for the payer', async () => {
      // The end the blocker was blocking: a Tap checkout that actually
      // reaches a payment page.
      const h = harness()

      const result = await build(h.registry).createAndCommit(
        SLUG,
        order() as never,
      )

      expect(result.next_action).toMatchObject({
        kind: 'redirect',
        url: CREATE_CHARGE_RESPONSE.transaction.url,
      })
      expect(result.payment_redirect_url).toBe(
        CREATE_CHARGE_RESPONSE.transaction.url,
      )
    })
  })

  describe('when the payer details are genuinely absent', () => {
    it('refuses before any network call rather than inventing an email', async () => {
      // Email is optional at checkout and required by Tap. A placeholder
      // address would reach the customer's receipt and the merchant's
      // reconciliation.
      const h = harness()

      const { customer_email, ...withoutEmail } = order() as Record<
        string,
        unknown
      >

      await expect(
        build(h.registry).createAndCommit(SLUG, withoutEmail as never),
      ).rejects.toBeInstanceOf(BadRequestException)

      // The whole point: nothing was sent to Tap.
      expect(h.requests).toHaveLength(0)
    })

    it('leaves the email key out of the context rather than blank', async () => {
      const h = harness()

      const { customer_email, ...withoutEmail } = order() as Record<
        string,
        unknown
      >

      await build(h.registry)
        .createAndCommit(SLUG, withoutEmail as never)
        .catch(() => undefined)

      expect(h.contexts[0].metadata).toEqual({
        customer_first_name: 'Sara',
        customer_middle_name: 'Ahmed',
        customer_last_name: 'Ali',
      })
    })

    it('creates no order when the provider refuses', async () => {
      const h = harness()

      const { customer_email, ...withoutEmail } = order() as Record<
        string,
        unknown
      >

      await build(h.registry)
        .createAndCommit(SLUG, withoutEmail as never)
        .catch(() => undefined)

      expect(await prisma.order.count()).toBe(0)
    })
  })
})

/* ------------------------------------------------------------------ */

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const user = await prisma.users.create({
    data: {
      username: 'spec_payer',
      email: 'spec_payer@example.test',
      password: 'x',
      updated_at: new Date(),
    },
    select: { id: true },
  })

  const store = await prisma.store.create({
    data: {
      name: 'Spec Payer',
      slug: SLUG,
      currency: 'USD',
      ownerId: user.id,
      updatedAt: new Date(),
    },
    select: { id: true },
  })

  const tenant = <T>(cb: (tx: any) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT
          set_config('app.store_id', ${store.id.toString()}, true),
          set_config('app.mode', 'live', true)
      `
      return cb(tx)
    })

  const product = await tenant<{ id: bigint }>((tx) =>
    tx.product.create({
      data: {
        store_id: store.id,
        title: 'Spec Product',
        handle: 'spec-product-payer',
        status: 'ACTIVE',
      },
      select: { id: true },
    }),
  )

  const variant = await tenant<{ id: bigint }>((tx) =>
    tx.productVariant.create({
      data: {
        product_id: product.id,
        title: 'Default Title',
        price: '25.00',
        inventory_qty: 10,
        track_inventory: true,
        continue_selling: false,
      },
      select: { id: true },
    }),
  )

  const account = await tenant<{ id: bigint }>((tx) =>
    tx.paymentAccount.create({
      data: {
        store_id: store.id,
        mode: 'live',
        gateway: 'tap',
        display_name: 'Tap Payments',
        status: 'active',
        settlement_currency: 'USD',
      },
      select: { id: true },
    }),
  )

  const offering = await tenant<{ id: bigint }>((tx) =>
    tx.paymentMethodOffering.create({
      data: {
        account_id: account.id,
        store_id: store.id,
        mode: 'live',
        method: 'card',
        enabled: true,
        position: 0,
        commitment_kind: 'funds_secured',
        capture_mode: 'automatic',
      },
      select: { id: true },
    }),
  )

  return {
    storeId: store.id,
    variantId: variant.id,
    offeringId: offering.id,
  }
}

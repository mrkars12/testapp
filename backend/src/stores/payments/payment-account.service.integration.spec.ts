import { ConfigService } from '@nestjs/config'
import { Prisma, PrismaClient } from '@prisma/client'
import { EncryptionService } from '../../common/crypto/encryption.service'
import { EnvKeyProvider } from '../../common/crypto/env-key.provider'
import { StoreKeyService } from '../../common/crypto/store-key.service'
import { DecryptionError } from '../../common/crypto/key-provider.interface'
import { IdReservationService } from '../../common/ids/id-reservation.service'
import { PaymentAccountService } from './payment-account.service'
import { ProviderRegistry } from './gateways/provider-registry.service'
import { CredentialValidationPipeline } from './gateways/credential-validation.service'
import { CodAdapter } from './gateways/adapters/cod.adapter'
import { BankTransferAdapter } from './gateways/adapters/bank-transfer.adapter'
import { StripeAdapter } from './gateways/adapters/stripe/stripe.adapter'
import { PaymobAdapter } from './gateways/adapters/paymob/paymob.adapter'
import type { PaymobHttp } from './gateways/adapters/paymob/paymob-client'
import { MoyasarAdapter } from './gateways/adapters/moyasar/moyasar.adapter'
import type { MoyasarHttp } from './gateways/adapters/moyasar/moyasar-client'
import { TapAdapter } from './gateways/adapters/tap/tap.adapter'
import type { TapHttp } from './gateways/adapters/tap/tap-client'
import type { StripeClientLike } from './gateways/adapters/stripe/stripe-client'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness'

/** Secret key this spec treats as rejected by Stripe, to test validation failure deterministically. */
const REJECTED_STRIPE_KEY = 'sk_live_rejected_by_stub'

/**
 * Minimal stub client — only `balance.retrieve()` is exercised by
 * `validateCredentials()`, which is all this spec calls through the
 * adapter. No network I/O, so credential validation here is deterministic
 * and does not depend on Stripe being reachable.
 */
function stubStripeClient(secretKey: string): StripeClientLike {
  return {
    checkout: {
      sessions: {
        create: async () => ({ id: 'cs_stub', url: 'https://checkout.stripe.com/c/pay/cs_stub', payment_intent: 'pi_stub' }),
        retrieve: async () => ({ id: 'cs_stub', url: 'https://checkout.stripe.com/c/pay/cs_stub', payment_intent: 'pi_stub' }),
      },
    },
    paymentIntents: {
      create: async () => ({ id: 'pi_stub', status: 'succeeded', currency: 'usd', amount: 0 }),
      retrieve: async () => ({
        id: 'pi_stub',
        status: 'succeeded',
        currency: 'usd',
        amount: 0,
        amount_received: 0,
      }),
      capture: async () => ({
        id: 'pi_stub',
        status: 'succeeded',
        currency: 'usd',
        amount: 0,
        amount_received: 0,
      }),
      cancel: async () => ({ id: 'pi_stub', status: 'canceled', currency: 'usd', amount: 0 }),
    },
    refunds: {
      create: async () => ({ id: 're_stub', status: 'succeeded', amount: 0 }),
    },
    balance: {
      retrieve: async () => {
        if (secretKey === REJECTED_STRIPE_KEY) {
          throw new Error('Invalid API Key provided (stub)')
        }
        return { object: 'balance' }
      },
    },
    webhooks: {
      constructEvent: () => {
        throw new Error('not exercised by this spec')
      },
    },
  }
}

/** An API key this stub Paymob rejects, so validation has a failure path. */
const REJECTED_PAYMOB_API_KEY = 'pm_api_rejected'

/**
 * Paymob's transport, answering only the call validateCredentials makes.
 *
 * Offline: `POST /api/auth/tokens` is the documented endpoint that
 * authenticates a merchant's API key, and this returns a token for a
 * good key and 401 for the rejected one.
 */
const stubPaymobHttp: PaymobHttp = async (request) => {
  const apiKey = (request.body as { api_key?: string } | undefined)?.api_key

  if (apiKey === REJECTED_PAYMOB_API_KEY) {
    return { status: 401, body: { detail: 'Invalid token.' } }
  }

  return { status: 200, body: { token: 'auth_token_stub' } }
}

/** A secret key this stub Moyasar rejects, so validation has a failure path. */
const REJECTED_MOYASAR_KEY = 'sk_test_rejected'

/**
 * Moyasar's transport, answering only the read validateCredentials makes.
 *
 * Offline: `GET /payments` authenticates the key without creating
 * anything, and this returns 401 for the rejected one.
 */
const stubMoyasarHttp: MoyasarHttp = async (request) => {
  if (request.apiKey === REJECTED_MOYASAR_KEY) {
    return {
      status: 401,
      body: { type: 'authentication_error', message: 'Invalid authorization credentials' },
    }
  }

  return { status: 200, body: { payments: [] } }
}

/** A secret key this stub Tap rejects, so validation has a failure path. */
const REJECTED_TAP_KEY = 'sk_test_rejected_by_tap'

/**
 * Tap's transport, answering only the read validateCredentials makes.
 *
 * Offline: `POST /v2/charges/list` authenticates the key without
 * creating anything, and this returns Tap's documented 7022
 * `Invalid_Data` body for the rejected one.
 */
const stubTapHttp: TapHttp = async (request) => {
  if (request.apiKey === REJECTED_TAP_KEY) {
    return {
      status: 401,
      body: {
        errors: [
          { code: '7022', description: 'Missing required header: authorization' },
        ],
      },
    }
  }

  return { status: 200, body: { object_type: 'list', count: 0, charges: [] } }
}

/**
 * Same shape as `GatewaysModule`'s provider wiring, without the Nest DI
 * container — matches how the rest of this spec constructs its services
 * directly. `my_fatoorah`/`fawry` are deliberately left unregistered:
 * that mismatch (present in the catalog, absent from the registry) is
 * exactly what Stage 1 gating targets.
 */
function makeProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry([
    new CodAdapter(),
    new BankTransferAdapter(),
    new StripeAdapter(stubStripeClient),
    new PaymobAdapter(stubPaymobHttp),
    new MoyasarAdapter(stubMoyasarHttp),
    new TapAdapter(stubTapHttp),
  ])
  registry.onModuleInit()
  return registry
}

/**
 * اختبارات تكامل على Postgres حقيقي.
 *
 * دي أول مرة أساس التشفير المجمّد بيتستخدم فعلاً، فالاختبارات هنا
 * بتركّز على الضمانات اللي لو اتكسرت تبقى بيانات اعتماد ضايعة للأبد:
 *
 *   • المعرّف بيتحجز قبل التشفير، والـ AAD مربوط بيه
 *   • متجر مايقدرش يفك تشفير بيانات متجر تاني
 *   • بيانات الاعتماد مابترجعش في أي رد API
 *   • الحقل الفاضي معناه "ماتغيّرش" مش "امسح"
 */

const STORE = 1n
const OTHER_STORE = 2n

const KEK = Buffer.alloc(32, 0x5a).toString('base64')

function makeConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'payments') {
        return { encryptionKey: KEK, encryptionKeyVersion: 1 }
      }
      throw new Error(`missing config: ${key}`)
    },
    get: () => undefined,
  } as unknown as ConfigService
}

async function makeCrypto(): Promise<StoreKeyService> {
  const provider = new EnvKeyProvider(makeConfig())
  await provider.onModuleInit()
  return new StoreKeyService(provider)
}

describe('PaymentAccountService (integration)', () => {
  let prisma: PrismaClient
  let storeKeys: StoreKeyService
  let service: PaymentAccountService

  beforeAll(async () => {
    prisma = await startTestDatabase()
    storeKeys = await makeCrypto()
    const registry = makeProviderRegistry()

    service = new PaymentAccountService(
      prisma as never,
      storeKeys,
      new IdReservationService(prisma as never),
      registry,
      new CredentialValidationPipeline(registry),
    )
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    await seedStores(prisma)
  })

  async function withTenant<T>(
    storeId: bigint,
    mode: 'live' | 'test',
    cb: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId.toString()}, true), set_config('app.mode', ${mode}, true)`
      return cb(tx as Prisma.TransactionClient)
    })
  }

  describe('catalog', () => {
    it('lists every supported gateway with its credential fields', async () => {
      const settings = await service.listSettings(STORE)
      const keys = settings.map((s) => s.key)

      expect(keys).toEqual(
        expect.arrayContaining(['cod', 'bank_transfer', 'stripe', 'paymob']),
      )

      const stripe = settings.find((s) => s.key === 'stripe')
      expect(stripe?.requires_credentials).toBe(true)
      expect(stripe?.fields.map((f) => f.key)).toContain('secret_key')
      expect(stripe?.has_adapter).toBe(true)
      expect(stripe?.test_payment_supported).toBe(true)
      expect(stripe?.webhook_secret_field).toBe('webhook_secret')

      const cod = settings.find((s) => s.key === 'cod')
      expect(cod?.requires_credentials).toBe(false)
      expect(cod?.fields).toHaveLength(0)
      expect(cod?.has_adapter).toBe(true)
      expect(cod?.test_payment_supported).toBe(false)
      expect(cod?.webhook_secret_field).toBeNull()

      const myFatoorah = settings.find((s) => s.key === 'my_fatoorah')
      expect(myFatoorah?.has_adapter).toBe(false)
      expect(myFatoorah?.test_payment_supported).toBe(false)
      expect(myFatoorah?.webhook_secret_field).toBeNull()
    })

    it('reports no accounts for a fresh store', async () => {
      const settings = await service.listSettings(STORE)
      expect(settings.every((s) => s.accounts.length === 0)).toBe(true)
    })
  })

  describe('credential storage', () => {
    it('encrypts credentials and never returns them', async () => {
      const result = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: {
          publishable_key: 'pk_live_abc123',
          secret_key: 'sk_live_supersecret9999',
        },
      })

      expect(result.is_configured).toBe(true)
      expect(JSON.stringify(result)).not.toContain('sk_live_supersecret9999')
      expect(result.credentials_hint).toEqual({
        publishable_key: '••••c123',
        secret_key: '••••9999',
      })
      expect(result).not.toHaveProperty('credentials')
      expect(result).not.toHaveProperty('credentials_envelope')
    })

    it('stores ciphertext, not plaintext, in the database', async () => {
      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_live_plaintextcheck' },
      })

      const row = await withTenant(STORE, 'live', (tx) =>
        tx.paymentAccount.findFirstOrThrow({
          where: { store_id: STORE, mode: 'live' },
        }),
      )

      expect(row.credentials_envelope).not.toBeNull()
      expect(row.credentials_envelope).not.toContain('sk_live_plaintextcheck')
      expect(row.credential_kek_version).toBe(1)
      expect(row.credential_dek_version).toBe(1)
    })

    it('round-trips credentials through the internal reveal path', async () => {
      const saved = await service.upsert(STORE, 'paymob', {
        mode: 'live',
        credentials: { api_key: 'pm_key_1', hmac_secret: 'pm_hmac_1' },
      })

      const revealed = await service.revealCredentialsForGateway(
        STORE,
        'live',
        BigInt(saved.id),
      )

      expect(revealed).toEqual({ api_key: 'pm_key_1', hmac_secret: 'pm_hmac_1' })
    })

    it('binds ciphertext to the record id — the AAD guarantee', async () => {
      const a = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_account_a' },
      })
      const b = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        display_name: 'Second',
        credentials: { secret_key: 'sk_account_b' },
      })

      const envelopeOfA = (
        await withTenant(STORE, 'live', (tx) =>
          tx.paymentAccount.findFirstOrThrow({ where: { id: BigInt(a.id) } }),
        )
      ).credentials_envelope

      await withTenant(STORE, 'live', (tx) =>
        tx.paymentAccount.update({
          where: { id: BigInt(b.id) },
          data: { credentials_envelope: envelopeOfA },
        }),
      )

      await expect(
        service.revealCredentialsForGateway(STORE, 'live', BigInt(b.id)),
      ).rejects.toBeInstanceOf(DecryptionError)
    })

    it('binds ciphertext to the mode — test cannot be read as live', async () => {
      const live = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_live_x' },
      })

      // Intentional mode tampering changes the RLS column itself.
      // With RLS, updating mode via tenant (WITH CHECK mode = current_setting)
      // always fails (live->test violates live, test->live violates test),
      // and direct rls_test without context hides the row. Bypass RLS
      // via owner (test:test) which bypasses ENABLE ROW LEVEL SECURITY.
      const ownerUrl = new URL(process.env.TEST_DATABASE_URL!)
      ownerUrl.username = 'test'
      ownerUrl.password = 'test'
      const owner = new PrismaClient({ datasources: { db: { url: ownerUrl.toString() } } })
      await owner.$connect()
      try {
        await owner.paymentAccount.update({
          where: { id: BigInt(live.id) },
          data: { mode: 'test' },
        })
      } finally {
        await owner.$disconnect()
      }

      await expect(
        service.revealCredentialsForGateway(STORE, 'test', BigInt(live.id)),
      ).rejects.toBeInstanceOf(DecryptionError)
    })

    it('isolates credentials between stores', async () => {
      const mine = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_mine' },
      })

      const theirs = await service.upsert(OTHER_STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_theirs' },
      })

      const envelopeOfMine = (
        await withTenant(STORE, 'live', (tx) =>
          tx.paymentAccount.findFirstOrThrow({
            where: { id: BigInt(mine.id) },
          }),
        )
      ).credentials_envelope

      await withTenant(OTHER_STORE, 'live', (tx) =>
        tx.paymentAccount.update({
          where: { id: BigInt(theirs.id) },
          data: { credentials_envelope: envelopeOfMine },
        }),
      )

      await expect(
        service.revealCredentialsForGateway(OTHER_STORE, 'live', BigInt(theirs.id)),
      ).rejects.toBeInstanceOf(DecryptionError)
    })
  })

  describe('merge semantics', () => {
    it('treats an omitted field as unchanged', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: {
          publishable_key: 'pk_original',
          secret_key: 'sk_original',
        },
      })

      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { publishable_key: 'pk_updated' },
      })

      const revealed = await service.revealCredentialsForGateway(
        STORE,
        'live',
        BigInt(saved.id),
      )

      expect(revealed).toEqual({
        publishable_key: 'pk_updated',
        secret_key: 'sk_original',
      })
    })

    it('treats an empty string as unchanged, not as a delete', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_keepme' },
      })

      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: '   ' },
      })

      const revealed = await service.revealCredentialsForGateway(
        STORE,
        'live',
        BigInt(saved.id),
      )

      expect(revealed.secret_key).toBe('sk_keepme')
    })

    it('updates non-credential fields without touching credentials', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_untouched' },
      })

      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        settlement_currency: 'usd',
      })

      const row = await withTenant(STORE, 'live', (tx) =>
        tx.paymentAccount.findFirstOrThrow({
          where: { id: BigInt(saved.id) },
        }),
      )

      expect(row.settlement_currency).toBe('USD')
      expect(
        await service.revealCredentialsForGateway(STORE, 'live', BigInt(saved.id)),
      ).toEqual({ secret_key: 'sk_untouched' })
    })
  })

  describe('validation', () => {
    it('rejects an unknown gateway', async () => {
      await expect(
        service.upsert(STORE, 'not_a_gateway', { mode: 'live' }),
      ).rejects.toThrow(/بوابة غير مدعومة/)
    })

    it('rejects a credential field not in the gateway catalog', async () => {
      await expect(
        service.upsert(STORE, 'stripe', {
          mode: 'live',
          credentials: { totally_made_up: 'x' },
        }),
      ).rejects.toThrow(/حقل غير معروف/)
    })

    it('rejects a payment method the gateway does not offer', async () => {
      await expect(
        service.upsert(STORE, 'stripe', {
          mode: 'live',
          offerings: [{ method: 'knet' }],
        }),
      ).rejects.toThrow(/مش متاحة لبوابة/)
    })

    it('rejects duplicate offerings', async () => {
      await expect(
        service.upsert(STORE, 'paymob', {
          mode: 'live',
          offerings: [
            { method: 'card', gateway_method_config: '1' },
            { method: 'card', gateway_method_config: '1' },
          ],
        }),
      ).rejects.toThrow(/وسيلة مكرّرة/)
    })

    it('rejects test mode for a gateway that has none', async () => {
      await expect(
        service.upsert(STORE, 'cod', { mode: 'test' }),
      ).rejects.toThrow(/مالهاش وضع اختبار/)
    })
  })

  describe('offerings', () => {
    it('supports multiple integrations of the same method', async () => {
      const saved = await service.upsert(STORE, 'paymob', {
        mode: 'live',
        credentials: { api_key: 'k', hmac_secret: 'h' },
        offerings: [
          { method: 'card', gateway_method_config: '111', enabled: true, position: 0 },
          { method: 'wallet', gateway_method_config: '222', enabled: true, position: 1 },
          { method: 'kiosk', gateway_method_config: '333', enabled: false, position: 2 },
        ],
      })

      expect(saved.offerings).toHaveLength(3)
      expect(saved.offerings.map((o) => o.gateway_method_config)).toEqual([
        '111',
        '222',
        '333',
      ])
    })

    it('replaces offerings on a subsequent save', async () => {
      await service.upsert(STORE, 'paymob', {
        mode: 'live',
        offerings: [{ method: 'card', gateway_method_config: '111' }],
      })

      const updated = await service.upsert(STORE, 'paymob', {
        mode: 'live',
        offerings: [{ method: 'wallet', gateway_method_config: '222' }],
      })

      expect(updated.offerings).toHaveLength(1)
      expect(updated.offerings[0].method).toBe('wallet')
    })

    it('defaults commitment kind and capture mode', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        offerings: [{ method: 'cod', enabled: true }],
      })

      expect(saved.offerings[0].commitment_kind).toBe('funds_secured')
      expect(saved.offerings[0].capture_mode).toBe('automatic')
    })

    it('accepts an explicit commitment kind for manual methods', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        offerings: [{ method: 'cod', commitment_kind: 'promise_accepted' }],
      })

      expect(saved.offerings[0].commitment_kind).toBe('promise_accepted')
    })

    // Regression: the settings UI (frontend) has no per-offering management
    // screen — it only ever calls PUT with { enabled, mode, credentials },
    // never `offerings`. Before this fix, saving/enabling a gateway that
    // way updated the account's status but created zero
    // PaymentMethodOffering rows, so listPaymentMethods() (which the
    // storefront checkout actually queries) never saw the gateway —
    // "enabled" in settings, invisible at checkout.
    it('backfills a default, enabled offering per catalog method when the caller omits `offerings` entirely and enables the gateway', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        enabled: true,
        // no `offerings` key at all — matches the real frontend request shape
      })

      expect(saved.offerings).toHaveLength(1)
      expect(saved.offerings[0].method).toBe('cod')
      expect(saved.offerings[0].enabled).toBe(true)
    })

    it('does not create an enabled offering when the gateway is saved but not enabled', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        enabled: false,
      })

      expect(saved.offerings).toHaveLength(1)
      expect(saved.offerings[0].enabled).toBe(false)
    })

    it('syncs the backfilled offering back to enabled when the gateway is re-enabled later, without duplicating it', async () => {
      await service.upsert(STORE, 'cod', { mode: 'live', enabled: false })
      const disabled = await service.upsert(STORE, 'cod', { mode: 'live', enabled: false })
      expect(disabled.offerings).toHaveLength(1)
      expect(disabled.offerings[0].enabled).toBe(false)

      const reenabled = await service.upsert(STORE, 'cod', { mode: 'live', enabled: true })
      expect(reenabled.offerings).toHaveLength(1)
      expect(reenabled.offerings[0].id).toBe(disabled.offerings[0].id)
      expect(reenabled.offerings[0].enabled).toBe(true)
    })

    it('never overwrites an explicitly-managed offering (a future offerings UI, or multi-integration setup) with the default backfill', async () => {
      const withExplicitOffering = await service.upsert(STORE, 'paymob', {
        mode: 'live',
        credentials: { api_key: 'k', hmac_secret: 'h' },
        offerings: [
          { method: 'card', gateway_method_config: 'custom-integration', enabled: true, position: 0 },
        ],
      })
      expect(withExplicitOffering.offerings).toHaveLength(1)

      // A later save that omits `offerings` (e.g. toggling enabled from the
      // simple switch) must not touch or duplicate the explicit offering —
      // the backfill only ever targets gateway_method_config: '', a
      // distinct key from 'custom-integration' under the same method.
      // Paymob's catalog entry declares 3 methods (card/wallet/kiosk), so
      // the backfill also creates the other two default ('') offerings —
      // this only asserts the pre-existing explicit one survives untouched.
      const afterToggle = await service.upsert(STORE, 'paymob', {
        mode: 'live',
        enabled: true,
      })

      const explicit = afterToggle.offerings.find((o) => o.gateway_method_config === 'custom-integration')
      expect(explicit?.id).toBe(withExplicitOffering.offerings[0].id)
      expect(explicit?.method).toBe('card')
    })
  })

  describe('mode and account separation', () => {
    it('keeps test and live accounts independent', async () => {
      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_live_1' },
      })
      await service.upsert(STORE, 'stripe', {
        mode: 'test',
        credentials: { secret_key: 'sk_test_1' },
      })

      const settings = await service.listSettings(STORE)
      const stripe = settings.find((s) => s.key === 'stripe')

      expect(stripe?.accounts).toHaveLength(2)
      expect(stripe?.accounts.map((a) => a.mode).sort()).toEqual(['live', 'test'])
    })

    it('supports multiple accounts for one gateway via display name', async () => {
      await service.upsert(STORE, 'stripe', { mode: 'live', display_name: 'UK' })
      await service.upsert(STORE, 'stripe', { mode: 'live', display_name: 'EG' })

      const settings = await service.listSettings(STORE)
      const stripe = settings.find((s) => s.key === 'stripe')

      expect(stripe?.accounts.map((a) => a.display_name).sort()).toEqual(['EG', 'UK'])
    })
  })

  describe('clearCredentials', () => {
    it('removes credentials and returns the account to draft', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: { secret_key: 'sk_to_clear' },
      })

      const cleared = await service.clearCredentials(STORE, 'stripe', 'live')

      expect(cleared.is_configured).toBe(false)
      expect(cleared.status).toBe('draft')
      expect(cleared.credentials_hint).toEqual({})

      const row = await withTenant(STORE, 'live', (tx) =>
        tx.paymentAccount.findFirstOrThrow({
          where: { id: BigInt(saved.id) },
        }),
      )
      expect(row.credentials_envelope).toBeNull()
      expect(row.credentials_fingerprint).toBeNull()
    })

    it('does not clear another store\'s account', async () => {
      await service.upsert(OTHER_STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_theirs' },
      })

      await expect(
        service.clearCredentials(STORE, 'stripe', 'live'),
      ).rejects.toThrow(/مش موجود/)
    })
  })

  describe('status transitions', () => {
    it('starts as draft with no credentials', async () => {
      const saved = await service.upsert(STORE, 'stripe', { mode: 'live' })
      expect(saved.status).toBe('draft')
    })

    it('activates once credentials pass real adapter validation and the account is enabled', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        // Both keys the catalog marks required: the pipeline's structural
        // stage now refuses a Stripe account that could never mount
        // Stripe.js at the storefront.
        credentials: { publishable_key: 'pk_x', secret_key: 'sk_x' },
      })
      expect(saved.status).toBe('active')
      expect(saved.last_error).toBeNull()
    })

    it('activates a manual gateway immediately', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        enabled: true,
      })
      expect(saved.status).toBe('active')
    })

    it('disables on request', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        enabled: false,
      })
      expect(saved.status).toBe('disabled')
    })
  })

  describe('webhook status', () => {
    it('is not_configured when no webhook secret is saved', async () => {
      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: { publishable_key: 'pk_x', secret_key: 'sk_x' },
      })
      const settings = await service.listSettings(STORE)
      const account = settings.find((g) => g.key === 'stripe')!.accounts.find((a) => a.mode === 'live')!
      expect(account.webhook).toMatchObject({ configured: false, status: 'not_configured' })
    })

    it('is configured but unverified until a webhook actually arrives', async () => {
      await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: {
          publishable_key: 'pk_x',
          secret_key: 'sk_x',
          webhook_secret: 'whsec_x',
        },
      })
      const settings = await service.listSettings(STORE)
      const account = settings.find((g) => g.key === 'stripe')!.accounts.find((a) => a.mode === 'live')!
      expect(account.webhook).toMatchObject({ configured: true, status: 'configured' })
    })

    it('reflects a verified inbound webhook, never fabricating it from credentials alone', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: {
          publishable_key: 'pk_x',
          secret_key: 'sk_x',
          webhook_secret: 'whsec_x',
        },
      })

      await prisma.webhookEvent.create({
        data: {
          gateway: 'stripe',
          account_id: BigInt(saved.id),
          store_id: STORE,
          mode: 'live',
          provider_event_id: 'evt_1',
          event_type: 'payment_intent.succeeded',
          status: 'applied',
          signature_verified: true,
          body_sha256: 'x'.repeat(64),
          body_bytes: 1,
        },
      })

      const settings = await service.listSettings(STORE)
      const account = settings.find((g) => g.key === 'stripe')!.accounts.find((a) => a.mode === 'live')!
      expect(account.webhook).toMatchObject({ configured: true, status: 'verified' })
    })

    it('reports verification_failed when the last inbound webhook failed signature checks', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: {
          publishable_key: 'pk_x',
          secret_key: 'sk_x',
          webhook_secret: 'whsec_x',
        },
      })

      await prisma.webhookEvent.create({
        data: {
          gateway: 'stripe',
          account_id: BigInt(saved.id),
          store_id: STORE,
          mode: 'live',
          status: 'rejected_signature',
          signature_verified: false,
          body_sha256: 'y'.repeat(64),
          body_bytes: 1,
        },
      })

      const settings = await service.listSettings(STORE)
      const account = settings.find((g) => g.key === 'stripe')!.accounts.find((a) => a.mode === 'live')!
      expect(account.webhook).toMatchObject({ configured: true, status: 'verification_failed' })
    })

    it('keeps test and live webhook status independent', async () => {
      const live = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: {
          publishable_key: 'pk_live',
          secret_key: 'sk_live',
          webhook_secret: 'whsec_live',
        },
      })
      await service.upsert(STORE, 'stripe', {
        mode: 'test',
        enabled: true,
        credentials: { publishable_key: 'pk_test', secret_key: 'sk_test' },
      })

      await prisma.webhookEvent.create({
        data: {
          gateway: 'stripe',
          account_id: BigInt(live.id),
          store_id: STORE,
          mode: 'live',
          status: 'applied',
          signature_verified: true,
          body_sha256: 'z'.repeat(64),
          body_bytes: 1,
        },
      })

      const settings = await service.listSettings(STORE)
      const stripe = settings.find((g) => g.key === 'stripe')!
      expect(stripe.accounts.find((a) => a.mode === 'live')!.webhook).toMatchObject({
        status: 'verified',
      })
      expect(stripe.accounts.find((a) => a.mode === 'test')!.webhook).toMatchObject({
        status: 'not_configured',
      })
    })
  })

  describe('gateway/credential gating (Stage 1)', () => {
    it('saves a working adapter (Stripe) as enabled normally', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: { publishable_key: 'pk_live_good', secret_key: 'sk_live_good' },
      })
      expect(saved.status).toBe('active')
    })

    it('keeps Bank Transfer usable', async () => {
      const saved = await service.upsert(STORE, 'bank_transfer', {
        mode: 'live',
        enabled: true,
        credentials: { bank_name: 'Test Bank', account_holder: 'Store Owner' },
      })
      expect(saved.status).toBe('active')
    })

    it('keeps COD usable', async () => {
      const saved = await service.upsert(STORE, 'cod', {
        mode: 'live',
        enabled: true,
      })
      expect(saved.status).toBe('active')
    })

    // MyFatoorah is in the catalog with no adapter behind it. Paymob,
    // Moyasar and then Tap each played this role and no longer can.
    it('allows drafting an unimplemented gateway (not yet enabled)', async () => {
      const saved = await service.upsert(STORE, 'my_fatoorah', {
        mode: 'live',
        credentials: { api_token: 'my_fatoorah_token' },
      })
      expect(saved.status).toBe('draft')
    })

    it('rejects enabling an unimplemented gateway', async () => {
      await expect(
        service.upsert(STORE, 'my_fatoorah', {
          mode: 'live',
          enabled: true,
          credentials: { api_token: 'my_fatoorah_token' },
        }),
      ).rejects.toThrow(/مش متاحة لسه/)
    })

    describe('Paymob', () => {
      const live = {
        secret_key: 'egy_sk_live_good',
        public_key: 'egy_pk_live_good',
        api_key: 'pm_api_good',
        hmac_secret: 'pm_hmac',
      }

      it('activates only after real credential validation succeeds', async () => {
        const saved = await service.upsert(STORE, 'paymob', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        expect(saved.status).toBe('active')
        expect(saved.last_verified_at).not.toBeNull()
        expect(saved.last_error).toBeNull()
      })

      it('does not activate when Paymob rejects the API key', async () => {
        const saved = await service.upsert(STORE, 'paymob', {
          mode: 'live',
          enabled: true,
          credentials: { ...live, api_key: REJECTED_PAYMOB_API_KEY },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toBeTruthy()
        expect(saved.last_verified_at).toBeNull()
        // Credentials are still stored, just not verified.
        expect(saved.is_configured).toBe(true)
      })

      it('does not activate a test key saved against a live account', async () => {
        const saved = await service.upsert(STORE, 'paymob', {
          mode: 'live',
          enabled: true,
          credentials: { ...live, secret_key: 'egy_sk_test_good' },
        })

        expect(saved.status).toBe('errored')
      })

      it('refuses a credential field the catalog does not declare', async () => {
        // merchant_id was in the catalog before the Intention API flow;
        // it is not part of it, so it is no longer accepted.
        await expect(
          service.upsert(STORE, 'paymob', {
            mode: 'live',
            credentials: { ...live, merchant_id: '123' },
          }),
        ).rejects.toThrow(/merchant_id/)
      })

      it('requires every documented credential before calling out', async () => {
        const saved = await service.upsert(STORE, 'paymob', {
          mode: 'live',
          enabled: true,
          credentials: { secret_key: live.secret_key },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('public_key')
      })

      it('never returns a Paymob secret in the response', async () => {
        const saved = await service.upsert(STORE, 'paymob', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        const serialised = JSON.stringify(saved)

        for (const secret of Object.values(live)) {
          expect(serialised).not.toContain(secret)
        }

        // Only a masked hint reaches the API.
        expect(saved.credentials_hint.secret_key).toMatch(/^••••/)
      })
    })

    it('never calls out to a provider for an unimplemented gateway', async () => {
      // my_fatoorah has no adapter at all — if the service tried to
      // resolve and call validateCredentials() for it, this would throw a
      // ProviderError ("No adapter is registered") instead of saving.
      const saved = await service.upsert(STORE, 'my_fatoorah', {
        mode: 'live',
        credentials: { api_token: 'token_x' },
      })
      expect(saved.status).toBe('draft')
    })

    it('invokes validateCredentials() on the real adapter when credentials are saved', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: { publishable_key: 'pk_x_valid', secret_key: 'sk_x_valid' },
      })
      // Reaching 'active' (not 'draft'/'errored') is only possible if the
      // stub adapter's validateCredentials() actually ran and returned valid.
      expect(saved.status).toBe('active')
      expect(saved.last_verified_at).not.toBeNull()
    })

    it('refuses a required credential field the merchant left blank', async () => {
      // Caught before any provider call: cheaper, and a better message
      // than any gateway's "unauthorized". The required set comes from
      // the catalog, so core never names a provider's fields.
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: { secret_key: 'sk_x' },
      })

      expect(saved.status).toBe('errored')
      expect(saved.last_error).toContain('publishable_key')
      expect(saved.last_verified_at).toBeNull()
    })

    it('does not mark rejected credentials as valid', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: {
          publishable_key: 'pk_x',
          secret_key: REJECTED_STRIPE_KEY,
        },
      })
      expect(saved.status).toBe('errored')
      expect(saved.last_error).toBeTruthy()
      expect(saved.is_configured).toBe(true) // credentials are still stored, just not verified
    })
  })

    describe('Moyasar', () => {
      const live = {
        secret_key: 'sk_live_good',
        webhook_secret: 'moyasar_webhook_secret',
      }

      it('activates only after real credential validation succeeds', async () => {
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        expect(saved.status).toBe('active')
        expect(saved.last_verified_at).not.toBeNull()
        expect(saved.last_error).toBeNull()
      })

      it('does not activate when Moyasar rejects the secret key', async () => {
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'test',
          enabled: true,
          credentials: { ...live, secret_key: REJECTED_MOYASAR_KEY },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toBeTruthy()
        expect(saved.last_verified_at).toBeNull()
        expect(saved.is_configured).toBe(true)
      })

      it('does not activate a test key saved against a live account', async () => {
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'live',
          enabled: true,
          credentials: { ...live, secret_key: 'sk_test_good' },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('sk_live_')
      })

      it('activates with only secret_key — the webhook secret is a separate, later concern', async () => {
        // Account setup (can this store actually charge cards?) and
        // webhook setup (can we hear back from Moyasar?) are two
        // different questions. A merchant must be able to save a working
        // Moyasar account before they've configured — or even seen — the
        // webhook URL, which itself only exists once the account does
        // (see WebhookPanel.tsx). Requiring webhook_secret up front was
        // the exact chicken-and-egg the merchant reported.
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'live',
          enabled: true,
          credentials: { secret_key: live.secret_key },
        })

        expect(saved.status).toBe('active')
        expect(saved.last_error).toBeNull()

        const settings = await service.listSettings(STORE)
        const account = settings.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'live')!
        expect(account.status).toBe('active')
        expect(account.webhook).toMatchObject({ configured: false, status: 'not_configured' })
      })

      it('rejects saving with an empty secret_key — a merchant cannot activate on missing required credentials', async () => {
        // secret_key is still the one field this flow cannot work
        // without. Sending some *other* field (webhook_secret) forces
        // credentialsChanged=true, which runs the structural check —
        // secret_key is missing, so this must be rejected, never "active".
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'live',
          enabled: true,
          credentials: { secret_key: '', webhook_secret: live.webhook_secret },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('secret_key')

        const settings = await service.listSettings(STORE)
        const account = settings.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'live')
        expect(account?.status).not.toBe('active')
      })

      it('treats the publishable key as optional, since this flow never uses it', async () => {
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        expect(saved.status).toBe('active')
      })

      it('exposes everything the Webhook Setup UI needs to render Moyasar\'s webhook URL, generically', async () => {
        // Regression: the merchant reported no Webhook URL showing for
        // Moyasar's TEST card. The frontend builds
        // `${backendOrigin()}/api/payments/webhooks/moyasar/<account.id>`
        // purely from the `listSettings()` response — this proves that
        // response actually carries every piece that requires, the same
        // way it does for Stripe/Paymob/Tap (no gateway-specific branch
        // anywhere in that pipeline).
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'test',
          enabled: true,
          credentials: { ...live, secret_key: 'sk_test_good' },
        })

        const settings = await service.listSettings(STORE)
        const moyasar = settings.find((s) => s.key === 'moyasar')

        expect(moyasar?.has_adapter).toBe(true)
        expect(moyasar?.webhook_events.length).toBeGreaterThan(0)
        expect(moyasar?.webhook_secret_field).toBe('webhook_secret')

        const testAccount = moyasar?.accounts.find((a) => a.mode === 'test')
        expect(testAccount?.id).toBe(saved.id)
        expect(testAccount?.id).toBeTruthy()
      })

      describe('generateWebhookSecret (Secret Token generation)', () => {
        it('is denied before any credentials are saved', async () => {
          await expect(
            service.generateWebhookSecret(STORE, 'moyasar', 'test'),
          ).rejects.toThrow('احفظ بيانات الاعتماد أولًا.')
        })

        it('generates and persists a server-side token once credentials exist', async () => {
          await service.upsert(STORE, 'moyasar', {
            mode: 'test',
            enabled: true,
            credentials: { ...live, secret_key: 'sk_test_good' },
          })

          const result = await service.generateWebhookSecret(STORE, 'moyasar', 'test')

          expect(result.webhook_secret).toBeTruthy()
          expect(result.webhook_secret.length).toBeGreaterThanOrEqual(32)
          expect(result.credentials_hint.webhook_secret).toMatch(/^••••/)

          // Persisted, not just returned once and discarded — a fresh
          // read (via the normal settings path) sees the account has a
          // webhook secret configured, still never in plaintext.
          const settings = await service.listSettings(STORE)
          const account = settings.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'test')!
          expect(account.webhook).toMatchObject({ configured: true, status: 'configured' })
          expect(JSON.stringify(account)).not.toContain(result.webhook_secret)
        })

        it('reaches VERIFIED only after a real, signature-checked webhook — never merely from generating the token', async () => {
          const saved = await service.upsert(STORE, 'moyasar', {
            mode: 'test',
            enabled: true,
            credentials: { ...live, secret_key: 'sk_test_good' },
          })
          await service.generateWebhookSecret(STORE, 'moyasar', 'test')

          const rightAfterGeneration = await service.listSettings(STORE)
          expect(
            rightAfterGeneration.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'test')!.webhook,
          ).toMatchObject({ status: 'configured' })

          await prisma.webhookEvent.create({
            data: {
              gateway: 'moyasar',
              account_id: BigInt(saved.id),
              store_id: STORE,
              mode: 'test',
              status: 'applied',
              signature_verified: true,
              body_sha256: 'b'.repeat(64),
              body_bytes: 1,
            },
          })

          const afterCallback = await service.listSettings(STORE)
          expect(
            afterCallback.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'test')!.webhook,
          ).toMatchObject({ status: 'verified' })
        })

        it('generates independent tokens for TEST and LIVE', async () => {
          await service.upsert(STORE, 'moyasar', { mode: 'test', enabled: true, credentials: { ...live, secret_key: 'sk_test_good' } })
          await service.upsert(STORE, 'moyasar', { mode: 'live', enabled: true, credentials: live })

          const testResult = await service.generateWebhookSecret(STORE, 'moyasar', 'test')
          const liveResult = await service.generateWebhookSecret(STORE, 'moyasar', 'live')

          expect(testResult.webhook_secret).not.toBe(liveResult.webhook_secret)
          expect(testResult.id).not.toBe(liveResult.id)
        })

        it('never returns the plaintext token from a normal settings read', async () => {
          await service.upsert(STORE, 'moyasar', { mode: 'test', enabled: true, credentials: { ...live, secret_key: 'sk_test_good' } })
          const { webhook_secret } = await service.generateWebhookSecret(STORE, 'moyasar', 'test')

          const settings = await service.listSettings(STORE)
          expect(JSON.stringify(settings)).not.toContain(webhook_secret)

          const status = await service.webhookStatus(STORE, 'moyasar', 'test')
          expect(JSON.stringify(status)).not.toContain(webhook_secret)
        })

        it('rotation invalidates the old token and resets a previously-verified status to configured', async () => {
          const saved = await service.upsert(STORE, 'moyasar', {
            mode: 'test',
            enabled: true,
            credentials: { ...live, secret_key: 'sk_test_good' },
          })
          const first = await service.generateWebhookSecret(STORE, 'moyasar', 'test')

          // A real inbound webhook, verified against the first token,
          // pushes the status to "verified".
          await prisma.webhookEvent.create({
            data: {
              gateway: 'moyasar',
              account_id: BigInt(saved.id),
              store_id: STORE,
              mode: 'test',
              status: 'applied',
              signature_verified: true,
              body_sha256: 'a'.repeat(64),
              body_bytes: 1,
            },
          })

          const beforeRotation = await service.listSettings(STORE)
          expect(
            beforeRotation.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'test')!.webhook,
          ).toMatchObject({ status: 'verified' })

          const second = await service.generateWebhookSecret(STORE, 'moyasar', 'test')
          expect(second.webhook_secret).not.toBe(first.webhook_secret)

          // The old inbound event still exists, but it proved the *old*
          // secret — the badge must not keep claiming "verified" for a
          // token that no longer exists.
          const afterRotation = await service.listSettings(STORE)
          expect(
            afterRotation.find((s) => s.key === 'moyasar')!.accounts.find((a) => a.mode === 'test')!.webhook,
          ).toMatchObject({ status: 'configured' })
        })

        it('is denied for a gateway that does not declare generated-secret support (Stripe)', async () => {
          await service.upsert(STORE, 'stripe', {
            mode: 'live',
            enabled: true,
            credentials: { publishable_key: 'pk_x', secret_key: 'sk_x', webhook_secret: 'whsec_x' },
          })

          await expect(
            service.generateWebhookSecret(STORE, 'stripe', 'live'),
          ).rejects.toThrow('مالهاش توليد Secret Token من السيرفر')
        })

        it('cannot generate against another store\'s account (store isolation)', async () => {
          await service.upsert(OTHER_STORE, 'moyasar', {
            mode: 'test',
            enabled: true,
            credentials: { ...live, secret_key: 'sk_test_good' },
          })

          // STORE never saved a Moyasar account of its own — the lookup
          // is scoped by store_id via RLS, so it must not find OTHER_STORE's.
          await expect(
            service.generateWebhookSecret(STORE, 'moyasar', 'test'),
          ).rejects.toThrow('احفظ بيانات الاعتماد أولًا.')
        })

        it('cannot generate against the other mode\'s account (test/live isolation)', async () => {
          await service.upsert(STORE, 'moyasar', {
            mode: 'live',
            enabled: true,
            credentials: live,
          })

          // Only LIVE has a saved account — TEST must not fall back to it.
          await expect(
            service.generateWebhookSecret(STORE, 'moyasar', 'test'),
          ).rejects.toThrow('احفظ بيانات الاعتماد أولًا.')
        })
      })

      it('never returns a Moyasar secret in the response', async () => {
        const saved = await service.upsert(STORE, 'moyasar', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        const serialised = JSON.stringify(saved)

        for (const secret of Object.values(live)) {
          expect(serialised).not.toContain(secret)
        }

        expect(saved.credentials_hint.secret_key).toMatch(/^••••/)
      })
    })

    describe('Stripe', () => {
      it('does not activate a test key saved against a live account', async () => {
        // `balance.retrieve()` succeeds for either key, so without the
        // adapter's mode guard this account would go active and live
        // orders would be recorded as funded against Stripe test intents.
        const saved = await service.upsert(STORE, 'stripe', {
          mode: 'live',
          enabled: true,
          credentials: {
            publishable_key: 'pk_test_good',
            secret_key: 'sk_test_good',
          },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('sk_live_')
        expect(saved.last_verified_at).toBeNull()
      })

      it('activates a live key on a live account', async () => {
        const saved = await service.upsert(STORE, 'stripe', {
          mode: 'live',
          enabled: true,
          credentials: {
            publishable_key: 'pk_live_good',
            secret_key: 'sk_live_good',
          },
        })

        expect(saved.status).toBe('active')
      })
    })

    describe('Tap', () => {
      const live = {
        secret_key: 'sk_live_good_tap',
        merchant_id: '599424',
        redirect_url: 'https://store.example/checkout/return',
        post_url: 'https://api.example/payments/webhooks/tap/1',
      }

      it('activates only after real credential validation succeeds', async () => {
        const saved = await service.upsert(STORE, 'tap', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        expect(saved.status).toBe('active')
        expect(saved.last_verified_at).not.toBeNull()
        expect(saved.last_error).toBeNull()
      })

      it('does not activate when Tap rejects the secret key', async () => {
        const saved = await service.upsert(STORE, 'tap', {
          mode: 'test',
          enabled: true,
          credentials: { ...live, secret_key: REJECTED_TAP_KEY },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toBeTruthy()
        expect(saved.last_verified_at).toBeNull()
        expect(saved.is_configured).toBe(true)
      })

      it('does not activate a test key saved against a live account', async () => {
        const saved = await service.upsert(STORE, 'tap', {
          mode: 'live',
          enabled: true,
          credentials: { ...live, secret_key: 'sk_test_good' },
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('sk_live_')
      })

      it('requires the redirect URL before calling out', async () => {
        // `redirect` is a required field of Create a Charge, so an
        // account without one could never take a payment.
        const { redirect_url, ...withoutRedirect } = live

        const saved = await service.upsert(STORE, 'tap', {
          mode: 'live',
          enabled: true,
          credentials: withoutRedirect,
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('redirect_url')
      })

      it('requires the webhook URL before calling out', async () => {
        // Tap posts only to the `post.url` a charge request carried;
        // without it no callback ever arrives.
        const { post_url, ...withoutPost } = live

        const saved = await service.upsert(STORE, 'tap', {
          mode: 'live',
          enabled: true,
          credentials: withoutPost,
        })

        expect(saved.status).toBe('errored')
        expect(saved.last_error).toContain('post_url')
      })

      it('treats the merchant id as optional', async () => {
        const { merchant_id, ...withoutMerchant } = live

        const saved = await service.upsert(STORE, 'tap', {
          mode: 'live',
          enabled: true,
          credentials: withoutMerchant,
        })

        expect(saved.status).toBe('active')
      })

      it('never returns a Tap secret in the response', async () => {
        const saved = await service.upsert(STORE, 'tap', {
          mode: 'live',
          enabled: true,
          credentials: live,
        })

        expect(JSON.stringify(saved)).not.toContain(live.secret_key)
        expect(saved.credentials_hint.secret_key).toMatch(/^••••/)
      })
    })
})

/* ------------------------------------------------------------------ */

/**
 * Creates the two stores this spec references by id.
 *
 * payment_accounts holds a foreign key to store, so the rows must exist.
 * The ids are forced rather than captured because the assertions read
 * far more naturally against STORE and OTHER_STORE than against values
 * threaded through every call.
 */
async function seedStores(prisma: PrismaClient): Promise<void> {
  for (const id of [STORE, OTHER_STORE]) {
    const user = await prisma.users.create({
      data: {
        id,
        username: `spec_account_${id}`,
        email: `spec_account_${id}@example.test`,
        password: 'x',
        updated_at: new Date(),
      },
      select: { id: true },
    })

    await prisma.store.create({
      data: {
        id,
        name: `Spec ${id}`,
        slug: `spec-store-${id}`,
        currency: 'USD',
        ownerId: user.id,
        updatedAt: new Date(),
      },
    })
  }
}

import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { EncryptionService } from '../../common/crypto/encryption.service'
import { EnvKeyProvider } from '../../common/crypto/env-key.provider'
import { StoreKeyService } from '../../common/crypto/store-key.service'
import { DecryptionError } from '../../common/crypto/key-provider.interface'
import { IdReservationService } from '../../common/ids/id-reservation.service'
import { PaymentAccountService } from './payment-account.service'
import {
  ALL_TEST_TABLES,
  startTestDatabase,
  stopTestDatabase,
  truncateTables,
} from '../../../test/db-test-harness'

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
    service = new PaymentAccountService(
      prisma as never,
      storeKeys,
      new IdReservationService(prisma as never),
    )
  }, 180_000)

  afterAll(async () => {
    await stopTestDatabase()
  })

  beforeEach(async () => {
    await truncateTables(ALL_TEST_TABLES)
    await seedStores(prisma)
  })

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

      const cod = settings.find((s) => s.key === 'cod')
      expect(cod?.requires_credentials).toBe(false)
      expect(cod?.fields).toHaveLength(0)
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

      const row = await prisma.paymentAccount.findFirstOrThrow({
        where: { store_id: STORE },
      })

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
        await prisma.paymentAccount.findFirstOrThrow({ where: { id: BigInt(a.id) } })
      ).credentials_envelope

      // ننقل نص A المشفّر لصف B — نفس المتجر ونفس المفتاح المشتق،
      // بس الـ AAD مربوط بـ id مختلف، فالفك لازم يفشل
      await prisma.paymentAccount.update({
        where: { id: BigInt(b.id) },
        data: { credentials_envelope: envelopeOfA },
      })

      await expect(
        service.revealCredentialsForGateway(STORE, 'live', BigInt(b.id)),
      ).rejects.toBeInstanceOf(DecryptionError)
    })

    it('binds ciphertext to the mode — test cannot be read as live', async () => {
      const live = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_live_x' },
      })

      await prisma.paymentAccount.update({
        where: { id: BigInt(live.id) },
        data: { mode: 'test' },
      })

      await expect(
        service.revealCredentialsForGateway(STORE, 'test', BigInt(live.id)),
      ).rejects.toBeInstanceOf(DecryptionError)
    })

    it('isolates credentials between stores', async () => {
      const mine = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_mine' },
      })

      // نعمل صف لمتجر تاني وننقل له نفس النص المشفّر
      const theirs = await service.upsert(OTHER_STORE, 'stripe', {
        mode: 'live',
        credentials: { secret_key: 'sk_theirs' },
      })

      const envelopeOfMine = (
        await prisma.paymentAccount.findFirstOrThrow({
          where: { id: BigInt(mine.id) },
        })
      ).credentials_envelope

      await prisma.paymentAccount.update({
        where: { id: BigInt(theirs.id) },
        data: { credentials_envelope: envelopeOfMine },
      })

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

      const row = await prisma.paymentAccount.findFirstOrThrow({
        where: { id: BigInt(saved.id) },
      })

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

      const row = await prisma.paymentAccount.findFirstOrThrow({
        where: { id: BigInt(saved.id) },
      })
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

    it('moves to verifying once credentials are supplied and enabled', async () => {
      const saved = await service.upsert(STORE, 'stripe', {
        mode: 'live',
        enabled: true,
        credentials: { secret_key: 'sk_x' },
      })
      expect(saved.status).toBe('verifying')
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
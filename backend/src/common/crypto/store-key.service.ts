import { Inject, Injectable } from '@nestjs/common'
import * as crypto from 'crypto'

import {
  assertKeyVersion,
  buildAad,
  CIPHER_ALGORITHM,
  DERIVED_KEY_LENGTH,
  DecryptionError,
  ENVELOPE_HEADER_LENGTH,
  ENVELOPE_VERSION,
  EnvelopeScope,
  IV_LENGTH,
  KEY_PROVIDER,
  OFFSET_CIPHERTEXT,
  OFFSET_DERIVED_KEY_VERSION,
  OFFSET_ENVELOPE_VERSION,
  OFFSET_IV,
  OFFSET_KEK_VERSION,
  OFFSET_SCOPE,
  OFFSET_TAG,
  packEnvelopeHeader,
  wipe,
} from './key-provider.interface'

import type {
  EncryptionContext,
  KeyProvider,
} from './key-provider.interface'

export const DEFAULT_DEK_VERSION = 1

export interface StoreEnvelope {
  payload: string
  kekVersion: number
  dekVersion: number
}

@Injectable()
export class StoreKeyService {
  constructor(
    @Inject(KEY_PROVIDER) private readonly keyProvider: KeyProvider,
  ) {}

  async deriveStoreKey(
    storeId: bigint | number | string,
    dekVersion: number = DEFAULT_DEK_VERSION,
    kekVersion?: number,
  ): Promise<Buffer> {
    assertKeyVersion('dek_version', dekVersion)

    const resolvedKekVersion =
      kekVersion ?? (await this.keyProvider.currentKekVersion())

    assertKeyVersion('kek_version', resolvedKekVersion)

    const normalizedStoreId = this.normalizeStoreId(storeId)
    const kek = await this.keyProvider.getKek(resolvedKekVersion)

    try {
      const derived = crypto.hkdfSync(
        'sha256',
        kek,
        Buffer.from(`store:${normalizedStoreId}`, 'utf8'),
        Buffer.from(`dek:v${dekVersion}:kek:v${resolvedKekVersion}`, 'utf8'),
        DERIVED_KEY_LENGTH,
      )

      return Buffer.from(derived)
    } finally {
      wipe(kek)
    }
  }

  async encryptForStore(
    storeId: bigint | number | string,
    plainText: string,
    context: EncryptionContext,
    dekVersion: number = DEFAULT_DEK_VERSION,
  ): Promise<StoreEnvelope> {
    assertKeyVersion('dek_version', dekVersion)

    const normalizedStoreId = this.normalizeStoreId(storeId)

    /** F2 */
    const aad = buildAad(EnvelopeScope.Store, normalizedStoreId, context)

    const kekVersion = await this.keyProvider.currentKekVersion()
    assertKeyVersion('kek_version', kekVersion)

    const dek = await this.deriveStoreKey(
      normalizedStoreId,
      dekVersion,
      kekVersion,
    )

    try {
      const iv = crypto.randomBytes(IV_LENGTH)

      const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, dek, iv)
      cipher.setAAD(aad)

      const encrypted = Buffer.concat([
        cipher.update(plainText, 'utf8'),
        cipher.final(),
      ])
      const authTag = cipher.getAuthTag()

      const header = packEnvelopeHeader({
        envelopeVersion: ENVELOPE_VERSION,
        scope: EnvelopeScope.Store,
        kekVersion,
        derivedKeyVersion: dekVersion,
      })

      return {
        payload: Buffer.concat([header, iv, authTag, encrypted]).toString(
          'base64',
        ),
        kekVersion,
        dekVersion,
      }
    } finally {
      wipe(dek)
    }
  }

  async decryptForStore(
    storeId: bigint | number | string,
    payload: string,
    context: EncryptionContext,
  ): Promise<string> {
    const raw = Buffer.from(payload, 'base64')

    /** F1 */
    if (raw.length < ENVELOPE_HEADER_LENGTH) {
      throw new DecryptionError(
        'malformed',
        'نص مشفّر تالف: الحجم أصغر من الحد الأدنى.',
      )
    }

    const envelopeVersion = raw.readUInt8(OFFSET_ENVELOPE_VERSION)

    if (envelopeVersion !== ENVELOPE_VERSION) {
      throw new DecryptionError(
        'unsupported_version',
        `إصدار envelope غير معروف (${envelopeVersion}). ` +
          `الإصدار المدعوم: ${ENVELOPE_VERSION}.`,
      )
    }

    const scope = raw.readUInt8(OFFSET_SCOPE)

    if (scope !== EnvelopeScope.Store) {
      throw new DecryptionError(
        'malformed',
        `النص ده نطاقه ${scope} مش نطاق متجر. ` +
          `لو نطاقه المنصة استخدم EncryptionService.`,
      )
    }

    const normalizedStoreId = this.normalizeStoreId(storeId)

    /** F2 */
    const aad = buildAad(EnvelopeScope.Store, normalizedStoreId, context)

    const kekVersion = raw.readUInt16BE(OFFSET_KEK_VERSION)
    const dekVersion = raw.readUInt16BE(OFFSET_DERIVED_KEY_VERSION)

    /** F3 */
    const dek = await this.deriveStoreKeyOrThrow(
      normalizedStoreId,
      dekVersion,
      kekVersion,
    )

    try {
      const iv = raw.subarray(OFFSET_IV, OFFSET_TAG)
      const authTag = raw.subarray(OFFSET_TAG, OFFSET_CIPHERTEXT)
      const encrypted = raw.subarray(OFFSET_CIPHERTEXT)

      const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, dek, iv)
      decipher.setAAD(aad)
      decipher.setAuthTag(authTag)

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ])

      return decrypted.toString('utf8')
    } catch {
      throw new DecryptionError(
        'integrity',
        'فشل التحقق من سلامة النص المشفّر. ' +
          'الاحتمالات: متجر غلط، أو سياق مختلف (وضع/صف/حقل)، ' +
          'أو عبث بالبيانات. الحالة دي تستدعي تنبيه أمني.',
      )
    } finally {
      wipe(dek)
    }
  }

  async encryptJsonForStore(
    storeId: bigint | number | string,
    obj: Record<string, any>,
    context: EncryptionContext,
    dekVersion: number = DEFAULT_DEK_VERSION,
  ): Promise<StoreEnvelope> {
    return this.encryptForStore(
      storeId,
      JSON.stringify(obj),
      context,
      dekVersion,
    )
  }

  async decryptJsonForStore<T = Record<string, any>>(
    storeId: bigint | number | string,
    payload: string | null | undefined,
    context: EncryptionContext,
  ): Promise<T | null> {
    if (!payload) return null

    return JSON.parse(
      await this.decryptForStore(storeId, payload, context),
    ) as T
  }

  readEnvelopeHeader(payload: string): {
    envelopeVersion: number
    scope: number
    kekVersion: number
    dekVersion: number
  } {
    const raw = Buffer.from(payload, 'base64')

    /** F1 */
    if (raw.length < ENVELOPE_HEADER_LENGTH) {
      throw new DecryptionError(
        'malformed',
        'نص مشفّر تالف: الحجم أصغر من الحد الأدنى.',
      )
    }

    return {
      envelopeVersion: raw.readUInt8(OFFSET_ENVELOPE_VERSION),
      scope: raw.readUInt8(OFFSET_SCOPE),
      kekVersion: raw.readUInt16BE(OFFSET_KEK_VERSION),
      dekVersion: raw.readUInt16BE(OFFSET_DERIVED_KEY_VERSION),
    }
  }

  private async deriveStoreKeyOrThrow(
    storeId: string,
    dekVersion: number,
    kekVersion: number,
  ): Promise<Buffer> {
    try {
      return await this.deriveStoreKey(storeId, dekVersion, kekVersion)
    } catch (error) {
      throw new DecryptionError('key_unavailable', (error as Error).message)
    }
  }

  private normalizeStoreId(storeId: bigint | number | string): string {
    if (typeof storeId === 'bigint') {
      return this.assertNonNegative(storeId)
    }

    if (typeof storeId === 'number') {
      if (!Number.isSafeInteger(storeId)) {
        throw new Error(
          `store_id لازم يكون عدد صحيح آمن (استلمنا: ${storeId}).`,
        )
      }
      return this.assertNonNegative(BigInt(storeId))
    }

    const trimmed = String(storeId).trim()

    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `store_id لازم يكون رقم صحيح موجب (استلمنا: "${storeId}").`,
      )
    }

    return this.assertNonNegative(BigInt(trimmed))
  }

  private assertNonNegative(value: bigint): string {
    if (value < 0n) {
      throw new Error(`store_id ماينفعش يكون سالب (استلمنا: ${value}).`)
    }

    return value.toString()
  }
}

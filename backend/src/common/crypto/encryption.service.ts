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

export const PLATFORM_KEY_VERSION = 1

@Injectable()
export class EncryptionService {
  constructor(
    @Inject(KEY_PROVIDER) private readonly keyProvider: KeyProvider,
  ) {}

  async encrypt(
    plainText: string,
    context: EncryptionContext,
  ): Promise<string> {
    /** F2: AAD built before the try — context errors are bugs, not incidents */
    const aad = buildAad(EnvelopeScope.Platform, null, context)

    const kekVersion = await this.keyProvider.currentKekVersion()
    assertKeyVersion('kek_version', kekVersion)

    const platformKey = await this.derivePlatformKey(
      kekVersion,
      PLATFORM_KEY_VERSION,
    )

    try {
      const iv = crypto.randomBytes(IV_LENGTH)

      const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, platformKey, iv)
      cipher.setAAD(aad)

      const encrypted = Buffer.concat([
        cipher.update(plainText, 'utf8'),
        cipher.final(),
      ])
      const authTag = cipher.getAuthTag()

      const header = packEnvelopeHeader({
        envelopeVersion: ENVELOPE_VERSION,
        scope: EnvelopeScope.Platform,
        kekVersion,
        derivedKeyVersion: PLATFORM_KEY_VERSION,
      })

      return Buffer.concat([header, iv, authTag, encrypted]).toString('base64')
    } finally {
      wipe(platformKey)
    }
  }

  async decrypt(payload: string, context: EncryptionContext): Promise<string> {
    const raw = Buffer.from(payload, 'base64')

    /** F1: strictly less-than — GCM ciphertext length == plaintext length */
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

    if (scope !== EnvelopeScope.Platform) {
      throw new DecryptionError(
        'malformed',
        `النص ده نطاقه ${scope} مش نطاق المنصة. ` +
          `لو نطاقه متجر استخدم StoreKeyService.`,
      )
    }

    /** F2 */
    const aad = buildAad(EnvelopeScope.Platform, null, context)

    const kekVersion = raw.readUInt16BE(OFFSET_KEK_VERSION)
    const derivedKeyVersion = raw.readUInt16BE(OFFSET_DERIVED_KEY_VERSION)

    /** F3: const, not let — no definite-assignment ambiguity */
    const platformKey = await this.derivePlatformKeyOrThrow(
      kekVersion,
      derivedKeyVersion,
    )

    try {
      const iv = raw.subarray(OFFSET_IV, OFFSET_TAG)
      const authTag = raw.subarray(OFFSET_TAG, OFFSET_CIPHERTEXT)
      const encrypted = raw.subarray(OFFSET_CIPHERTEXT)

      const decipher = crypto.createDecipheriv(
        CIPHER_ALGORITHM,
        platformKey,
        iv,
      )
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
          'الاحتمالات: عبث بالبيانات، أو نقل النص لصف/وضع تاني، أو مفتاح غلط. ' +
          'الحالة دي تستدعي تنبيه أمني.',
      )
    } finally {
      wipe(platformKey)
    }
  }

  async encryptJson(
    obj: Record<string, any>,
    context: EncryptionContext,
  ): Promise<string> {
    return this.encrypt(JSON.stringify(obj), context)
  }

  async decryptJson<T = Record<string, any>>(
    payload: string | null | undefined,
    context: EncryptionContext,
  ): Promise<T | null> {
    if (!payload) return null

    return JSON.parse(await this.decrypt(payload, context)) as T
  }

  private async derivePlatformKeyOrThrow(
    kekVersion: number,
    platformKeyVersion: number,
  ): Promise<Buffer> {
    try {
      return await this.derivePlatformKey(kekVersion, platformKeyVersion)
    } catch (error) {
      throw new DecryptionError('key_unavailable', (error as Error).message)
    }
  }

  private async derivePlatformKey(
    kekVersion: number,
    platformKeyVersion: number,
  ): Promise<Buffer> {
    assertKeyVersion('platform_key_version', platformKeyVersion)

    const kek = await this.keyProvider.getKek(kekVersion)

    try {
      const derived = crypto.hkdfSync(
        'sha256',
        kek,
        Buffer.from('platform', 'utf8'),
        Buffer.from(`platform:v${platformKeyVersion}`, 'utf8'),
        DERIVED_KEY_LENGTH,
      )

      return Buffer.from(derived)
    } finally {
      wipe(kek)
    }
  }
}

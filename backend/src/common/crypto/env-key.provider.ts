import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PaymentsConfig } from '../config/configuration'
import {
  assertKeyVersion,
  computeKeyCheckValue,
  KEK_LENGTH_BYTES,
  KeyProvider,
} from './key-provider.interface'

@Injectable()
export class EnvKeyProvider implements KeyProvider, OnModuleInit {
  private readonly logger = new Logger(EnvKeyProvider.name)

  private readonly keys = new Map<number, Buffer>()
  private current: number | null = null

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const payments = this.config.getOrThrow<PaymentsConfig>('payments')

    assertKeyVersion(
      'PAYMENT_ENCRYPTION_KEY_VERSION',
      payments.encryptionKeyVersion,
    )

    this.registerKey(
      payments.encryptionKeyVersion,
      payments.encryptionKey,
      'PAYMENT_ENCRYPTION_KEY',
    )

    this.current = payments.encryptionKeyVersion

    if (
      payments.previousEncryptionKey &&
      payments.previousEncryptionKeyVersion
    ) {
      assertKeyVersion(
        'PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION',
        payments.previousEncryptionKeyVersion,
      )

      this.registerKey(
        payments.previousEncryptionKeyVersion,
        payments.previousEncryptionKey,
        'PAYMENT_ENCRYPTION_KEY_PREVIOUS',
      )
    }

    for (const version of this.sortedVersions()) {
      const kcv = computeKeyCheckValue(this.keys.get(version) as Buffer)
      const marker = version === this.current ? 'current' : 'retired'
      this.logger.log(`🔑 KEK v${version} [${marker}] KCV=${kcv}`)
    }
  }

  async currentKekVersion(): Promise<number> {
    if (this.current === null) {
      throw new Error(
        'EnvKeyProvider لسه ماتهيّأش. تأكد إن CryptoModule متسجل في ' +
          'الـ module tree وإن onModuleInit اشتغلت.',
      )
    }

    return this.current
  }

  async getKek(version: number): Promise<Buffer> {
    const key = this.keys.get(version)

    if (!key) {
      throw new Error(
        `مفتاح التشفير نسخة ${version} مش متاح في البيئة الحالية. ` +
          `في نص مشفّر بالنسخة دي محتاج المفتاح بتاعها. ` +
          `النسخ المتاحة: [${this.sortedVersions().join(', ')}]. ` +
          `ظبّط PAYMENT_ENCRYPTION_KEY_PREVIOUS و ` +
          `PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION=${version}`,
      )
    }

    return Buffer.from(key)
  }

  async availableVersions(): Promise<number[]> {
    return this.sortedVersions()
  }

  async keyCheckValue(version: number): Promise<string> {
    const key = await this.getKek(version)

    try {
      return computeKeyCheckValue(key)
    } finally {
      key.fill(0)
    }
  }

  private registerKey(version: number, raw: string, name: string): void {
    if (this.keys.has(version)) {
      throw new Error(
        `نسخة المفتاح ${version} متسجّلة أكتر من مرة (${name}). ` +
          `كل نسخة لازم تكون فريدة.`,
      )
    }

    const decoded = Buffer.from(raw, 'base64')

    if (decoded.length !== KEK_LENGTH_BYTES) {
      throw new Error(
        `${name} لازم يكون ${KEK_LENGTH_BYTES} byte بعد فك الـ base64 ` +
          `(الناتج الحالي ${decoded.length} byte). ` +
          `ولّده بالأمر: openssl rand -base64 32`,
      )
    }

    this.keys.set(version, decoded)
  }

  private sortedVersions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b)
  }
}

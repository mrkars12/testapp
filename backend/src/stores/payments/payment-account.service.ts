import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  CaptureMode,
  CommitmentKind,
  Mode,
  PaymentAccountStatus,
  PaymentMethodKey,
  PaymentProviderKey,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { crossModeQuery } from '../../common/tenant/cross-mode-query';
import { StoreKeyService } from '../../common/crypto/store-key.service';
import { DecryptionError } from '../../common/crypto/key-provider.interface';
import type {
  CryptoMode,
  EncryptionContext,
} from '../../common/crypto/key-provider.interface';
import {
  IdReservationService,
  PAYMENT_ACCOUNTS_TABLE,
} from '../../common/ids/id-reservation.service';
import {
  allowedCredentialKeys,
  allowedMethods,
  findGateway,
  listGateways,
} from './gateway-catalog';
import type {
  OfferingInputDto,
  UpsertPaymentAccountDto,
} from './dto/upsert-payment-account.dto';

/**
 * ══════════════════════════════════════════════════════════════════
 * حسابات الدفع
 * ══════════════════════════════════════════════════════════════════
 *
 * أول مستهلك حقيقي لأساس التشفير المجمّد وخدمة حجز المعرّفات.
 *
 * ثلاث قواعد بتحكم الملف ده:
 *
 *  1. **بيانات الاعتماد مابترجعش أبداً.** ولا endpoint واحد بيفك
 *     تشفيرها ويرجّعها. الواجهة بتاخد تلميح مقنّع (آخر 4 حروف)
 *     و is_configured بس. فك التشفير هيبقى للأدابترز في 1b.2 وبعدها.
 *
 *  2. **المعرّف بيتحجز قبل التشفير.** الـ AAD المجمّد بيربط النص
 *     المشفّر بـ id الصف، فالـ id لازم يبقى معروف قبل ما نشفّر —
 *     مش بعد الإدراج.
 *
 *  3. **الحقل الفاضي معناه "ماتغيّرش".** التاجر ممكن يعدّل اسم الحساب
 *     من غير ما يعيد كتابة مفاتيحه. المسح ليه endpoint لوحده.
 */

/** نوع الصف في الـ AAD — ثابت مدى الحياة، ممنوع يتغيّر */
const RECORD_TYPE = 'payment_account';

/** اسم الحقل في الـ AAD */
const CREDENTIALS_FIELD = 'credentials';

const DEFAULT_DISPLAY_NAME = 'Default';

@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeKeys: StoreKeyService,
    private readonly ids: IdReservationService,
  ) {}

  /**
   * كل البوابات المدعومة + إعداد المتجر لكل واحدة.
   *
   * الرد ده هو اللي الواجهة بتبني منه الفورم كله.
   */
  async listSettings(storeId: bigint) {
    const accounts = await crossModeQuery(
      'merchant_dual_mode_view',
      'settings screen lists both live and test accounts for one store',
      () =>
        this.prisma.guarded().paymentAccount.findMany({
          where: { store_id: storeId },
          include: { offerings: { orderBy: { position: 'asc' } } },
          orderBy: [{ gateway: 'asc' }, { display_name: 'asc' }],
        }),
    );

    return listGateways().map((gateway) => {
      const configured = accounts.filter((a) => a.gateway === gateway.key);

      return {
        key: gateway.key,
        name_ar: gateway.name_ar,
        name_en: gateway.name_en,
        requires_credentials: gateway.requires_credentials,
        supports_test_mode: gateway.supports_test_mode,
        supports_multiple_integrations: gateway.supports_multiple_integrations,
        methods: gateway.methods,
        fields: gateway.credential_fields,
        accounts: configured.map((account) => this.toPublicAccount(account)),
      };
    });
  }

  /**
   * ينشئ أو يعدّل حساب بوابة.
   *
   * التدفق لما يكون في بيانات اعتماد جديدة على حساب جديد:
   *   1. احجز id من الـ sequence
   *   2. ابنِ الـ AAD بالـ id ده
   *   3. شفّر
   *   4. اعمل الصف بالـ id الصريح
   */
  async upsert(
    storeId: bigint,
    gatewayKey: string,
    dto: UpsertPaymentAccountDto,
  ) {
    const gateway = findGateway(gatewayKey);

    if (!gateway) {
      throw new NotFoundException(`بوابة غير مدعومة: "${gatewayKey}".`);
    }

    if (dto.mode === 'test' && !gateway.supports_test_mode) {
      throw new BadRequestException(`${gateway.name_ar} مالهاش وضع اختبار.`);
    }

    const displayName = (dto.display_name ?? DEFAULT_DISPLAY_NAME).trim();

    if (displayName.length === 0) {
      throw new BadRequestException('اسم الحساب ماينفعش يكون فاضي.');
    }

    const credentials = this.sanitizeCredentials(gatewayKey, dto.credentials);
    const offerings = this.sanitizeOfferings(gatewayKey, dto.offerings);

    const existing = await this.prisma.guarded().paymentAccount.findFirst({
      where: {
        store_id: storeId,
        mode: dto.mode,
        gateway: gatewayKey as PaymentProviderKey,
        display_name: displayName,
      },
    });

    const accountId = existing
      ? existing.id
      : await this.ids.reserve(PAYMENT_ACCOUNTS_TABLE);

    const context: EncryptionContext = {
      mode: dto.mode as CryptoMode,
      recordType: RECORD_TYPE,
      recordId: accountId.toString(),
      field: CREDENTIALS_FIELD,
    };

    // دمج بيانات الاعتماد: الحقل اللي مابعتش يفضل زي ما هو
    const credentialUpdate = await this.buildCredentialUpdate(
      storeId,
      existing,
      credentials,
      context,
    );

    const status = this.resolveStatus(
      gateway.requires_credentials,
      credentialUpdate.hasCredentialsAfter,
      dto.enabled,
      existing?.status,
    );

    const data = {
      store_id: storeId,
      mode: dto.mode as Mode,
      gateway: gatewayKey as PaymentProviderKey,
      display_name: displayName,
      settlement_currency: dto.settlement_currency?.toUpperCase() ?? null,
      status,
      ...credentialUpdate.fields,
    };

    const account = await this.prisma.guarded().$transaction(async (tx) => {
      const saved = existing
        ? await tx.paymentAccount.update({
            where: {
              id: existing.id,
              store_id: storeId,
              mode: dto.mode,
            },
            data,
          })
        : await tx.paymentAccount.create({
            data: {
              id: accountId,
              ...data,
            },
          });

      if (offerings) {
        await this.replaceOfferings(
          tx as unknown as Prisma.TransactionClient,
          saved.id,
          storeId,
          dto.mode,
          offerings,
        );
      }

      return tx.paymentAccount.findFirstOrThrow({
        where: {
          id: saved.id,
          store_id: storeId,
          mode: dto.mode,
        },
        include: {
          offerings: {
            orderBy: { position: 'asc' },
          },
        },
      });
    });

    this.logger.log(
      `حساب دفع اتحفظ: متجر ${storeId} / ${gatewayKey} / ${dto.mode} / ${displayName}` +
        (credentialUpdate.credentialsChanged ? ' (بيانات اعتماد اتحدّثت)' : ''),
    );

    return this.toPublicAccount(account);
  }

  /**
   * يمسح بيانات الاعتماد ويوقف الحساب.
   *
   * المسح عملية منفصلة عن التعديل عن قصد — عشان التاجر مايمسحش سر
   * بالغلط وهو بيغيّر اسم الحساب.
   */
  async clearCredentials(
    storeId: bigint,
    gatewayKey: string,
    mode: 'test' | 'live',
    displayName = DEFAULT_DISPLAY_NAME,
  ) {
    const account = await this.prisma.guarded().paymentAccount.findFirst({
      where: {
        store_id: storeId,
        mode: mode as Mode,
        gateway: gatewayKey as PaymentProviderKey,
        display_name: displayName,
      },
    });

    if (!account) {
      throw new NotFoundException('الحساب مش موجود.');
    }

    const updated = await this.prisma.guarded().paymentAccount.update({
      where: { id: account.id, store_id: account.store_id, mode: account.mode },
      data: {
        credentials_envelope: null,
        credential_kek_version: null,
        credential_dek_version: null,
        credentials_fingerprint: null,
        credentials_hint: Prisma.DbNull,
        status: 'draft',
        last_verified_at: null,
        last_error: null,
      },
      include: { offerings: { orderBy: { position: 'asc' } } },
    });

    this.logger.warn(
      `بيانات اعتماد اتمسحت: متجر ${storeId} / ${gatewayKey} / ${mode} / ${displayName}`,
    );

    return this.toPublicAccount(updated);
  }

  /**
   * يفك تشفير بيانات الاعتماد **للاستخدام الداخلي بس**.
   *
   * ⚠️ ممنوع منعاً باتاً إن الناتج ده يرجع في أي رد API. الدالة دي
   * موجودة عشان الأدابترز في المرحلة 1b.2 وبعدها، مش عشان الواجهة.
   *
   * فشل السلامة بيترمي DecryptionError — مش بيرجع null — عشان العبث
   * مايتخفيش ورا "مفيش بيانات".
   */
  async revealCredentialsForGateway(
    storeId: bigint,
    mode: Mode,
    accountId: bigint,
  ): Promise<Record<string, string>> {
    const account = await this.prisma
      .guarded()
      .paymentAccount.findFirstOrThrow({
        where: { id: accountId, store_id: storeId, mode },
      });

    if (!account.credentials_envelope) {
      return {};
    }

    const context: EncryptionContext = {
      mode: account.mode as CryptoMode,
      recordType: RECORD_TYPE,
      recordId: account.id.toString(),
      field: CREDENTIALS_FIELD,
    };

    try {
      const decrypted = await this.storeKeys.decryptJsonForStore<
        Record<string, string>
      >(storeId, account.credentials_envelope, context);

      return decrypted ?? {};
    } catch (error) {
      if (error instanceof DecryptionError && error.isSecurityRelevant) {
        // نقل الصف، أو تغيير الوضع، أو عبث بالبيانات
        this.logger.error(
          `[security] فشل التحقق من سلامة بيانات اعتماد الحساب ${accountId} ` +
            `(متجر ${storeId}): ${error.message}`,
        );
      }
      throw error;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     داخلي
     ═══════════════════════════════════════════════════════════════ */

  /**
   * يبني حقول بيانات الاعتماد للحفظ.
   *
   * الدمج بيحصل على النص المفكوك مؤقتاً في الذاكرة عشان الحقل اللي
   * التاجر مابعتوش يفضل زي ما هو. النتيجة بتتشفّر تاني كاملة.
   */
  private async buildCredentialUpdate(
    storeId: bigint,
    existing: { id: bigint; credentials_envelope: string | null } | null,
    incoming: Record<string, string> | null,
    context: EncryptionContext,
  ): Promise<{
    fields: Record<string, unknown>;
    credentialsChanged: boolean;
    hasCredentialsAfter: boolean;
  }> {
    const alreadyHas = Boolean(existing?.credentials_envelope);

    if (!incoming || Object.keys(incoming).length === 0) {
      // مفيش حاجة جديدة — سيب اللي متخزّن زي ما هو
      return {
        fields: {},
        credentialsChanged: false,
        hasCredentialsAfter: alreadyHas,
      };
    }

    let merged: Record<string, string> = {};

    if (existing?.credentials_envelope) {
      const current = await this.storeKeys.decryptJsonForStore<
        Record<string, string>
      >(storeId, existing.credentials_envelope, context);
      merged = { ...(current ?? {}) };
    }

    merged = { ...merged, ...incoming };

    const envelope = await this.storeKeys.encryptJsonForStore(
      storeId,
      merged,
      context,
    );

    return {
      fields: {
        credentials_envelope: envelope.payload,
        credential_kek_version: envelope.kekVersion,
        credential_dek_version: envelope.dekVersion,
        credentials_fingerprint: await this.fingerprint(storeId, merged),
        credentials_hint: this.buildHint(merged) as Prisma.InputJsonValue,
      },
      credentialsChanged: true,
      hasCredentialsAfter: true,
    };
  }

  /**
   * بصمة بيانات الاعتماد.
   *
   * HMAC بمفتاح المتجر المشتق مش hash عادي: hash عادي لسر قصير
   * (زي كود تاجر) قابل للتخمين بالقوة الغاشمة.
   */
  private async fingerprint(
    storeId: bigint,
    credentials: Record<string, string>,
  ): Promise<string> {
    const key = await this.storeKeys.deriveStoreKey(storeId);

    try {
      const canonical = Object.keys(credentials)
        .sort()
        .map((k) => `${k}=${credentials[k]}`)
        .join('\n');

      return createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
    } finally {
      key.fill(0);
    }
  }

  /** آخر 4 حروف من كل حقل — للعرض بس، مفيش أسرار كاملة */
  private buildHint(
    credentials: Record<string, string>,
  ): Record<string, string> {
    const hint: Record<string, string> = {};

    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== 'string' || value.length === 0) continue;
      hint[key] = value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
    }

    return hint;
  }

  /** بيرفض أي مفتاح مش موجود في كتالوج البوابة */
  private sanitizeCredentials(
    gatewayKey: string,
    incoming: Record<string, string> | undefined,
  ): Record<string, string> | null {
    if (!incoming) return null;

    const allowed = new Set(allowedCredentialKeys(gatewayKey));
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(incoming)) {
      if (!allowed.has(key)) {
        throw new BadRequestException(
          `حقل غير معروف لبوابة ${gatewayKey}: "${key}".`,
        );
      }

      if (typeof value !== 'string') {
        throw new BadRequestException(`قيمة الحقل "${key}" لازم تكون نص.`);
      }

      // نص فاضي = ماتغيّرش، مش امسح
      if (value.trim().length === 0) continue;

      result[key] = value.trim();
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  private sanitizeOfferings(
    gatewayKey: string,
    incoming: OfferingInputDto[] | undefined,
  ): OfferingInputDto[] | null {
    if (!incoming) return null;

    const allowed = new Set(allowedMethods(gatewayKey));
    const seen = new Set<string>();

    for (const offering of incoming) {
      if (!allowed.has(offering.method)) {
        throw new BadRequestException(
          `وسيلة "${offering.method}" مش متاحة لبوابة ${gatewayKey}.`,
        );
      }

      const key = `${offering.method}:${offering.gateway_method_config ?? ''}`;

      if (seen.has(key)) {
        throw new BadRequestException(
          `وسيلة مكرّرة: "${offering.method}" بنفس إعداد التكامل.`,
        );
      }

      seen.add(key);
    }

    return incoming;
  }

  /**
   * يستبدل وسائل الدفع للحساب.
   *
   * حذف وإعادة إنشاء داخل نفس الـ transaction: الوسائل إعدادات
   * بسيطة مالهاش حالة، ومحدش بيشير ليها في 1b.1.
   */
  private async replaceOfferings(
    tx: Prisma.TransactionClient,
    accountId: bigint,
    storeId: bigint,
    mode: 'test' | 'live',
    offerings: OfferingInputDto[],
  ): Promise<void> {
    await tx.paymentMethodOffering.deleteMany({
      where: {
        account_id: accountId,
        store_id: storeId,
        mode: mode as Mode,
      },
    });

    if (offerings.length === 0) return;

    await tx.paymentMethodOffering.createMany({
      data: offerings.map((offering, index) => ({
        account_id: accountId,
        store_id: storeId,
        mode: mode as Mode,
        method: offering.method as PaymentMethodKey,
        gateway_method_config: offering.gateway_method_config ?? '',
        enabled: offering.enabled ?? false,
        position: offering.position ?? index,
        display_name_ar: offering.display_name_ar ?? null,
        display_name_en: offering.display_name_en ?? null,
        constraints: offering.constraints
          ? (offering.constraints as Prisma.InputJsonValue)
          : Prisma.DbNull,
        commitment_kind: (offering.commitment_kind ??
          'funds_secured') as CommitmentKind,
        capture_mode: (offering.capture_mode ?? 'automatic') as CaptureMode,
      })),
    });
  }

  private resolveStatus(
    requiresCredentials: boolean,
    hasCredentials: boolean,
    enabled: boolean | undefined,
    currentStatus: PaymentAccountStatus | undefined,
  ): PaymentAccountStatus {
    if (enabled === false) return 'disabled';

    // البوابات اليدوية (الدفع عند الاستلام / التحويل البنكي) مالهاش
    // بيانات اعتماد أصلاً، فبتبقى شغّالة بمجرد ما التاجر يفعّلها
    if (!requiresCredentials) {
      return enabled ? 'active' : (currentStatus ?? 'draft');
    }

    if (!hasCredentials) return 'draft';

    // في المرحلة 1b.1 مفيش أدابتر يقدر يتحقق من المفاتيح فعلاً،
    // فالحساب بيفضل verifying لحد ما أول أدابتر يوصل.
    return enabled ? 'verifying' : 'draft';
  }

  /**
   * الشكل اللي بيرجع في الـ API.
   *
   * ⚠️ لاحظ إن credentials_envelope مش هنا ولا هيبقى هنا أبداً.
   */
  private toPublicAccount(account: {
    id: bigint;
    mode: string;
    gateway: string;
    display_name: string;
    status: string;
    settlement_currency: string | null;
    credentials_envelope: string | null;
    credentials_hint: unknown;
    last_verified_at: Date | null;
    last_error: string | null;
    created_at: Date;
    updated_at: Date;
    offerings?: {
      id: bigint;
      method: string;
      gateway_method_config: string;
      enabled: boolean;
      position: number;
      display_name_ar: string | null;
      display_name_en: string | null;
      constraints: unknown;
      commitment_kind: string;
      capture_mode: string;
    }[];
  }) {
    return {
      id: account.id.toString(),
      mode: account.mode,
      gateway: account.gateway,
      display_name: account.display_name,
      status: account.status,
      settlement_currency: account.settlement_currency,
      is_configured: Boolean(account.credentials_envelope),
      credentials_hint: (account.credentials_hint ?? {}) as Record<
        string,
        string
      >,
      last_verified_at: account.last_verified_at,
      last_error: account.last_error,
      created_at: account.created_at,
      updated_at: account.updated_at,
      offerings: (account.offerings ?? []).map((offering) => ({
        id: offering.id.toString(),
        method: offering.method,
        gateway_method_config: offering.gateway_method_config,
        enabled: offering.enabled,
        position: offering.position,
        display_name_ar: offering.display_name_ar,
        display_name_en: offering.display_name_en,
        constraints: offering.constraints ?? null,
        commitment_kind: offering.commitment_kind,
        capture_mode: offering.capture_mode,
      })),
    };
  }
}

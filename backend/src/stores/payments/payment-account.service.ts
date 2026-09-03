import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
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
import type { GatewayDefinition } from './gateway-catalog';
import { ProviderRegistry } from './gateways/provider-registry.service';
import { webhookSecretField } from './gateways/provider.types';
import { CredentialValidationPipeline } from './gateways/credential-validation.service';
import type { CredentialValidationOutcome } from './gateways/credential-validation.service';
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
    private readonly providers: ProviderRegistry,
    private readonly credentialValidation: CredentialValidationPipeline,
  ) {}

  /**
   * كل البوابات المدعومة + إعداد المتجر لكل واحدة.
   *
   * الرد ده هو اللي الواجهة بتبني منه الفورم كله.
   */
  async listSettings(storeId: bigint) {
    // Dual-mode view must satisfy RLS: mode = current_setting('app.mode')
    // A single LOCAL value cannot match both live and test, so fetch
    // per-mode via withTenantTransaction (sets app.store_id + app.mode
    // LOCAL on same tx) and merge before mapping. Keeps crossModeQuery
    // file unchanged, but does not use it here (guard-only, no RLS).
    const [liveAccounts, testAccounts] = await Promise.all([
      this.prisma.withTenantTransaction(storeId, 'live', (tx) =>
        tx.paymentAccount.findMany({
          where: { store_id: storeId, mode: 'live' as Mode },
          include: { offerings: { orderBy: { position: 'asc' } } },
          orderBy: [{ gateway: 'asc' }, { display_name: 'asc' }],
        }),
      ),
      this.prisma.withTenantTransaction(storeId, 'test', (tx) =>
        tx.paymentAccount.findMany({
          where: { store_id: storeId, mode: 'test' as Mode },
          include: { offerings: { orderBy: { position: 'asc' } } },
          orderBy: [{ gateway: 'asc' }, { display_name: 'asc' }],
        }),
      ),
    ]);
    const accounts = [...liveAccounts, ...testAccounts];
    const webhookByAccount = await this.latestWebhookStatusByAccount(
      accounts.map((a) => a.id),
    );

    return listGateways().map((gateway) => {
      const configured = accounts.filter((a) => a.gateway === gateway.key);
      const hasAdapter = this.providers.has(gateway.key);
      const capabilities = hasAdapter ? this.providers.capabilities(gateway.key) : null;

      return {
        key: gateway.key,
        name_ar: gateway.name_ar,
        name_en: gateway.name_en,
        requires_credentials: gateway.requires_credentials,
        supports_test_mode: gateway.supports_test_mode,
        supports_multiple_integrations: gateway.supports_multiple_integrations,
        methods: gateway.methods,
        fields: gateway.credential_fields,
        webhook_events: gateway.webhook_events ?? [],
        webhook_setup_help_ar: gateway.webhook_setup_help_ar ?? null,
        // مشتقّة من الـ registry وقت التشغيل، مش من الكتالوج — بتعكس
        // فعلياً هل فيه أدابتر شغّال ورا البوابة دي ولا لسه كتالوج بس.
        has_adapter: hasAdapter,
        test_payment_supported: gateway.supports_test_mode && hasAdapter,
        webhook_secret_field:
          capabilities && capabilities.webhooks ? webhookSecretField(capabilities) : null,
        // Moyasar-only today (see gateway-catalog.ts) — data-driven, not a
        // gateway.key check, so any future gateway can opt in the same way.
        supports_generated_webhook_secret: Boolean(gateway.supports_generated_webhook_secret),
        accounts: configured.map((account) =>
          this.toPublicAccount(
            account,
            this.webhookStatusFor(account, webhookByAccount.get(account.id.toString())),
          ),
        ),
      };
    });
  }

  /**
   * "تحقّق من الويبهوك" — إعادة قراءة صريحة لحالة الحساب بناءً على آخر
   * WebhookEvent وصل فعلاً. مفيش استدعاء وهمي للمزوّد هنا؛ التحقق
   * الحقيقي الوحيد هو نداء وصل واتحقق توقيعه، وده بيحصل بس لما التاجر
   * يهيّئ الـ webhook عند المزوّد فعلاً ويوصل نداء حقيقي (أو تجريبي من
   * لوحة المزوّد نفسها).
   */
  async webhookStatus(storeId: bigint, gatewayKey: string, mode: 'test' | 'live') {
    const account = await this.prisma.withTenantTransaction(storeId, mode, (tx) =>
      tx.paymentAccount.findFirst({
        where: { store_id: storeId, mode: mode as Mode, gateway: gatewayKey as PaymentProviderKey },
        orderBy: { display_name: 'asc' },
      }),
    );

    if (!account) {
      throw new NotFoundException(`مفيش حساب "${gatewayKey}" في وضع ${mode} للمتجر ده.`);
    }

    const latest = await this.latestWebhookStatusByAccount([account.id]);
    return this.webhookStatusFor(account, latest.get(account.id.toString()));
  }

  /**
   * "إنشاء Secret Token" — يولّد سر webhook قوي على السيرفر بدل ما
   * يتوقّع من التاجر يخترعه بنفسه، ويخزّنه في نفس envelope الاعتماد
   * المشفّر (مفيش تخزين تاني منفصل). مقتصر على البوابات اللي بتعلن
   * `supports_generated_webhook_secret` في الكتالوج — ميسر بس دلوقتي؛
   * Stripe/Paymob/Tap ليهم موديل أمان تاني ومحتاجوش الزر ده أصلاً.
   *
   * لازم يبقى فيه حساب محفوظ (بيانات اعتماد اتحفظت) قبل ما نولّد —
   * السر بيتضاف على الاعتماد الموجود، مش بيبتدئ حساب من الصفر. النص
   * الصريح بيترجع مرة واحدة بس في رد الاستدعاء ده؛ أي قراءة تانية
   * (listSettings/webhookStatus) بترجّع تلميح مقنّع بس زي أي حقل تاني.
   */
  async generateWebhookSecret(
    storeId: bigint,
    gatewayKey: string,
    mode: 'test' | 'live',
    displayName = DEFAULT_DISPLAY_NAME,
  ) {
    const gateway = findGateway(gatewayKey);

    if (!gateway) {
      throw new NotFoundException(`بوابة غير مدعومة: "${gatewayKey}".`);
    }

    if (!gateway.supports_generated_webhook_secret) {
      throw new BadRequestException(
        `${gateway.name_ar} مالهاش توليد Secret Token من السيرفر.`,
      );
    }

    if (!this.providers.has(gatewayKey)) {
      throw new BadRequestException(
        `${gateway.name_ar} مش متاحة لسه (لا يوجد أدابتر مسجّل لها).`,
      );
    }

    const existing = await this.prisma.withTenantTransaction(storeId, mode, (tx) =>
      tx.paymentAccount.findFirst({
        where: {
          store_id: storeId,
          mode: mode as Mode,
          gateway: gatewayKey as PaymentProviderKey,
          display_name: displayName,
        },
      }),
    );

    // The webhook URL and this token both hang off a real account.id —
    // there is nothing to attach a generated secret to until credentials
    // have been saved at least once (see WebhookPanel.tsx's placeholder).
    if (!existing || !existing.credentials_envelope) {
      throw new BadRequestException('احفظ بيانات الاعتماد أولًا.');
    }

    const capabilities = this.providers.capabilities(gatewayKey);
    const field = webhookSecretField(capabilities);

    // 256 bits of CSPRNG entropy, base64url so it drops cleanly into a
    // form field and a URL-unsafe-character-free copy/paste — never
    // Math.random(), never generated in the browser.
    const token = randomBytes(32).toString('base64url');

    const context: EncryptionContext = {
      mode: mode as CryptoMode,
      recordType: RECORD_TYPE,
      recordId: existing.id.toString(),
      field: CREDENTIALS_FIELD,
    };

    const credentialUpdate = await this.buildCredentialUpdate(
      storeId,
      existing,
      { [field]: token },
      context,
    );

    const account = await this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      const saved = await tx.paymentAccount.update({
        where: { id: existing.id, store_id: storeId, mode: mode as Mode },
        // Touches only the credential-envelope fields — status, enabled
        // state, display name, offerings are all untouched by rotating a
        // webhook secret. `updated_at` bumps as a side effect of this
        // `.update()` call, which is what lets webhookStatusFor() below
        // treat any webhook event received before this moment as stale —
        // see its comment for why that matters after a rotation.
        data: credentialUpdate.fields,
      });

      return tx.paymentAccount.findFirstOrThrow({
        where: { id: saved.id, store_id: storeId, mode: mode as Mode },
        include: { offerings: { orderBy: { position: 'asc' } } },
      });
    });

    this.logger.log(
      `Webhook secret اتولّد: متجر ${storeId} / ${gatewayKey} / ${mode} / ${displayName}`,
    );

    const latest = await this.latestWebhookStatusByAccount([account.id]);
    const webhook = this.webhookStatusFor(
      account,
      latest.get(account.id.toString()),
    );

    return {
      ...this.toPublicAccount(account, webhook),
      // The ONLY place this ever appears in plaintext. Every other read
      // path (listSettings, webhookStatus, upsert's own response) only
      // ever returns credentials_hint's masked last-4.
      webhook_secret: token,
    };
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

    // Listed in the catalog is not the same as usable: the catalog is
    // metadata for the form, the registry is what can actually process a
    // payment. A merchant must never be able to *enable* a gateway that
    // has no adapter behind it — that failure would only surface later,
    // at a customer's checkout. Saving a draft (credentials filled in,
    // not yet enabled) ahead of an adapter landing is still allowed.
    if (dto.enabled === true && !this.providers.has(gatewayKey)) {
      throw new BadRequestException(
        `${gateway.name_ar} مش متاحة لسه (لا يوجد أدابتر مسجّل لها).`,
      );
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

    const existingForId = await this.prisma.withTenantTransaction(storeId, dto.mode, async (tx) =>
      tx.paymentAccount.findFirst({
        where: {
          store_id: storeId,
          mode: dto.mode as Mode,
          gateway: gatewayKey as PaymentProviderKey,
          display_name: displayName,
        },
      }),
    );

    const accountId = existingForId ? existingForId.id : await this.ids.reserve(PAYMENT_ACCOUNTS_TABLE);

    const context: EncryptionContext = {
      mode: dto.mode as CryptoMode,
      recordType: RECORD_TYPE,
      recordId: accountId.toString(),
      field: CREDENTIALS_FIELD,
    };

    const credentialUpdate = await this.buildCredentialUpdate(
      storeId,
      existingForId,
      credentials,
      context,
    );

    // Real validation, through the shared pipeline — only when there is
    // new credential material to check. The pipeline does the structural
    // check from the catalog, delegates the real one to the adapter, and
    // normalises whatever comes back; core never learns a provider's
    // field names or error strings.
    //
    // Re-validating unchanged, already-saved credentials on every
    // unrelated edit (e.g. renaming the account) would mean calling out
    // to the provider far more than the merchant's action warrants.
    const validation = credentialUpdate.credentialsChanged
      ? await this.credentialValidation.validate({
          gateway: gatewayKey,
          credentials: credentialUpdate.merged ?? {},
          mode: dto.mode as Mode,
        })
      : null;

    const checked = validation !== null && validation.stage !== 'skipped';

    const status = this.resolveStatus(
      gateway.requires_credentials,
      credentialUpdate.hasCredentialsAfter,
      dto.enabled,
      existingForId?.status,
      validation,
    );

    const data = {
      store_id: storeId,
      mode: dto.mode as Mode,
      gateway: gatewayKey as PaymentProviderKey,
      display_name: displayName,
      settlement_currency: dto.settlement_currency?.toUpperCase() ?? null,
      status,
      // A skipped validation (no adapter registered yet) is not evidence
      // either way, so it leaves the previous verdict alone.
      last_verified_at: checked ? (validation!.valid ? new Date() : null) : undefined,
      last_error: checked
        ? (validation!.valid
            ? null
            : (validation!.message ?? 'فشل التحقق من بيانات الاعتماد.'))
        : undefined,
      ...credentialUpdate.fields,
    };

    const account = await this.prisma.withTenantTransaction(storeId, dto.mode, async (tx) => {
      const existing = await tx.paymentAccount.findFirst({
        where: {
          store_id: storeId,
          mode: dto.mode as Mode,
          gateway: gatewayKey as PaymentProviderKey,
          display_name: displayName,
        },
      });

      const saved = existing
        ? await tx.paymentAccount.update({
            where: {
              id: existing.id,
              store_id: storeId,
              mode: dto.mode as Mode,
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
          tx,
          saved.id,
          storeId,
          dto.mode,
          offerings,
        );
      } else {
        // The settings UI has no per-offering management screen — it only
        // ever sends { enabled, mode, credentials }, never `offerings`.
        // Without this, saving/enabling a gateway here updated the
        // account's status but never created the PaymentMethodOffering
        // row checkout.service.ts's listPaymentMethods() actually queries
        // (`enabled: true` on the offering, not just an active account),
        // so a merchant "enabling" a gateway never made it appear at
        // checkout. `skipDuplicates` makes this a pure backfill: an
        // offering that already exists (from this path or a future
        // offerings-management UI) is never touched or reset.
        await this.ensureDefaultOfferings(tx, saved.id, storeId, dto.mode, gateway, status);
      }

      return tx.paymentAccount.findFirstOrThrow({
        where: {
          id: saved.id,
          store_id: storeId,
          mode: dto.mode as Mode,
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
    const updated = await this.prisma.withTenantTransaction(storeId, mode, async (tx) => {
      const account = await tx.paymentAccount.findFirst({
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

      return tx.paymentAccount.update({
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
    const account = await this.prisma.withTenantTransaction(storeId, mode as unknown as string, async (tx) =>
      tx.paymentAccount.findFirstOrThrow({
        where: { id: accountId, store_id: storeId, mode },
      }),
    );

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
    /** Merged plaintext, only when credentials actually changed — for validation, never for the API response. */
    merged?: Record<string, string>;
  }> {
    const alreadyHas = Boolean(existing?.credentials_envelope);

    if (!incoming || Object.keys(incoming).length === 0) {
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
      merged,
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

  /**
   * يضمن وجود offering لكل وسيلة يدعمها الكتالوج، ويزامن enabled بتاعه
   * مع حالة الحساب — لما التاجر بيحفظ/يفعّل/يعطّل بوابة من واجهة
   * الإعدادات الحالية (اللي مالهاش شاشة لإدارة الـ offerings يدويًا —
   * بترسل بس enabled/mode/credentials).
   *
   * من غير كده، حفظ حساب دفع كان بيحدّث status الحساب بس، وميوصلش أي
   * offering لصفحة الدفع (checkout.service.ts::listPaymentMethods بيفلتر
   * على `enabled: true` في الـ offering نفسه، مش بس status الحساب) —
   * يعني البوابة تفضل "مفعّلة" في الإعدادات بس محدش يشوفها عند الدفع،
   * أو تفضل ظاهرة في الدفع بعد ما التاجر يعطّلها.
   *
   * `upsert` بالـ unique constraint (account_id, method, "") — لو
   * offering موجود بالفعل (من هنا قبل كده، أو من شاشة إدارة offerings
   * مستقبلية) بيتزامن `enabled` بتاعه بس، من غير ما يتلمس أي حقل تاني
   * (الاسم المعروض، القيود، الترتيب...).
   */
  private async ensureDefaultOfferings(
    tx: Prisma.TransactionClient,
    accountId: bigint,
    storeId: bigint,
    mode: 'test' | 'live',
    gateway: GatewayDefinition,
    status: PaymentAccountStatus,
  ): Promise<void> {
    const enabled = status === 'active';

    await Promise.all(
      gateway.methods.map((method, index) =>
        tx.paymentMethodOffering.upsert({
          where: {
            account_id_method_gateway_method_config: {
              account_id: accountId,
              method: method as PaymentMethodKey,
              gateway_method_config: '',
            },
          },
          create: {
            account_id: accountId,
            store_id: storeId,
            mode: mode as Mode,
            method: method as PaymentMethodKey,
            gateway_method_config: '',
            enabled,
            position: index,
          },
          update: { enabled },
        }),
      ),
    );
  }

  private resolveStatus(
    requiresCredentials: boolean,
    hasCredentials: boolean,
    enabled: boolean | undefined,
    currentStatus: PaymentAccountStatus | undefined,
    validation: CredentialValidationOutcome | null,
  ): PaymentAccountStatus {
    if (enabled === false) return 'disabled';

    // Credentials were just checked against the real adapter this call —
    // that result is authoritative, not "verifying" (which means checked
    // later, asynchronously). A rejection always wins over `enabled`.
    //
    // A `skipped` outcome means there is no adapter yet to check against,
    // so it proves nothing and must not mark the account verified.
    if (validation && validation.stage !== 'skipped') {
      if (!validation.valid) return 'errored';
      return enabled ? 'active' : (currentStatus ?? 'draft');
    }

    if (!requiresCredentials) {
      return enabled ? 'active' : (currentStatus ?? 'draft');
    }

    if (!hasCredentials) return 'draft';

    // Credentials are unchanged this call (nothing to (re-)validate). If
    // they were already verified — or already rejected — on a prior save,
    // an unrelated edit (e.g. renaming the account) should not silently
    // reset that outcome back to "pending verification".
    if (currentStatus === 'active' || currentStatus === 'errored') {
      return enabled ? currentStatus : 'draft';
    }

    return enabled ? 'verifying' : 'draft';
  }

  /**
   * الشكل اللي بيرجع في الـ API.
   *
   * ⚠️ لاحظ إن credentials_envelope مش هنا ولا هيبقى هنا أبداً.
   */
  /**
   * أحدث صف WebhookEvent لكل حساب، بدون scoping — الجدول ده منصّة مش
   * مستأجر (انظر تعليق الموديل في schema.prisma)، فالقراءة بتستخدم
   * platform() زي ما بيحصل في webhook-ingestion.service.ts.
   */
  private async latestWebhookStatusByAccount(
    accountIds: bigint[],
  ): Promise<Map<string, { verified: boolean; at: Date }>> {
    if (accountIds.length === 0) return new Map();

    const events = await this.prisma.platform().webhookEvent.findMany({
      where: { account_id: { in: accountIds } },
      orderBy: { received_at: 'desc' },
      select: { account_id: true, signature_verified: true, received_at: true },
    });

    const byAccount = new Map<string, { verified: boolean; at: Date }>();
    for (const event of events) {
      const key = event.account_id.toString();
      // First row per account wins — the list is ordered newest first.
      if (!byAccount.has(key)) {
        byAccount.set(key, { verified: event.signature_verified, at: event.received_at });
      }
    }
    return byAccount;
  }

  /**
   * حالة الـ webhook الظاهرة للتاجر.
   *
   * مبنية بالكامل على إشارات حقيقية: هل فيه سر/HMAC متخزّن، وهل آخر
   * نداء وصل فعلاً اتحقق توقيعه. مفيش حالة "Verified" بتترجع لمجرد
   * وجود بيانات اعتماد — لازم نداء حقيقي نجح فعلاً.
   */
  private webhookStatusFor(
    account: {
      gateway: string;
      status: string;
      credentials_hint: unknown;
      updated_at?: Date;
    },
    latest: { verified: boolean; at: Date } | undefined,
  ): {
    supported: boolean;
    configured: boolean;
    status: 'not_configured' | 'configured' | 'verified' | 'verification_failed' | 'disabled';
    last_event_at: Date | null;
    last_event_verified: boolean | null;
  } | null {
    if (!this.providers.has(account.gateway)) return null;

    const capabilities = this.providers.capabilities(account.gateway);
    if (!capabilities.webhooks) return null;

    const field = webhookSecretField(capabilities);
    const hints = (account.credentials_hint ?? {}) as Record<string, string>;
    const configured = Boolean(hints[field]);

    // A rotated Secret Token invalidates whatever the last inbound
    // webhook proved, but there is no dedicated "rotated_at" column
    // (no owner permission on this DB to run that migration — see the
    // generateWebhookSecret() call site). `updated_at` already bumps on
    // the very save that rotates the token, so an event older than that
    // save can no longer speak to the *current* secret and must not be
    // shown as "verified". Scoped to gateways that actually rotate a
    // server-generated secret (Moyasar only, today) — every other
    // gateway's webhook status keeps its exact prior behaviour, since an
    // unrelated account edit (rename, enable toggle) bumping
    // `updated_at` would otherwise incorrectly hide a real verified
    // Stripe/Paymob/Tap webhook until the next callback arrives.
    const gatewayDef = findGateway(account.gateway);
    const effectiveLatest =
      gatewayDef?.supports_generated_webhook_secret &&
      latest &&
      account.updated_at &&
      latest.at < account.updated_at
        ? undefined
        : latest;

    let status: 'not_configured' | 'configured' | 'verified' | 'verification_failed' | 'disabled';
    if (account.status === 'disabled') {
      status = 'disabled';
    } else if (!configured) {
      status = 'not_configured';
    } else if (!effectiveLatest) {
      status = 'configured';
    } else {
      status = effectiveLatest.verified ? 'verified' : 'verification_failed';
    }

    return {
      supported: true,
      configured,
      status,
      last_event_at: latest?.at ?? null,
      last_event_verified: latest?.verified ?? null,
    };
  }

  private toPublicAccount(
    account: {
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
    },
    webhook: ReturnType<PaymentAccountService['webhookStatusFor']> = null,
  ) {
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
      webhook,
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

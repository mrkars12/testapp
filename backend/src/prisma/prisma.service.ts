import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { createTenantGuardExtension } from '../common/tenant/tenant-guard.extension';
import type { TenantConfig } from '../common/config/configuration';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * كاش للعميل الموسّع بحارس العزل.
   *
   * unknown مش النوع المستنتج: $extends بيرجّع نوع معقّد، وتخزينه في
   * حقل معرّف بالنوع المستنتج بيعمل دورة استنتاج في TypeScript.
   * التحويل بيحصل في guarded() نفسها، فالمستدعي بياخد النوع الصح.
   */
  private guardedCache: unknown = null;
  private platformClient: PrismaClient | null = null;

  constructor(
    private eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  /**
   * True in production (config falls back to `NODE_ENV` directly so this
   * still works in the handful of call sites/tests that construct
   * PrismaService with a bare/no-op ConfigService stub).
   */
  protected isProduction(): boolean {
    return (
      this.config.get<boolean>('app.isProduction') ??
      process.env.NODE_ENV === 'production'
    );
  }

  /**
   * True only for a genuine local/test run. NODE_ENV=development is
   * deliberately NOT sufficient by itself — the shared/deployed
   * environment runs with NODE_ENV=development, and must fail closed just
   * like production. The fallback below only activates when NODE_ENV=test
   * (set automatically by Jest) or via the explicit
   * ALLOW_PLATFORM_DB_FALLBACK=true opt-in.
   */
  protected allowsPlatformDbFallback(): boolean {
    return (
      this.config.get<boolean>('app.allowPlatformDbFallback') ??
      process.env.NODE_ENV === 'test'
    );
  }

  protected getPlatformDatabaseUrl(): string | undefined {
    const fromConfig = this.config.get<string>('DATABASE_URL_PLATFORM');
    if (fromConfig) return fromConfig;
    if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;

    if (!this.allowsPlatformDbFallback()) {
      // Fail closed by default: never silently reuse the tenant-scoped
      // connection for platform-wide/cross-tenant work (idempotency sweep,
      // outbox dispatch, webhook ingestion, reconciliation, account
      // resolution — see platform() below). This applies in production
      // AND in any shared/deployed environment running with
      // NODE_ENV=development — only a genuine local/test run (see
      // allowsPlatformDbFallback()) may proceed to the fallback below.
      // Returning undefined here is what makes platform() fail closed
      // instead of falling through to it.
      return undefined;
    }

    // The integration harness now provisions a REAL `dartstore_platform`
    // role — the same narrow, least-privilege identity production uses —
    // and publishes it here. Preferred over every derivation below,
    // because it is the actual role rather than a stand-in for it.
    if (process.env.TEST_PLATFORM_DATABASE_URL) {
      return process.env.TEST_PLATFORM_DATABASE_URL;
    }

    // Fallback for local dev/tests only, explicitly opted into via
    // allowsPlatformDbFallback(): derive the owner URL from
    // TEST_DATABASE_URL / DATABASE_URL.
    const fallback = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (fallback) {
      try {
        const url = new URL(fallback);
        if (url.username === 'rls_test') {
          url.username = 'test';
          url.password = 'test';
          return url.toString();
        }
        return fallback;
      } catch {
        return fallback;
      }
    }
    return undefined;
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Database connected successfully!');
    try {
      const platform = this.platform();
      await platform.$connect();
      console.log('✅ Platform database connected successfully!');
    } catch (error) {
      if (this.isProduction()) {
        // Fail closed: a production boot with no working platform
        // connection must not continue — every platform() consumer would
        // otherwise fail unpredictably per-call, or (before this fix)
        // silently fall back to the tenant-scoped connection.
        throw error;
      }
      // Platform client optional in dev/test if DATABASE_URL_PLATFORM and
      // TEST_DATABASE_URL/DATABASE_URL are both absent.
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (this.platformClient) {
      await this.platformClient.$disconnect();
    }
  }

  /**
   * عميل Prisma مع حارس عزل المستأجرين.
   *
   * الحارس **تبليغ فقط**: بيسجّل تحذير لو استعلام على موديل مسجّل في
   * tenant-scoped-models مش مقيّد بـ store_id و mode. مابيعدّلش الاستعلام،
   * ومابيضيفش شروط، ومابيمنعش أي عملية.
   *
   * ⚠️ ده مسار **اختياري بالكامل**. كل الخدمات الموجودة في المشروع
   * بتستخدم `this` مباشرةً زي ما هي بالظبط، ومفيش أي تغيير في سلوكها
   * ولا في أنواعها. خدمات المرحلة 1b هي اللي هتستخدم guarded() صراحةً.
   *
   * السبب في إنه اختياري: $extends بيرجّع عميل بنوع مختلف، فلو استبدلنا
   * العميل الأساسي كان التغيير هيمتد لكل خدمة في المشروع.
   */
  guarded() {
    if (!this.guardedCache) {
      this.guardedCache = this.buildGuardedClient();
    }
    return this.guardedCache as ReturnType<PrismaService['buildGuardedClient']>;
  }

  private buildGuardedClient() {
    const tenant = this.config.get<TenantConfig>('tenant');

    return this.$extends(
      createTenantGuardExtension({
        enabled: tenant?.guardEnabled ?? false,
        throwOnViolation: tenant?.throwOnViolation ?? false,
        tenantContext: this.tenantContext,
      }),
    );
  }

  /**
   * Runs a tenant transaction with PostgreSQL RLS context.
   *
   * The setting is LOCAL to the current database transaction/connection,
   * so pooled connections cannot leak one store's context into another
   * request.
   *
   * `options` passes straight through to Prisma's own interactive
   * transaction (`maxWait`/`timeout`). Callers whose transaction does
   * more than a couple of statements — a capture plus a ledger post plus
   * an order finalisation, say — need the default 5s timeout raised;
   * omitting `options` keeps every existing caller's behaviour unchanged.
   */
  async withTenantTransaction<T>(
    storeId: bigint,
    mode: string,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT
          set_config('app.store_id', ${storeId.toString()}, true),
          set_config('app.mode', ${mode}, true)
      `;

      return callback(tx);
    }, options);
  }

  platform(): PrismaClient {
    if (this.platformClient) return this.platformClient;
    const url = this.getPlatformDatabaseUrl();

    if (!url) {
      if (!this.allowsPlatformDbFallback()) {
        // No silent fallback to the tenant-scoped DATABASE_URL — in
        // production, and in any shared/deployed environment running with
        // NODE_ENV=development, every platform() consumer (idempotency
        // sweep, outbox dispatch, webhook ingestion, reconciliation,
        // account resolution) does deliberate cross-tenant/pre-tenant-
        // context work that must run on an explicitly configured elevated
        // connection, not whatever the tenant runtime happens to be.
        throw new Error(
          'DATABASE_URL_PLATFORM is not configured. platform() refuses ' +
            'to fall back to the tenant runtime connection (DATABASE_URL) ' +
            'unless this is a genuine local/test run — set ' +
            'DATABASE_URL_PLATFORM to the elevated platform/admin ' +
            'connection string before starting the application, or (local ' +
            'dev/test only) opt in explicitly via ' +
            'ALLOW_PLATFORM_DB_FALLBACK=true.',
        );
      }
      // Local dev/test only, explicitly opted into: no DATABASE_URL_PLATFORM,
      // TEST_DATABASE_URL, or DATABASE_URL at all — fall back to Prisma's
      // own env resolution.
      this.platformClient = new PrismaClient();
      return this.platformClient;
    }

    this.platformClient = new PrismaClient({
      datasources: { db: { url } },
    });
    return this.platformClient;
  }

  async withPlatformTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.platform().$transaction(async (tx) => callback(tx));
  }

  /**
   * ✅ استدعى الدالة دى قبل أى delete على devices
   */
  async deleteDevice(deviceId: bigint) {
    const device = await this.devices.findFirst({
      where: { id: deviceId },
      select: { id: true, user_id: true },
    });

    const result = await this.devices.delete({
      where: { id: deviceId },
    });

    if (device) {
      this.eventEmitter.emit('device.deleted', {
        deviceId: device.id.toString(),
        userId: device.user_id.toString(),
      });
    }

    return result;
  }

  async deleteManyDevices(where: any) {
    const devices = await this.devices.findMany({
      where,
      select: { id: true, user_id: true },
    });

    const result = await this.devices.deleteMany({ where });

    for (const device of devices) {
      this.eventEmitter.emit('device.deleted', {
        deviceId: device.id.toString(),
        userId: device.user_id.toString(),
      });
    }

    return result;
  }
}

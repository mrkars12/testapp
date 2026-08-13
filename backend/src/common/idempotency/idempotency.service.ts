import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { crossStoreQuery } from '../tenant/cross-store-query';
import type { IdempotencyConfig } from '../config/configuration';
import {
  ClaimRequest,
  ClaimResult,
  isUniqueConstraintError,
} from './idempotency.types';

/**
 * ══════════════════════════════════════════════════════════════════
 * خدمة منع التكرار
 * ══════════════════════════════════════════════════════════════════
 *
 * التصميم: **الحجز أولاً (claim-first)**، مش الفحص أولاً.
 *
 * الطريقة الغلط الشائعة:
 *   1. دوّر على سجل بالمفتاح ده
 *   2. لو مش موجود، نفّذ العملية واعمل سجل
 *
 * طلبين متوازيين بيعدّوا خطوة 1 الاتنين قبل ما أي واحد يوصل لخطوة 2،
 * فالعملية بتتنفّذ مرتين. ده بالظبط سيناريو الدبل-كليك على زرار الدفع.
 *
 * الطريقة الصح:
 *   1. اعمل السجل بحالة in_flight — القيد الفريد بيرفض التاني
 *   2. لو الإنشاء نجح → نفّذ
 *   3. لو رجع P2002 → في سجل موجود، شوف حالته:
 *      completed + نفس البصمة → رجّع الرد المخزّن
 *      completed + بصمة مختلفة → 409 تعارض
 *      in_flight + الحجز ساري → 409 اتأخّر وحاول تاني
 *      in_flight + الحجز خلص → اسرق الحجز وكمّل (الطلب الأصلي مات)
 *
 * القيد الفريد في قاعدة البيانات هو اللي بينفّذ الضمانة، مش الكود.
 *
 * ⚠️ ملاحظة على أعمدة Json: Prisma بيرفض تمرير null عادية لعمود
 * Json، ولازم Prisma.DbNull (NULL في قاعدة البيانات) أو Prisma.JsonNull
 * (قيمة JSON اسمها null). وتمرير undefined معناه "ماتغيّرش العمود".
 * الاتنين دول مصدر أخطاء صامتة، فمستخدمين DbNull صراحةً.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get settings(): IdempotencyConfig {
    return this.config.getOrThrow<IdempotencyConfig>('idempotency');
  }

  get defaultTtlSeconds(): number {
    return this.settings.ttlSeconds;
  }

  get defaultLeaseSeconds(): number {
    return this.settings.leaseSeconds;
  }

  /**
   * يحاول حجز المفتاح.
   *
   * ⚠️ لازم يتنادى خارج أي transaction للمستدعي. السجل لازم يتحفظ
   * فوراً عشان الطلب المتوازي يشوفه.
   */
  async claim(request: ClaimRequest): Promise<ClaimResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + request.ttlSeconds * 1000);
    const lockedUntil = new Date(now.getTime() + request.leaseSeconds * 1000);

    try {
      const created = await this.prisma
        .guarded()
        .paymentIdempotencyRecord.create({
          data: {
            store_id: request.storeId,
            mode: request.mode,
            scope: request.scope,
            idempotency_key: request.idempotencyKey,
            request_fingerprint: request.fingerprint,
            status: 'in_flight',
            locked_until: lockedUntil,
            expires_at: expiresAt,
          },
          select: {
            id: true,
          },
        });

      return {
        outcome: 'proceed',
        recordId: created.id,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      return this.resolveExisting(request, now, lockedUntil);
    }
  }

  /**
   * يسجّل نجاح العملية ويخزّن الرد للإعادة.
   *
   * mode مطلوب هنا لأن PaymentIdempotencyRecord tenant-scoped
   * على مستوى store + mode.
   */
  async complete(
    recordId: bigint,
    storeId: bigint,
    mode: ClaimRequest['mode'],
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    await this.prisma.guarded().paymentIdempotencyRecord.updateMany({
      where: {
        id: recordId,
        store_id: storeId,
        mode,
      },
      data: {
        status: 'completed',
        response_status_code: statusCode,

        // DbNull مش null: تمرير null عادية لعمود Json
        // بيرمي في Prisma.
        response_body:
          body === null || body === undefined
            ? Prisma.DbNull
            : (body as Prisma.InputJsonValue),

        locked_until: null,
        completed_at: new Date(),
      },
    });
  }

  /**
   * يسجّل فشل العملية.
   *
   * الحالة بتبقى failed مش completed، فإعادة المحاولة بنفس المفتاح
   * مسموحة — العميل المفروض يقدر يعيد بعد خطأ مؤقت.
   */
  async fail(
    recordId: bigint,
    storeId: bigint,
    mode: ClaimRequest['mode'],
  ): Promise<void> {
    await this.prisma.guarded().paymentIdempotencyRecord.updateMany({
      where: {
        id: recordId,
        store_id: storeId,
        mode,
      },
      data: {
        status: 'failed',
        locked_until: null,
        completed_at: new Date(),
      },
    });
  }

  /**
   * ينضّف السجلات المنتهية — كل ساعة.
   *
   * ده platform-wide purge مقصود، لذلك لازم يمر من
   * crossStoreQuery('platform_sweep') بدل اختراع store scope.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<number> {
    const result = await crossStoreQuery(
      'platform_sweep',
      'purge expired idempotency records',
      () =>
        this.prisma.guarded().paymentIdempotencyRecord.deleteMany({
          where: {
            expires_at: {
              lt: new Date(),
            },
          },
        }),
    );

    if (result.count > 0) {
      this.logger.log(`تم حذف ${result.count} سجل idempotency منتهي.`);
    }

    return result.count;
  }

  /**
   * يقرر النتيجة لما القيد الفريد يرفض الإنشاء.
   */
  private async resolveExisting(
    request: ClaimRequest,
    now: Date,
    lockedUntil: Date,
  ): Promise<ClaimResult> {
    const existing = await this.prisma
      .guarded()
      .paymentIdempotencyRecord.findFirst({
        where: {
          store_id: request.storeId,
          mode: request.mode,
          scope: request.scope,
          idempotency_key: request.idempotencyKey,
        },
      });

    if (!existing) {
      // اتحذف بين المحاولتين (تنضيف) — المستدعي يعيد المحاولة.
      return {
        outcome: 'in_flight',
        retryAfterSeconds: 1,
      };
    }

    // نفس المفتاح بجسم مختلف = خطأ من العميل، مش إعادة إرسال.
    if (existing.request_fingerprint !== request.fingerprint) {
      return {
        outcome: 'conflict',
        detail:
          'نفس Idempotency-Key اتبعت مع محتوى طلب مختلف. ' +
          'كل عملية لازم يكون ليها مفتاح خاص بيها.',
      };
    }

    if (existing.status === 'completed') {
      return {
        outcome: 'replay',
        statusCode: existing.response_status_code ?? 200,
        body: existing.response_body ?? null,
      };
    }

    if (existing.status === 'failed') {
      // العملية فشلت — نسمح بإعادة المحاولة بحجز جديد.
      const stolen = await this.stealLease(existing.id, request, lockedUntil);

      return stolen
        ? {
            outcome: 'proceed',
            recordId: existing.id,
          }
        : {
            outcome: 'in_flight',
            retryAfterSeconds: 1,
          };
    }

    // in_flight
    const leaseExpired =
      existing.locked_until !== null && existing.locked_until <= now;

    if (!leaseExpired) {
      const retryAfterSeconds = existing.locked_until
        ? Math.max(
            1,
            Math.ceil((existing.locked_until.getTime() - now.getTime()) / 1000),
          )
        : 1;

      return {
        outcome: 'in_flight',
        retryAfterSeconds,
      };
    }

    // الحجز خلص — الطلب الأصلي مات (السيرفر وقع مثلاً).
    // نسرق الحجز.
    this.logger.warn(
      `حجز idempotency منتهي للمفتاح ${request.scope}:${request.idempotencyKey} — ` +
        `جاري استئنافه.`,
    );

    const stolen = await this.stealLease(existing.id, request, lockedUntil);

    return stolen
      ? {
          outcome: 'proceed',
          recordId: existing.id,
        }
      : {
          outcome: 'in_flight',
          retryAfterSeconds: 1,
        };
  }

  /**
   * يحاول أخذ الحجز بشرط إن حالته لسه زي ما شفناها.
   *
   * updateMany بشرط بيمنع طلبين من سرقة نفس الحجز المنتهي
   * في نفس اللحظة: الأول بس اللي هيلاقي الحالة القديمة.
   */
  private async stealLease(
    recordId: bigint,
    request: ClaimRequest,
    lockedUntil: Date,
  ): Promise<boolean> {
    const result = await this.prisma
      .guarded()
      .paymentIdempotencyRecord.updateMany({
        where: {
          id: recordId,
          store_id: request.storeId,
          mode: request.mode,
          OR: [
            {
              status: 'failed',
            },
            {
              status: 'in_flight',
              locked_until: {
                lte: new Date(),
              },
            },
            {
              status: 'in_flight',
              locked_until: null,
            },
          ],
        },
        data: {
          status: 'in_flight',
          locked_until: lockedUntil,
          completed_at: null,
          response_status_code: null,

          // DbNull مش undefined: undefined معناها
          // "ماتغيّرش"، فالرد القديم كان هيفضل مخزّن
          // على سجل بقى in_flight تاني.
          response_body: Prisma.DbNull,
        },
      });

    return result.count === 1;
  }
}

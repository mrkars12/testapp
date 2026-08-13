import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { MessagingConfig } from '../config/configuration';
import { crossStoreQuery } from '../tenant/cross-store-query';
import { ConsumedEventService } from './consumed-event.service';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OutboxRecord } from './messaging.types';

/**
 * ══════════════════════════════════════════════════════════════════
 * موزّع صندوق الصادر
 * ══════════════════════════════════════════════════════════════════
 *
 * موزّع بالاستطلاع مع حجز (leased poller). من غير Redis ولا BullMQ —
 * دول متأجّلين للمرحلة 2.
 *
 * الحجز الآمن بين أكتر من instance بيتعمل بـ:
 *
 *   FOR UPDATE SKIP LOCKED
 *
 * ده بيخلي كل عامل ياخد دفعة مختلفة من غير تعارض ومن غير انتظار.
 * لو عامل وقع وهو ماسك رسايل، الحجز بينتهي (claim_expires_at) وعامل
 * تاني بياخدها.
 *
 * ⚠️ التسليم at-least-once مش exactly-once: رسالة ممكن تتسلّم مرتين لو
 * الحجز انتهى أثناء معالجة بطيئة. المستهلكين لازم يكونوا idempotent،
 * وده اللي ConsumedEventService بيضمنه بقيد فريد في قاعدة البيانات.
 *
 * ملاحظة على الجدولة: الفترة بتتسجّل ديناميكياً في SchedulerRegistry
 * مش بديكوريتر @Interval، لأن الديكوريتر بيتقيّم وقت تعريف الكلاس وقتها
 * ConfigService لسه مش متاح — يعني القيمة كانت هتفضل ثابتة في الكود
 * ومتغيّر البيئة يبقى بلا معنى.
 *
 * المرحلة 1a: سجل المستهلكين فاضي، فالموزّع بيشتغل على جدول فاضي.
 */
@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  /** معرّف فريد للعامل — بيتكتب في claimed_by */
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  private static readonly INTERVAL_NAME = 'outbox-dispatcher';

  /** بيمنع تداخل الدورات داخل نفس الـ instance */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registry: OutboxHandlerRegistry,
    private readonly consumed: ConsumedEventService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.settings.dispatcherEnabled) {
      this.logger.warn(
        'موزّع صندوق الصادر متوقّف (OUTBOX_DISPATCHER_ENABLED=false). ' +
          'الأحداث هتتكتب ومحدش هيعالجها.',
      );
      return;
    }

    const intervalMs = this.settings.pollIntervalMs;

    const handle = setInterval(() => {
      void this.poll();
    }, intervalMs);

    this.scheduler.addInterval(OutboxDispatcherService.INTERVAL_NAME, handle);

    this.logger.log(
      `موزّع صندوق الصادر شغّال — عامل ${this.workerId}، ` +
        `كل ${intervalMs}ms، دفعة ${this.settings.batchSize}.`,
    );
  }

  onModuleDestroy(): void {
    // من غير ده، إعادة التشغيل السريعة بتسيب مؤقتات شغالة
    if (
      this.scheduler.doesExist(
        'interval',
        OutboxDispatcherService.INTERVAL_NAME,
      )
    ) {
      this.scheduler.deleteInterval(OutboxDispatcherService.INTERVAL_NAME);
    }
  }

  private get settings(): MessagingConfig {
    return this.config.getOrThrow<MessagingConfig>('messaging');
  }

  /** دورة الاستطلاع — بتتسجّل في onModuleInit */
  async poll(): Promise<void> {
    // التداخل بين instances متعالج بالحجز في قاعدة البيانات؛
    // ده بيمنع التداخل جوه الـ instance الواحدة بس.
    if (this.running) return;

    this.running = true;

    try {
      await this.dispatchBatch();
    } catch (error) {
      this.logger.error(
        `دورة توزيع فشلت: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  /** يحجز دفعة ويعالجها. بيرجّع عدد الرسايل اللي اتعالجت. */
  async dispatchBatch(): Promise<number> {
    const claimed = await this.claimBatch();

    if (claimed.length === 0) return 0;

    for (const message of claimed) {
      await this.dispatchOne(message);
    }

    return claimed.length;
  }

  /**
   * يحجز دفعة رسايل ذرّياً.
   *
   * ده platform-wide sweep مقصود، لأن العامل لازم يشوف الرسائل
   * من كل المتاجر. لذلك يتم تشغيل الـraw SQL داخل crossStoreQuery
   * بدل محاولة فرض tenant scope غير موجود أصلًا في هذا المسار.
   *
   * بياخد:
   *   • الرسايل المعلّقة اللي حان وقتها
   *   • الرسايل المحجوزة اللي حجزها انتهى (عامل وقع)
   */
  private async claimBatch(): Promise<OutboxRecord[]> {
    const { leaseSeconds, batchSize } = this.settings;

    const leaseExpiry = new Date(Date.now() + leaseSeconds * 1000);

    const rows = await crossStoreQuery(
      'platform_sweep',
      'claim pending outbox across stores',
      () =>
        this.prisma.$queryRaw<
          {
            id: bigint;
            store_id: bigint;
            mode: 'test' | 'live';
            aggregate_type: string;
            aggregate_id: string;
            event_type: string;
            event_version: number;
            payload: Record<string, unknown>;
            attempts: number;
            occurred_at: Date;
          }[]
        >`
          UPDATE outbox_messages AS target
          SET status = 'claimed',
              claimed_by = ${this.workerId},
              claim_expires_at = ${leaseExpiry}
          FROM (
            SELECT id
            FROM outbox_messages
            WHERE (status = 'pending' AND next_attempt_at <= now())
               OR (status = 'claimed' AND claim_expires_at < now())
            ORDER BY id ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          ) AS candidate
          WHERE target.id = candidate.id
          RETURNING target.id, target.store_id, target.mode,
                    target.aggregate_type, target.aggregate_id,
                    target.event_type, target.event_version,
                    target.payload, target.attempts, target.occurred_at
        `,
    );

    return rows.map((row) => ({
      id: typeof row.id === 'bigint' ? row.id : BigInt(row.id as never),
      storeId:
        typeof row.store_id === 'bigint'
          ? row.store_id
          : BigInt(row.store_id as never),
      mode: row.mode,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      payload: row.payload ?? {},
      attempts: row.attempts,
      occurredAt: row.occurred_at,
    }));
  }

  private async dispatchOne(message: OutboxRecord): Promise<void> {
    const handlers = this.registry.handlersFor(message.eventType);

    // مفيش مستهلك مسجّل — الحالة الطبيعية في المرحلة 1a.
    // بنعلّمها منشورة عشان مانفضلش نحاول عليها للأبد.
    if (handlers.length === 0) {
      await this.markPublished(message, 'no_handlers');
      return;
    }

    // Tracks the claim held while a handler runs, so it can be released
    // if that handler throws.
    let claimedBy: string | null = null;

    try {
      for (const handler of handlers) {
        const first = await this.consumed.tryConsume(
          handler.consumerName,
          message,
        );

        if (!first) {
          this.logger.debug(
            `تخطّي: ${handler.consumerName} استهلك الرسالة ${message.id} قبل كده.`,
          );
          continue;
        }

        claimedBy = handler.consumerName;
        await handler.handle(message);
        claimedBy = null;
      }

      await this.markPublished(message, 'ok');
    } catch (error) {
      // The claim is taken before the handler runs so concurrent workers
      // cannot both process it. If the handler then fails, the claim must
      // go, or every retry skips it and the message is marked published
      // without ever having been handled.
      if (claimedBy) {
        await this.consumed
          .release(claimedBy, message.id, message.storeId, message.mode)
          .catch((releaseError) =>
            this.logger.error(
              `فشل تحرير حجز ${claimedBy} للرسالة ${message.id}: ` +
                `${(releaseError as Error).message}`,
            ),
          );
      }

      await this.markFailed(message, error as Error);
    }
  }

  private async markPublished(
    message: OutboxRecord,
    reason: string,
  ): Promise<void> {
    const result = await this.prisma.guarded().outboxMessage.updateMany({
      where: {
        id: message.id,
        store_id: message.storeId,
        mode: message.mode,
      },
      data: {
        status: 'published',
        published_at: new Date(),
        claimed_by: null,
        claim_expires_at: null,
        last_error: reason === 'ok' ? null : reason,
      },
    });

    if (result.count !== 1) {
      this.logger.warn(
        `لم يتم تحديث رسالة outbox ${message.id}: لم يتم العثور على الصف المتوقع للمتجر ${message.storeId} والوضع ${message.mode}.`,
      );
    }
  }

  private async markFailed(message: OutboxRecord, error: Error): Promise<void> {
    const { maxAttempts, backoffBaseSeconds } = this.settings;

    const attempts = message.attempts + 1;
    const isDead = attempts >= maxAttempts;

    // تراجع أسي: 5s, 10s, 20s, 40s ...
    const delaySeconds = backoffBaseSeconds * 2 ** (attempts - 1);

    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);

    const result = await this.prisma.guarded().outboxMessage.updateMany({
      where: {
        id: message.id,
        store_id: message.storeId,
        mode: message.mode,
      },
      data: {
        status: isDead ? 'dead' : 'pending',
        attempts,
        next_attempt_at: nextAttemptAt,
        last_error: error.message.slice(0, 2000),
        claimed_by: null,
        claim_expires_at: null,
      },
    });

    if (result.count !== 1) {
      this.logger.error(
        `فشل تحديث حالة رسالة outbox ${message.id} بعد الخطأ: ` +
          `لم يتم العثور على الصف المتوقع للمتجر ${message.storeId} والوضع ${message.mode}.`,
      );

      return;
    }

    if (isDead) {
      // ⚠️ في المرحلة 1b الرسالة الميتة معناها عملية دفع نجحت وطلب
      // ماتعملش. لازم تنبيه حقيقي، مش سطر لوج بس.
      this.logger.error(
        `[outbox-dead-letter] الرسالة ${message.id} (${message.eventType}) ` +
          `فشلت ${attempts} مرة ووصلت للحد الأقصى. متجر ${message.storeId} ` +
          `وضع ${message.mode}. آخر خطأ: ${error.message}`,
      );
    } else {
      this.logger.warn(
        `الرسالة ${message.id} (${message.eventType}) فشلت — محاولة ${attempts}/` +
          `${maxAttempts}، إعادة بعد ${delaySeconds}s: ${error.message}`,
      );
    }
  }

  /** عدد الرسايل الميتة — للمراقبة والتنبيه */
  async deadLetterCount(): Promise<number> {
    return crossStoreQuery('health_check', 'count dead letters', () =>
      this.prisma.guarded().outboxMessage.count({
        where: {
          status: 'dead',
        },
      }),
    );
  }

  /**
   * الرسايل المعلّقة أكتر من المدة المحددة.
   *
   * صندوق واقف معناه إن أحداث بتتكتب وماحدش بيعالجها. لازم تنبيه.
   */
  async stalePendingCount(olderThanSeconds = 300): Promise<number> {
    return crossStoreQuery(
      'health_check',
      'count stale pending outbox messages',
      () =>
        this.prisma.guarded().outboxMessage.count({
          where: {
            status: 'pending',
            created_at: {
              lt: new Date(Date.now() - olderThanSeconds * 1000),
            },
          },
        }),
    );
  }
}

import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, from, of } from 'rxjs'
import { catchError, switchMap, tap } from 'rxjs/operators'
import type { Request, Response } from 'express'
import { TenantContextService } from '../tenant/tenant-context.service'
import { IdempotencyService } from './idempotency.service'
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_METADATA,
  IdempotencyOptions,
  fingerprintRequest,
  validateIdempotencyKey,
} from './idempotency.types'

/**
 * بيعلّم راوت إنه محمي بمنع التكرار.
 *
 * ⚠️ **اختياري بالكامل.** مفيش أي راوت في المرحلة 1a بيستخدمه، فتسجيل
 * الـ interceptor مالوش أي تأثير على أي endpoint موجود.
 *
 * مثال (المرحلة 1b):
 *   @Idempotent({ scope: 'payments.create_intent' })
 *   @Post('intents')
 *   createIntent(...) {}
 */
export const Idempotent = (options: IdempotencyOptions) =>
  SetMetadata(IDEMPOTENCY_METADATA, options)

/**
 * ══════════════════════════════════════════════════════════════════
 * اعتراض منع التكرار
 * ══════════════════════════════════════════════════════════════════
 *
 * التدفق:
 *   1. اقرأ المفتاح من الهيدر (مفيش مفتاح → عدّي عادي)
 *   2. احسب بصمة الطلب
 *   3. احجز
 *   4. حسب النتيجة: نفّذ / رجّع المخزّن / 409
 *   5. بعد النجاح: خزّن الرد للإعادة
 *
 * أمان: المفتاح بيتصرّف كأنه بيانات اعتماد — إعادة الرد بترجّع بيانات
 * العملية الأصلية. عشان كده السجل مقيّد بـ (store_id, mode, scope,
 * key)، والبحث بيتم بمعرّف المتجر من سياق الطلب، فمستحيل مفتاح من متجر
 * يقرأ رد متجر تاني.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
    private readonly tenantContext: TenantContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<IdempotencyOptions | undefined>(
      IDEMPOTENCY_METADATA,
      context.getHandler(),
    )

    if (!options) return next.handle()

    const request = context.switchToHttp().getRequest<Request>()
    const rawKey = request.headers[IDEMPOTENCY_HEADER]

    // المفتاح اختياري: الراوت شغال عادي من غيره، بس من غير حماية
    if (rawKey === undefined) return next.handle()

    let idempotencyKey: string
    try {
      idempotencyKey = validateIdempotencyKey(rawKey)
    } catch (error) {
      throw new BadRequestException((error as Error).message)
    }

    const storeIdRaw = this.tenantContext.getStoreId()

    if (storeIdRaw === null) {
      // في المرحلة 1a مفيش حل للمتجر النشط. الراوت اللي بيستخدم الديكوريتر
      // ده لازم يكون وراه ActiveStoreGuard (المرحلة 1b).
      throw new ServiceUnavailableException(
        'منع التكرار محتاج سياق متجر — تأكد إن الراوت وراه ActiveStoreGuard.',
      )
    }

    const storeId = BigInt(storeIdRaw)
    const mode = this.tenantContext.getMode()

    const fingerprint = fingerprintRequest({
      method: request.method,
      path: request.route?.path ?? request.path,
      body: request.body,
    })

    return from(
      this.idempotency.claim({
        storeId,
        mode,
        scope: options.scope,
        idempotencyKey,
        fingerprint,
        ttlSeconds: options.ttlSeconds ?? this.idempotency.defaultTtlSeconds,
        leaseSeconds: this.idempotency.defaultLeaseSeconds,
      }),
    ).pipe(
      switchMap((claim) => {
        if (claim.outcome === 'conflict') {
          throw new ConflictException(claim.detail)
        }

        if (claim.outcome === 'in_flight') {
          const response = context.switchToHttp().getResponse<Response>()
          response.setHeader('Retry-After', String(claim.retryAfterSeconds))
          throw new ConflictException(
            'نفس الطلب لسه بيتنفّذ. استنى شوية وحاول تاني.',
          )
        }

        if (claim.outcome === 'replay') {
          const response = context.switchToHttp().getResponse<Response>()
          response.status(claim.statusCode)
          response.setHeader('Idempotent-Replayed', 'true')
          return of(claim.body)
        }

        const recordId = claim.recordId

        return next.handle().pipe(
          tap({
            next: (body) => {
              const response = context.switchToHttp().getResponse<Response>()
              const statusCode = response.statusCode ?? 200
              const stored = options.redact ? options.redact(body) : body

              // مش بننتظر التخزين: فشله مايمنعش رد ناجح من الوصول للعميل
              void this.idempotency
                .complete(recordId, storeId, statusCode, stored)
                .catch(() => undefined)
            },
          }),
          catchError((error) => {
            void this.idempotency.fail(recordId, storeId).catch(() => undefined)
            throw error
          }),
        )
      }),
    )
  }
}

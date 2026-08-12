import { Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client/extension'
import { inspectScope } from './tenant-scope.inspector'
import { currentCrossStoreReason, isCrossStoreQuery } from './cross-store-query'
import { currentCrossModeReason, isCrossModeQuery } from './cross-mode-query'
import type { TenantContextService } from './tenant-context.service'

/**
 * ══════════════════════════════════════════════════════════════════
 * حارس عزل المستأجرين — تبليغ فقط
 * ══════════════════════════════════════════════════════════════════
 *
 * بيفحص الاستعلامات على الموديلات المسجّلة في tenant-scoped-models،
 * وبيسجّل تحذير لو الاستعلام مش مقيّد بـ store_id و mode.
 *
 * ثلاث ضمانات صريحة:
 *   ❌ مابيعدّلش args — الاستعلام بيتنفّذ زي ما المطوّر كتبه بالظبط.
 *   ❌ مابيضيفش شروط ولا بيعيد كتابة أي حاجة.
 *   ❌ مابيمنعش ولا بيرمي — الفشل في الفحص مايوقفش الطلب.
 *
 * ✅ بيسجّل تحذير بس.
 *
 * السبب: إعادة الكتابة التلقائية بتخلي نتيجة الاستعلام تختلف عن اللي
 * مكتوب في الكود، وده أسوأ من غياب الحارس أصلاً — المطوّر بيثق في
 * كود مش بيعمل اللي مكتوب فيه.
 *
 * ⚠️ الفحص نفسه ملفوف في try/catch: أي خطأ جواه (شكل args غير متوقع
 * مثلاً) لازم مايأثرش على الاستعلام. حارس تبليغ ماينفعش يكسر إنتاج.
 *
 * المرحلة 3 هتحوّل ده لمنع فعلي مع RLS على مستوى Postgres.
 */

export interface TenantGuardOptions {
  /** لو false الـ extension بيعدّي على طول من غير أي فحص */
  readonly enabled: boolean
  readonly tenantContext: TenantContextService
  readonly logger?: Logger
  /**
   * يرمي بدل ما يسجّل.
   *
   * ⚠️ للاختبارات بس. في الإنتاج تبليغ فقط، عشان استعلام ناقص نطاق
   * يبقى تحذير مش صفحة خطأ للتاجر. في الاختبار العكس هو الصح: مطلوب
   * يفشل عشان مايوصلش للإنتاج أصلاً.
   */
  readonly throwOnViolation?: boolean
}

/** بيتترمي لما throwOnViolation شغّال. */
export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeViolationError'
    Object.setPrototypeOf(this, TenantScopeViolationError.prototype)
  }
}

/**
 * The extension definition, before Prisma wraps it.
 *
 * Exported separately because Prisma.defineExtension returns an opaque
 * wrapper, which leaves the handler unreachable from a unit test. The
 * suppression logic below is exactly the kind of thing that has to be
 * proven rather than assumed, so it needs a seam.
 */
export function buildTenantGuardDefinition(options: TenantGuardOptions) {
  const logger = options.logger ?? new Logger('TenantGuard')

  return {
    name: 'tenant-guard',
    query: {
      $allOperations({ model, operation, args, query }: any) {
        if (!options.enabled) {
          return query(args)
        }

        // استعلام معلَن إنه عابر للمتاجر — بيعدّي من غير فحص، والسبب
        // متسجّل في الكود عند نقطة الاستدعاء.
        if (isCrossStoreQuery()) {
          logger.debug(
            `[tenant-scope] عبور متاجر مسموح: ${model ?? 'unknown'}.${operation}` +
              ` — ${currentCrossStoreReason()}`,
          )
          return query(args)
        }

        try {
          const rawViolations = inspectScope({
            model,
            operation,
            args,
            contextStoreId: options.tenantContext.getStoreId(),
          })

          // crossModeQuery suppresses ONLY the mode-scope finding. Store
          // scope — missing_store_scope, store_scope_mismatch — is never
          // filtered here, by construction: this is a post-filter on the
          // mode kind alone, not a second bypass path. A query that is
          // both cross-store and mode-agnostic must still declare
          // crossStoreQuery to pass; crossModeQuery cannot substitute
          // for it.
          const violations = isCrossModeQuery()
            ? rawViolations.filter((v) => v.kind !== 'missing_mode_scope')
            : rawViolations

          if (isCrossModeQuery() && violations.length < rawViolations.length) {
            logger.debug(
              `[tenant-scope] وضع عابر مسموح: ${model ?? 'unknown'}.${operation}` +
                ` — ${currentCrossModeReason()}`,
            )
          }

          if (violations.length > 0) {
            const requestId = options.tenantContext.getRequestId()

            if (options.throwOnViolation) {
              throw new TenantScopeViolationError(
                `[tenant-scope] ` +
                  violations
                    .map(
                      (violation) =>
                        `${violation.model}.${violation.operation} — ` +
                        `${violation.kind}: ${violation.detail}`,
                    )
                    .join('; ') +
                  (requestId ? ` (request ${requestId})` : ''),
              )
            }

            for (const violation of violations) {
              logger.warn(
                `[tenant-scope] ${violation.model}.${violation.operation} — ` +
                  `${violation.kind}: ${violation.detail}` +
                  (requestId ? ` (request ${requestId})` : ''),
              )
            }
          }
        } catch (error) {
          // المخالفة المتعمّدة بتعدّي — دي مش فشل في الفحص.
          if (error instanceof TenantScopeViolationError) throw error

          // الفحص فشل — بنسجّل ونكمّل. الاستعلام أهم من الحارس.
          logger.error(
            `[tenant-scope] فشل الفحص لـ ${model ?? 'unknown'}.${operation}: ` +
              `${(error as Error).message}`,
          )
        }

        // args متمرّرة زي ما هي بالظبط، من غير أي تعديل
        return query(args)
      },
    },
  }
}

export function createTenantGuardExtension(options: TenantGuardOptions) {
  return Prisma.defineExtension(buildTenantGuardDefinition(options) as never)
}
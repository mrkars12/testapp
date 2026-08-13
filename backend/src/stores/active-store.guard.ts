import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { ActiveStoreService } from './active-store.service'
import { TenantContextService } from '../common/tenant/tenant-context.service'

/**
 * ActiveStoreGuard
 * ==================
 * بيشتغل بعد أي Auth Guard (SessionAuthGuard) في نفس الـ @UseGuards() chain،
 * يعني الترتيب المتوقع:
 *
 *   @UseGuards(SessionAuthGuard, ActiveStoreGuard)
 *
 * بيحل المتجر الفعّال من (بالترتيب):
 *   1. هيدر X-Store-Id
 *   2. هيدر X-Store-Slug
 *   3. الـ route param :storeSlug
 *
 * وبيتحقق إن المتجر ده فعلاً بتاع req.user.id عن طريق ActiveStoreService،
 * وبعدين بيحط النتيجة على الـ request:
 *   - request.activeStore    → صف المتجر كامل
 *   - request.activeStoreId  → bigint، اختصار سريع
 *
 * وكمان بيحط المتجر في TenantContext، عشان حارس Prisma يبقى عنده حاجة
 * يقارن بيها. من غير الخطوة دي الحارس شغّال على فراغ: مفيش متجر في
 * السياق، فمفيش استعلام يتقال عليه إنه خرج بره نطاق المتجر.
 */
@Injectable()
export class ActiveStoreGuard implements CanActivate {
  constructor(
    private readonly activeStoreService: ActiveStoreService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    const userId = request.user?.id ?? request.user?.sub
    if (!userId) {
      // من المفروض الـ Auth Guard اللي قبله يكون رفض الطلب قبل ما يوصل
      // هنا أصلاً. منكررش خطأ Auth هنا — الـ Auth Guard هو المسؤول عنه.
      return true
    }

    const storeIdentifier: string | null =
      (request.headers['x-store-id'] as string) ||
      (request.headers['x-store-slug'] as string) ||
      request.params?.storeSlug ||
      null

    const store = await this.activeStoreService.resolveActiveStore(
      userId,
      storeIdentifier,
    )

    request.activeStore = store
    request.activeStoreId = store.id

    // ⚠️ بعد التحقق من الملكية، مش قبله. لو اتحطت قبل، أي طلب بيطلب
    // متجر مش بتاعه كان هيملا السياق بمتجر مالوش حق فيه، والحارس نفسه
    // كان هيبقى مصدر التسريب بدل ما يمنعه.
    this.tenantContext.setStoreId(store.id.toString())

    return true
  }
}
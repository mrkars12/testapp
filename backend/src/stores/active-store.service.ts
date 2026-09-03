import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { store as StoreRecord } from '@prisma/client'

/**
 * ActiveStoreService
 * ====================
 * البنية التحتية المشتركة لحل "المتجر الفعّال" لأي مستخدم بأمان.
 *
 * ⚠️ قاعدة أمان أساسية: أي storeIdentifier (id أو slug) قادم من الفرونت
 * (هيدر / باراميتر / URL) بيتعامل معاه هنا دايماً كـ "مفتاح بحث" بس،
 * مش كحقيقة موثوقة. مفيش أي استعلام بيرجع صف متجر من غير ما يتأكد إن
 * ownerId بتاعه == userId الحالي. لو مش بتاعه، بنرجع NotFoundException
 * (مش بنفرّق بين "مش موجود" و"موجود بس مش بتاعك") عشان منسربش معلومة
 * عن وجود متاجر تانية لمستخدمين تانيين.
 *
 * لو مفيش storeIdentifier مبعوت خالص، بنرجع لنفس السلوك الحالي في
 * المشروع (أول متجر بيملكه اليوزر) — للحفاظ على التوافق الكامل مع كل
 * الكود الحالي لحد ما نربط الـ UI بتاع اختيار المتجر في مرحلة لاحقة.
 */
@Injectable()
export class ActiveStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** أكبر قيمة يقدر عمود bigint في Postgres يشيلها. */
  private static readonly MAX_STORE_ID = 9223372036854775807n

  /**
   * يحوّل الـ identifier لـ id رقمي، أو null لو مش رقم أصلاً أو رقم
   * أكبر من اللي العمود يستحمله.
   *
   * ⚠️ الجزء بتاع الحد الأقصى مش تجميل: من غيره الرقم الكبير كان
   * بيتبعت لـ Postgres وبيرجع خطأ من الـ driver، اللي بيطلع للعميل
   * 500 بدل 404. أي هيدر X-Store-Id قديم أو متعدّل بالإيد لازم يبقى
   * رفض نضيف الواجهة تقدر تتعافى منه، مش صفحة خطأ.
   */
  private toStoreId(storeIdentifier: string): bigint | null {
    if (!/^\d+$/.test(storeIdentifier)) return null

    const value = BigInt(storeIdentifier)

    return value > ActiveStoreService.MAX_STORE_ID ? null : value
  }

  /**
   * يحل المتجر الفعّال. لا يفرّق بين "غير موجود" و"غير مملوك" في الخطأ
   * المرجوع — مناسب للاستخدام العام (قراءة/كتابة) في الـ Guard.
   */
  async resolveActiveStore(
    userId: string | bigint,
    storeIdentifier?: string | null,
  ): Promise<StoreRecord> {
    const ownerId = BigInt(userId)

    if (storeIdentifier) {
      const numericId = this.toStoreId(storeIdentifier)

      const store = await this.prisma.store.findFirst({
        where: {
          ownerId,
          ...(numericId !== null
            ? { id: numericId }
            : { slug: storeIdentifier }),
        },
      })

      if (!store) {
        throw new NotFoundException('Store not found')
      }

      return store
    }

    // مفيش identifier — نفس سلوك findFirst({ownerId}) الحالي في المشروع،
    // بس بترتيب زمني صريح (أقدم متجر) عشان يكون سلوك حتمي وقابل للتوقع
    // بدل ما نسيب Postgres يختار أي ترتيب.
    const store = await this.prisma.store.findFirst({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
    })

    if (!store) {
      throw new NotFoundException('Store not found')
    }

    return store
  }

  /**
   * نسخة صارمة: بترمي ForbiddenException (مش NotFoundException) لو
   * الـ identifier موجود فعلاً بس مملوك ليوزر تاني — مفيدة في السياقات
   * الحساسة (حذف/تعديل) اللي محتاجة تفرقة واضحة في الـ logs/monitoring
   * بين "معرّف غلط" و"محاولة وصول لمتجر مش بتاعك". اختيارية الاستخدام،
   * وهتتفعّل في المراحل الجاية حسب الحاجة الفعلية لكل endpoint.
   */
  async assertOwnership(
    userId: string | bigint,
    storeIdentifier: string,
  ): Promise<StoreRecord> {
    const ownerId = BigInt(userId)
    const numericId = this.toStoreId(storeIdentifier)

    const store = await this.prisma.store.findFirst({
      where: numericId !== null
        ? { id: numericId }
        : { slug: storeIdentifier },
    })

    if (!store) {
      throw new NotFoundException('Store not found')
    }

    if (store.ownerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this store')
    }

    return store
  }
}

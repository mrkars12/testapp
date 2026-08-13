import { Module } from '@nestjs/common'
import { ActiveStoreService } from './active-store.service'
import { ActiveStoreGuard } from './active-store.guard'
import { PrismaModule } from '../prisma/prisma.module'

/**
 * ActiveStoreModule
 * ==================
 * البنية التحتية المشتركة لتحديد "المتجر الفعّال" بأمان لأي Controller
 * محتاج يشتغل على أكتر من متجر لنفس اليوزر (multi-store).
 *
 * أي Module تاني عايز يستخدم ActiveStoreGuard أو @ActiveStore()/@ActiveStoreId()
 * لازم يعمل import للـ Module ده، بنفس فكرة استيراد PrismaModule.
 *
 * ⚠️ مرحلة التأسيس: ده Module بنية تحتية بس دلوقتي — مفيش أي Controller
 * حالي بيستخدمه، فمفيش أي تغيير في سلوك أي API موجود.
 */
@Module({
  imports: [PrismaModule],
  providers: [ActiveStoreService, ActiveStoreGuard],
  exports: [ActiveStoreService, ActiveStoreGuard],
})
export class ActiveStoreModule {}

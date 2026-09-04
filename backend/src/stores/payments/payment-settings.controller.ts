import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import { ActiveStoreGuard } from '../active-store.guard'
import { ActiveStore } from '../active-store.decorator'
import type { store as StoreRecord } from '@prisma/client'
import { PaymentAccountService } from './payment-account.service'
import { UpsertPaymentAccountDto } from './dto/upsert-payment-account.dto'

/**
 * إعدادات الدفع للتاجر.
 *
 * المسارات محفوظة زي ما هي عشان الواجهة الموجودة تفضل شغّالة:
 *   GET    /api/stores/payment-settings
 *   PUT    /api/stores/payment-settings/:gateway
 *   DELETE /api/stores/payment-settings/:gateway/credentials
 *
 * ⚠️ ولا endpoint واحد هنا بيرجّع بيانات اعتماد مفكوكة. الواجهة بتاخد
 * is_configured و credentials_hint (آخر 4 حروف) بس.
 *
 * العزل بين المتاجر بيتم بـ ActiveStoreGuard زي باقي الموديولات —
 * كل استدعاء بياخد store.id من الـ guard، مش من جسم الطلب.
 */
@Controller('stores')
@UseGuards(SessionAuthGuard)
export class PaymentSettingsController {
  constructor(private readonly accounts: PaymentAccountService) {}

  @Get('payment-settings')
  @UseGuards(ActiveStoreGuard)
  async list(@ActiveStore() store: StoreRecord) {
    return this.accounts.listSettings(store.id)
  }

  @Put('payment-settings/:gateway')
  @UseGuards(ActiveStoreGuard)
  async upsert(
    @ActiveStore() store: StoreRecord,
    @Param('gateway') gateway: string,
    @Body() body: UpsertPaymentAccountDto,
  ) {
    return this.accounts.upsert(store.id, gateway, body)
  }

  @Delete('payment-settings/:gateway/credentials')
  @UseGuards(ActiveStoreGuard)
  async clearCredentials(
    @ActiveStore() store: StoreRecord,
    @Param('gateway') gateway: string,
    @Query('mode') mode?: string,
    @Query('display_name') displayName?: string,
  ) {
    const resolvedMode = mode === 'test' ? 'test' : 'live'
    return this.accounts.clearCredentials(
      store.id,
      gateway,
      resolvedMode,
      displayName,
    )
  }

  /**
   * "تحقّق من الويبهوك" — تعيد قراءة الحالة من آخر WebhookEvent وصل
   * فعلاً لهذا الحساب. مش استدعاء للمزوّد؛ إعادة تحقّق للإشارة
   * المخزّنة عندنا، عشان التاجر يقدر يضغط الزر بعد ما يهيّئ الـ
   * webhook عند المزوّد ويشوف الحالة تتحدّث.
   */
  @Get('payment-settings/:gateway/webhook')
  @UseGuards(ActiveStoreGuard)
  async webhookStatus(
    @ActiveStore() store: StoreRecord,
    @Param('gateway') gateway: string,
    @Query('mode') mode?: string,
  ) {
    const resolvedMode = mode === 'test' ? 'test' : 'live'
    return this.accounts.webhookStatus(store.id, gateway, resolvedMode)
  }

  /**
   * "إنشاء Secret Token" — يولّد سر webhook قوي على السيرفر ويخزّنه
   * مشفّراً على الحساب الموجود بالفعل. مقتصر على البوابات اللي بتعلن
   * `supports_generated_webhook_secret` (ميسر بس دلوقتي — انظر
   * PaymentAccountService.generateWebhookSecret). النص الصريح بيترجع
   * مرة واحدة بس هنا؛ ولا endpoint تاني بيرجّعه تاني أبداً.
   *
   * store.id بييجي من الـ guard زي كل مسار تاني هنا، مش من جسم الطلب —
   * التاجر مايقدرش يولّد سر لحساب متجر تاني ولا لوضع (test/live) غير
   * اللي محدده صراحة في الـ query.
   */
  @Post('payment-settings/:gateway/webhook/secret/generate')
  @UseGuards(ActiveStoreGuard)
  async generateWebhookSecret(
    @ActiveStore() store: StoreRecord,
    @Param('gateway') gateway: string,
    @Query('mode') mode?: string,
    @Query('display_name') displayName?: string,
  ) {
    const resolvedMode = mode === 'test' ? 'test' : 'live'
    return this.accounts.generateWebhookSecret(
      store.id,
      gateway,
      resolvedMode,
      displayName,
    )
  }
}

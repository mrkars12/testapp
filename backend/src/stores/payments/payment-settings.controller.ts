import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
}

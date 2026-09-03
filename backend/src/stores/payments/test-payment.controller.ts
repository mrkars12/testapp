import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import type { store as StoreRecord } from '@prisma/client'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import { ActiveStoreGuard } from '../active-store.guard'
import { ActiveStore } from '../active-store.decorator'
import { TestPaymentService } from './test-payment.service'
import { InitiateTestPaymentDto } from './dto/initiate-test-payment.dto'

/**
 * Merchant-only test payments — proving a TEST-mode gateway account
 * actually works, against the real provider, without ever creating an
 * Order or touching inventory/revenue.
 *
 * Every route requires an authenticated session AND ownership of the
 * resolved store (`SessionAuthGuard` + `ActiveStoreGuard`, the same pair
 * every other merchant-only payments endpoint uses). There is no public,
 * unauthenticated path to any of this — unlike the storefront checkout
 * controller, which is deliberately public. A request with no valid
 * session cookie never reaches the service at all.
 */
@Controller('stores/payments/test')
@UseGuards(SessionAuthGuard)
export class TestPaymentController {
  constructor(private readonly testPayments: TestPaymentService) {}

  @Post()
  @UseGuards(ActiveStoreGuard)
  async initiate(
    @ActiveStore() store: StoreRecord,
    @Body() body: InitiateTestPaymentDto,
  ) {
    return this.testPayments.initiate(store.id, store.currency ?? 'USD', body)
  }

  @Post(':token/sync')
  @UseGuards(ActiveStoreGuard)
  async sync(@ActiveStore() store: StoreRecord, @Param('token') token: string) {
    return this.testPayments.sync(store.id, token)
  }

  @Get(':token')
  @UseGuards(ActiveStoreGuard)
  async status(@ActiveStore() store: StoreRecord, @Param('token') token: string) {
    return this.testPayments.status(store.id, token)
  }
}

import { Global, Module } from '@nestjs/common'
import { TenantContextService } from './tenant-context.service'
import { TenantContextMiddleware } from './tenant-context.middleware'

/**
 * سياق المستأجر.
 *
 * @Global عشان PrismaService (في موديول عام) محتاج يحقن
 * TenantContextService من غير ما يحصل اعتماد دائري بين الموديولين.
 *
 * الميدلوير بيتسجّل في main.ts، والـ extension بيتركّب في PrismaService.
 */
@Global()
@Module({
  providers: [TenantContextService, TenantContextMiddleware],
  exports: [TenantContextService, TenantContextMiddleware],
})
export class TenantModule {}

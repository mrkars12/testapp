import { Module } from '@nestjs/common'
import { IdempotencyInterceptor } from './idempotency.interceptor'
import { IdempotencyService } from './idempotency.service'

/**
 * منع التكرار.
 *
 * الـ interceptor **مش مسجّل عالمياً** عن قصد — بيتفعّل بالديكوريتر
 * @Idempotent على الراوت. كده مفيش أي endpoint موجود بيتأثر.
 *
 * PrismaModule و ConfigModule و TenantModule كلهم @Global فمش محتاجين
 * استيراد هنا.
 */
@Module({
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}

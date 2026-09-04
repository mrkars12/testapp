import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { ValidationPipe, Logger, ForbiddenException } from '@nestjs/common'
import { AppModule } from './app.module'
import cookieParser from 'cookie-parser'
import type { AppConfig } from './common/config/configuration'
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware'
import { applySecurityHeaders } from './common/security-headers.middleware'
import { csrfProtection } from './common/csrf-protection.middleware'
import { buildCorsOriginChecker } from './common/config/cors-origin-matcher'

// Prisma بيرجّع BigInt، و JSON.stringify مابيعرفش يتعامل معاه.
// لازم يفضل هنا قبل أي serialization.
;(BigInt.prototype as any).toJSON = function () {
  return this.toString()
}

async function bootstrap() {
  const logger = new Logger('Bootstrap')

  // rawBody مطلوبة للتحقق من توقيع الـ webhooks في المراحل الجاية.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  const config = app.get(ConfigService)
  const { port, corsOrigins, nodeEnv } = config.getOrThrow<AppConfig>('app')

  // CORS MUST be the very first middleware. Express/Nest middleware runs
  // in registration order, and every middleware after this one is capable
  // of short-circuiting a request with its own `res.status(...).json(...)`
  // (csrfProtection does exactly this for a rejected request) — a response
  // sent before the `cors` package's middleware has run carries no
  // `Access-Control-Allow-Origin` header at all, regardless of the actual
  // status code. The browser then reports a generic CORS failure instead
  // of the real 4xx/5xx, which is exactly what masked the credentials-
  // endpoint bug below. Registering CORS first guarantees every response —
  // success or error, from any later middleware or the app itself — gets
  // the correct CORS headers.
  const isAllowedOrigin = buildCorsOriginChecker(corsOrigins)

  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true)
      } else {
        // A browser calling from an origin outside the allowlist is a
        // normal, expected occurrence (a stray tab, a stale bookmark, a
        // misconfigured client) — not a server fault. A plain `Error`
        // here used to escape as an unhandled exception: Nest's default
        // filter logged it as a full ERROR-level stack trace and
        // answered with a generic `{"statusCode":500,"message":"Internal
        // server error"}`, carrying no CORS headers (correct — a
        // rejected origin must never see one) but reading, to both the
        // browser console and the server log, exactly like a crash. That
        // noise is also what buried the real credentials-endpoint bug
        // this file's CORS-must-run-first comment above describes.
        //
        // A `ForbiddenException` is still an active, logged rejection
        // (this does not fall back to the `cors` package's silent
        // `callback(null, false)`, which would let the request continue
        // unauthenticated through the app and rely on the browser alone
        // to hide the response) — it just reports as what it is: a 403,
        // not a 500, with the actual rejected origin recorded so a real
        // occurrence is diagnosable from the log alone.
        logger.warn(`CORS rejected origin: ${origin ?? '(none)'}`)
        callback(new ForbiddenException('Origin not allowed.'))
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Register-Flow',
      'X-Register-Signature',
      'X-Device-Fingerprint',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Store-Slug',
    ],
  })

  app.use(cookieParser())
  app.use(applySecurityHeaders)
  app.use(csrfProtection)

  /**
   * سياق المستأجر — لازم بعد cookieParser وقبل التوجيه.
   * بيفتح AsyncLocalStorage للطلب وبيكمّل. مابيرفضش أي طلب.
   */
  const tenantMiddleware = app.get(TenantContextMiddleware)
  app.use(tenantMiddleware.use.bind(tenantMiddleware))

  /**
   * التحقق من الـ DTOs.
   *
   * class-validator و class-transformer كانوا مثبتين في المشروع من غير
   * ما يتفعّلوا، يعني كل الـ DTOs الموجودة كانت شكلية. تفعيلهم هنا.
   *
   * forbidNonWhitelisted مقفولة عن قصد: whitelist بتشيل الحقول الزيادة
   * بصمت بدل ما ترفض الطلب كله، فمفيش طلب كان بينجح هيبدأ يفشل.
   *
   * ملاحظة: الـ routes اللي مكتوبة @Body() body: any مالهاش metatype،
   * فـ NestJS بيتخطاها تماماً — يعني أغلب الكود الحالي مش متأثر.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  )

  app.setGlobalPrefix('api')

  // بيخلي onModuleDestroy تشتغل فعلاً عند SIGTERM — مهم لقفل اتصالات
  // Prisma بشكل نظيف.
  app.enableShutdownHooks()

  await app.listen(port)

  logger.log(`🚀 Server running on http://localhost:${port}/api [${nodeEnv}]`)
  logger.log(`🔓 CORS origins: ${corsOrigins.join(', ')}`)
}

bootstrap()

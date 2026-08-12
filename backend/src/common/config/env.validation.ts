import { plainToInstance } from 'class-transformer'
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator'

/**
 * التحقق من متغيرات البيئة وقت الإقلاع.
 *
 * أي متغير ناقص أو غلط بيوقّف السيرفر فوراً بخطأ واضح بدل ما يفضل شغال
 * ويقع بعدين عند أول استخدام. ده اللي بيخلينا نقدر نشيل الـ fallback
 * secrets المكتوبة في الكود بأمان.
 *
 * ⚠️ ملاحظة على القيم المنطقية: @IsBoolean() مع enableImplicitConversion
 * **مابتشتغلش** — class-transformer بيحوّل أي نص لـ true، فـ "flase"
 * و "yes" و "0" كلهم بيعدّوا من غير أي خطأ. ولأن configuration.ts
 * بيقرأ process.env مباشرةً، الخطأ الإملائي كان هيعدّي بصمت ويطفّي
 * الموزّع. عشان كده بنتحقق منهم كنصوص بقائمة قيم مسموحة.
 *
 * ⚠️ كل متغيرات المرحلة 1a اختيارية بقيم افتراضية عن قصد: مفيش بيئة
 * شغالة حالياً ممكن تفشل في الإقلاع بسبب الإضافات دي.
 */

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** الأشكال المقبولة للقيم المنطقية في متغيرات البيئة */
const BOOLEAN_VALUES = ['true', 'false', '1', '0']

const BOOLEAN_MESSAGE = `القيمة لازم تكون واحدة من: ${BOOLEAN_VALUES.join(' | ')}`

export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 4000

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL مطلوب' })
  DATABASE_URL!: string

  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET مطلوب — مفيش fallback بعد دلوقتي' })
  JWT_SECRET!: string

  @IsString()
  @IsNotEmpty({ message: 'FLOW_SECRET مطلوب — مفيش fallback بعد دلوقتي' })
  FLOW_SECRET!: string

  @IsString()
  @IsNotEmpty({ message: 'PAYMENT_ENCRYPTION_KEY مطلوب' })
  PAYMENT_ENCRYPTION_KEY!: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PAYMENT_ENCRYPTION_KEY_VERSION: number = 1

  @IsOptional()
  @IsString()
  PAYMENT_ENCRYPTION_KEY_PREVIOUS?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION?: number

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000,*.localhost:3000'

  // ── المرحلة 1a: صندوق الصادر ────────────────────────────────

  @IsOptional()
  @IsString()
  @IsIn(BOOLEAN_VALUES, {
    message: `OUTBOX_DISPATCHER_ENABLED: ${BOOLEAN_MESSAGE}`,
  })
  OUTBOX_DISPATCHER_ENABLED?: string

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(300_000)
  OUTBOX_POLL_INTERVAL_MS: number = 5000

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  OUTBOX_BATCH_SIZE: number = 50

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(3600)
  OUTBOX_LEASE_SECONDS: number = 60

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  OUTBOX_MAX_ATTEMPTS: number = 8

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  OUTBOX_BACKOFF_BASE_SECONDS: number = 5

  // ── المرحلة 1a: منع التكرار ─────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(60)
  IDEMPOTENCY_TTL_SECONDS: number = 86_400

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(3600)
  IDEMPOTENCY_LEASE_SECONDS: number = 60

  // ── المرحلة 1a: حارس العزل ──────────────────────────────────

  @IsOptional()
  @IsString()
  @IsIn(BOOLEAN_VALUES, { message: `TENANT_GUARD_ENABLED: ${BOOLEAN_MESSAGE}` })
  TENANT_GUARD_ENABLED?: string
}

/** الحد الأدنى المفضل لطول الأسرار النصية — تحذير فقط، مش منع إقلاع */
const RECOMMENDED_SECRET_LENGTH = 32

/** الطول المطلوب لمفتاح التشفير بعد فك الـ base64 */
const REQUIRED_KEY_BYTES = 32

function assertBase64Key(name: string, value: string): void {
  const decoded = Buffer.from(value, 'base64')

  // Buffer.from مابيرميش خطأ على base64 غلط، بيتجاهل الحروف غير الصالحة،
  // فالتحقق من الطول هو خط الدفاع الحقيقي.
  if (decoded.length !== REQUIRED_KEY_BYTES) {
    throw new Error(
      `${name} لازم يكون ${REQUIRED_KEY_BYTES} byte بعد فك الـ base64 ` +
        `(الناتج الحالي ${decoded.length} byte). ` +
        `ولّده بالأمر: openssl rand -base64 32`,
    )
  }
}

function warnIfWeak(name: string, value: string): void {
  if (value.length < RECOMMENDED_SECRET_LENGTH) {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠️  ${name} طوله ${value.length} حرف — يُفضّل ${RECOMMENDED_SECRET_LENGTH} حرف على الأقل. ` +
        `ولّد واحد أقوى بالأمر: openssl rand -base64 48`,
    )
  }
}

/** تُستدعى من ConfigModule.forRoot({ validate }) */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    excludeExtraneousValues: false,
  })

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  })

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const messages = Object.values(error.constraints ?? {}).join(', ')
        return `  • ${error.property}: ${messages}`
      })
      .join('\n')

    throw new Error(
      `❌ إعدادات البيئة غير صالحة — السيرفر مش هيقوم:\n${details}\n\n` +
        `راجع backend/.env.example`,
    )
  }

  assertBase64Key('PAYMENT_ENCRYPTION_KEY', validated.PAYMENT_ENCRYPTION_KEY)

  if (validated.PAYMENT_ENCRYPTION_KEY_PREVIOUS) {
    assertBase64Key(
      'PAYMENT_ENCRYPTION_KEY_PREVIOUS',
      validated.PAYMENT_ENCRYPTION_KEY_PREVIOUS,
    )

    if (!validated.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION) {
      throw new Error(
        'PAYMENT_ENCRYPTION_KEY_PREVIOUS متظبط من غير ' +
          'PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION — لازم الاتنين مع بعض.',
      )
    }

    if (
      validated.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION ===
      validated.PAYMENT_ENCRYPTION_KEY_VERSION
    ) {
      throw new Error(
        'PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION لازم يكون مختلف عن ' +
          'PAYMENT_ENCRYPTION_KEY_VERSION.',
      )
    }
  }

  warnIfWeak('JWT_SECRET', validated.JWT_SECRET)
  warnIfWeak('FLOW_SECRET', validated.FLOW_SECRET)

  return validated
}

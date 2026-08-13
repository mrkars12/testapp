import { createHash } from 'crypto'
import type { Mode } from '../money/money.types'

/**
 * ══════════════════════════════════════════════════════════════════
 * عقود منع التكرار (Idempotency)
 * ══════════════════════════════════════════════════════════════════
 *
 * المشكلة اللي بيحلها: العميل بيبعت طلب دفع، الشبكة بتقطع قبل ما الرد
 * يوصله، العميل بيعيد الطلب. من غير منع تكرار العميل بيتحاسب مرتين.
 *
 * الحل: العميل بيبعت مفتاح فريد في هيدر Idempotency-Key. أول طلب
 * بيتنفّذ، وأي إعادة بنفس المفتاح بترجّع نفس الرد المخزّن.
 */

/** اسم الهيدر المعياري */
export const IDEMPOTENCY_HEADER = 'idempotency-key'

/** مفتاح الميتاداتا للديكوريتر */
export const IDEMPOTENCY_METADATA = Symbol('IDEMPOTENCY_METADATA')

/** الحد الأقصى لطول المفتاح — نفس حد العمود في قاعدة البيانات */
export const MAX_KEY_LENGTH = 255

export interface IdempotencyOptions {
  /**
   * اسم العملية المنطقي، مثال: "payments.create_intent".
   *
   * جزء من المفتاح الفريد، فمفتاح واحد من العميل ممكن يستخدم على
   * عمليتين مختلفتين من غير تعارض.
   */
  readonly scope: string

  /** مدة صلاحية السجل بالثواني — بيغلب الإعداد العام */
  readonly ttlSeconds?: number

  /**
   * دالة تنقية الرد قبل تخزينه.
   *
   * أي رد فيه بيانات حساسة لازم يمر من هنا. ردود الدفع بالتصميم
   * مافيهاش بيانات اعتماد، بس الخطاف موجود على أي حال.
   */
  readonly redact?: (body: unknown) => unknown
}

export interface ClaimRequest {
  readonly storeId: bigint
  readonly mode: Mode
  readonly scope: string
  readonly idempotencyKey: string
  readonly fingerprint: string
  readonly ttlSeconds: number
  readonly leaseSeconds: number
}

export type ClaimResult =
  /** أول مرة — نفّذ العملية */
  | { readonly outcome: 'proceed'; readonly recordId: bigint }
  /** نفس المفتاح ونفس الطلب واتنفّذ خلاص — رجّع الرد المخزّن */
  | {
      readonly outcome: 'replay'
      readonly statusCode: number
      readonly body: unknown
    }
  /** نفس المفتاح بس الطلب مختلف — العميل غلطان */
  | { readonly outcome: 'conflict'; readonly detail: string }
  /** نفس المفتاح ولسه بيتنفّذ في طلب متوازي */
  | { readonly outcome: 'in_flight'; readonly retryAfterSeconds: number }

/**
 * تسلسل ثابت للكائنات — نفس المحتوى بيدّي نفس النص دايماً.
 *
 * JSON.stringify العادي بيحافظ على ترتيب إدخال المفاتيح، يعني
 * {a:1,b:2} و {b:2,a:1} بيدّوا نصين مختلفين رغم إنهم نفس الطلب.
 * ده كان هيخلي إعادة إرسال بنفس البيانات تتحسب "طلب مختلف" وترجّع 409.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'

  if (typeof value === 'bigint') return `"${value.toString()}"`

  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`
}

/**
 * بصمة الطلب — sha256 لـ (الميثود + المسار + الجسم).
 *
 * لو العميل بعت نفس المفتاح بجسم مختلف، البصمة هتختلف وبنرجّع 409
 * بدل ما نرجّع رد عملية تانية خالص.
 */
export function fingerprintRequest(input: {
  method: string
  path: string
  body: unknown
}): string {
  const canonical = canonicalize({
    method: input.method.toUpperCase(),
    path: input.path,
    body: input.body ?? null,
  })

  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** بيتحقق من شكل المفتاح اللي جاي من العميل */
export function validateIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error('Idempotency-Key لازم يكون نص.')
  }

  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    throw new Error('Idempotency-Key ماينفعش يكون فاضي.')
  }

  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new Error(
      `Idempotency-Key أطول من الحد المسموح (${MAX_KEY_LENGTH} حرف).`,
    )
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    throw new Error('Idempotency-Key بيقبل حروف وأرقام و . _ : - بس.')
  }

  return trimmed
}

/** بيتعرّف على تعارض القيد الفريد في Prisma من غير ما يعتمد على الأنواع المولّدة */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

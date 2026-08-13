import type { Mode } from '../money/money.types'

/**
 * ══════════════════════════════════════════════════════════════════
 * عقد صندوق الصادر
 * ══════════════════════════════════════════════════════════════════
 *
 * المشكلة اللي بيحلها: تغيير الحالة في قاعدة البيانات + إرسال حدث
 * لنظام تاني = كتابة مزدوجة. لو الأولى نجحت والتانية فشلت، النظام
 * بيقع في حالة غير متسقة. في المرحلة 1b ده معناه: عملية دفع نجحت
 * وطلب ماتعملش.
 *
 * الحل: الحدث بيتكتب كصف في نفس الـ transaction بتاعة تغيير الحالة.
 * يا الاتنين يتحفظوا يا الاتنين يترجعوا. موزّع منفصل بيقراهم بعدين.
 */

/** إصدار العقد الحالي — بيتخزّن مع كل رسالة */
export const CURRENT_EVENT_VERSION = 1

export interface OutboxEnvelope {
  readonly storeId: bigint
  readonly mode: Mode
  /** نوع الكيان المصدر، مثال: 'checkout' */
  readonly aggregateType: string
  readonly aggregateId: string
  /** نوع الحدث، مثال: 'checkout.committed' */
  readonly eventType: string
  readonly eventVersion?: number
  readonly payload: Record<string, unknown>
  /** وقت حدوث الحدث في العمل — الافتراضي دلوقتي */
  readonly occurredAt?: Date
}

export interface OutboxRecord {
  readonly id: bigint
  readonly storeId: bigint
  readonly mode: Mode
  readonly aggregateType: string
  readonly aggregateId: string
  readonly eventType: string
  readonly eventVersion: number
  readonly payload: Record<string, unknown>
  readonly attempts: number
  readonly occurredAt: Date
}

/** مستهلك حدث. لازم يكون idempotent — التسليم at-least-once. */
export interface OutboxHandler {
  /** اسم فريد — جزء من مفتاح منع التكرار في consumed_events */
  readonly consumerName: string
  handle(message: OutboxRecord): Promise<void>
}

/**
 * مفاتيح ممنوعة في حمولة الأحداث.
 *
 * قاعدة ملزمة: الصندوق بيحمل معرّفات وتغييرات حالة، **مش أسرار ولا
 * لقطات كاملة للكيانات**. المستهلك اللي محتاج تفاصيل بيقراها من المصدر
 * بصلاحياته هو. من غير القاعدة دي الصندوق بيبقى قناة جانبية بتلتف حول
 * كل ضوابط الوصول في النظام.
 */
const FORBIDDEN_SUBSTRINGS = [
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'secret_key',
  'private_key',
  'credentials',
  'credentials_encrypted',
  'authorization',
  'card_number',
  'cvv',
]

/**
 * رموز قصيرة لازم تتطابق بالكامل مش كجزء من كلمة.
 *
 * "pan" لو اتقارنت كجزء كانت هتمنع أسماء بريئة زي expandedItems
 * و companyPanel و spanClass — كلهم بيحتووا على "pan" بعد التوحيد.
 */
const FORBIDDEN_EXACT = ['pan']

export class OutboxPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboxPayloadError'
    Object.setPrototypeOf(this, OutboxPayloadError.prototype)
  }
}

/**
 * يوحّد اسم المفتاح قبل المقارنة.
 *
 * ⚠️ من غير التوحيد ده، المقارنة بتفشل مع الأسماء بصيغة camelCase:
 * "cardNumber" بحروف صغيرة بتبقى "cardnumber"، واللي مابيحتويش على
 * "card_number"، فالمفتاح كان بيعدّي. بنشيل كل حاجة مش حرف أو رقم من
 * الطرفين عشان card_number و cardNumber و card-number كلهم يتطابقوا.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const FORBIDDEN_SUBSTRINGS_NORMALIZED = FORBIDDEN_SUBSTRINGS.map(normalizeKey)
const FORBIDDEN_EXACT_NORMALIZED = new Set(FORBIDDEN_EXACT.map(normalizeKey))

/** بيفحص الحمولة بحثاً عن مفاتيح تبدو حساسة، على أي عمق */
export function assertPayloadIsSafe(payload: unknown, path = 'payload'): void {
  if (payload === null || typeof payload !== 'object') return

  if (Array.isArray(payload)) {
    payload.forEach((item, index) =>
      assertPayloadIsSafe(item, `${path}[${index}]`),
    )
    return
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalized = normalizeKey(key)

    const isForbidden =
      FORBIDDEN_EXACT_NORMALIZED.has(normalized) ||
      FORBIDDEN_SUBSTRINGS_NORMALIZED.some((forbidden) =>
        normalized.includes(forbidden),
      )

    if (isForbidden) {
      throw new OutboxPayloadError(
        `حمولة الحدث فيها مفتاح يبدو حساس: ${path}.${key}. ` +
          `الصندوق بيحمل معرّفات وتغييرات حالة بس — راجع AI_RULES.md.`,
      )
    }

    assertPayloadIsSafe(value, `${path}.${key}`)
  }
}

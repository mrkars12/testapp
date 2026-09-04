const PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  declined: 'تم رفض عملية الدفع — حاول ببطاقة أخرى',
  declined_insufficient_funds: 'رصيد البطاقة غير كافٍ',
  declined_do_not_honor: 'البنك رفض العملية — تواصل مع البنك',
  declined_card_invalid: 'بيانات البطاقة غير صحيحة',
  declined_risk: 'تم رفض العملية لأسباب أمنية',
  authentication_required: 'التحقق مطلوب — أكمل خطوة التحقق مع البنك',
  authentication_failed: 'فشل التحقق — حاول مرة أخرى',
  amount_limit: 'المبلغ خارج الحدود المسموحة',
  currency_unsupported: 'العملة غير مدعومة لهذه الوسيلة',
  method_unavailable: 'وسيلة الدفع غير متاحة حالياً',
  duplicate_request: 'تم إرسال الطلب مسبقاً — جارٍ المعالجة',
  provider_unavailable: 'مزود الدفع غير متاح حالياً — حاول لاحقاً',
  provider_timeout: 'انتهت مهلة الاتصال بمزود الدفع — حاول مرة أخرى',
  rate_limited: 'عدد كبير من المحاولات — انتظر قليلاً وحاول مرة أخرى',
  configuration_error: 'خطأ في إعدادات بوابة الدفع — تواصل مع التاجر',
  mode_mismatch: 'وضع البيئة غير متطابق — تواصل مع التاجر',
  invalid_card: 'بيانات البطاقة غير صحيحة',
  insufficient_funds: 'رصيد البطاقة غير كافٍ',
  risk: 'تم رفض العملية لأسباب أمنية',
}

export function normalizePaymentError(err: any): string {
  const raw = err?.response?.data || err?.data || err
  const code = String(raw?.code || raw?.error_code || raw?.errorCode || '').toLowerCase()
  if (code && PAYMENT_ERROR_MESSAGES[code]) return PAYMENT_ERROR_MESSAGES[code]
  // Try to extract clean message without leaking provider internals
  const msg = String(raw?.message || err?.message || '')
  if (!msg) return 'حدث خطأ أثناء معالجة الدفع — حاول مرة أخرى'
  // Avoid leaking secrets or raw provider payloads
  if (msg.length > 200) return 'حدث خطأ أثناء معالجة الدفع — حاول مرة أخرى'
  if (msg.toLowerCase().includes('secret') || msg.toLowerCase().includes('publishable_key') || msg.includes('client_secret')) {
    return 'حدث خطأ أثناء معالجة الدفع — حاول مرة أخرى'
  }
  return msg
}

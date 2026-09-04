import type { AccountStatus, WebhookAccountStatus } from './types'

/* ══════════════════════════════════════════════════════════════════════
   Status vocabulary shown to merchants. Two independent badges, not one
   flat status: a gateway account's own lifecycle (draft → verifying →
   active/errored/disabled) is orthogonal to its webhook's lifecycle
   (not_configured → configured → verified/verification_failed). Both
   map 1:1 onto backend enums that already exist — no schema change.
   ══════════════════════════════════════════════════════════════════════ */

export const GATEWAY_STATUS_LABEL: Record<AccountStatus, string> = {
  draft: 'غير مهيّأة',
  verifying: 'جارٍ التحقق',
  active: 'مفعّلة',
  disabled: 'معطّلة',
  errored: 'خطأ',
}

export const GATEWAY_STATUS_BADGE: Record<AccountStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  verifying: 'bg-amber-50 text-amber-700',
  active: 'bg-green-50 text-green-700',
  disabled: 'bg-gray-100 text-gray-500',
  errored: 'bg-red-50 text-red-700',
}

export const WEBHOOK_STATUS_LABEL: Record<WebhookAccountStatus, string> = {
  not_configured: 'يلزم إعداد الويبهوك',
  configured: 'تم الإعداد — بانتظار أول نداء',
  verified: 'تم التحقق من الويبهوك',
  verification_failed: 'آخر نداء فشل التحقق منه',
  disabled: 'البوابة معطّلة',
}

export const WEBHOOK_STATUS_BADGE: Record<WebhookAccountStatus, string> = {
  not_configured: 'bg-amber-50 text-amber-700',
  configured: 'bg-blue-50 text-blue-700',
  verified: 'bg-green-50 text-green-700',
  verification_failed: 'bg-red-50 text-red-700',
  disabled: 'bg-gray-100 text-gray-500',
}

export const NOT_CONFIGURED_LABEL = 'غير مهيّأة'
export const NOT_CONFIGURED_BADGE = 'bg-gray-100 text-gray-500'

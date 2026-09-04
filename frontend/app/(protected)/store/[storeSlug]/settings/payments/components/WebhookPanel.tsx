import { useState } from 'react'
import type { Gateway, PublicAccount } from '@/lib/payments/types'
import { webhookUrl } from '@/lib/payments/types'
import { WEBHOOK_STATUS_BADGE, WEBHOOK_STATUS_LABEL } from '@/lib/payments/status'
import StatusBadge from './StatusBadge'
import { IconCopy, IconEye, IconEyeOff, IconSpinner } from './icons'

/**
 * Rendered only when `gateway.webhook_events.length > 0` — cod/bank_transfer
 * are offline methods with no adapter callback, so the caller never mounts
 * this for them. Every string here (URL, help text, event list, which
 * field holds the secret) comes from the catalog/account response, not
 * from a per-gateway conditional in this file.
 *
 * The Secret Token generation block below is the one part of this file
 * that IS gated on a per-gateway flag (`gateway.supports_generated_webhook_secret`),
 * because it genuinely is provider-specific — Stripe/Paymob/Tap each sign
 * with their own dashboard-issued secret and must never grow this button.
 * The flag itself is catalog data, not a `gateway.key === 'moyasar'` check
 * (see gateway-catalog.ts), so nothing here hardcodes which gateway that is.
 */
export default function WebhookPanel({
  gateway,
  account,
  mode,
  copiedUrl,
  onCopy,
  verifying,
  onVerify,
  generatedSecret,
  generatingSecret,
  onGenerateSecret,
  onDismissGeneratedSecret,
}: {
  gateway: Gateway
  account: PublicAccount | null
  mode: 'test' | 'live'
  copiedUrl: string | null
  onCopy: (text: string) => void
  verifying: boolean
  onVerify: () => void
  /** Plaintext token from the generate call, held only in the parent's in-memory state — never re-fetchable, never persisted. */
  generatedSecret?: string | null
  generatingSecret?: boolean
  onGenerateSecret?: () => void
  onDismissGeneratedSecret?: () => void
}) {
  const [revealSecret, setRevealSecret] = useState(false)

  const url = webhookUrl(gateway.key, account)
  if (!url) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-400">
        احفظ بيانات الاعتماد أولًا لإنشاء رابط الويبهوك الخاص بهذا الحساب.
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-gray-800">
          إعداد الويبهوك ({mode === 'test' ? 'Test' : 'Live'})
        </span>
        {account?.webhook && (
          <StatusBadge status={account.webhook.status} labelMap={WEBHOOK_STATUS_LABEL} colorMap={WEBHOOK_STATUS_BADGE} />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-gray-700">رابط الـ Webhook (من السيرفر لبوابة الدفع)</span>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 truncate rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-600 outline-none"
          />
          <button
            type="button"
            onClick={() => onCopy(url)}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-2 text-[12px] text-gray-600 hover:bg-white"
          >
            <IconCopy /> {copiedUrl === url ? 'تم النسخ' : 'نسخ'}
          </button>
        </div>
        <span className="text-[11px] text-gray-400">
          هذا رابط خادم-إلى-خادم — بوابة الدفع تناديه مباشرة، مش متصفح العميل.
        </span>
      </div>

      {gateway.webhook_setup_help_ar && (
        <p className="text-[11px] leading-relaxed text-gray-500">{gateway.webhook_setup_help_ar}</p>
      )}

      {gateway.webhook_secret_field && !gateway.supports_generated_webhook_secret && (
        <p className="text-[11px] text-blue-600">
          الصق السر اللي هتاخده من لوحة البوابة في حقل «{
            gateway.fields.find((f) => f.key === gateway.webhook_secret_field)?.label_ar ?? gateway.webhook_secret_field
          }» بالأعلى — نفس الحقل ده هو اللي بيتحقق بيه من توقيع الويبهوك.
        </p>
      )}

      {gateway.supports_generated_webhook_secret && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-2.5">
          <span className="text-[12px] font-medium text-gray-700">Secret Token</span>

          {generatedSecret ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={revealSecret ? generatedSecret : '•'.repeat(24)}
                  dir="ltr"
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 truncate rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-[12px] text-gray-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setRevealSecret((v) => !v)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-2 text-[12px] text-gray-600 hover:bg-white"
                >
                  {revealSecret ? <IconEyeOff /> : <IconEye />} {revealSecret ? 'إخفاء' : 'إظهار'}
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(generatedSecret)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-2 text-[12px] text-gray-600 hover:bg-white"
                >
                  <IconCopy /> {copiedUrl === generatedSecret ? 'تم النسخ' : 'نسخ'}
                </button>
              </div>
              <p className="text-[11px] font-medium text-amber-700">
                هذا السر سيتم عرضه لك الآن فقط. انسخه وضعه في Moyasar.
              </p>
              <button
                type="button"
                onClick={onDismissGeneratedSecret}
                className="self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              >
                لقد أضفته إلى Moyasar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onGenerateSecret}
              disabled={generatingSecret}
              className="self-start flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {generatingSecret && <IconSpinner />}
              {account?.webhook?.configured ? 'إعادة إنشاء Secret Token' : 'إنشاء Secret Token'}
            </button>
          )}
        </div>
      )}

      {gateway.webhook_events.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-gray-700">الأحداث المطلوبة</span>
          <div className="flex flex-wrap gap-1.5">
            {gateway.webhook_events.map((evt) => (
              <span
                key={evt.key}
                title={evt.required ? 'مطلوب' : 'اختياري'}
                className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-mono ${
                  evt.required ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-500'
                }`}
              >
                {evt.key}
              </span>
            ))}
          </div>
        </div>
      )}

      {account?.webhook?.last_event_at && (
        <span className="text-[11px] text-gray-400">
          آخر نداء وصل: {new Date(account.webhook.last_event_at).toLocaleString('ar-EG')}
          {' — '}
          {account.webhook.last_event_verified ? 'توقيعه صحيح' : 'فشل التحقق من توقيعه'}
        </span>
      )}

      <button
        type="button"
        onClick={onVerify}
        disabled={verifying}
        className="self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {verifying ? 'جاري التحقق...' : 'تحقّق من الويبهوك'}
      </button>
    </div>
  )
}

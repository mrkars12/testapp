import type { PaymentField } from '@/lib/payments/types'
import { IconLock } from './icons'

export default function SecretField({
  field,
  value,
  hint,
  isWebhookSecret,
  onChange,
}: {
  field: PaymentField
  value: string
  hint: string | undefined
  isWebhookSecret: boolean
  onChange: (value: string) => void
}) {
  return (
    <div
      className={`flex flex-col gap-1 ${
        isWebhookSecret ? 'rounded-lg border border-blue-100 bg-blue-50/40 p-2.5' : ''
      }`}
    >
      <label className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-gray-700">
        {field.type === 'password' && <IconLock />}
        {field.label_ar}
        {field.required && <span className="text-red-500">*</span>}
        {isWebhookSecret && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
            سر الويبهوك
          </span>
        )}
      </label>

      {field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={hint ? `الحالي: ${hint}` : field.placeholder}
          className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
        />
      ) : field.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-gray-400"
        >
          <option value="">اختر...</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label_ar}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'password' ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            hint ? `الحالي: ${hint} — سيبها فاضية لو مش عايز تغيّرها` : field.placeholder
          }
          className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
          dir="ltr"
        />
      )}
      {field.help_ar && <span className="text-[11px] leading-relaxed text-gray-400">{field.help_ar}</span>}
    </div>
  )
}

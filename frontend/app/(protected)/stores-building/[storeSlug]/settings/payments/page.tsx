'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '@/lib/config'
/* ══════════════════════════════════════════════════════════════════════
   Admin — Payment Settings
   /stores-building/[storeSlug]/settings/payments
   GET  /api/stores/payment-settings
   PUT  /api/stores/payment-settings/:provider
   DEL  /api/stores/payment-settings/:provider/credentials
   ══════════════════════════════════════════════════════════════════════ */

type FieldType = 'text' | 'password' | 'select' | 'textarea'

interface PaymentField {
  key: string
  label_ar: string
  type: FieldType
  required: boolean
  options?: { value: string; label_ar: string }[]
}

interface PaymentProvider {
  key: string
  name_ar: string
  description_ar: string
  requires_credentials: boolean
  supports_test_mode: boolean
  fields: PaymentField[]
  enabled: boolean
  is_test_mode: boolean
  is_configured: boolean
  credentials: Record<string, string> | null
  settings: Record<string, any>
}

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    className={`transition-transform ${open ? 'rotate-180' : ''}`}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
)
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconSpinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconLock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

export default function PaymentSettingsPage() {
  const [providers, setProviders] = useState<PaymentProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({})
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  const loadProviders = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/stores/payment-settings`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error()
      const data: PaymentProvider[] = await res.json()
      setProviders(data)
    } catch {
      setErrorByKey({ __global: 'تعذر تحميل بوابات الدفع، حاول تاني' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProviders() }, [])

  const getDraftValue = (provider: PaymentProvider, fieldKey: string) => {
    if (drafts[provider.key]?.[fieldKey] !== undefined) return drafts[provider.key][fieldKey]
    return provider.credentials?.[fieldKey] || ''
  }

  const setDraftValue = (providerKey: string, fieldKey: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [providerKey]: { ...prev[providerKey], [fieldKey]: value } }))
  }

  const toggleExpanded = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  /** تفعيل/تعطيل مباشر من الـ switch (من غير ما يفتح الفورم) */
  const handleToggle = async (provider: PaymentProvider) => {
    const nextEnabled = !provider.enabled

    // لو هيفعّل بوابة لسه مش متظبطة ومحتاجة بيانات — افتحله الفورم بدل ما يفشل بصمت
    if (nextEnabled && provider.requires_credentials && !provider.is_configured) {
      setExpandedKey(provider.key)
      return
    }

    setSavingKey(provider.key)
    setErrorByKey((prev) => ({ ...prev, [provider.key]: '' }))
    try {
      const res = await fetch(
  `${API_URL}/stores/payment-settings/${provider.key}`,
  {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      enabled: nextEnabled,
      is_test_mode: provider.is_test_mode,
      credentials: drafts[provider.key] || {},
    }),
  }
)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'فشل التحديث')

      setProviders((prev) =>
        prev.map((p) => (p.key === provider.key ? { ...p, enabled: data.enabled } : p)),
      )
    } catch (err: any) {
      setErrorByKey((prev) => ({ ...prev, [provider.key]: err.message || 'حصل خطأ' }))
    } finally {
      setSavingKey(null)
    }
  }

  const handleSaveCredentials = async (provider: PaymentProvider) => {
    setSavingKey(provider.key)
    setErrorByKey((prev) => ({ ...prev, [provider.key]: '' }))
    try {
      const res = await fetch(`${API_URL}/stores/payment-settings/${provider.key}`, {
  method: 'PUT',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    enabled: true,
    is_test_mode: provider.is_test_mode,
    credentials: drafts[provider.key] || {},
  }),
})
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'فشل الحفظ')

      await loadProviders()
      setDrafts((prev) => ({ ...prev, [provider.key]: {} }))
      setExpandedKey(null)
      setSavedFlash(provider.key)
      setTimeout(() => setSavedFlash(null), 2000)
    } catch (err: any) {
      setErrorByKey((prev) => ({ ...prev, [provider.key]: err.message || 'حصل خطأ' }))
    } finally {
      setSavingKey(null)
    }
  }

  const handleTestModeToggle = (providerKey: string, checked: boolean) => {
    setProviders((prev) =>
      prev.map((p) => (p.key === providerKey ? { ...p, is_test_mode: checked } : p)),
    )
  }

 const handleClearCredentials = async (provider: PaymentProvider) => {
  setSavingKey(provider.key)

  try {
    const res = await fetch(
      `${API_URL}/stores/payment-settings/${provider.key}/credentials`,
      {
        method: 'DELETE',
        credentials: 'include',
      }
    )

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data?.message || 'فشل حذف البيانات')
    }

    await loadProviders()
  } catch (err: any) {
    setErrorByKey((prev) => ({
      ...prev,
      [provider.key]: err.message || 'حصل خطأ',
    }))
  } finally {
    setSavingKey(null)
  }
}

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-400">
        <IconSpinner />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">بوابات الدفع</h1>
        <p className="mt-1 text-sm text-gray-500">
          فعّل بوابات الدفع اللي عايز تقبل بيها الطلبات في متجرك. بياناتك محفوظة ومشفّرة بالكامل.
        </p>
      </div>

      {errorByKey.__global && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{errorByKey.__global}</div>
      )}

      <div className="flex flex-col gap-3">
        {providers.map((provider) => {
          const isExpanded = expandedKey === provider.key
          const isSaving = savingKey === provider.key

          return (
            <div
              key={provider.key}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              {/* رأس الكارت */}
              <div
                className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3.5"
                onClick={() => provider.requires_credentials && toggleExpanded(provider.key)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{provider.name_ar}</span>
                      {provider.is_configured && (
                        <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600">
                          <IconCheck /> متصلة
                        </span>
                      )}
                      {savedFlash === provider.key && (
                        <span className="text-[11px] font-medium text-green-600">تم الحفظ</span>
                      )}
                    </div>
                    <span className="truncate text-[12px] text-gray-500">{provider.description_ar}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  {isSaving && !isExpanded ? (
                    <span className="text-gray-400"><IconSpinner /></span>
                  ) : (
                    <button
                      onClick={() => handleToggle(provider)}
                      role="switch"
                      aria-checked={provider.enabled}
                      className="relative h-6 w-11 rounded-full transition-colors"
                      style={{ background: provider.enabled ? '#16a34a' : '#e5e7eb' }}
                    >
                      <span
                        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                        style={{ transform: provider.enabled ? 'translateX(-22px)' : 'translateX(-2px)', right: 0 }}
                      />
                    </button>
                  )}
                  {provider.requires_credentials && (
                    <button
                      onClick={() => toggleExpanded(provider.key)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <IconChevron open={isExpanded} />
                    </button>
                  )}
                </div>
              </div>

              {/* الفورم — بيتولد تلقائي من الحقول المعرّفة للبوابة دي */}
              {isExpanded && provider.requires_credentials && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                  {provider.supports_test_mode && (
                    <label className="mb-4 flex items-center gap-2 text-[13px] text-gray-700">
                      <input
                        type="checkbox"
                        checked={provider.is_test_mode}
                        onChange={(e) => handleTestModeToggle(provider.key, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      وضع تجريبي (Test mode)
                    </label>
                  )}

                  <div className="flex flex-col gap-3">
                    {provider.fields.map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <label className="flex items-center gap-1.5 text-[12.5px] font-medium text-gray-700">
                          {field.type === 'password' && <IconLock />}
                          {field.label_ar}
                          {field.required && <span className="text-red-500">*</span>}
                        </label>

                        {field.type === 'textarea' ? (
                          <textarea
                            value={getDraftValue(provider, field.key)}
                            onChange={(e) => setDraftValue(provider.key, field.key, e.target.value)}
                            rows={2}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
                          />
                        ) : field.type === 'select' ? (
                          <select
                            value={getDraftValue(provider, field.key)}
                            onChange={(e) => setDraftValue(provider.key, field.key, e.target.value)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-gray-400"
                          >
                            <option value="">اختر...</option>
                            {field.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label_ar}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type === 'password' ? 'password' : 'text'}
                            value={getDraftValue(provider, field.key)}
                            onChange={(e) => setDraftValue(provider.key, field.key, e.target.value)}
                            placeholder={
                              field.type === 'password' && provider.is_configured
                                ? 'سيبها فاضية لو مش عايز تغيّرها'
                                : ''
                            }
                            className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-gray-400"
                            dir="ltr"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {errorByKey[provider.key] && (
                    <p className="mt-3 text-[12.5px] text-red-500">{errorByKey[provider.key]}</p>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    {provider.is_configured ? (
                      <button
                        onClick={() => handleClearCredentials(provider)}
                        className="text-[12.5px] font-medium text-red-500 hover:underline"
                      >
                        فصل البوابة ومسح البيانات
                      </button>
                    ) : <span />}

                    <button
                      onClick={() => handleSaveCredentials(provider)}
                      disabled={isSaving}
                      className="flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {isSaving && <IconSpinner />}
                      حفظ وتفعيل
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useAuth } from '@/components/AuthProvider'
import { refreshStoreBootstrap } from '@/lib/storeBootstrap'

export default function NewStorePage() {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('SAR')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  // A social-login account that has never set a password (Part 9/10) needs
  // to finish its profile here — this is the first authenticated screen it
  // reaches with zero stores. A normal "create another store" visit (the
  // account already has a password) never shows these fields.
  const needsProfileCompletion = user?.has_password === false

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')

  useEffect(() => {
    if (!user) return
    setFirstName((prev) => prev || user.first_name || '')
    setLastName((prev) => prev || user.last_name || '')
  }, [user])

  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (needsProfileCompletion) {
      if (!firstName.trim() || !lastName.trim()) {
        setError('يرجى إدخال الاسم الأول واسم العائلة')
        return
      }
      if (password.length < 8) {
        setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
        return
      }
      if (password !== passwordConfirmation) {
        setError('كلمتا المرور غير متطابقتين')
        return
      }
    }

    setLoading(true)
    try {
      const payload: Record<string, unknown> = { name, slug, description, currency }
      if (needsProfileCompletion) {
        payload.first_name = firstName.trim()
        payload.last_name = lastName.trim()
        payload.password = password
      }

      const response = await api.post('/stores', payload)
      const data = response.data

      await refreshStoreBootstrap().catch(() => {})

      // Active store changes ONLY here, on confirmed success — never as a
      // side effect of merely visiting this page. Admin URLs carry no
      // store slug, so "go to the new store" is simply a navigation to
      // that store's URL — the slug in the address bar is what makes it
      // active.
      if (data?.slug) {
        router.push(`/store/${encodeURIComponent(data.slug)}`)
      } else {
        router.push('/store')
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'فشل في إنشاء المتجر')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-gray-50" dir="rtl">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="text-right mb-6 border-b border-gray-100 pb-4">
          <h2 className="text-xl font-bold text-gray-900">إنشاء متجر جديد</h2>
          <p className="text-sm text-gray-500 mt-1">
            {needsProfileCompletion
              ? 'أكمل بيانات حسابك ثم أنشئ متجرك الأول'
              : 'أكمل البيانات التالية لإنشاء متجرك'}
          </p>
        </div>

        {error && <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg text-right">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5 text-right">
          {needsProfileCompletion && (
            <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
              <p className="text-sm font-semibold text-blue-700">بيانات الحساب</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">الاسم الأول *</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم العائلة *</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={user?.email || ''}
                  readOnly
                  dir="ltr"
                  className="w-full px-4 py-2.5 border border-gray-100 bg-gray-100 text-gray-500 rounded-xl outline-none text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">كلمة المرور *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
                />
                <p className="mt-1 text-xs text-gray-500">تُستخدم لتسجيل الدخول بالبريد وكلمة المرور، بالإضافة إلى تسجيل الدخول الحالي عبر السوشيال ميديا.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">تأكيد كلمة المرور *</label>
                <input
                  type="password"
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم المتجر *</label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="متجر الأناقة"
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">رابط المتجر *</label>
            <div className="flex rounded-xl shadow-sm border border-gray-200 overflow-hidden focus-within:border-blue-600" dir="ltr">
              <span className="bg-gray-50 text-gray-400 px-3 py-2 text-sm border-r border-gray-200 flex items-center">/stores/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(slugify(e.target.value))
                }}
                placeholder="my-store"
                required
                className="w-full px-4 py-2 text-sm outline-none font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">وصف المتجر</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اكتب وصفاً مختصراً لمتجرك..."
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">العملة</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm bg-white shadow-sm"
            >
              <option value="SAR">ريال سعودي (SAR)</option>
              <option value="USD">دولار أمريكي (USD)</option>
              <option value="EGP">جنيه مصري (EGP)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-colors cursor-pointer disabled:bg-gray-300"
            >
              {loading ? 'جاري إنشاء المتجر...' : 'إنشاء المتجر'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/store')}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

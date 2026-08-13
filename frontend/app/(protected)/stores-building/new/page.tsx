'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { API_URL } from '@/lib/config'

export default function NewStorePage() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('SAR')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setName(value)
    
    // توليد السلاغ تلقائياً
    const generatedSlug = value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
    setSlug(generatedSlug)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${API_URL}/stores`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // 👈 إضافة السطر هنا أيضاً
  body: JSON.stringify({ name, slug, description, currency })
})

      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'فشل في إنشاء المتجر')

      router.push('/stores-building') // العودة لصفحة المتاجر بعد النجاح
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 bg-gray-50" dir="rtl">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="text-right mb-6 border-b border-gray-100 pb-4">
          <h2 className="text-xl font-bold text-gray-900">إنشاء متجر جديد</h2>
          <p className="text-sm text-gray-500 mt-1">أكمل البيانات التالية لإنشاء متجرك</p>
        </div>

        {error && <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg text-right">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5 text-right">
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
              <span className="bg-gray-50 text-gray-400 px-3 py-2 text-sm border-r border-gray-200 flex items-center">/storecraft.app/store</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
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
              onClick={() => router.push('/stores-building')}
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
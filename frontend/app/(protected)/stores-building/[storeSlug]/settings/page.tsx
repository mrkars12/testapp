'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { API_URL } from '@/lib/config'

export default function StoreSettingsPage() {
  const params = useParams()
  const storeSlug = params?.storeSlug as string
  const router = useRouter()
  
  const [storeId, setStoreId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [status, setStatus] = useState<number>(1) // 💡 جعلنا الحالة رقماً افتراضياً (1 تعني نشط)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // جلب البيانات الحالية للمتجر عند فتح الصفحة
  useEffect(() => {
    const fetchStoreData = async () => {
      try {
        const response = await fetch(`${API_URL}/stores`, {
          credentials: 'include'
        })
        if (!response.ok) throw new Error('فشل في جلب بيانات المتجر')
        const stores = await response.json()
        
        const currentStore = stores.find((s: any) => s.slug === storeSlug)
        if (!currentStore) throw new Error('المتجر غير موجود')

        setStoreId(currentStore.id)
        setName(currentStore.name)
        setDescription(currentStore.description || '')
        setCurrency(currentStore.currency)
        
        // 💡 قراءة الحالة كـ رقم؛ إذا كانت قادمة كـ BigInt أو String نقوم بتحويلها لـ Number (إما 1 أو 0)
        setStatus(Number(currentStore.status) === 0 ? 0 : 1)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    if (storeSlug) fetchStoreData()
  }, [storeSlug])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const response = await fetch(`http://localhost:4000/api/stores/${storeSlug}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ 
          id: storeId,
          name, 
          description, 
          currency, 
          status: Number(status), // 💡 التأكيد على إرسالها كـ رقم صريح للسيرفر
          slug: storeSlug
        })
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.message || 'فشل السيرفر في التحديث (خطأ 500)')
      }
      
      alert('تم حفظ التغييرات بنجاح!')
      router.refresh()
      router.push('/stores-building') 
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center mt-20 font-sans text-gray-500">جاري تحميل الإعدادات...</div>

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4 text-right">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">إعدادات المتجر</h1>
          <p className="text-sm text-gray-500 mt-0.5">{storeSlug}</p>
        </div>
        <button 
          onClick={() => router.push('/stores-building')}
          className="text-sm text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
        >
          ← عرض المتاجر
        </button>
      </div>

      {error && <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg text-right">{error}</div>}

      <form onSubmit={handleUpdate} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5 text-right">
        <h3 className="text-base font-bold text-gray-900 border-b border-gray-50 pb-2">المعلومات الأساسية</h3>
        
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم المتجر</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">وصف المتجر</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm shadow-sm"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">حالة المتجر</label>
            <select
              value={status}
              onChange={(e) => setStatus(Number(e.target.value))} // 💡 تحويل القيمة القادمة من الـ select لرقم فوراً
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm bg-white shadow-sm"
            >
              {/* 💡 استخدام القيم الرقمية 1 و 0 */}
              <option value={1}>نشط</option>
              <option value={0}>غير نشط</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">العملة</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:border-blue-600 text-sm bg-white shadow-sm"
            >
              <option value="USD">دولار أمريكي (USD)</option>
              <option value="SAR">ريال سعودي (SAR)</option>
              <option value="EGP">جنيه مصري (EGP)</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-gray-100">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-colors cursor-pointer disabled:bg-gray-300"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/stores-building')}
            className="px-5 py-2.5 border border-gray-200 text-gray-700 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors cursor-pointer"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
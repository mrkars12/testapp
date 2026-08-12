'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { API_URL } from '@/lib/config'

interface Store {
  id: number
  name: string
  slug: string
  currency: string
  status: string
}

export default function MyStoresPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    // جلب المتاجر من الباك-إند
    const fetchStores = async () => {
      try {
        const response = await fetch(`${API_URL}/stores`, {
          credentials: 'include', // 👈 هذا السطر يخبر المتصفح بإرسال الـ HttpOnly Cookie تلقائياً
        })
        if (!response.ok) throw new Error('فشل في جلب بيانات المتاجر')
        const data = await response.json()
        setStores(data)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchStores()
  }, [])

  if (loading) return <div className="text-center mt-20 font-sans text-gray-500">جاري تحميل المتاجر...</div>

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* الهيدر العلوى */}
      <div className="flex justify-between items-center mb-8 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-sans">متاجري</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة جميع متاجرك الإلكترونية</p>
        </div>
        <button
          onClick={() => router.push('/stores-building/new')}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
        >
          <span>+</span> متجر جديد
        </button>
      </div>

      {error && <div className="p-4 mb-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>}

      {/* لو لا يوجد متاجر */}
      {stores.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl bg-white">
          <p className="text-gray-500 font-medium">لم تقم بإنشاء أي متجر بعد.</p>
          <button 
            onClick={() => router.push('/stores-building/new')}
            className="mt-4 text-blue-600 font-semibold text-sm hover:underline"
          >
            أنشئ متجرك الأول الآن
          </button>
        </div>
      ) : (
        /* شبكة عرض المتاجر المحترفة Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stores.map((store) => (
            <div key={store.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
              {/* شارة حالة المتجر */}
              <span className={`absolute top-4 left-4 text-xs font-medium px-2.5 py-0.5 rounded-full ${
                store.status === '1' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {store.status === '1' ? 'نشط' : 'غير نشط'}
              </span>

              <h2 className="text-lg font-bold text-gray-900 mb-1 mt-2 text-right">{store.name}</h2>
              <p className="text-sm text-gray-400 font-mono text-right mb-4">/{store.slug}</p>
              
              <div className="flex items-center gap-2 mb-5">
                <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600 font-medium">{store.currency}</span>
              </div>

              {/* أزرار التحكم والربط الاحترافي */}
              <div className="grid grid-cols-4 gap-1 border-t border-gray-100 pt-4 text-center text-xs">
                <a 
                  href={`https://${store.slug}.dartcoin.com`} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="p-2 text-gray-600 hover:text-blue-600 font-medium transition-colors border border-gray-100 rounded-md hover:bg-gray-50"
                >
                  عرض ↗
                </a>
                <Link 
                  href='#'
                  className="p-2 text-gray-600 hover:text-blue-600 font-medium transition-colors border border-gray-100 rounded-md hover:bg-gray-50"
                >
                  المنتجات
                </Link>
                <Link 
                  href='#'
                  className="p-2 text-gray-600 hover:text-blue-600 font-medium transition-colors border border-gray-100 rounded-md hover:bg-gray-50"
                >
                  الطلبّات
                </Link>
                <Link 
                  href={`/stores-building/${store.slug}/settings`}
                  className="p-2 bg-blue-600 text-white font-medium transition-colors rounded-md hover:bg-blue-700"
                >
                  إعدادات
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
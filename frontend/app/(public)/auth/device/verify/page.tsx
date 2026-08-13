'use client'

import { useEffect, Suspense } from 'react' // 👈 أضفنا Suspense
import { useSearchParams, useRouter } from 'next/navigation'
import api from '@/lib/api'

// 1. المكون الذي يحتوي على منطق التحقق (Client Logic)
function VerifyDeviceContent() {
  const params = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
        // إذا لم يوجد توكن، قد ترغب في توجيهه للوجن بخطأ
        // router.replace('/login?device_error=1')
        return
    }

    api.post('/api/device/verify', { token })
      .then(() => {
        router.replace('/login?device_verified=1')
      })
      .catch(() => {
        router.replace('/login?device_error=1')
      })
  }, [params, router])

  return (
    <div className="min-h-screen flex items-center justify-center">
       <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 font-bold">جاري التحقق من الجهاز...</p>
       </div>
    </div>
  )
}

// 2. المكون الأساسي للصفحة (Page Wrapper)
export default function VerifyDevicePage() {
  return (
    // 🚩 تغليف المحتوى بـ Suspense هو الحل الوحيد لخطأ useSearchParams أثناء الـ Build
    <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-500 font-bold">
            جاري التحميل...
        </div>
    }>
      <VerifyDeviceContent />
    </Suspense>
  )
}
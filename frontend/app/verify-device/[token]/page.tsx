'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useAuth } from '@/components/AuthProvider'

export default function VerifyPage() {
    const { token } = useParams()
    const router = useRouter()
    const { isAuthenticated } = useAuth() 
    const [status, setStatus] = useState('verifying')
    const hasCalled = useRef(false)

    useEffect(() => {
  if (!token || hasCalled.current) return
  hasCalled.current = true

  const verify = async () => {
    try {
      await api.get(`/api/verify-device/${token}`)

      setStatus('success')
      sessionStorage.setItem('show_verified_msg', 'true')

      setTimeout(() => {
        if (isAuthenticated) {
          router.push('/dashboard')
        } else {
          router.push('/login')
        }
      }, 2000)

    } catch (err: any) {
      console.error("Verification error:", err)
      setStatus('error')
    }
  }

  verify()
}, [token, router, isAuthenticated])

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="max-w-md w-full text-center p-10 bg-white rounded-3xl shadow-2xl border border-gray-100">
                {status === 'verifying' && (
                    <div className="space-y-4">
                        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
                        <p className="text-gray-500 font-medium">جاري معالجة طلب التوثيق...</p>
                    </div>
                )}
                
                {status === 'success' && (
                    <div className="space-y-4 animate-in fade-in zoom-in duration-500">
                        <div className="text-6xl">✅</div>
                        <h1 className="text-2xl font-bold text-gray-800">تم التوثيق بنجاح!</h1>
                        <p className="text-gray-600">
                            لقد قمت باعتماد الجهاز بنجاح. جاري توجيهك الآن...
                        </p>
                    </div>
                )}
                
                {status === 'error' && (
                    <div className="space-y-4 animate-in fade-in zoom-in duration-500">
                        <div className="text-6xl">❌</div>
                        <h1 className="text-2xl font-bold text-red-600">الرابط غير صالح</h1>
                        <p className="text-gray-600">الرابط منتهي الصلاحية أو تم استخدامه مسبقاً.</p>
                        <button 
                            onClick={() => router.push('/login')}
                            className="mt-4 px-6 py-2 bg-gray-800 text-white rounded-xl text-sm"
                        >
                            العودة للرئيسية
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
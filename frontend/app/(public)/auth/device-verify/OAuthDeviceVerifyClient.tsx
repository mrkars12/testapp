// OAuthDeviceVerifyClient.tsx
'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import OTPInput from '@/components/OTPInput'
import api from '@/lib/api'
import { useAuthState } from '@/lib/authState'
import { useQueryClient } from '@tanstack/react-query'

export default function OAuthDeviceVerifyClient() {
  const params = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const tempToken = params.get('temp_token')

  const [otp, setOtp] = useState<string[]>(Array(6).fill(''))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!tempToken) router.replace('/login')
  }, [tempToken])

  // ✅ عند تحديث الصفحة — نمسح الـ temp_token ونرجع للـ login
  useEffect(() => {
    const handleBeforeUnload = () => {
      // لا نعمل شيء — الـ temp_token في الـ URL هيتمسح لو المستخدم روح صفحة تانية
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(p => p <= 1 ? 0 : p - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const handleVerify = async () => {
    const code = otp.join('').trim()
    if (code.length !== 6) { setError('أدخل الكود بالكامل'); return }

    setLoading(true)
    setError('')

    try {
      const res = await api.post('/auth/oauth/verify-device', {
        code,
        temp_token: tempToken,
      })

      if (!res.data.authenticated) {
        setError(res.data.message || 'كود غير صحيح')
        setLoading(false)
        return
      }

      // ✅ نجح
      useAuthState.getState().setSession(res.data.sessionId)
      useAuthState.getState().setStatus('authenticated')
      queryClient.setQueryData(['auth-user'], {
        authenticated: true,
        user: res.data.user,
        session_id: res.data.sessionId,
      })

      router.replace('/dashboard')
    } catch (err: any) {
      setError(err?.response?.data?.message || 'فشل التحقق')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white p-10 rounded-[2.5rem] shadow-xl space-y-8">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
          </div>
          <h2 className="text-2xl font-black text-gray-900">تحقق من جهازك</h2>
          <p className="text-gray-500 text-sm">
            تم رصد دخول من جهاز جديد<br/>
            أدخل الكود المرسل لبريدك الإلكتروني
          </p>
        </div>

        <div className="flex justify-center">
          <OTPInput value={otp} onChange={setOtp} disabled={loading} />
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading
            ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جاري التحقق...</span></>
            : 'تحقق الآن'
          }
        </button>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-sm font-bold rounded-2xl text-center border border-red-100">
            {error}
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          لو حدّثت الصفحة ستحتاج لتسجيل الدخول مجدداً
        </p>
      </div>
    </div>
  )
}
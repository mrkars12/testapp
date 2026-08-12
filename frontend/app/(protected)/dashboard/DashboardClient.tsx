'use client'

import { useAuth } from '@/components/AuthProvider'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import OTPInput from '@/components/OTPInput'
import { useBalanceStore } from '@/components/balanceStore'
import { useAuthState } from '@/lib/authState'
import toast from 'react-hot-toast'

export default function DashboardClient() {
  const {
    user,
    isLoading,
    refreshUser,
    isSessionReady
  } = useAuth()

  const { status } = useAuthState()
  const router = useRouter()
  const pathname = usePathname()

  /**
   * OTP
   */
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''))
  const [error, setError] = useState(false)
  const [otpReady, setOtpReady] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)

  /**
   * Cooldown
   */
  const [resendCooldown, setResendCooldown] = useState(0)

  /**
   * Balance Store
   */
  const balance = useBalanceStore(state => state.balance)
  const balanceLoading = useBalanceStore(state => state.loading)
  const hydrated = useBalanceStore(state => state.hydrated)
  const fetchBalance = useBalanceStore(state => state.fetch)

  /**
   * Email Verification
   */
/**
 * ✅ منع OTP الوهمي أثناء مزامنة التابات
 */
/**
 * =================================
 * ✅ منع OTP الوهمي أثناء مزامنة التابات
 * =================================
 */

const emailVerified =
  !!user?.email_verified_at

const isVerified =
  status === 'authenticated' &&
  !!user &&
  emailVerified

const shouldShowOtp =
  status === 'authenticated' &&
  !!user &&
  !emailVerified


  /**
   * Cooldown persistence
   */
  useEffect(() => {

  const targetUser = user as any

  if (
    !targetUser?.email_otp_last_sent_at
  ) {
    return
  }

  const sentAt =
    new Date(
      targetUser.email_otp_last_sent_at
    ).getTime()

  const updateCooldown = () => {

    const now = Date.now()

    const remaining =
      Math.max(
        0,
        60 -
        Math.floor(
          (now - sentAt) / 1000
        )
      )

    setResendCooldown(
      remaining
    )
  }

  // ✅ فوراً
  updateCooldown()

  const interval =
    setInterval(
      updateCooldown,
      1000
    )

  return () =>
    clearInterval(interval)

}, [user])

  /**
   * ✅ device verified toast
   */
  useEffect(() => {
    const verified = sessionStorage.getItem('device_verified')
    if (verified === '1') {
      toast.success('تم التحقق من الجهاز بنجاح')
      sessionStorage.removeItem('device_verified')
    }
  }, [])

  /**
   * Countdown
   */

  /**
   * ✅ unverified redirect
   */
  useEffect(() => {
    if (status === 'booting' || isLoading || !isSessionReady) return;
    if (!user) return;

    if (!user.email_verified_at && pathname !== '/dashboard') {
      router.replace('/dashboard')
    }
  }, [user, status, pathname, router, isLoading, isSessionReady])

  /**
   * منع flicker
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      setOtpReady(true)
    }, 200)

    return () => clearTimeout(timer)
  }, [])

/**
 * ✅ منع ظهور OTP أثناء انتقال مزامنة login
 */
/**
 * =================================
 * ✅ منع ظهور OTP أثناء login sync
 * =================================
 */
useEffect(() => {

  if (status === 'authenticated') {

    sessionStorage.removeItem(
      'AUTH_LOGIN_SYNCING'
    )
  }

}, [status])

/**
 * =================================
 * ✅ المستخدم موثق → نظف OTP
 * =================================
 */
useEffect(() => {

  if (user?.email_verified_at) {

    setOtp(
      Array(6).fill('')
    )

    setError(false)
  }

}, [user])

  if ( isLoading || !isSessionReady ) { return ( <div className="fixed inset-0 bg-white z-[999999]" /> ) }

  return (
    <div className="animate-in fade-in duration-500">
      {/* OTP */}
      {shouldShowOtp && (
        <div className="max-w-md mx-auto bg-white p-10 rounded-[3rem] text-center shadow-xl border border-gray-100 mt-10">
          <h2 className="text-3xl font-black mb-2 text-gray-900">تأكيد البريد</h2>
          <p className="text-gray-500 mb-8 font-bold">أدخل الكود المرسل إلى {user?.email}</p>

          <OTPInput
            value={otp}
            onChange={setOtp}
            hasError={error}
            onClearError={() => setError(false)}
          />

          <button
            disabled={verifyLoading}
            onClick={async () => {
              if (verifyLoading) return;
              setVerifyLoading(true)
              setError(false)

              try {
                const code = otp.join('').trim()
                if (code.length !== 6) {
                  setError(true)
                  toast.error('أدخل الكود بالكامل')
                  return
                }

                const res = await api.post('/auth/verify-otp', {
                  email: user?.email || '',
                  code
                })

                if (!res.data.success) {
                  setError(true)
                  toast.error(res.data.message)
                  return
                }

                toast.success('تم تفعيل الحساب بنجاح')
                await refreshUser()

                await new Promise(resolve => setTimeout(resolve, 500))
                await useBalanceStore.getState().fetch(true)

                const intended = new URLSearchParams(window.location.search).get('intended')
                router.replace(intended || '/dashboard')
              } catch (err) {
                console.error(err)
              } finally {
                // 🚩 هنا تم وضع الـ finally المفقودة لإغلاق الـ Loader بأمان
                setVerifyLoading(false)
              }
            }}
            className="w-full mt-10 py-5 bg-blue-600 text-white rounded-2xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifyLoading ? (
              <div className="flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                جاري التحقق...
              </div>
            ) : (
              'تأكيد وتفعيل'
            )}
          </button>

          {/* Resend */}
          <button
            disabled={resendCooldown > 0 || resendLoading}
            onClick={async () => {
              if (resendLoading || resendCooldown > 0) return;
              setResendLoading(true)

              try {
                const res = await api.post('/auth/resend-otp', {
                  email: user?.email
                })

                if (!res.data.success) {
                  toast.error(res.data.message)
                  return
                }

                toast.success('تم إرسال كود جديد')
                setResendCooldown(60)
                await refreshUser()
              } catch (err: any) {
                toast.error(err?.response?.data?.message || 'حدث خطأ أثناء إعادة الإرسال')
              } finally {
                setResendLoading(false)
              }
            }}
            className="w-full mt-4 py-4 border border-gray-200 rounded-2xl font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resendLoading ? (
              <div className="flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                جاري الإرسال...
              </div>
            ) : resendCooldown > 0 ? (
              `إعادة الإرسال خلال ${resendCooldown}s`
            ) : (
              'إعادة إرسال الكود'
            )}
          </button>
        </div>
      )}

      {/* Dashboard */}
      {isVerified && (
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Balance */}
          <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 flex justify-between items-center">
            <div>
              <p className="text-gray-400 font-bold text-xs uppercase mb-2 tracking-widest">الرصيد المتاح</p>
              <h3 className="text-4xl font-black text-gray-900">
                {balanceLoading ? '...' : hydrated ? (balance || '0.00') : '...'}
                <span className="text-xl text-gray-400 ml-3">USD</span>
              </h3>
            </div>

            <button
              onClick={() => fetchBalance(true)}
              disabled={balanceLoading}
              className="p-4 bg-gray-50 border border-gray-100 rounded-2xl hover:bg-gray-100 transition-all"
            >
              <svg
                className={`w-6 h-6 text-blue-600 ${balanceLoading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-10 bg-indigo-600 rounded-[3rem] text-white shadow-xl shadow-indigo-100">
              <h4 className="text-2xl font-black">مرحباً {user?.username}</h4>
              <p className="opacity-80 mt-2 font-medium">حسابك مفعل وجاهز للعمل بشكل كامل.</p>
            </div>

            <div className="p-10 bg-gray-900 rounded-[3rem] text-white shadow-xl">
              <h4 className="text-2xl font-black">حالة النظام</h4>
              <p className="text-green-400 mt-2 font-bold flex items-center gap-2">
                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                متصل والخدمات مستقرة
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
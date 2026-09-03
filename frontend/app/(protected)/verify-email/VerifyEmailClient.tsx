'use client'

import { useAuth } from '@/components/AuthProvider'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import OTPInput from '@/components/OTPInput'
import { authedHome } from '@/lib/storeBootstrap'
import { useAuthState } from '@/lib/authState'
import toast from 'react-hot-toast'

export default function VerifyEmailClient() {
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

    if (!user.email_verified_at && pathname !== '/verify-email') {
      router.replace('/verify-email')
    }
  }, [user, status, pathname, router, isLoading, isSessionReady])

  /**
   * `/dashboard` does not exist as a route at all any more — this page,
   * `/verify-email`, is purely the email-verification gate. Once the
   * account is verified, whether that just happened here or the user
   * landed on `/verify-email` directly (a stale bookmark/link, a
   * force-logout redirect target), this continues on into the store URL
   * architecture instead of rendering a store-less landing page as a
   * persistent destination. This also fires right after the OTP submit
   * below sets `isVerified` via `refreshUser()`, so that handler doesn't
   * need its own separate redirect.
   */
  useEffect(() => {
    if (!isVerified || pathname !== '/verify-email') return

    const intended = new URLSearchParams(window.location.search).get('intended')
    let cancelled = false
    ;(async () => {
      // Single owner. A fresh signup arrives with `?intended=/store/<newslug>`
      // (RegisterStep2Client) — honoured because that slug is now owned.
      // Otherwise `resume` resolves to a real store, never the chooser.
      const target = await authedHome('resume', intended)
      if (!cancelled) router.replace(target)
    })()
    return () => { cancelled = true }
  }, [isVerified, pathname, router])

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
                // Navigation is handled by the `isVerified` effect above,
                // once `refreshUser()` flips it true — not here, so there
                // is exactly one place that decides where a just-verified
                // account goes next (the store URL architecture, not a
                // hard-coded '/dashboard').
                await refreshUser()
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

      {/* A verified account never lingers here — the effect above always
          continues into the store URL architecture. This is a transient
          "on the way" state, not a merchant home. */}
      {isVerified && (
        <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
            <p className="text-sm text-gray-400">جارٍ فتح المتجر...</p>
          </div>
        </div>
      )}
    </div>
  )
}
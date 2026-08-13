'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useRef, useEffect, useTransition, useCallback } from 'react'
import { useAuth } from '@/components/AuthProvider'
import OTPInput from '@/components/OTPInput'
import api from '@/lib/api'
import { getHardwareFingerprint } from '@/lib/fingerprint'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthState } from '@/lib/authState'
import Turnstile from 'react-turnstile'
import SocialAuthButtons from '@/components/SocialAuthButtons'
import toast from 'react-hot-toast'
import AuthNavigationLinks from '@/components/AuthNavigationLinks'

export default function LoginClient({ intended }: { intended?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const { status } = useAuthState()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const { login, refreshUser } = useAuth()
  const [isPending, startTransition] = useTransition()

  // 🍏 جعل الحالة البدئية دايماً login لمنع النفضة أو التعليق عند الـ Refresh
  const [step, setStep] = useState<'login' | '2fa' | 'device'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''))
  const [deviceOtp, setDeviceOtp] = useState<string[]>(Array(6).fill(''))
  
  const [globalLoading, setGlobalLoading] = useState(false)
  const [serverError, setServerError] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(60)
  const [requiresCaptcha, setRequiresCaptcha] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
const [oauthTempToken, setOauthTempToken] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const isPageSubmitting = globalLoading || isPending;

  /**
   * =================================
   * ✅ الفحص الأمني الصامت المعتمد على الـ DB (أول شيء يعمل عند تحميل الصفحة)
   * =================================
   */
 /**
   * =================================
   * ✅ الفحص الأمني الصامت المعتمد على الـ DB (مُعدل لمنع التضارب)
   * =================================
   */
  /**
   * =================================
   * ✅ فحص السوشيال ميديا اللحظي (مُعدل: ريفريش الصفحة يعود للدخول فوراً)
   * =================================
   */
  useEffect(() => {
    // 🍏 1. لو فيه بيانات سوشيال ميديا حية وقادمة فوراً في الـ RAM، افتح بوكس التحقق
    if (typeof window !== 'undefined' && (window as any).__OAUTH_SECURE_DATA__) {
      const secureData = (window as any).__OAUTH_SECURE_DATA__

      if (secureData.step === 'device' && secureData.token) {
        setStep('device')
        setOauthTempToken(secureData.token)
        
        if (secureData.email) {
          setEmail(secureData.email)
        }
        
        // 🧼 مسح وتدمير الداتا من الـ RAM فوراً للأمان التام وحتى لا تتكرر
        delete (window as any).__OAUTH_SECURE_DATA__

        toast.error('🔒 تم رصد محاولة دخول من جهاز جديد عبر السوشيال ميديا، يرجى كتابة كود التحقق المرسل لبريدك الإلكتروني.', { position: 'top-center' })
        return; // قفل الإيفكت هنا وسيب بوكس الكود يظهر
      }
    }

    // 🍏 2. الضربة القاضية: لو عمل Refresh أو مفيش داتا في الـ RAM، افتح شاشة اللوجين العادية دايماً وم تطلبش أي حاجة من الـ DB
    setStep('login')

  }, []) // مصفوفة فارغة ليعمل مرة واحدة فقط أول ما الصفحة تفتح

  /**
   * =================================
   * 🍏 الاستقبال الآمن التام (Memory State Only) لحماية الأجهزة الجديدة القادمة من السوشيال ميديا
   * =================================
   */
  /**
   * 🛡️ الاستقبال الآمن التام المستقر (Window RAM Memory)
   */
  useEffect(() => {
    if (typeof window === 'undefined') return

    // قراءة البيانات من ذاكرة الـ Window المؤقتة
    const secureData = (window as any).__OAUTH_SECURE_DATA__

    if (secureData && secureData.step === 'device' && secureData.token) {
      // 🚀 اقلب الواجهة فوراً لبوكس التحقق
      setStep('device')
      setOauthTempToken(secureData.token)
      
      if (secureData.email) {
        setEmail(secureData.email)
      }
      
      // 🧼 تدمير ومسح الداتا من الـ RAM فوراً عشان لو عمل Refresh يرجع لوجين طبيعي
      delete (window as any).__OAUTH_SECURE_DATA__

      toast.error('🔒 تم رصد محاولة دخول من جهاز جديد عبر السوشيال ميديا، يرجى كتابة كود التحقق المرسل لبريدك الإلكتروني.', { position: 'top-center' })
    }
  }, []) // 🍏 مصفوفة فارغة تماماً عشان يلقطها أول ما يفتح اللوجين فوراً وبدون تكرار
  /**
   * =================================
   * ✅ AUTH SUCCESS (التوجيه المستمر صامتاً)
   * =================================
   */
  const handleAuthSuccess = useCallback(async (data: any) => {
    useAuthState.getState().setStatus('authenticated')
    if (data.session_id) {
      useAuthState.getState().setSession(data.session_id)
    }

    queryClient.setQueryData(['auth-user'], {
      authenticated: true,
      user: data.user,
      session_id: data.session_id
    })

    const urlIntended = searchParams.get('intended') || searchParams.get('redirect')
    const rawTarget = intended || urlIntended || '/dashboard'
    const targetPath = decodeURIComponent(rawTarget)

    // ✅ تنظيف أي flow قديم
delete (window as any).__OAUTH_SECURE_DATA__

sessionStorage.removeItem('oauth_msg')

queryClient.removeQueries({
  queryKey: ['pending-device']
})

const bc = new BroadcastChannel('auth_sync_channel')

bc.postMessage({
  type: 'AUTH_LOGIN_SYNC',
  userPayload: {
    authenticated: true,
    user: data.user,
    session_id: data.session_id
  },
  intendedPath: targetPath,

  // ✅ مهم جداً
  clearAuthFlows: true,
})

    await refreshUser()
    await queryClient.invalidateQueries({ queryKey: ['auth-user'] })
    
    startTransition(() => {
      router.replace(targetPath)
    })
  }, [queryClient, router, searchParams, intended, refreshUser])

useEffect(() => {
  const msg = sessionStorage.getItem('oauth_msg')
  if (!msg) return
  sessionStorage.removeItem('oauth_msg')

  const messages: Record<string, string> = {
    account_not_found: '❌ هذا الحساب غير مسجل، يرجى إنشاء حساب أولاً',
    already_exists:    '⚠️ لديك حساب بالفعل، سجّل دخولك مباشرة',
  }

  if (messages[msg]) {
    toast.error(messages[msg], {
      duration: 5000,
      position: 'top-center',
    })
  }
}, [])
  /**
   * =================================
   * ✅ COOLDOWN TIMER
   * =================================
   */
  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [resendCooldown])

  /**
   * =================================
   * ✅ LOGIN HANDLER
   * =================================
   */
  const handleSubmit = async (e: React.FormEvent) => {
    if (e) e.preventDefault()
    if (submittingRef.current || isPageSubmitting) return;

    setGlobalLoading(true)
    setServerError('')
    submittingRef.current = true

    try {
      const hwFingerprint = await getHardwareFingerprint()
      const res = await login(email, password, captchaToken, hwFingerprint)

      if (res.success === false) {
        if (res.requires_captcha) setRequiresCaptcha(true);
        setServerError(res.message || 'فشل تسجيل الدخول')
        setGlobalLoading(false)
        submittingRef.current = false
        return
      }

      if (res.requires_device_verification) {
        setStep('device')
        setGlobalLoading(false)
        submittingRef.current = false
        return
      }

      if (res.requires_2fa) {
        setStep('2fa')
        setGlobalLoading(false)
        submittingRef.current = false
        return
      }

      if (res.authenticated) {
        await handleAuthSuccess(res)
      }
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.requires_captcha) setRequiresCaptcha(true);
      setServerError(data?.message || 'فشل تسجيل الدخول')
      setGlobalLoading(false)
      submittingRef.current = false
    }
  }

  /**
   * =================================
   * ✅ VERIFY DEVICE CODE
   * =================================
   */
/**
   * =================================
   * 🍏 VERIFY DEVICE CODE (دخول السوشيال والعادي الموحد)
   * =================================
   */
  /**
   * =================================
   * 🍏 VERIFY DEVICE CODE (مُعدل: تفعيل الجهاز وإعادة المستخدم لصفحة الدخول)
   * =================================
   */
  const handleVerifyDevice = async () => {
    if (isPageSubmitting) return
    const code = deviceOtp.join('').trim()
    if (code.length !== 6) { setServerError('أدخل الكود بالكامل'); return }

    setGlobalLoading(true)
    setServerError('')

    try {
      const hwFingerprint = await getHardwareFingerprint()

      // أ- إذا كان الطلب قادماً من السوشيال ميديا ومعه التوكن المشفر المخفي
      if (oauthTempToken) {
        const res = await api.post('/auth/oauth/verify-device', {
          code,
          temp_token: oauthTempToken
        })

        if (!res.data.authenticated) {
          setServerError(res.data.message || 'كود غير صحيح')
          setGlobalLoading(false)
          return
        }

        // 🍏 التعديل السحري: تصفير وتطهير ومسح التوكن المؤقت
        setOauthTempToken(null)
        setDeviceOtp(Array(6).fill('')) // تصفير مربعات الكود
        
        // إرجاعه صامتاً لشاشة اللوجين الرئيسية
        setStep('login')
        setGlobalLoading(false)

        // إظهار رسالة النجاح والتفعيل
        toast.success('✅ تم تفعيل وتوثيق جهازك بنجاح! يمكنك الآن تسجيل الدخول عبر السوشيال ميديا الحين.', { 
          duration: 6000,
          position: 'top-center' 
        })
      } 
      // ب- المسار التقليدي لتوثيق الأجهزة عبر تسجيل الدخول العادي
      else {
        const res = await api.post('/auth/device/verify-code', {
          code,
          fingerprint: hwFingerprint,
          email, 
        })

        if (!res.data.authenticated) {
          setServerError(res.data.message || 'كود غير صحيح')
          setGlobalLoading(false)
          return
        }

        // 🍏 التعديل السحري: تصفير ومسح كود الـ OTP
        setDeviceOtp(Array(6).fill(''))
        
        // إرجاعه صامتاً لشاشة اللوجين الرئيسية ليكتب الباسوورد من جديد
        setStep('login')
        setPassword('') // مسح الباسوورد القديم لزيادة الأمان وإجباره على الكتابة
        setGlobalLoading(false)

        // إظهار رسالة النجاح والتفعيل
        toast.success('✅ تم تفعيل وتوثيق جهازك بنجاح! يرجى كتابة كلمة المرور لتسجيل الدخول بأمان.', { 
          duration: 6000,
          position: 'top-center' 
        })
      }

    } catch (err: any) {
      setServerError(err?.response?.data?.message || 'تعذر التحقق حالياً')
      setGlobalLoading(false)
    }
  }
  /**
   * =================================
   * ✅ VERIFY 2FA CODE
   * =================================
   */
  const handleVerify2FA = async () => {
    if (isPageSubmitting) return;

    const code = otp.join('').trim()
    if (code.length !== 6) {
      setServerError('أدخل الكود بالكامل')
      return
    }

    setGlobalLoading(true)
    setServerError('')

    try {
      const fingerprint = await getHardwareFingerprint()
      const res = await api.post('/auth/2fa/login', {
        email,
        code,
        fingerprint
      })

      if (!res.data.authenticated) {
        setServerError(res.data.message || 'كود غير صحيح')
        setGlobalLoading(false)
        return
      }

      await handleAuthSuccess(res.data)
    } catch (err: any) {
      setServerError(err?.response?.data?.message || 'فشل التحقق الثنائي')
      setGlobalLoading(false)
    }
  }

  const handleResendDeviceCode = async () => {
    if (resendLoading || resendCooldown > 0) return;

    setResendLoading(true)
    setServerError('')

    try {
      const hwFingerprint = await getHardwareFingerprint()
      const res = await api.post('/auth/device/resend-code', {
        email,
        fingerprint: hwFingerprint
      })

      if (!res.data.success) {
        setServerError(res.data.message)
        return
      }

      setResendCooldown(60)
    } catch (err: any) {
      setServerError(err?.response?.data?.message || 'تعذر إعادة الإرسال حالياً')
    } finally {
      setResendLoading(false)
    }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-[2.5rem] shadow-xl border border-gray-100 animate-in fade-in duration-300">
        
        <div className="text-center">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            {step === 'device' ? 'تأمين الحساب' : step === '2fa' ? 'التحقق الثنائي' : 'تسجيل الدخول'}
          </h2>
        </div>

        <div className="mt-8 space-y-6">
          {step === 'login' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="البريد الإلكتروني"
                value={email}
                disabled={isPageSubmitting}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-5 py-4 border border-gray-200 rounded-2xl focus:outline-none focus:border-blue-500 font-medium transition-colors disabled:opacity-60"
                required
              />

              <input
                type="password"
                placeholder="كلمة المرور"
                value={password}
                disabled={isPageSubmitting}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-5 py-4 border border-gray-200 rounded-2xl focus:outline-none focus:border-blue-500 font-medium transition-colors disabled:opacity-60"
                required
              />

              {requiresCaptcha && (
                <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50 flex justify-center">
                  <Turnstile
                    sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                    onVerify={(token) => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken(null)}
                    className="mx-auto"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isPageSubmitting}
                className="w-full py-4.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black shadow-lg shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPageSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>جاري الدخول...</span>
                  </>
                ) : (
                  'دخول'
                )}
              </button>
            </form>
          )}

          {step === 'login' && (
            <SocialAuthButtons mode="login" className="mt-2" />
          )}

          {(step === 'device' || step === '2fa') && (
            <div className="text-center space-y-6">
              <p className="text-gray-500 font-medium">
                {step === 'device' ? 'أدخل كود التحقق المرسل إلى البريد الإلكتروني الخاص بك' : 'أدخل الكود من تطبيق المصادقة'}
              </p>

              <div className="flex justify-center">
                <OTPInput
                  value={step === 'device' ? deviceOtp : otp}
                  onChange={step === 'device' ? setDeviceOtp : setOtp}
                  disabled={isPageSubmitting}
                />
              </div>

              <button
                onClick={step === 'device' ? handleVerifyDevice : handleVerify2FA}
                disabled={isPageSubmitting}
                className="w-full py-4.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black shadow-lg shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPageSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>جاري التحقق...</span>
                  </>
                ) : (
                  'تحقق الآن'
                )}
              </button>

              {step === 'device' && (
                <button
                  onClick={handleResendDeviceCode}
                  disabled={resendCooldown > 0 || resendLoading || isPageSubmitting}
                  className="text-sm font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:no-underline block mx-auto pt-2"
                >
                  {resendLoading ? 'جاري الإرسال...' : resendCooldown > 0 ? `إعادة الإرسال خلال ${resendCooldown}ث` : 'إعادة إرسال الكود'}
                </button>
              )}
            </div>
          )}

          {serverError && (
            <div className="p-4 bg-red-50 text-red-700 text-sm font-bold rounded-2xl text-center border border-red-100 animate-in shake duration-300">
              {serverError}
            </div>
          )}

          <AuthNavigationLinks />


        </div>
      </div>
    </div>
  )
}
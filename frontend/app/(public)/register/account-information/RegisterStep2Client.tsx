// app/(public)/register/account-information/RegisterStep2Client.tsx

'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useMemo, useEffect, useRef , useTransition} from 'react';
import CountrySelect from '@/components/CountrySelect';
import TurnstileCaptcha from '@/components/TurnstileCaptcha';
import { useAuth } from '@/components/AuthProvider';
import { useDevicesStore } from "@/lib/device";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Cookies from 'js-cookie'; // 👈 أضف هذا السطر
import { getHardwareFingerprint } from '@/lib/fingerprint'; // 🚩 تأكد من استيراد دالة البصمة العميقة
import { useAuthState } from '@/lib/authState'
import api from '@/lib/api'
import SocialAuthButtons from '@/components/SocialAuthButtons';
import AuthNavigationLinks from '@/components/AuthNavigationLinks'
          

  // ... كود حقول التسجيل ...


const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// ────────────────────────────────────────────────
// Zod Schema
// ────────────────────────────────────────────────




const getRegisterSchema = (isBusiness: boolean) =>
  z
    .object({
      country: z.string().min(1, 'يرجى اختيار البلد'),
      country_code: z.string().min(1, 'كود البلد مطلوب'),
      mobile_code: z.string().min(1, 'كود الجوال مطلوب'),
      email: z.string().email('البريد الإلكتروني غير صالح'),
      username: z
        .string()
        .min(4, 'اسم المستخدم يجب أن يكون 4 أحرف على الأقل')
        .max(16, 'الحد الأقصى 16 حرف')
        .regex(/^[a-zA-Z0-9]+$/, 'أحرف وأرقام إنجليزية فقط'),
      password: z
        .string()
        .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
        .regex(/[a-z]/, 'حرف صغير واحد على الأقل')
        .regex(/[A-Z]/, 'حرف كبير واحد على الأقل')
        .regex(/[0-9]/, 'رقم واحد على الأقل')
        .regex(/[^a-zA-Z0-9]/, 'رمز خاص واحد على الأقل'),
      password_confirmation: z.string(),
      business_name: isBusiness
        ? z.string().min(2, 'اسم الشركة مطلوب')
        : z.string().optional(),
      entity_type: isBusiness
        ? z.string().min(1, 'نوع الكيان مطلوب')
        : z.string().optional(),
      cf_turnstile_token: z.string().min(1, 'يرجى إكمال التحقق الأمني'),
    })
    .refine((data) => data.password === data.password_confirmation, {
      message: 'كلمتا المرور غير متطابقتين',
      path: ['password_confirmation'],
    });
type RegisterForm = z.infer<ReturnType<typeof getRegisterSchema>>;
type CountryValue = {
  country: string;
  code: string;
  dial_code: string;
};
export default function RegisterStep2Client() {
  const router = useRouter();
  const { register: authRegister, refreshUser } = useAuth();
  const [invalidFlow, setInvalidFlow] = useState(false);
  // تحقق كلاينت سايد (بديل للـ redirect السيرفر)
  const params = useSearchParams();
  const flowToken = params.get('flow');
  const flowSignature = params.get('sig');
  const accountType = params.get('type');
  const isBusiness = accountType === 'business';
  const queryClient = useQueryClient()
    const [isPending, startTransition] = useTransition()
  
  useEffect(() => {
    if (!flowToken || !flowSignature) {
      router.replace('/register');
    }
  }, [flowToken, flowSignature, router]);
  if (!flowToken || !flowSignature) return null;
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
    setValue,
    clearErrors,
    setError,
    trigger,
  } = useForm<RegisterForm>({
    resolver: zodResolver(getRegisterSchema(isBusiness)),
    mode: 'onChange',
  });
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [emailChecking, setEmailChecking] = useState(false);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const submittingRef = useRef(false);
  const email = watch('email');
  const username = watch('username');
  const password = watch('password') || '';
  const passwordStrength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    return score;
  }, [password]);
  // Enhanced validation: Async check for email and username availability (assuming API endpoints exist)
    
  const { isAuthenticated } = useAuth()


  // داخل RegisterStep2Client.tsx
useEffect(() => {
  const checkEmail = async () => {
    if (email && !errors.email) {
      setEmailChecking(true);
      try {
        const res = await api.post('/auth/check-email', { email });
        if (!res.data.available) {
          setError('email', { message: 'البريد الإلكتروني مستخدم بالفعل' });
        }
      } catch {} finally { setEmailChecking(false); }
    }
  };
  const timer = setTimeout(checkEmail, 500);
  return () => clearTimeout(timer);
}, [email]);

useEffect(() => {
  const checkUsername = async () => {
    if (username && !errors.username) {
      setUsernameChecking(true);
      try {
        const res = await api.post('/auth/check-username', { username });
        if (!res.data.available) {
          setError('username', { message: 'البريد الإلكتروني مستخدم بالفعل' });
        }
      } catch {} finally { setUsernameChecking(false); }
    }
  };
  const timer = setTimeout(checkUsername, 500);
  return () => clearTimeout(timer);
}, [username]);


// @/app/(public)/register/account-information/RegisterStep2Client.tsx

const onSubmit = handleSubmit(async (data) => {
  if (submittingRef.current || loading) return;
  
  submittingRef.current = true;
  setLoading(true);
  setServerError('');
  
  try {
    // ✅ الحل الجديد: جلب البصمة مباشرة من المكتبة
    // لم نعد بحاجة لفحص deviceStore.fingerprint
    const hwFingerprint = await getHardwareFingerprint();

    // 2. إرسال طلب التسجيل
    const result = await authRegister(
    {
      ...data,

      fingerprint:
        hwFingerprint,

      hardware_fingerprint:
        hwFingerprint,

      user_agent:
        navigator.userAgent,

      accounttype:
        accountType,

      timezone:
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone
    },

    flowToken,

    flowSignature
  )

      // بقية الكود كما هو...
if (result.success && result.authenticated && result.session_id) {
  const authState = useAuthState.getState()
  authState.setSession(result.session_id)
  authState.setStatus('authenticated')

  queryClient.setQueryData(['auth-user'], {
    authenticated: true,
    user: result.user,
    session_id: result.session_id
  })

  const bc = new BroadcastChannel('auth_sync_channel')

bc.postMessage({
  type: 'AUTH_LOGIN_SYNC',

  userPayload: {
    authenticated: true,
    user: result.user,
    session_id: result.session_id
  },

  intendedPath: '/dashboard',

  clearAuthFlows: true,
})

bc.close()

  startTransition(() => {

  router.replace(
    '/dashboard'
  )
})
} else {
  throw new Error("فشل في استلام بيانات الجلسة")
}
  } catch (err: any) {
    submittingRef.current = false;
    setLoading(false);
    
    // إظهار رسالة الخطأ القادمة من NestJS
    const errorMessage = err.response?.data?.message || err.message || 'حدث خطأ أثناء إنشاء الحساب';
    setServerError(errorMessage);
  } finally {
    // نغلق التحميل فقط إذا لم نكن في حالة انتقال ناجحة
    if (submittingRef.current === false) {
       setLoading(false);
    }
  }
});

  return (
    <div className="min-h-screen bg-gradient-to-tr from-emerald-50 via-cyan-50 to-teal-50 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="
        w-full max-w-md lg:max-w-lg
        bg-white/80 dark:bg-gray-900/80
        shadow-[8px_8px_16px_rgba(0,0,0,0.05),-8px_-8px_16px_rgba(255,255,255,0.8)]
        dark:shadow-[8px_8px_16px_rgba(0,0,0,0.2),-8px_-8px_16px_rgba(255,255,255,0.05)]
        rounded-3xl
        overflow-hidden
        transition-all duration-500
      ">
        <div className="px-8 pt-8 pb-4">
          <button
            onClick={() => router.replace('/register')}
            className="group flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors duration-300"
          >
            <svg className="w-5 h-5 mr-2 transform group-hover:-translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            العودة
          </button>
        </div>
        {/* العنوان */}
        <div className="px-8 pb-6 text-center">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-cyan-600 dark:from-emerald-400 dark:to-cyan-400">
            إنشاء حساب جديد
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {isBusiness ? 'حساب أعمال' : 'حساب شخصي'}
          </p>
        </div>


        {/* النموذج */}
        <form onSubmit={onSubmit} className="px-8 pb-10 space-y-6" noValidate>
          {/* البلد */}

<SocialAuthButtons 
  mode="register" 
  className="mt-4" 
/>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              البلد
            </label>
            <CountrySelect
              value={{
                country: watch('country') || '',
                code: watch('country_code') || '',
                dial_code: watch('mobile_code') || '',
              }}
              onChange={(val: CountryValue) => {
                setValue('country', val.country, { shouldValidate: true });
                setValue('country_code', val.code, { shouldValidate: true });
                setValue('mobile_code', val.dial_code, { shouldValidate: true });
              }}
              error={errors.country?.message}
            />
          </div>
          {/* البريد الإلكتروني مع تحقق async */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              {...register('email', { onBlur: () => trigger('email') })}
              dir="ltr"
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner
                ${errors.email ? 'border-red-500 bg-red-50/50' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'}
              `}
              placeholder="example@email.com"
            />
            {emailChecking && <span className="absolute right-3 top-10 text-xs text-gray-500">جاري التحقق...</span>}
            {errors.email && <p className="mt-2 text-sm text-red-600">{errors.email.message}</p>}
          </div>
          {/* اسم المستخدم مع تحقق async */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              اسم المستخدم
            </label>
            <input
              type="text"
              {...register('username', { onBlur: () => trigger('username') })}
              dir="ltr"
              maxLength={16}
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner
                ${errors.username ? 'border-red-500 bg-red-50/50' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'}
              `}
              placeholder="4-16 حرف/رقم"
            />
            {usernameChecking && <span className="absolute right-3 top-10 text-xs text-gray-500">جاري التحقق...</span>}
            {errors.username && <p className="mt-2 text-sm text-red-600">{errors.username.message}</p>}
          </div>
          {/* كلمة المرور */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              كلمة المرور
            </label>
            <input
              type="password"
              {...register('password')}
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner
                ${errors.password ? 'border-red-500 bg-red-50/50' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'}
              `}
            />
            {errors.password && <p className="mt-2 text-sm text-red-600">{errors.password.message}</p>}
            {password && (
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>قوة كلمة المرور:</span>
                  <span className={`font-medium ${passwordStrength <= 2 ? 'text-red-600' : passwordStrength <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {passwordStrength <= 2 ? 'ضعيفة' : passwordStrength <= 3 ? 'متوسطة' : passwordStrength <= 4 ? 'قوية' : 'ممتازة'}
                  </span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-500"
                    style={{ width: `${(passwordStrength / 5) * 100}%`,
                      background: passwordStrength <= 2 ? '#ef4444' : passwordStrength <= 3 ? '#f59e0b' : passwordStrength <= 4 ? '#10b981' : '#059669' }}
                  />
                </div>
              </div>
            )}
          </div>
          {/* تأكيد كلمة المرور */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              تأكيد كلمة المرور
            </label>
            <input
              type="password"
              {...register('password_confirmation')}
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner
                ${errors.password_confirmation ? 'border-red-500 bg-red-50/50' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'}
              `}
            />
            {errors.password_confirmation && <p className="mt-2 text-sm text-red-600">{errors.password_confirmation.message}</p>}
          </div>
          {/* حقول الأعمال إذا كان الحساب تجاري */}
          {isBusiness && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  اسم الشركة القانوني
                </label>
                <input
                  type="text"
                  {...register('business_name')}
                  className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner
                    ${errors.business_name ? 'border-red-500 bg-red-50/50' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'}
                  `}
                />
                {errors.business_name && <p className="mt-2 text-sm text-red-600">{errors.business_name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  نوع الكيان القانوني
                </label>
                <select
                  {...register('entity_type')}
                  className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner appearance-none
                    ${errors.entity_type ? 'border-red-500 bg-red-50/50' : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'}
                  `}
                >
                  <option value="">اختر نوع الكيان</option>
                  <option value="llc">شركة ذات مسئولية محدودة</option>
                  <option value="corporation">شركة مساهمة</option>
                  <option value="partnership">شركة تضامنية</option>
                  <option value="sole_proprietorship">مشروع فردي</option>
                  <option value="other">أخرى</option>
                </select>
                {errors.entity_type && <p className="mt-2 text-sm text-red-600">{errors.entity_type.message}</p>}
              </div>
            </>
          )}
          {/* Captcha مع تحسين عرض */}
          <div className="mt-4">
            <TurnstileCaptcha
              onVerify={(token) => {
                setValue('cf_turnstile_token', token, { shouldValidate: true });
              }}
              onError={() => setError('cf_turnstile_token', { type: 'manual', message: 'فشل التحقق الأمني، يرجى المحاولة مرة أخرى' })}
            />
            {errors.cf_turnstile_token && <p className="mt-2 text-sm text-red-600">{errors.cf_turnstile_token.message}</p>}
          </div>
          {/* زر الإرسال */}
          <button
            type="submit"
            disabled={loading || !isValid || emailChecking || usernameChecking}
            className={`w-full py-4 rounded-xl text-white font-semibold transition-all duration-300 mt-6
              ${isValid && !loading && !emailChecking && !usernameChecking
                ? 'bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 shadow-md hover:shadow-lg hover:-translate-y-1'
                : 'bg-gray-400 cursor-not-allowed'
              }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                جاري إنشاء الحساب...
              </span>
            ) : (
              'إنشاء الحساب'
            )}
          </button>
          {/* رسالة خطأ عامة */}
          {serverError && (
            <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-xl text-center text-red-700 dark:text-red-300 text-sm">
              {serverError}
            </div>
          )}

        <AuthNavigationLinks />

        </form>
      </div>
    </div>
  );
}
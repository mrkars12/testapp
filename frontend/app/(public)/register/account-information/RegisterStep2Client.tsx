// app/(public)/register/account-information/RegisterStep2Client.tsx

'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { useState, useMemo, useEffect, useRef, useTransition } from 'react';
import PhoneInput, { type PhoneValue } from '@/components/PhoneInput';
import TurnstileCaptcha from '@/components/TurnstileCaptcha';
import { useAuth } from '@/components/AuthProvider';
import { useQueryClient } from '@tanstack/react-query'
import { getHardwareFingerprint } from '@/lib/fingerprint';
import { useAuthState } from '@/lib/authState'
import { AUTH_TAB_ID } from '@/lib/auth-tab-id'
import api from '@/lib/api'
import SocialAuthButtons from '@/components/SocialAuthButtons';
import AuthNavigationLinks from '@/components/AuthNavigationLinks'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

// ────────────────────────────────────────────────
// Zod Schema
//
// One account = one signup flow: personal data (name/phone/email/password)
// and the first store's identity (name/slug/currency) are collected
// together — there is no personal/business branch, and no username field:
// identity is email. `phone` is validated as a real phone number
// (libphonenumber-js), not a loose digit string. `country`/`country_code`/
// `mobile_code` are still part of the current RegisterDto contract, but
// they're no longer a separate field the user fills in — PhoneInput's own
// country picker supplies all three together with the phone number, so
// there is never a state where one is set and the others aren't (that
// mismatch was the root cause of the previous "+--"/false-invalid bug).
// ────────────────────────────────────────────────

const STORE_CURRENCIES = ['SAR', 'USD', 'EGP'] as const
const CURRENCY_LABELS: Record<(typeof STORE_CURRENCIES)[number], string> = {
  SAR: 'SAR — ريال سعودي',
  USD: 'USD — دولار أمريكي',
  EGP: 'EGP — جنيه مصري',
}

const registerSchema = z
  .object({
    country: z.string().min(1),
    country_code: z.string().min(1),
    mobile_code: z.string().min(1),
    first_name: z.string().min(1, 'الاسم الأول مطلوب').max(50),
    last_name: z.string().min(1, 'اسم العائلة مطلوب').max(50),
    // Populated only once PhoneInput considers the number structurally
    // valid for the selected country — see PhoneInput.tsx. The refine
    // below is what actually blocks submission; an empty/invalid value
    // never satisfies it.
    phone: z
      .string()
      .refine((val) => !!val && isValidPhoneNumber(val), 'رقم الهاتف غير صالح'),
    email: z.email('البريد الإلكتروني غير صالح'),
    password: z
      .string()
      .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      .regex(/[a-z]/, { message: 'حرف صغير واحد على الأقل' })
      .regex(/[A-Z]/, { message: 'حرف كبير واحد على الأقل' })
      .regex(/[0-9]/, { message: 'رقم واحد على الأقل' })
      .regex(/[^a-zA-Z0-9]/, { message: 'رمز خاص واحد على الأقل' }),
    password_confirmation: z.string(),
    store_name: z.string().min(2, 'اسم المتجر مطلوب').max(60),
    store_slug: z
      .string()
      .min(3, 'معرّف المتجر يجب أن يكون 3 أحرف على الأقل')
      .max(40)
      .regex(/^[a-z0-9-]+$/, { message: 'حروف إنجليزية صغيرة وأرقام وشرطات فقط' }),
    store_currency: z.enum(STORE_CURRENCIES, { message: 'يرجى اختيار العملة' }),
    cf_turnstile_token: z.string().min(1, 'يرجى إكمال التحقق الأمني'),
  })
  .refine((data) => data.password === data.password_confirmation, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['password_confirmation'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Section heading — keeps the three logical groups (account/store/security)
 *  visually distinct without turning the form into separate wizard steps.
 *  A top divider (except on the first section) is what actually separates
 *  the groups; the heading itself just names the group beneath it. */
function SectionHeading({ title, subtitle, first }: { title: string; subtitle?: string; first?: boolean }) {
  return (
    <div className={first ? '' : 'pt-2 mt-2 border-t border-gray-100 dark:border-gray-800'}>
      <h3 className={`text-sm font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 ${first ? '' : 'mt-6'}`}>
        {title}
      </h3>
      {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </div>
  )
}

function fieldClasses(hasError: boolean, isValidValue: boolean) {
  if (hasError) return 'border-red-500 bg-red-50/50 dark:bg-red-950/20'
  if (isValidValue) return 'border-emerald-400 dark:border-emerald-600'
  return 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-300/50'
}

export default function RegisterStep2Client() {
  const router = useRouter();
  const { register: authRegister } = useAuth();
  const params = useSearchParams();
  const flowToken = params.get('flow');
  const flowSignature = params.get('sig');
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);

  useEffect(() => {
    if (!flowToken || !flowSignature) {
      router.replace('/register');
    }
  }, [flowToken, flowSignature, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid, touchedFields },
    watch,
    setValue,
    setError,
    trigger,
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
    defaultValues: { phone: '' },
  });
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [emailChecking, setEmailChecking] = useState(false);
  const slugTouchedRef = useRef(false);
  const submittingRef = useRef(false);
  const email = watch('email');
  const storeName = watch('store_name');
  const storeSlug = watch('store_slug');
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

  // اسم المتجر يقترح معرّفاً تلقائياً — لكن فقط طالما المستخدم لم يعدّل
  // المعرّف يدوياً بعد (الاسم والمعرّف مرتبطان بصرياً، لكن المعرّف يبقى
  // قابلاً للتعديل المستقل). Guarded on a non-empty store name: without
  // this, the effect ran once on mount with `storeName === ''`, forcing
  // `store_slug` to `''` with `shouldValidate: true` and showing a red
  // "at least 3 characters" error before the user had typed anything at
  // all — the same class of premature-validation bug PhoneInput had.
  useEffect(() => {
    if (slugTouchedRef.current) return;
    if (!storeName) return;
    setValue('store_slug', slugify(storeName), { shouldValidate: true });
  }, [storeName, setValue]);

  const handlePhoneChange = (value: PhoneValue | null) => {
    if (value) {
      setValue('phone', value.e164, { shouldValidate: true });
      setValue('country', value.country, { shouldValidate: true });
      setValue('country_code', value.countryCode, { shouldValidate: true });
      setValue('mobile_code', value.dialCode, { shouldValidate: true });
    } else {
      setValue('phone', '', { shouldValidate: true });
    }
  };

  const onSubmit = handleSubmit(async (data) => {
    if (submittingRef.current || loading) return;

    submittingRef.current = true;
    setLoading(true);
    setServerError('');

    try {
      const hwFingerprint = await getHardwareFingerprint();

      const result = await authRegister(
        {
          ...data,
          accounttype: 'individual',
          fingerprint: hwFingerprint,
          hardware_fingerprint: hwFingerprint,
          user_agent: navigator.userAgent,
          timezone,
        },
        flowToken,
        flowSignature,
      )

      if (result.success && result.authenticated && result.session_id) {
        const authState = useAuthState.getState()
        authState.setSession(result.session_id)
        authState.setStatus('authenticated')

        queryClient.setQueryData(['auth-user'], {
          authenticated: true,
          user: result.user,
          session_id: result.session_id
        })

        // Email verification still gates every other protected route, so
        // this always lands on /verify-email first — the dedicated
        // verification gate, not the merchant Dashboard (`/dashboard` no
        // longer exists at all). The first store was already created
        // alongside the account — `intended` tells that gate where to
        // continue to once OTP verification succeeds.
        const storeSlugCreated: string | undefined = result.store?.slug
        const verifyTarget = storeSlugCreated
          ? `/verify-email?intended=${encodeURIComponent(`/store/${storeSlugCreated}`)}`
          : '/verify-email'

        const bc = new BroadcastChannel('auth_sync_channel')
        bc.postMessage({
          type: 'AUTH_LOGIN_SYNC',
          senderId: AUTH_TAB_ID,
          userPayload: {
            authenticated: true,
            user: result.user,
            session_id: result.session_id
          },
          intendedPath: '/verify-email',
          clearAuthFlows: true,
        })
        bc.close()

        startTransition(() => {
          router.replace(verifyTarget)
        })
      } else {
        throw new Error("فشل في استلام بيانات الجلسة")
      }
    } catch (err: any) {
      // Never clear the form on a failed submission — the user's data
      // stays exactly as entered so they can fix one field and retry, not
      // start over.
      submittingRef.current = false;
      setLoading(false);

      const errorMessage = err.response?.data?.message || err.message || 'حدث خطأ أثناء إنشاء الحساب';
      setServerError(errorMessage);
    } finally {
      if (submittingRef.current === false) {
        setLoading(false);
      }
    }
  });

  if (!flowToken || !flowSignature) return null;

  return (
    <div className="min-h-screen bg-gradient-to-tr from-emerald-50 via-cyan-50 to-teal-50 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950 flex items-center justify-center p-4 sm:p-6 lg:p-10">
      <div className="
        w-full max-w-md lg:max-w-lg
        bg-white/90 dark:bg-gray-900/90
        shadow-[8px_8px_16px_rgba(0,0,0,0.05),-8px_-8px_16px_rgba(255,255,255,0.8)]
        dark:shadow-[8px_8px_16px_rgba(0,0,0,0.2),-8px_-8px_16px_rgba(255,255,255,0.05)]
        rounded-3xl
        overflow-visible
        transition-all duration-500
      ">
        <div className="px-8 pt-8 pb-4">
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="group flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors duration-300"
          >
            <svg className="w-5 h-5 mr-2 transform group-hover:-translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            العودة
          </button>
        </div>
        <div className="px-8 pb-6 text-center">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-cyan-600 dark:from-emerald-400 dark:to-cyan-400">
            إنشاء حساب ومتجر جديد
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            أكمل بياناتك ومتجرك الأول في خطوة واحدة
          </p>
        </div>

        <form onSubmit={onSubmit} className="px-8 pb-10 space-y-6" noValidate dir="rtl">
          <SocialAuthButtons mode="register" className="mt-4" />

          {/* ── القسم أ: بيانات الحساب ── */}
          <SectionHeading title="بيانات الحساب" first />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                الاسم الأول
              </label>
              <input
                id="first_name"
                type="text"
                {...register('first_name')}
                aria-invalid={!!errors.first_name}
                aria-describedby={errors.first_name ? 'first_name-error' : undefined}
                className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner ${fieldClasses(!!errors.first_name, touchedFields.first_name === true && !errors.first_name)}`}
              />
              {errors.first_name && <p id="first_name-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.first_name.message}</p>}
            </div>
            <div>
              <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                اسم العائلة
              </label>
              <input
                id="last_name"
                type="text"
                {...register('last_name')}
                aria-invalid={!!errors.last_name}
                aria-describedby={errors.last_name ? 'last_name-error' : undefined}
                className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner ${fieldClasses(!!errors.last_name, touchedFields.last_name === true && !errors.last_name)}`}
              />
              {errors.last_name && <p id="last_name-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.last_name.message}</p>}
            </div>
          </div>

          <div className="relative">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              type="email"
              {...register('email', { onBlur: () => trigger('email') })}
              dir="ltr"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner ${fieldClasses(!!errors.email, touchedFields.email === true && !errors.email && !emailChecking)}`}
              placeholder="example@email.com"
            />
            {emailChecking && <span className="absolute left-3 top-10 text-xs text-gray-500">جاري التحقق...</span>}
            {errors.email && <p id="email-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.email.message}</p>}
          </div>

          {/* One coherent control: country picker (flag + calling code) +
              national number — defaults to Egypt for this Arabic-first
              onboarding flow, but the user can change it freely. */}
          <PhoneInput defaultCountryCode="EG" onChange={handlePhoneChange} error={errors.phone?.message} />

          {/* ── القسم ب: بيانات المتجر ── */}
          <SectionHeading title="بيانات المتجر" subtitle="اسم متجرك ورابطه العام" />

          <div>
            <label htmlFor="store_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              اسم المتجر
            </label>
            <input
              id="store_name"
              type="text"
              {...register('store_name')}
              placeholder="متجر الأناقة"
              aria-invalid={!!errors.store_name}
              aria-describedby={errors.store_name ? 'store_name-error' : undefined}
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner ${fieldClasses(!!errors.store_name, touchedFields.store_name === true && !errors.store_name)}`}
            />
            {errors.store_name && <p id="store_name-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.store_name.message}</p>}
          </div>

          <div>
            <label htmlFor="store_slug" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              معرّف المتجر
            </label>
            <div className={`flex items-stretch rounded-xl shadow-sm border overflow-hidden transition-colors focus-within:ring-2 focus-within:ring-emerald-300/50 ${errors.store_slug ? 'border-red-500' : 'border-gray-300 dark:border-gray-600 focus-within:border-emerald-500'}`} dir="ltr">
              <span className="bg-gray-50 dark:bg-gray-800 text-gray-400 px-3.5 py-3 text-sm border-l border-gray-200 dark:border-gray-700 flex items-center whitespace-nowrap">/stores/</span>
              <input
                id="store_slug"
                type="text"
                {...register('store_slug', {
                  onChange: () => { slugTouchedRef.current = true },
                })}
                placeholder="ivcg7f-00"
                aria-invalid={!!errors.store_slug}
                aria-describedby={errors.store_slug ? 'store_slug-error' : 'store_slug-preview'}
                className="min-w-0 flex-1 px-4 py-3 text-sm outline-none font-mono bg-transparent"
              />
            </div>
            {errors.store_slug ? (
              <p id="store_slug-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.store_slug.message}</p>
            ) : (
              <p id="store_slug-preview" className="mt-2.5 text-xs text-gray-500 dark:text-gray-400" dir="ltr">
                {storeSlug ? `/stores/${storeSlug}` : 'سيظهر رابط متجرك هنا'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="store_currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              العملة
            </label>
            <select
              id="store_currency"
              {...register('store_currency')}
              defaultValue=""
              aria-invalid={!!errors.store_currency}
              aria-describedby={errors.store_currency ? 'store_currency-error' : undefined}
              className={`w-full py-3 px-4 border rounded-xl transition-all duration-300 shadow-inner bg-white dark:bg-gray-900 appearance-none ${fieldClasses(!!errors.store_currency, false)}`}
            >
              <option value="" disabled>اختر العملة</option>
              {STORE_CURRENCIES.map((code) => (
                <option key={code} value={code}>{CURRENCY_LABELS[code]}</option>
              ))}
            </select>
            {errors.store_currency && <p id="store_currency-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.store_currency.message}</p>}
          </div>

          {/* ── القسم ج: كلمة المرور ── */}
          <SectionHeading title="كلمة المرور" />

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              كلمة المرور
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                {...register('password')}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : 'password-strength'}
                className={`w-full py-3 px-4 pl-11 border rounded-xl transition-all duration-300 shadow-inner ${fieldClasses(!!errors.password, touchedFields.password === true && !errors.password)}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                aria-pressed={showPassword}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 rounded"
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            {errors.password && <p id="password-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.password.message}</p>}
            {password && (
              <div id="password-strength" className="mt-3 space-y-2" aria-live="polite">
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

          <div>
            <label htmlFor="password_confirmation" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              تأكيد كلمة المرور
            </label>
            <div className="relative">
              <input
                id="password_confirmation"
                type={showPasswordConfirmation ? 'text' : 'password'}
                {...register('password_confirmation')}
                aria-invalid={!!errors.password_confirmation}
                aria-describedby={errors.password_confirmation ? 'password_confirmation-error' : undefined}
                className={`w-full py-3 px-4 pl-11 border rounded-xl transition-all duration-300 shadow-inner ${fieldClasses(!!errors.password_confirmation, touchedFields.password_confirmation === true && !errors.password_confirmation)}`}
              />
              <button
                type="button"
                onClick={() => setShowPasswordConfirmation((v) => !v)}
                aria-label={showPasswordConfirmation ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                aria-pressed={showPasswordConfirmation}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 rounded"
              >
                {showPasswordConfirmation ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
            {errors.password_confirmation && <p id="password_confirmation-error" role="alert" className="mt-2.5 text-sm text-red-600">{errors.password_confirmation.message}</p>}
          </div>

          <div className="pt-2">
            <TurnstileCaptcha
              onVerify={(token) => {
                setValue('cf_turnstile_token', token, { shouldValidate: true });
              }}
              onError={() => setError('cf_turnstile_token', { type: 'manual', message: 'فشل التحقق الأمني، يرجى المحاولة مرة أخرى' })}
            />
            {errors.cf_turnstile_token && <p role="alert" className="mt-2.5 text-sm text-red-600">{errors.cf_turnstile_token.message}</p>}
          </div>

          <div className="pt-2 space-y-4">
            <button
              type="submit"
              disabled={loading || !isValid || emailChecking}
              className={`w-full py-4 rounded-xl text-white font-semibold transition-all duration-300
                ${isValid && !loading && !emailChecking
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

            {serverError && (
              <div role="alert" className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-xl text-center text-red-700 dark:text-red-300 text-sm">
                {serverError}
              </div>
            )}

            <AuthNavigationLinks />
          </div>
        </form>
      </div>
    </div>
  );
}

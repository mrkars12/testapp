'use client'

import { useRouter, usePathname } from 'next/navigation'

export default function AuthNavigationLinks() {
  const router = useRouter()
  const pathname = usePathname()

  // تحديد الصفحة الحالية بدقة
  const isLoginPage = pathname === '/login'
  const isRegisterPage = pathname.startsWith('/register')
  const isForgotPasswordPage = pathname === '/forgot-password'

  return (
    <div className="w-full pt-4 border-t border-gray-100 dark:border-gray-800/60 text-center">
      <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-2 text-xs font-bold text-gray-400 dark:text-gray-500">
        
        {/* 1️⃣ لو المستخدم في صفحة تسجيل الدخول (Login) */}
        {isLoginPage && (
          <>
            {/* رابط إنشاء الحساب */}
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              ليس لديك حساب؟{' '}
              <button
                type="button"
                onClick={() => router.push('/register')}
                className="text-cyan-600 dark:text-cyan-400 font-bold hover:underline transition-colors"
              >
                أنشئ حسابك الآن
              </button>
            </p>

            {/* الفاصل الجمالي المنطقي */}
            <span className="text-gray-300 dark:text-gray-700">|</span>

            {/* رابط نسيت كلمة المرور حصرياً هنا */}
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className="text-emerald-600 dark:text-emerald-400 hover:underline transition-colors"
            >
              نسيت كلمة المرور؟
            </button>
          </>
        )}

        {/* 2️⃣ لو المستخدم في صفحة إنشاء الحساب (Register) */}
        {isRegisterPage && (
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            لديك حساب بالفعل؟{' '}
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline transition-colors"
            >
              سجل الدخول الآن
            </button>
          </p>
        )}

        {/* 3️⃣ لو المستخدم في صفحة نسيت كلمة المرور (Forgot Password) */}
        {isForgotPasswordPage && (
            <p className="text-gray-500 dark:text-gray-400 font-medium">
            لديك حساب بالفعل؟{' '}
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline transition-colors"
            >
              سجل الدخول الآن
            </button>
          </p>
        )}

      </div>
    </div>
  )
}
'use client'

import { useEffect, useRef, Suspense } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Inter, Cairo, Tajawal } from 'next/font/google'
import { useAuth } from '@/components/AuthProvider'
import Sidebar from '@/components/layout/Sidebar'
import TopMenu from '@/components/layout/TopMenu'
import { useNotificationStore } from '@/components/notificationStore'
import { useBalanceStore } from '@/components/balanceStore'
import { useDevicesStore } from '@/lib/device'
import NotificationSound from '@/components/NotificationSound'
import { useAuthState } from '@/lib/authState'
import AuthGuard from '@/components/AuthGuard'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-cairo' })
const tajawal = Tajawal({ subsets: ['arabic'], weight: ['400', '500', '700'], variable: '--font-tajawal' })


function ProtectedLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isSessionReady, isLoading } = useAuth()
  const status = useAuthState(s => s.status)
  const hydratedRef = useRef<string | null>(null)

  // الصفحات العامة والمسارات المحمية
  // الصفحات العامة والمسارات المحمية
  const isPublicPage = pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/store/')
  
  // 🍏 أضفنا '/stores-building' إجبارياً هنا داخل مصفوفة الحماية العامة للتطبيق
  const protectedRoutes = ['/dashboard', '/settings', '/wallet', '/notifications', '/devices', '/stores-building']
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  // التحقق من تفعيل البريد
  const emailVerified = user?.email_verified_at !== null && user?.email_verified_at !== undefined
  const isVerificationAllowed = pathname === '/dashboard'
  const shouldBlockRoute = status === 'authenticated' && !!user && !emailVerified && !isVerificationAllowed


  
  /**
   * =================================
   * ✅ المزامنة وجلب البيانات (Hydration) عند الدخول
   * =================================
   */
  useEffect(() => {
    if (!isSessionReady || isLoading || status !== 'authenticated' || !user?.id) return;

    const currentUserId = String(user.id)
    if (hydratedRef.current === currentUserId) return;
    hydratedRef.current = currentUserId

    useBalanceStore.getState().fetch(true).catch(() => {})
    useDevicesStore.getState().fetchDevices().catch(() => {})

    if (emailVerified) {
      useNotificationStore.getState().fetchLatest().catch(() => {})
    }
  }, [status, isSessionReady, isLoading, user?.id, emailVerified])

  /**
   * =================================
   * ✅ توجيه الحسابات غير المفعلة بريدياً
   * =================================
   */
  useEffect(() => {
    if (shouldBlockRoute) {
      router.replace('/dashboard')
    }
  }, [shouldBlockRoute, router])

  /**
   * =================================
   * ✅ التحويلات التلقائية (Auth Redirects) لمنع الـ Loops
   * =================================
   */
  useEffect(() => {
    if (!isSessionReady || isLoading || status === 'booting') return;

    const currentPath = pathname + window.location.search

    // 1. الزوار يحاولون دخول صفحات محمية
    if (status === 'unauthenticated' && isProtectedRoute) {
      router.replace(`/login?intended=${encodeURIComponent(currentPath)}`)
      return
    }

    // 2. مستخدم مسجل يقف على صفحة عامة
    if (status === 'authenticated' && isPublicPage) {
      const params = new URLSearchParams(window.location.search)
      const intended = params.get('intended') || params.get('redirect')
      const target = intended ? decodeURIComponent(intended) : '/dashboard'

      if (currentPath !== target) {
        router.replace(target)
      }
    }
  }, [pathname, router, status, isSessionReady, isLoading, isPublicPage, isProtectedRoute])

  /**
   * =================================
   * 🛑 شاشات الحجب الشاملة لمنع الـ Flicker
   * =================================
   */

  // 1. حجب الشاشة بالكامل أثناء عملية تسجيل الخروج
  if (status === 'logging_out') {
    return (
      <div className="fixed inset-0 bg-white z-[999999] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm font-medium">جارٍ تسجيل الخروج...</p>
      </div>
    )
  }
  if (status === 'refreshing_session') {

  return (

    <div className="fixed inset-0 bg-white z-[999999] flex flex-col items-center justify-center gap-4">

      <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin" />

      <p className="text-gray-500 text-sm font-medium">
        جارٍ تأمين الجلسة...
      </p>

    </div>
  )
}
  // 2. 🚩 [تأمين ثغرة الـ Booting الفورية لصفحات اللوجين]
  // طالما المتصفح بيحمل الجلسة في البداية، ممنوع منعاً باتاً إظهار صفحة الدخول، تظل شاشة بيضاء محجوبة
  if (isPublicPage && (status === 'booting' || isLoading || !isSessionReady)) {
    return <div className="fixed inset-0 bg-white z-[999999]" />
  }

  // 3. حجب شاشة الدخول تماماً إذا تأكدنا أن حالة الحساب الموثق أصبحت authenticated
  if (status === 'authenticated' && isPublicPage) {
    return <div className="fixed inset-0 bg-white z-[999999]" />
  }

  // 4. حجب الصفحات المحمية أثناء مرحلة التوثيق الابتدائية للزوار
  if (isProtectedRoute && (status === 'booting' || isLoading || !isSessionReady || (status === 'unauthenticated' && !user))) {
    return <div className="fixed inset-0 bg-white z-[999999]" />
  }

  // 5. السماح برندرة الصفحات العامة بأمان للزوار الفعليين بعد تخطي التحققات
  if (isPublicPage) {
    return <>{children}</>
  }

  // 6. حجب ريندر الصفحات غير المفعلة بريدياً لحين توجيهها للداشبورد
  if (shouldBlockRoute) {
  return null
}

const isThemeEditor =
  pathname.startsWith(
    '/stores-building/themes'
  )

if (isThemeEditor) {
  return (
    <>
      <NotificationSound />

      <AuthGuard>
        {children}
      </AuthGuard>
    </>
  )
}

  /**
   * =================================
   * ✅ رندرة التطبيق الأساسي ولوحة التحكم
   * =================================
   */
  return (
    <div className="flex min-h-screen w-full bg-gray-50">
      <NotificationSound />

      <Sidebar key={`sidebar-${user?.id}`} />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-[15.5rem]">
        <TopMenu />

        <main className="flex-1 m-4 lg:m-1 p-5 lg:p-5 ">
          <AuthGuard>

            {children}

          </AuthGuard>
        </main>
      </div>
    </div>
  )
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-white z-[999999]" />}>
      <ProtectedLayoutContent>{children}</ProtectedLayoutContent>
    </Suspense>
  )
}
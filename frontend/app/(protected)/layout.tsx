'use client'

import { useEffect, useMemo, useRef, Suspense } from 'react'
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
import { ensureStoreBootstrap, useStoreBootstrap } from '@/lib/storeBootstrap'
import { extractStoreSlug } from '@/lib/storeRoute'
import StoreUnavailable from '@/components/StoreUnavailable'

const NEUTRAL_BLOCKER = <div className="fixed inset-0 bg-white z-[999999]" />

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-cairo' })
const tajawal = Tajawal({ subsets: ['arabic'], weight: ['400', '500', '700'], variable: '--font-tajawal' })


function ProtectedLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isSessionReady, isLoading, refreshUser } = useAuth()
  const status = useAuthState(s => s.status)
  const hydratedRef = useRef<string | null>(null)

  // This component only ever mounts for `app/(protected)/**` routes, so
  // every pathname it sees is a protected one. (`/login` / `/register` are
  // `app/(public)/**` — handled by `PublicAuthGuard` there.)
  const protectedRoutes = ['/verify-email', '/settings', '/wallet', '/notifications', '/devices', '/store', '/select-store']
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  /**
   * Email verification — an explicit THREE-state read, because "we don't
   * know yet" must never be mistaken for "unverified":
   *
   *   verified   — the profile carries an `email_verified_at` timestamp
   *   unverified — the profile carries the `email_verified_at` KEY and it
   *                is null  (an authoritative `/auth/me` / `sanitizeUser`
   *                answer, or the now-authoritative login response)
   *   unknown    — authenticated, but the user object has no
   *                `email_verified_at` key at all yet (a thin, pre-`/auth/me`
   *                seed). Wait for the authoritative fetch; do NOT redirect.
   *
   * The old check (`email_verified_at !== null && !== undefined`) collapsed
   * `unknown` into `unverified`, so a freshly-logged-in VERIFIED account —
   * whose cache was momentarily seeded from the thin login payload — was
   * bounced to `/verify-email` for one round-trip (the visible flash).
   */
  const hasVerificationInfo =
    !!user && Object.prototype.hasOwnProperty.call(user, 'email_verified_at')
  const emailVerified = hasVerificationInfo && user!.email_verified_at != null
  const emailKnownUnverified = hasVerificationInfo && user!.email_verified_at == null
  const emailStatusUnknown = status === 'authenticated' && !!user && !hasVerificationInfo

  // `/dashboard` no longer exists as a route at all (it 404s) — the
  // dedicated email-verification gate is `/verify-email`, kept as its own
  // route specifically so it is never confused with the merchant Dashboard
  // that `/store/<slug>` now owns.
  const isVerificationAllowed = pathname === '/verify-email'
  const shouldBlockRoute =
    status === 'authenticated' && !!user && emailKnownUnverified && !isVerificationAllowed

  /**
   * Store authorization — evaluated HERE, at the boundary that decides to
   * mount the merchant shell (`<Sidebar/> + <TopMenu/>`), NOT one layout
   * deeper in `store/[storeSlug]/layout.tsx`. Deciding it deeper is why the
   * shell used to paint before the "غير متاحة" rejection: the parent shell
   * had already mounted. Now, for a `/store/<slug>` path whose slug is not
   * one of the current user's OWN stores, this returns the safe rejection
   * INSTEAD of the shell — the merchant subtree never mounts.
   *
   * Frontend UX gate only; the backend `ActiveStoreGuard` (owner-scoped
   * 404) + RLS remain the real security boundary and are unchanged.
   */
  const storeSlugInPath = useMemo(() => extractStoreSlug(pathname), [pathname])
  const knownStores = useStoreBootstrap((s) => s.stores)
  const storeBootstrapStatus = useStoreBootstrap((s) => s.status)
  const slugKnownOwned =
    !!storeSlugInPath && knownStores.some((s) => s.slug === storeSlugInPath)
  // A successful `/stores` fetch is the only thing that fills `knownStores`
  // or moves status to `ready`/`error`; every post-auth nav path
  // (`authedHome`, `/store/new`, `/select-store`) force-refreshes it BEFORE
  // routing here, so a legitimate slug is always already present.
  const storeListResolvedOnce =
    storeBootstrapStatus === 'ready' ||
    storeBootstrapStatus === 'error' ||
    knownStores.length > 0
  const storeAccess: 'allow' | 'pending' | 'deny' = !storeSlugInPath
    ? 'allow'
    : slugKnownOwned
      ? 'allow'
      : !storeListResolvedOnce || storeBootstrapStatus === 'loading'
        ? 'pending'
        : 'deny'


  
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
    // Global active-store bootstrap — runs here, at the outer protected
    // layout, specifically because THIS component is always mounted for
    // every authenticated route. It previously lived only inside
    // StoreSwitcher (rendered by the Sidebar), so any route whose layout
    // skips the Sidebar (e.g. the full-screen theme editor branch below)
    // never triggered it, leaving store-dependent pages waiting on an
    // activeStore that nothing was ever going to resolve. Idempotent — a
    // second call (from a page's own `useActiveStoreReady()`) is a no-op.
    ensureStoreBootstrap().catch(() => {})

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
      router.replace('/verify-email')
    }
  }, [shouldBlockRoute, router])

  /**
   * Email-verification status is authenticated-but-unknown (thin seed, no
   * `/auth/me` yet). Pull the authoritative profile so the three-state read
   * above resolves to verified/unverified — never leave the gate guessing.
   */
  useEffect(() => {
    if (emailStatusUnknown) {
      refreshUser().catch(() => {})
    }
  }, [emailStatusUnknown, refreshUser])

  /**
   * =================================
   * ✅ التحويلات التلقائية (Auth Redirects) لمنع الـ Loops
   * =================================
   */
  useEffect(() => {
    if (!isSessionReady || isLoading || status === 'booting') return;

    const currentPath = pathname + window.location.search

    // Guests hitting a protected route -> login, remembering where they
    // were headed. (The "authenticated user on a public auth page" case is
    // NOT handled here: this component only ever mounts for `(protected)/`
    // routes, so a `/login`/`/register` pathname is unreachable — that
    // forwarding lives in `app/(public)/layout.tsx`'s `PublicAuthGuard`.)
    if (status === 'unauthenticated' && isProtectedRoute) {
      router.replace(`/login?intended=${encodeURIComponent(currentPath)}`)
    }
  }, [pathname, router, status, isSessionReady, isLoading, isProtectedRoute])

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
  // Block protected pages during the initial auth resolution for visitors.
  if (isProtectedRoute && (status === 'booting' || isLoading || !isSessionReady || (status === 'unauthenticated' && !user))) {
    return NEUTRAL_BLOCKER
  }

  // Authenticated but email-verification status not yet known — hold the
  // neutral blocker (NOT the verification page, NOT the merchant shell)
  // until the authoritative profile lands. UNKNOWN ≠ UNVERIFIED.
  if (isProtectedRoute && emailStatusUnknown && !isVerificationAllowed) {
    return NEUTRAL_BLOCKER
  }

  // Block render of an email-unverified account's page until it is forwarded.
  if (shouldBlockRoute) {
  return null
}

  // Store authorization gate — BEFORE the merchant shell mounts. A
  // `/store/<slug>` path whose slug is not one of the user's own stores is
  // rejected here; the Sidebar / TopMenu / dashboard subtree never render.
  if (storeAccess === 'pending') {
    return NEUTRAL_BLOCKER
  }
  if (storeAccess === 'deny') {
    return <StoreUnavailable />
  }

const isThemeEditor =
  pathname.startsWith(
    '/store/themes'
  )

// The post-login store chooser (Part 24) must read as an authentication/
// onboarding screen, not a merchant Dashboard page — it renders full-screen,
// with no Sidebar/TopMenu, the same way the theme editor already opts out
// of the merchant shell below.
const isAuthFlowPage = pathname === '/select-store'

if (isThemeEditor || isAuthFlowPage) {
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
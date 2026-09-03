'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthState } from '@/lib/authState'
import { authedHome } from '@/lib/storeBootstrap'
import NeutralAuthShell from '@/components/NeutralAuthShell'

/**
 * Gate for the `(public)` auth routes (`/login`, `/register`,
 * `/register/*`). Two jobs, both about an ALREADY-authenticated visitor
 * who reaches one of these routes (a landing-page CTA, a stale bookmark,
 * browser Back, a bfcache restore):
 *
 *  1. NO FORM FLASH. The auth form is rendered ONLY once we positively
 *     know the visitor is a guest (`status === 'unauthenticated'`). While
 *     the state is unknown (`booting` / query still loading) or the
 *     visitor is authenticated (being forwarded), a neutral shell is
 *     shown instead. The old gate only hid the form for
 *     `status === 'authenticated'`, so a fresh / hard / bfcache load —
 *     where `status` starts at `booting` — briefly painted the form.
 *
 *  2. FORWARD, don't sit. An authenticated visitor is sent to
 *     `authedHome('resume')` (the single owner) — the deep link if one is
 *     present, else the user's original store. NEVER `/select-store`:
 *     merely re-visiting `/login` is a resume, not a fresh login.
 *
 * It must not touch the moment a login is COMPLETING on this page —
 * `LoginClient.handleAuthSuccess` sets `status` to `authenticated` and
 * runs its own `router.replace`. That case always passes through
 * `status === 'unauthenticated'` first (`sawUnauth`), so the forward
 * effect below bails and lets `handleAuthSuccess` own the navigation.
 *
 * No `popstate` / `pushState` / history interception — only a forward
 * `router.replace` when it applies.
 */

const SETTLE_MS = 60
const BOOTING_SAFETY_MS = 5000

function PublicAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const status = useAuthState((s) => s.status)

  // A login/logout completing HERE always passes through
  // `unauthenticated` first — then the forward is `handleAuthSuccess`'s.
  const [sawUnauth, setSawUnauth] = useState(false)
  // Force the neutral shell after a bfcache restore of this page for an
  // authenticated visitor, before React would otherwise re-render the
  // (stale) form.
  const [forceShell, setForceShell] = useState(false)
  // Last-resort: if `/auth/me` never resolves, don't trap a real guest on
  // the shell forever — after a few seconds, assume guest and show the form.
  const [bootingTooLong, setBootingTooLong] = useState(false)
  const firedRef = useRef(false)

  const isAuthEntryPage =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname.startsWith('/register/')

  useEffect(() => {
    // one-way latch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'unauthenticated') setSawUnauth(true)
  }, [status])

  useEffect(() => {
    if (!isAuthEntryPage || status !== 'booting') {
      // reset when we leave `booting` (reacts to an observed transition)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBootingTooLong(false)
      return
    }
    const t = setTimeout(() => setBootingTooLong(true), BOOTING_SAFETY_MS)
    return () => clearTimeout(t)
  }, [isAuthEntryPage, status])

  useEffect(() => {
    if (!isAuthEntryPage) {
      firedRef.current = false
      return
    }

    const settleAndGo = () => {
      if (firedRef.current) return
      if (useAuthState.getState().status !== 'authenticated') return
      if (sawUnauth) return
      if (window.location.pathname !== pathname) return

      const search = new URLSearchParams(window.location.search)
      const reason = search.get('reason')
      if (reason === 'timeout' || reason === 'force_logout') return

      firedRef.current = true

      const go = (target: string) => {
        if (window.location.pathname + window.location.search !== target) {
          router.replace(target)
        }
      }

      // Single resolver. `authedHome` validates `intended` (safe, not an
      // auth route, owned store) and otherwise resumes into a real store —
      // never the one-time chooser.
      const raw = search.get('intended') || search.get('redirect')
      authedHome('resume', raw).then(go).catch(() => go('/store/new'))
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    if (status === 'authenticated' && !sawUnauth) {
      timer = setTimeout(settleAndGo, SETTLE_MS)
    }

    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      firedRef.current = false
      setSawUnauth(false)
      if (useAuthState.getState().status === 'authenticated') {
        setForceShell(true) // hide the bfcache-restored form immediately
        settleAndGo()
      }
    }
    window.addEventListener('pageshow', onPageShow)

    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [isAuthEntryPage, status, pathname, router, sawUnauth])

  // ── RENDER GATE ────────────────────────────────────────────────
  // The form renders ONLY for a confirmed guest. Anything else — state
  // unknown, authenticated (redirecting), logging out, bfcache restore —
  // shows the neutral shell so the auth form is never visible to an
  // already-authenticated user.
  if (isAuthEntryPage) {
    const confirmedGuest = status === 'unauthenticated' || bootingTooLong
    if (forceShell || !confirmedGuest) {
      return <NeutralAuthShell />
    }
  }

  return <>{children}</>
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<NeutralAuthShell />}>
      <PublicAuthGuard>{children}</PublicAuthGuard>
    </Suspense>
  )
}

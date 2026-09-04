'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useAuthState } from '@/lib/authState'
import NeutralAuthShell from '@/components/NeutralAuthShell'

/**
 * Root `/` gate.
 *
 * In this deployment the `access_token` cookie is set by the API origin
 * (`*-4000…`), so the FRONTEND server cannot read it — a pure
 * `redirect()` in the server component can't tell guest from authed.
 * This is the minimum client shim: it does NO destination logic of its
 * own — an authenticated visitor is handed straight to `/store`, the ONE
 * slug-agnostic resolver (`authedHome` / `StoreIndexPage`), which decides
 * 0 / 1 / many. It never touches `resolvePostAuthTarget` and never lands
 * on `/select-store`.
 *
 *   authenticated -> router.replace('/store')   (white overlay meanwhile)
 *   unauthenticated -> the server-rendered marketing landing
 *   still resolving -> white overlay (brief)
 *
 * `pageshow(persisted)` handles browser Back into a bfcache-restored copy
 * of `/`: the frozen page skips React re-render, so re-ask explicitly.
 */
export default function RootEntry({ landing }: { landing: React.ReactNode }) {
  const router = useRouter()
  const { isLoading, isSessionReady } = useAuth()
  const status = useAuthState((s) => s.status)

  useEffect(() => {
    if (status === 'authenticated') router.replace('/store')
  }, [status, router])

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      if (useAuthState.getState().status === 'authenticated') router.replace('/store')
      else window.location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [router])

  if (status === 'unauthenticated' && isSessionReady && !isLoading) {
    return <>{landing}</>
  }
  // authenticated (redirecting to /store) or still resolving
  return <NeutralAuthShell />
}

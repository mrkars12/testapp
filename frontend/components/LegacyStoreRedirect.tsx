'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  useStoreBootstrap,
  ensureStoreBootstrap,
  resolveOriginalStoreSlug,
} from '@/lib/storeBootstrap'

/**
 * Bridges the store-agnostic URLs (`/store/products`) that
 * predate the `[storeSlug]` segment, plus any nav link rendered before a
 * store was known, onto the real store-scoped route.
 *
 * It resolves the ORIGINAL store — the first this account ever created —
 * and redirects there. With zero stores it sends the user to the dashboard
 * entry, which shows the create-store flow. `stores[0]` is never a
 * fallback: the choice comes from `createdAt`, not from array position.
 *
 * `router.replace` (not `push`) keeps the slug-free URL out of history, so
 * Back from the real page doesn't bounce through this redirect again.
 */
export default function LegacyStoreRedirect({ subPath }: { subPath?: string }) {
  const router = useRouter()
  const stores = useStoreBootstrap((s) => s.stores)
  const status = useStoreBootstrap((s) => s.status)

  useEffect(() => {
    ensureStoreBootstrap().catch(() => {})
  }, [])

  useEffect(() => {
    if (status !== 'ready' && status !== 'error') return
    const slug = resolveOriginalStoreSlug(stores)
    if (!slug) {
      router.replace('/stores')
      return
    }
    // Carry the query string across the redirect. Some of these URLs are
    // meaningless without it — a gateway returning from a test payment
    // lands on `.../test/result?token=...`, and dropping the token turns a
    // successful payment into an unreadable result page. Read from
    // `window.location` rather than `useSearchParams()` so this stays a
    // plain effect and does not force a Suspense boundary on every stub.
    const search = typeof window !== 'undefined' ? window.location.search : ''
    router.replace(`/stores/${slug}${subPath ? `/${subPath}` : ''}${search}`)
  }, [status, stores, subPath, router])

  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
        <p className="text-sm text-gray-400">جارٍ فتح المتجر...</p>
      </div>
    </div>
  )
}

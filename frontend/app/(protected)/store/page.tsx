'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  useStoreBootstrap,
  ensureStoreBootstrap,
  resolveOriginalStoreSlug,
} from '@/lib/storeBootstrap'

/**
 * The dashboard entry point. The URL names no store, so this resolves the
 * user's ORIGINAL / PRIMARY store and redirects into its dashboard:
 *
 *     /store  ->  /store/<original>
 *
 * The destination is `resolveOriginalStoreSlug`: the ORIGINAL store, i.e.
 * the first store this account ever created (`createdAt` ascending, id
 * tie-broken). It is deterministic — the same user lands on the same store
 * every time — and it is neither `stores[0]` nor the `is_default` store.
 *
 * `is_default` is deliberately not used here: it is a user-selectable
 * preference that can point at the NEWEST store, which would make the
 * dashboard entry point drift as soon as the user changes it.
 *
 * This route previously rendered the store-management grid and deliberately
 * never redirected, on the reasoning that auto-navigating could overwrite a
 * selection the user had already made. That reasoning belonged to the old
 * architecture, where the active store was one global value that a redirect
 * really could clobber. It no longer applies: the active store is the
 * `[storeSlug]` URL segment, so a slug-free URL has no selection to
 * overwrite, and redirecting from it can only ever *add* a slug. The
 * permanent store-list grid this used to redirect to (`/store/all`) has
 * been removed entirely — the only remaining multi-store surfaces are the
 * Store Switcher (always visible) and `/select-store` (the post-login
 * chooser for 2+ stores, reached only right after authentication).
 *
 * The redirect is `replace`, not `push`: this URL resolves to somewhere
 * else, so leaving it in history would make Back re-run the redirect and
 * trap the user on the destination page.
 */
export default function StoreIndexPage() {
  const router = useRouter()
  const stores = useStoreBootstrap((s) => s.stores)
  const status = useStoreBootstrap((s) => s.status)

  useEffect(() => {
    ensureStoreBootstrap().catch(() => {})
  }, [])

  useEffect(() => {
    // 'error' is a terminal state too — falling through on it shows the
    // create-store empty state below rather than spinning forever. With no
    // store list there is nothing to resolve, and the user can still act.
    if (status !== 'ready' && status !== 'error') return

    const slug = resolveOriginalStoreSlug(stores)
    if (!slug) return // no stores — render the create-store flow below

    // Store ROOT, not a section. Appending `/products` here would make
    // "enter the dashboard" mean "open the catalogue", which is the
    // conflation this route is no longer allowed to make.
    router.replace(`/store/${encodeURIComponent(slug)}`)
  }, [status, stores, router])

  const resolving = status === 'idle' || status === 'loading' || resolveOriginalStoreSlug(stores) !== null

  if (resolving) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
          <p className="text-sm text-gray-400">جارٍ فتح المتجر...</p>
        </div>
      </div>
    )
  }

  // Zero stores: the existing empty-state / create-store flow, unchanged.
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8 border-b border-gray-100 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 font-sans">متاجري</h1>
        <p className="text-sm text-gray-500 mt-1">إدارة جميع متاجرك الإلكترونية</p>
      </div>

      <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl bg-white">
        <p className="text-lg font-semibold text-gray-700">لا يوجد متجر</p>
        <p className="mt-1 text-sm text-gray-500">أنشئ متجرك الأول للبدء في البيع</p>
        <button
          onClick={() => router.push('/store/new')}
          className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          + إضافة متجر جديد
        </button>
      </div>
    </div>
  )
}

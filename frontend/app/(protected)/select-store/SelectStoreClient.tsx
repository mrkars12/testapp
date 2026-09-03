'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useStoreBootstrap,
  ensureStoreBootstrap,
  orderStoresForDisplay,
  resolveOriginalStoreSlug,
  authedHome,
} from '@/lib/storeBootstrap'
import { useAuth } from '@/components/AuthProvider'

/**
 * The post-login store CHOOSER — reached only when an account owns 2+
 * stores (`resolvePostAuthTarget`). This is a distinct, auth-flow-styled
 * screen, not a merchant management page: it exists purely to pick which
 * store to enter, and picking one is a plain navigation to `/store/<slug>`,
 * nothing more.
 *
 * This used to be `/store/all`, a permanent in-app "all stores" list
 * (Sidebar-adjacent, reachable any time via the Store Switcher). The two
 * concepts were never the same thing wearing one URL: that page stayed
 * around after use, offered per-section quick actions, and was linked from
 * the merchant shell. This page does none of that — it is not in the
 * Sidebar, not in the Store Switcher, and renders outside the merchant
 * shell (see the `(protected)/layout.tsx` case for this route).
 */
export default function SelectStoreClient() {
  const router = useRouter()
  const stores = useStoreBootstrap((s) => s.stores)
  const status = useStoreBootstrap((s) => s.status)

  // The chooser is a post-login step reached while authenticated, so it
  // needs a way OUT that is not "pick a store". This reuses the one real
  // logout flow (`useAuth().logout` -> server `/auth/logout`, cookie clear,
  // socket teardown, cross-tab broadcast, redirect to `/login`) — it does
  // not navigate to `/login` on its own, and it persists nothing.
  const { logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = () => {
    if (loggingOut) return
    setLoggingOut(true)
    void logout()
  }

  useEffect(() => {
    ensureStoreBootstrap().catch(() => {})
  }, [])

  const settled = status === 'ready' || status === 'error'
  const ordered = orderStoresForDisplay(stores)
  const originalSlug = resolveOriginalStoreSlug(stores)

  // A direct visit to this URL with 0 or 1 store is not a real choice, so
  // hand it back to the ONE post-auth resolver (fresh-login context) rather
  // than re-deriving "0 -> /store/new, 1 -> /store/<slug>" here.
  //
  // ── WHY THE RE-ENTRY GUARD ────────────────────────────────────────
  //
  // This effect calls something that invalidates its own trigger.
  // `authedHome()` awaits `refreshStoreBootstrap()`, which is
  // `ensureStoreBootstrap(force = true)` — a FORCED refresh that always
  // sets `status: 'loading'` and then `'ready'`. `settled` is derived
  // from that status and is in the dependency array, so:
  //
  //     settled → effect → authedHome → status 'loading'  (settled false)
  //             → fetch resolves      → status 'ready'    (settled true)
  //             → effect → authedHome → …
  //
  // an unbounded loop that re-fetches `/stores` forever. In a browser it
  // happened to stop, but only by accident: `router.replace(t)` navigates
  // away and unmounts the component before the next pass lands. Anything
  // that does not unmount — a router that no-ops, a resolver that returns
  // the current path, a navigation that is blocked or slow — leaves it
  // spinning, hammering the endpoint and allocating on every pass.
  //
  // It is also what made the frontend test suite unable to finish: with a
  // no-op router the loop never terminated and the worker died with
  // "Ineffective mark-compacts near heap limit — JavaScript heap out of
  // memory", which vitest reports only as "Worker exited unexpectedly".
  // That looked environmental for weeks; it is deterministic, and
  // reproduces with this one file run on its own.
  //
  // Resolving a destination is a once-per-visit question, so the guard
  // says so directly. Behaviour is otherwise identical: the same resolver,
  // the same context, the same `replace`.
  const resolvingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!settled || stores.length > 1) return
    if (resolvingRef.current) return

    resolvingRef.current = true

    authedHome('fresh-login')
      .then((t) => {
        // Guarded on UNMOUNT, not on this effect re-running.
        //
        // A per-invocation `cancelled` flag cleared in the effect's
        // cleanup would be wrong here, and subtly so: `authedHome`
        // itself flips `settled` false and back to true, so the effect
        // is guaranteed to re-run — and therefore to clean up — while
        // its own resolution is still in flight. The navigation would
        // be discarded every single time and a one-store account would
        // sit on the chooser forever.
        if (mountedRef.current && t !== '/select-store') router.replace(t)
      })
      .catch(() => {
        // Let a genuine failure be retried on the next settle rather
        // than wedging the page on a transient error.
        resolvingRef.current = false
      })
  }, [settled, stores.length, router])

  // `replace`, not `push`: the chooser is a ONE-TIME post-login step. If it
  // stayed in history, pressing Back from `/store/<slug>` would re-enter it
  // even though an active store is now chosen. Replacing its history entry
  // makes Back skip straight past it to whatever preceded `/login` — no
  // Back-button interception, just correct history semantics.
  const selectStore = (slug: string) => {
    router.replace(`/store/${encodeURIComponent(slug)}`)
  }

  // Same reasoning: leaving the chooser via "create a store" must also not
  // leave it behind in history.
  const goCreateStore = () => {
    router.replace('/store/new')
  }

  if (!settled || stores.length <= 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-16" dir="rtl">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-bold text-gray-900">اختر المتجر</h1>
          <p className="mt-2 text-sm text-gray-500">اختر المتجر الذي تريد الوصول إليه</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ordered.map((store) => (
            <button
              key={store.id}
              onClick={() => selectStore(store.slug)}
              className="group flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-5 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-sm font-bold text-white">
                {(store.name?.[0] || store.slug[0] || '?').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold text-gray-900">{store.name}</span>
                  {store.slug === originalSlug && (
                    <span className="rounded bg-indigo-50 px-1.5 py-px text-[10px] font-medium text-indigo-700">
                      المتجر الأصلي
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-gray-400">/{store.slug}</span>
                {store.currency && (
                  <span className="mt-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    {store.currency}
                  </span>
                )}
              </span>
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className="mt-1 shrink-0 text-gray-300 transition-transform group-hover:-translate-x-0.5 group-hover:text-gray-500"
              >
                <path d="M11 17 6 12l5-5M18 17l-5-5 5-5" />
              </svg>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={goCreateStore}
            className="text-sm font-semibold text-gray-600 hover:text-gray-900 hover:underline"
          >
            + إنشاء متجر جديد
          </button>
        </div>

        {/*
          The logout action is a fixed, always-visible part of this
          screen's chrome — a merchant who reached the chooser must be
          able to leave without picking a store. It is deliberately kept
          apart from the store cards and from "create a store" by its own
          top border, and wired to the ONE real logout flow
          (`useAuth().logout`), never a bare `/login` navigation.
        */}
        <div className="mt-10 border-t border-gray-200 pt-6 text-center">
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            {loggingOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}
          </button>
        </div>
      </div>
    </div>
  )
}

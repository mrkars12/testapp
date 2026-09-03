'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  useStoreBootstrap,
  ensureStoreBootstrap,
  refreshStoreBootstrap,
  orderStoresForDisplay,
  resolveOriginalStoreSlug,
} from '@/lib/storeBootstrap'

export default function StoreSwitcher() {
  const router = useRouter()
  // The `[storeSlug]` URL segment IS which store is active — there is no
  // other source. A store-agnostic route has no active store, so this is
  // null there and the trigger falls back to *displaying* the entry store
  // (see `showingLandingFallback`), which is UI information and never
  // becomes active state.
  const params = useParams()
  const activeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : null

  // The store list AND the initial-active-store decision both live in the
  // shared bootstrap module (lib/storeBootstrap.ts) — this is the ONE
  // place that ever picks a store automatically. The Switcher only reads
  // that state and triggers (re)fetches; it never decides a store itself.
  const rawStores = useStoreBootstrap((s) => s.stores)
  const bootstrapStatus = useStoreBootstrap((s) => s.status)

  // Presentation order, not fetch order: the ORIGINAL (first-created) store
  // is always the first row, then the rest in creation order. Shares one
  // comparator with `resolveOriginalStoreSlug`, so the row at the top of
  // this menu is by construction the same store `/store` redirects
  // into — not two rules that happen to agree today. `stores[0]` is never
  // consulted, and `is_default` deliberately does not affect ordering.
  const stores = useMemo(() => orderStoresForDisplay(rawStores), [rawStores])
  const loading = bootstrapStatus === 'loading'
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bootstrapStatus === 'error') setError('تعذر تحميل المتاجر')
  }, [bootstrapStatus])

  // Trigger the bootstrap on mount (idempotent/no-op if it already ran
  // from the protected layout or another page) so the collapsed display
  // name/initial can resolve without requiring the menu to be opened.
  useEffect(() => {
    ensureStoreBootstrap().catch(() => {})
  }, [])

  // Re-fetch every time the menu opens (not just once) — a store created,
  // renamed, or deleted elsewhere must not leave this list stale until a
  // full page reload. This is an explicit refresh, never a re-selection.
  useEffect(() => {
    if (!open) return
    setError('')
    refreshStoreBootstrap().catch(() => {})
  }, [open])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const currentStore = stores.find(s => s.slug === activeSlug) || null

  const switchStore = (targetSlug: string) => {
    if (targetSlug === activeSlug) { setOpen(false); return }
    setOpen(false)

    // The store lives in the URL, so switching stores is a navigation —
    // not a state mutation. Stay on the same *section* the user is
    // currently looking at (products stays products, orders stays orders)
    // and swap only the store segment, so switching never also throws
    // away where they were. The `[storeSlug]` layout keys the subtree on
    // the slug, so it remounts and no page can paint the previous store's
    // data; the first request out of the new subtree reads its slug from
    // the URL (see `resolveStoreSlugForHeader` in lib/api.ts), so it cannot
    // carry the previous store's `X-Store-Slug`.
    // `(.*)$` captures the ENTIRE remainder, so nested sections survive
    // intact: `settings/payments` -> `settings/payments`,
    // `themes/editor` -> `themes/editor`. Only a bare
    // `/store/<slug>` (no trailing segment) fails to match.
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
    const section = currentPath.match(/\/store\/[^/]+\/(.+)$/)?.[1]
    // No current section means the user is on the store ROOT, so the
    // target is the other store's root. Selecting a store is not a request
    // to open Products; only a section carries over.
    router.push(
      `/store/${encodeURIComponent(targetSlug)}${section ? `/${section}` : ''}`,
    )
  }

  // What the collapsed trigger represents.
  //
  // On a store-agnostic route (/dashboard, /exchange, /settings/security)
  // the URL names no store, and this used to read "اختر المتجر" — telling a
  // merchant who owns stores, and has a perfectly good default, to go and
  // choose one. It is only an honest prompt when there is genuinely nothing
  // to show, so fall back to the store the dashboard would actually open
  // (the ORIGINAL store, the same one the entry redirect uses) and label it
  // for what it is.
  const originalSlug = resolveOriginalStoreSlug(stores)
  const landingStore = stores.find((st) => st.slug === originalSlug) ?? null
  const displayStore = currentStore ?? (activeSlug ? null : landingStore)
  const displaySlug = activeSlug ?? displayStore?.slug ?? null

  // Distinguishes "this is the store you are in" from "this is the store
  // you would land on" — the trigger shows the default's name on
  // store-agnostic routes, and must not imply the user is inside it.
  const showingLandingFallback = !activeSlug && !!displayStore

  const hasNoStores = bootstrapStatus === 'ready' && stores.length === 0
  const displayName =
    displayStore?.name || activeSlug || (hasNoStores ? 'لا يوجد متجر' : 'اختر متجرًا')
  const displayInitial = (displayName?.[0] || '?').toUpperCase()

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-gray-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-900 text-[11px] font-bold text-white">
          {displayInitial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-[13px] font-semibold leading-tight text-gray-900">
            {loading && !displayStore ? 'جارٍ...' : displayName}
          </span>
          {displaySlug && <span className="truncate text-[11px] text-gray-400">/{displaySlug}</span>}
          {/*
            Two independent facts, never merged into one badge:
              الأصلي — first store ever created (immutable history)
              الحالي — the store this tab is currently looking at
            "is_default" is deliberately not surfaced here — the active
            store is the URL alone (Part 10), and a separate, editable
            "default store" affordance reads as a second source of truth
            for the same decision.
          */}
          <span className="flex flex-wrap items-center gap-1">
            {displayStore?.slug === originalSlug && (
              <span className="text-[10px] font-medium text-indigo-600">المتجر الأصلي</span>
            )}
            {!showingLandingFallback && displaySlug && (
              <span className="text-[10px] font-medium text-gray-500">الحالي</span>
            )}
          </span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {/* Names what this menu is FOR. The prompt to choose belongs
              here, on a menu the user deliberately opened — not on the
              collapsed trigger, where it read as "you have no store". */}
          <div className="border-b border-gray-100 px-3 py-2 text-[11px] font-semibold text-gray-500">
            تبديل المتجر
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {loading && stores.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
                جارٍ التحميل...
              </div>
            ) : error && stores.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-red-500">{error}
                <button onClick={() => { setError(''); refreshStoreBootstrap().catch(() => {}) }} className="mt-2 block w-full text-xs text-blue-600 hover:underline">إعادة المحاولة</button>
              </div>
            ) : stores.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-gray-500">لا يوجد متاجر</p>
                <button onClick={() => { setOpen(false); router.push('/store/new') }} className="mt-3 w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white">إنشاء متجر</button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {stores.map((s) => {
                  const isActive = s.slug === activeSlug
                  return (
                    <button
                      key={s.id}
                      onClick={() => switchStore(s.slug)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${isActive ? 'bg-gray-900 text-white' : 'hover:bg-gray-50 text-gray-900'}`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${isActive ? 'bg-white text-gray-900' : 'bg-gray-100 text-gray-600'}`}>
                        {(s.name?.[0] || s.slug[0] || '?').toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={`flex items-center gap-1.5 truncate text-[13px] font-semibold leading-tight ${isActive ? 'text-white' : 'text-gray-900'}`}>
                          {s.slug === originalSlug && <span aria-hidden="true">⭐</span>}
                          <span className="truncate">{s.name}</span>
                        </span>
                        <span className={`truncate text-[11px] ${isActive ? 'text-white/60' : 'text-gray-400'}`}>/{s.slug}</span>
                        {/*
                          "is_default"/"تعيين كافتراضي" is deliberately not
                          surfaced or settable here — the active store comes
                          from the URL alone (Part 10); a separately editable
                          "default store" would be exactly the second source
                          of truth that principle rules out.
                        */}
                        <span className="flex flex-wrap items-center gap-1 pt-0.5">
                          {s.slug === originalSlug && (
                            <span className={`rounded px-1.5 py-px text-[10px] font-medium ${isActive ? 'bg-white/15 text-white/90' : 'bg-indigo-50 text-indigo-700'}`}>
                              المتجر الأصلي
                            </span>
                          )}
                          {isActive && (
                            <span className="rounded bg-white px-1.5 py-px text-[10px] font-bold text-gray-900">
                              الحالي
                            </span>
                          )}
                        </span>
                      </span>
                      {isActive && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-gray-900">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/*
            These two action items are fixed parts of the selector chrome,
            not data derived from the fetch — they must always render,
            regardless of loading/error/store-count. Previously gated on
            `!loading && !error [&& stores.length > 0]`, which meant every
            single re-open (which always kicks off a background refresh,
            see the `[open]` effect above) hid both of them for the
            duration of that request, and a transient background-refresh
            error hid them indefinitely even while a perfectly valid
            cached store list was still on screen. Neither item's
            visibility depends on the fetch lifecycle at all now.
          */}
          {/*
            The only chrome action left. "عرض كل المتاجر" (-> `/store/all`)
            was removed along with that page: this switcher lists every
            store directly above, so a second "see all stores" entry point
            pointed at a permanent product page was exactly the invented
            landing surface the store-routing architecture forbids.
          */}
          <div className="border-t border-gray-100 p-1.5">
            <button
              onClick={() => { setOpen(false); router.push('/store/new') }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              إنشاء متجر جديد
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useStoreBootstrap, ensureStoreBootstrap } from './storeBootstrap'

/**
 * For every store-dependent admin page (Products, Orders, Themes, ...),
 * all of which live under `/store/[storeSlug]/...`.
 *
 * The active store is read **from the URL segment**, not from any
 * persisted or shared state — so it is correct on the very first render,
 * survives a hard reload of a deep link, and is independent per tab. The
 * store list is still bootstrapped alongside it, because the Store
 * Switcher and the "no stores yet" empty state both need it; but the list
 * never decides which store is active.
 *
 *  - `ready === false`              -> the store list is still loading and
 *                                       the URL names no store; show a
 *                                       brief LOCAL loading state.
 *  - `ready === true`, `storeSlug`  -> fetch this page's own data.
 *  - `ready === true`, `!storeSlug` -> the URL names no store (only
 *                                       reachable from a legacy/agnostic
 *                                       route) — show the page's own
 *                                       "no store" state, never spin.
 *
 * A `storeSlug` present in the URL is authoritative for this hook
 * immediately; it is not gated on the store list arriving, because the
 * backend re-validates ownership on every request anyway and a slug the
 * user can't access simply 404s (handled per-page as "re-select a store").
 */
export function useActiveStoreReady() {
  const params = useParams()
  const storeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : null
  const bootstrapStatus = useStoreBootstrap((s) => s.status)

  useEffect(() => {
    ensureStoreBootstrap().catch(() => {})
  }, [])

  const ready = !!storeSlug || bootstrapStatus === 'ready' || bootstrapStatus === 'error'
  return { storeSlug, ready, bootstrapStatus }
}

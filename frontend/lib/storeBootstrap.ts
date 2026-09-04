import { create } from 'zustand'
import api from './api'
import { isSafeRelativePath } from './safePath'
import { extractStoreSlug, isTemporaryAuthRoute } from './storeRoute'

export interface StoreSummary {
  id: number
  name: string
  slug: string
  currency?: string
  status?: string
  is_default?: boolean
  /** ISO timestamp from `GET /stores`. Determines the ORIGINAL store and
   *  the switcher's display order — see `compareStores`. */
  createdAt?: string
}

interface StoreBootstrapState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  stores: StoreSummary[]
  error: string | null
}

/**
 * The ONE global store-list + initial-active-store resolution. Every
 * store-dependent admin page and the Store Switcher read from this same
 * state instead of each running their own `/stores` fetch + "pick a
 * default" heuristic — that duplication was the root cause of pages
 * hanging on direct load: the previous initialization logic lived only
 * inside `StoreSwitcher` (rendered in the Sidebar), so any route whose
 * layout doesn't render the Sidebar (e.g. the full-screen theme editor)
 * never triggered it, and the page waited forever for an `activeStore`
 * that nothing was ever going to set.
 */
export const useStoreBootstrap = create<StoreBootstrapState>(() => ({
  status: 'idle',
  stores: [],
  error: null,
}))

let inFlight: Promise<void> | null = null

/**
 * Idempotent: safe to call from every store-dependent page's mount effect
 * and from the Store Switcher — only the first caller in a session (or
 * after an explicit `force` refresh) actually hits the network. Resolves
 * the canonical active store exactly once per fetch, per the product rule:
 *
 * This fetch **never selects the active store** — that is decided solely
 * by the `[storeSlug]` URL segment (see `activeStore.ts`). The list it
 * loads has exactly two consumers: the Store Switcher, and
 * `resolveOriginalStoreSlug()` below, which the store-agnostic legacy
 * stubs use to pick which slug to *redirect to* when the URL doesn't name
 * one yet.
 */
export function ensureStoreBootstrap(force = false): Promise<void> {
  const state = useStoreBootstrap.getState()
  if (!force && (state.status === 'loading' || state.status === 'ready')) {
    return inFlight ?? Promise.resolve()
  }

  useStoreBootstrap.setState({ status: 'loading', error: null })
  const request = api
    .get('/stores')
    .then((res) => {
      const stores: StoreSummary[] = Array.isArray(res.data) ? res.data : []
      useStoreBootstrap.setState({ status: 'ready', stores, error: null })
    })
    .catch((err) => {
      if (err?.silent || err?.code === 'ERR_CANCELED') return
      useStoreBootstrap.setState({ status: 'error', error: 'تعذر تحميل المتاجر' })
    })
    .finally(() => {
      inFlight = null
    })

  inFlight = request
  return request
}

/**
 * Total order over a user's stores: **creation order, oldest first**.
 *
 *   1. `createdAt` ascending — the ORIGINAL (first-created) store leads.
 *   2. Ties broken by numeric `id`, then `slug`.
 *
 * `is_default` deliberately does NOT participate. The two concepts are
 * different and were previously conflated here, which is a bug worth
 * spelling out:
 *
 *   - ORIGINAL store  = the first store the account ever created. A fact
 *                       about history; immutable.
 *   - DEFAULT store   = `store.is_default`, a user-selectable preference
 *                       moved by `PATCH /stores/:slug/default`.
 *
 * They coincide for a fresh account only because `createStore` sets
 * `is_default: existingCount === 0`, making the first store the initial
 * default. Once the user picks a different default they diverge, and
 * sorting `is_default` first then promotes the NEWEST store to the top of
 * the switcher and to the dashboard entry point — exactly the mismatch
 * observed on the QA account, where `test` (2026-08-04) is the original but
 * `dartpay` (2026-08-24) carries the flag.
 *
 * Sorting on the data rather than trusting the server's array order is the
 * point: `stores[0]` is positional, so a change to the backend `orderBy` —
 * or a list rebuilt from cache — would otherwise silently reorder the
 * switcher and move the dashboard entry store.
 */
function compareStores(a: StoreSummary, b: StoreSummary): number {
  // A missing/invalid `createdAt` must not sort as "earliest" and falsely
  // claim to be the original store, so it sorts last and lets a store with
  // a real timestamp win.
  const createdAtMs = (s: StoreSummary): number => {
    const parsed = s.createdAt ? Date.parse(s.createdAt) : NaN
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
  }

  // Compared, not subtracted: two stores both missing `createdAt` are both
  // Infinity, and `Infinity - Infinity` is NaN, which would make the whole
  // sort implementation-defined instead of falling through to the id/slug
  // tie-breakers below.
  const [aMs, bMs] = [createdAtMs(a), createdAtMs(b)]
  if (aMs !== bMs) return aMs < bMs ? -1 : 1

  const [aId, bId] = [Number(a.id), Number(b.id)]
  if (!Number.isNaN(aId) && !Number.isNaN(bId) && aId !== bId) return aId < bId ? -1 : 1

  return String(a.slug).localeCompare(String(b.slug))
}

/**
 * The user's stores in presentation order — ORIGINAL (first-created) first,
 * then the rest in creation order. The Store Switcher renders this instead
 * of the raw fetch order, so the list never reshuffles between loads and
 * the original store is always the first row.
 */
export function orderStoresForDisplay(stores: StoreSummary[]): StoreSummary[] {
  return [...stores].sort(compareStores)
}

/**
 * The ORIGINAL store: the first store this account ever created.
 *
 * This is the store a *store-agnostic* URL lands on — the dashboard index
 * (`/store`) and the legacy `/store/<section>` stubs.
 * Purely a redirect target: it never makes a store "active" by itself; the
 * redirect it feeds puts the slug in the URL, and the URL is what makes it
 * active.
 *
 * It is literally the first store in display order, which keeps the
 * switcher's top row and the dashboard entry destination the same store by
 * construction rather than by two rules that happen to agree.
 *
 * Deliberately NOT `is_default` — see `compareStores` above. Returns null
 * only when the user owns no stores at all, which is the empty-state /
 * create-store case, not a store choice.
 */
export function resolveOriginalStoreSlug(stores: StoreSummary[]): string | null {
  if (stores.length === 0) return null
  return orderStoresForDisplay(stores)[0]?.slug ?? null
}

/**
 * The user's explicitly chosen DEFAULT store, if they have set one. A
 * separate, still-supported concept from the original store: it is a
 * preference the user controls via `PATCH /stores/:slug/default`, surfaced
 * in the switcher as its own badge. It intentionally does not affect
 * ordering or the dashboard entry point.
 */
export function resolveDefaultStoreSlug(stores: StoreSummary[]): string | null {
  return stores.find((s) => s.is_default)?.slug ?? null
}

/** Explicit re-fetch (store created/renamed/deleted elsewhere). */
export function refreshStoreBootstrap(): Promise<void> {
  return ensureStoreBootstrap(true)
}

/**
 * Discard every trace of the previous user's store context. Called on every
 * identity boundary — logout, cross-tab logout, confirmed session expiry,
 * and defensively when a login lands as a different user in the same tab —
 * so User B can never be routed from User A's cached store list.
 */
export function resetStoreBootstrap(): void {
  inFlight = null
  useStoreBootstrap.setState({ status: 'idle', stores: [], error: null })
}

export type PostAuthContext = 'fresh-login' | 'resume' | 'deep-link' | 'account-switch'

/**
 * THE one post-auth destination resolver. Every auth-completion / resume
 * path calls this with a context and the raw `intended` from the URL (or
 * null); no component decides a destination, validates an `intended`, or
 * picks the chooser on its own.
 *
 * `ctx` — only two behaviours, but four names for call-site clarity/logging:
 *   'fresh-login' / 'account-switch' — the user just authenticated. May
 *       land on `/select-store` when 2+ stores and no valid `intended`.
 *   'resume' / 'deep-link' — an already-authenticated session re-reached an
 *       auth page, or is being sent to a specific route. NEVER the chooser.
 *
 * `intended` is honoured only when ALL hold (else it is discarded and the
 * store-count rule below decides):
 *   1. it is a safe same-origin relative path
 *   2. it is not itself a temporary auth/onboarding route
 *   3. if it names a `/store/<slug>` route, that slug is one the CURRENT
 *      user actually owns (checked against the freshly-refreshed list) —
 *      this is what stops User B, logging in with a stale
 *      `intended=/store/<A's store>`, from being routed into A's route and
 *      only then bounced by the authorization gate.
 *
 * Store-count rule (after a forced `/stores` refresh for the current user):
 *   0 stores                      -> /store/new
 *   1 store                       -> /store/<slug>
 *   2+ & chooser allowed          -> /select-store
 *   2+ & chooser not allowed      -> /store/<originalSlug>
 */
export async function authedHome(
  ctx: PostAuthContext,
  intended?: string | null,
): Promise<string> {
  await refreshStoreBootstrap().catch(() => {})
  const stores = useStoreBootstrap.getState().stores
  const ownedSlugs = new Set(stores.map((s) => s.slug))

  const validIntended = resolveIntended(intended, ownedSlugs)
  if (validIntended) return validIntended

  if (stores.length === 0) return '/store/new'

  const chooserAllowed = ctx === 'fresh-login' || ctx === 'account-switch'
  if (chooserAllowed && stores.length >= 2) return '/select-store'

  const slug = resolveOriginalStoreSlug(stores)
  return slug ? `/store/${encodeURIComponent(slug)}` : '/store/new'
}

/** Returns a sanitised `intended` path, or null if it must be discarded. */
function resolveIntended(
  intended: string | null | undefined,
  ownedSlugs: Set<string>,
): string | null {
  if (!intended) return null
  let path = intended
  try {
    // callers pass the raw query-param value, which is usually %-encoded
    if (/%[0-9A-Fa-f]{2}/.test(path)) path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!isSafeRelativePath(path)) return null
  if (isTemporaryAuthRoute(path)) return null

  const slug = extractStoreSlug(path)
  if (slug !== null && !ownedSlugs.has(slug)) return null // foreign / stale store

  return path
}

/**
 * @deprecated Use `authedHome('fresh-login')`. Name alias kept for older
 * call sites / test mocks; one implementation only.
 */
export function resolvePostAuthTarget(): Promise<string> {
  return authedHome('fresh-login')
}

/** @deprecated alias of {@link resetStoreBootstrap} — used by tests. */
export function __resetStoreBootstrapForTests() {
  resetStoreBootstrap()
}

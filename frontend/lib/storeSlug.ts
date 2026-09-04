/**
 * The active store, read directly from the URL. There is no other source.
 *
 * Every store-scoped merchant dashboard route is `/store/[storeSlug]/…` —
 * distinct from `/stores/[slug]`, the public customer storefront — so the
 * slug is already in `window.location` — synchronously readable, correct
 * on the first render, correct after a reload, and naturally per-tab. React
 * components should prefer `useParams().storeSlug`; this exists for the one
 * caller that cannot use hooks, the axios request interceptor in `lib/api.ts`.
 *
 * This module replaced a Zustand store (`lib/activeStore.ts`) that mirrored
 * the same value. That mirror was a second authority for the same fact, and
 * every bug it caused came from the two disagreeing: the interceptor
 * consulted the mirror first, so a request issued before the mirror caught up
 * carried the PREVIOUS store's `X-Store-Slug`, and the attempt to keep it in
 * step by writing it during render produced "Cannot update a component while
 * rendering a different component". Deleting it removes both failure modes by
 * construction rather than by ordering.
 *
 * Nothing here writes to `localStorage`, `sessionStorage`, a cookie, or a
 * `BroadcastChannel`. Persisting or broadcasting the active store would turn
 * a per-tab value into a global one, so two tabs could not sit on two stores,
 * and a stale value could outlive the navigation that produced it.
 */

import { extractStoreSlug } from './storeRoute'

/**
 * The active store slug from the URL, for the one caller that cannot use
 * React hooks — the axios request interceptor in `lib/api.ts`. Shares the
 * single slug-vs-route rule with the rest of the app (`lib/storeRoute.ts`),
 * so a slug-free / legacy-stub / reserved segment never becomes an
 * `X-Store-Slug` header.
 */
export function readStoreSlugFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return extractStoreSlug(window.location.pathname)
}

/**
 * ONE canonical answer to "does this path name a per-merchant store, and if
 * so which slug?". Previously three modules each carried their own copy of
 * this rule (`app/(protected)/layout.tsx`, `lib/storeSlug.ts`, ad-hoc regexes
 * in `authedHome` callers) and they had drifted — one knew about the legacy
 * slug-free stubs, the others didn't.
 *
 * `/store/<slug>[/…]`      -> the slug (a real per-user store)
 * `/store` (bare)          -> null (the slug-agnostic resolver route)
 * `/store/new|all`         -> null (static sibling routes)
 * `/store/orders|products|settings|menus|pages|collections|themes` -> null
 *      (legacy slug-free redirect stubs — they `router.replace` to a real
 *       `/store/<slug>/<section>` before anything store-scoped runs)
 * `/stores/<slug>`         -> null (that is the PUBLIC storefront, a
 *                             different route tree entirely)
 * anything else            -> null
 */
export const RESERVED_STORE_ROUTE_SEGMENTS = new Set([
  'new',
  'all',
  'orders',
  'products',
  'settings',
  'menus',
  'pages',
  'collections',
  'themes',
])

/** The merchant store slug named by `pathname`, or `null` if it names none. */
export function extractStoreSlug(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const m = pathname.match(/^\/store\/([^/?#]+)/)
  const seg = m?.[1] ? decodeURIComponent(m[1]) : null
  if (!seg || RESERVED_STORE_ROUTE_SEGMENTS.has(seg)) return null
  return seg
}

/** True when `pathname` is (or is under) a per-merchant store route. */
export function isStoreRoute(pathname: string | null | undefined): boolean {
  return extractStoreSlug(pathname) !== null
}

/**
 * Temporary auth / onboarding routes. They are never a post-auth
 * *destination* — landing on one is a step, not an arrival — so an
 * `intended=` pointing at one is discarded by `authedHome`.
 */
export function isTemporaryAuthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const p = pathname.split(/[?#]/)[0]
  return (
    p === '/' ||
    p === '/login' ||
    p === '/register' ||
    p.startsWith('/register/') ||
    p === '/verify-email' ||
    p === '/select-store' ||
    p.startsWith('/auth/')
  )
}

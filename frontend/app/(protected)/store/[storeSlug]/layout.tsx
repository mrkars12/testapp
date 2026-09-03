'use client'

import { useParams } from 'next/navigation'

/**
 * Scopes the dashboard subtree to the store named in the URL.
 *
 * The subtree is keyed on the slug so that switching stores fully remounts
 * every page below it — none can keep painting the previous store's data
 * across a switch.
 *
 * Authorization is NOT done here. It is enforced one layout up, in
 * `app/(protected)/layout.tsx`, at the exact boundary that decides whether
 * to mount the merchant shell (`<Sidebar/> + <TopMenu/>`): a `/store/<slug>`
 * whose slug is not one of the current user's own stores is rejected there
 * with `<StoreUnavailable/>` and this subtree never mounts at all. Putting
 * the check here instead is what used to let the shell paint before the
 * rejection. The backend `ActiveStoreGuard` (owner-scoped 404) + RLS remain
 * the real security boundary.
 */
export default function StoreScopedLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const storeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : null

  return <div key={storeSlug ?? 'no-store'}>{children}</div>
}

import { notFound } from 'next/navigation'

/**
 * `/store/all` (the old permanent "all stores" list) was removed entirely —
 * the post-login multi-store chooser now lives at its own dedicated route,
 * `/select-store`, outside this tree.
 *
 * This file has to keep existing, though, as an explicit `notFound()`
 * trigger: `all` sits at the exact same path segment as `[storeSlug]`, so
 * simply deleting this file does not make `/store/all` 404 — it falls
 * through to the dynamic route instead, rendering the merchant dashboard
 * for a store literally slugged `all` (which cannot exist; `all` is a
 * reserved slug — see `RESERVED_STORE_SLUGS` on the backend). This static
 * route wins the match ahead of `[storeSlug]` and forces the 404 the
 * architecture requires.
 *
 * Note: the response's raw HTTP status can still read 200 rather than 404
 * — this subtree has a `loading.tsx` Suspense boundary (needed by the
 * real, data-fetching `[storeSlug]` routes), and headers for a streamed
 * response are sent before a suspended segment resolves, which is a
 * documented Next.js streaming characteristic, not something this page
 * controls. The rendered content is unambiguous either way: nothing about
 * the old store list ever renders here.
 */
export default function StoreAllRemovedPage(): never {
  notFound()
}

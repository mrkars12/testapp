'use client'

import { useCallback } from 'react'
import { useParams } from 'next/navigation'

/**
 * Builds a dashboard path scoped to the store currently in the URL.
 *
 *     storePath('orders')            -> /store/dartpay/orders
 *     storePath(`products/${id}/edit`) -> /store/dartpay/products/7/edit
 *
 * Every admin page lives under `/store/[storeSlug]/…`, but a lot
 * of in-page navigation was written slug-free (`/store/orders/12`).
 * Those links are wrong twice over:
 *
 *   1. They 404 whenever no slug-free stub exists for that depth. The stub
 *      tree only ever covered top-level sections, so
 *      `/store/products/7/edit`, `/store/orders/12` and
 *      `/store/settings/payments/test` all matched no route.
 *   2. Even where a stub does exist, it resolves the ORIGINAL store and
 *      redirects there — so following one from inside store B silently
 *      moves the user to store A, and the extra hop shows a spinner.
 *
 * Reading the slug from `useParams()` keeps the URL as the single source of
 * truth: the link is built from the store the user is actually in, and no
 * redirect or store-list fetch is involved.
 *
 * Callers must be inside the `[storeSlug]` segment. Outside it the slug is
 * empty and the caller should be using a store-agnostic route instead.
 */
export function useStorePath(): (subPath: string) => string {
  const params = useParams()
  const storeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : ''

  return useCallback(
    (subPath: string) =>
      `/store/${encodeURIComponent(storeSlug)}/${subPath.replace(/^\/+/, '')}`,
    [storeSlug],
  )
}

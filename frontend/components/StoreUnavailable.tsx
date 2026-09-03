'use client'

import Link from 'next/link'
import { refreshStoreBootstrap } from '@/lib/storeBootstrap'

/**
 * Shown when the merchant route `/store/<slug>` names a store the
 * authenticated user is NOT authorized for — a foreign store, or one that
 * does not exist. Both cases render the SAME neutral message so nothing
 * leaks about whether another user's store exists.
 *
 * This is UX only. The security boundary is the backend: every
 * `/stores/*` endpoint runs `ActiveStoreGuard`, which resolves the store
 * with an owner-scoped query and 404s a foreign / unknown `X-Store-Slug`,
 * and Postgres RLS hides cross-store rows underneath that. This component
 * just stops the merchant dashboard and its store-scoped fetches from
 * rendering/firing at all.
 */
export default function StoreUnavailable({ retry = false }: { retry?: boolean }) {
  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-gray-50 p-6 text-center dark:bg-gray-950"
      role="alert"
    >
      <div className="max-w-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-900">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 3h18v18H3z" opacity="0" />
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">هذه الصفحة غير متاحة</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          ليس لديك صلاحية الوصول إلى هذا المتجر، أو أن الرابط غير صحيح.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/store"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900"
          >
            الذهاب إلى متجرك
          </Link>
          {retry && (
            <button
              type="button"
              onClick={() => { refreshStoreBootstrap().catch(() => {}) }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300"
            >
              إعادة المحاولة
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

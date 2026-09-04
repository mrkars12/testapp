'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  useStoreBootstrap,
  ensureStoreBootstrap,
  resolveOriginalStoreSlug,
} from '@/lib/storeBootstrap'
import { useStorePath } from '@/lib/storePath'

/**
 * The store dashboard HOME: `/store/<storeSlug>`.
 *
 * This route used to `redirect()` straight to `/products`. That existed only
 * because the old implementation had no store landing page and treated
 * Products as the de-facto one — so "select a store" and "open Products"
 * were the same action, and there was no way to be *in* a store without
 * being in one of its sections. Selecting a store is not a request to see
 * the catalogue, so the redirect is gone and this renders the store's own
 * overview instead.
 *
 * It is not a second dashboard: it owns no data fetching of its own beyond
 * the store list every dashboard screen already loads, and every tile links
 * into the existing section routes rather than reimplementing them.
 *
 * Deliberately shows only facts the store record actually carries (name,
 * slug, currency, status, original/default standing). Order counts or
 * revenue would mean new endpoints and, until those exist, invented
 * numbers — worse than no number at all on a page a merchant reads first.
 */

const SECTIONS: { sub: string; label: string; desc: string; icon: string }[] = [
  { sub: 'products', label: 'المنتجات', desc: 'إدارة الكتالوج والمخزون', icon: 'fa-box' },
  { sub: 'orders', label: 'الطلبات', desc: 'متابعة الطلبات وحالتها', icon: 'fa-receipt' },
  { sub: 'collections', label: 'المجموعات', desc: 'تجميع المنتجات وتنظيمها', icon: 'fa-layer-group' },
  { sub: 'menus', label: 'القوائم', desc: 'قوائم التنقل في المتجر', icon: 'fa-bars' },
  { sub: 'pages', label: 'الصفحات', desc: 'صفحات المحتوى الثابتة', icon: 'fa-file-lines' },
  { sub: 'themes', label: 'التصميم', desc: 'مظهر المتجر وهويته', icon: 'fa-palette' },
  { sub: 'settings', label: 'الإعدادات', desc: 'بيانات المتجر الأساسية', icon: 'fa-gear' },
  { sub: 'settings/payments', label: 'بوابات الدفع', desc: 'طرق الدفع وإعداداتها', icon: 'fa-credit-card' },
]

export default function StoreDashboardHome() {
  const params = useParams()
  const storeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : ''
  const storePath = useStorePath()

  const stores = useStoreBootstrap((s) => s.stores)
  const status = useStoreBootstrap((s) => s.status)

  useEffect(() => {
    ensureStoreBootstrap().catch(() => {})
  }, [])

  const store = stores.find((s) => s.slug === storeSlug) ?? null
  const isOriginal = resolveOriginalStoreSlug(stores) === storeSlug
  const settled = status === 'ready' || status === 'error'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8 border-b border-gray-100 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {/*
              The slug always comes from the URL, so the heading is correct
              on the very first render even before the store list resolves.
              Only the display name has to wait, and it degrades to the slug
              rather than to a spinner.
            */}
            <h1 className="truncate text-2xl font-bold text-gray-900">
              {store?.name || storeSlug}
            </h1>
            <p className="mt-1 font-mono text-sm text-gray-400">/{storeSlug}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isOriginal && (
                <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                  المتجر الأصلي
                </span>
              )}
              {store?.is_default && (
                <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  المتجر الافتراضي
                </span>
              )}
              {store?.currency && (
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {store.currency}
                </span>
              )}
              {store && (
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    store.status === '1' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {store.status === '1' ? 'نشط' : 'غير نشط'}
                </span>
              )}
            </div>
          </div>

          <a
            href={`https://${storeSlug}.dartcoin.com`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            عرض المتجر ↗
          </a>
        </div>

        {/* Only claim the store is unknown once the list has actually settled. */}
        {settled && !store && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            لم يتم العثور على هذا المتجر ضمن متاجرك.{' '}
            <Link href="/store" className="font-semibold underline">
              الذهاب إلى متجرك
            </Link>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.sub}
            href={storePath(s.sub)}
            className="group rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 group-hover:bg-gray-900 group-hover:text-white">
                <i className={`fas ${s.icon} text-[13px]`} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-gray-900">{s.label}</span>
                <span className="mt-0.5 block text-[12px] text-gray-500">{s.desc}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

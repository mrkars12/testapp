'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

/* ══════════════════════════════════════════════════════════════════════
   Storefront — Single Collection Page
   /store/[slug]/collections/[handle]
   GET /api/storefront/{storeSlug}/collections/{handle}
   ══════════════════════════════════════════════════════════════════════ */

const T = {
  ink: '#1B1B18',
  inkSoft: '#4A473E',
  inkFaint: '#9C9482',
  brass: '#9C7A3C',
  brassStrong: '#C9A25A',
  paper: '#FBF9F5',
  border: '#E7E2D8',
  borderSoft: '#EDE8DD',
  brick: '#A23B2E',
  brickBg: '#FBEDE9',
}

const FONT_DISPLAY = "'Cairo', sans-serif"
const FONT_BODY = "'Tajawal', sans-serif"
const CURRENCY_CODE = 'EGP'

/* ── Types ─────────────────────────────────────────────────────────── */
interface CollectionProduct {
  id: string
  title: string
  handle: string
  image_url: string | null
  price: string | number | null
  compare_at_price: string | number | null
  position: number
}

interface CollectionDetail {
  id: number
  name: string
  handle: string
  description: string | null
  image_url: string | null
  products: CollectionProduct[]
}

type SortKey = 'default' | 'price_asc' | 'price_desc' | 'title_asc' | 'title_desc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: 'الترتيب الافتراضي' },
  { value: 'price_asc', label: 'السعر: من الأقل للأعلى' },
  { value: 'price_desc', label: 'السعر: من الأعلى للأقل' },
  { value: 'title_asc', label: 'الاسم: أ → ي' },
  { value: 'title_desc', label: 'الاسم: ي → أ' },
]

/* ── Helpers ────────────────────────────────────────────────────────── */
function toNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN
  if (typeof raw === 'number') return raw
  const str = String(raw).trim().replace(/[^\d.-]/g, '')
  return str === '' ? NaN : parseFloat(str)
}

function formatPrice(raw: string | number | null): string | null {
  const n = toNumber(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  const hasFraction = Math.round(n * 100) % 100 !== 0
  return n.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

function sortProducts(products: CollectionProduct[], sort: SortKey): CollectionProduct[] {
  const arr = [...products]
  switch (sort) {
    case 'price_asc':
      return arr.sort((a, b) => (toNumber(a.price) || 0) - (toNumber(b.price) || 0))
    case 'price_desc':
      return arr.sort((a, b) => (toNumber(b.price) || 0) - (toNumber(a.price) || 0))
    case 'title_asc':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'ar'))
    case 'title_desc':
      return arr.sort((a, b) => b.title.localeCompare(a.title, 'ar'))
    default:
      return arr.sort((a, b) => a.position - b.position)
  }
}

/* ── Icons ─────────────────────────────────────────────────────────── */
const IconSpinner = ({ className = '' }: { className?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconImagePlaceholder = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)
const IconHome = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)
const IconChevronDown = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)
const IconGrid = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
)
const IconList = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
)
const IconTag = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L4 3a1 1 0 0 0-1 1l.24 5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.82Z" />
    <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)

/* ── Product Card ───────────────────────────────────────────────────── */
function ProductCard({
  product, storeSlug, collectionHandle, listView,
}: {
  product: CollectionProduct
  storeSlug: string
  collectionHandle: string
  listView: boolean
}) {
  const price = toNumber(product.price)
  const compareAt = toNumber(product.compare_at_price)
  const hasSale = Number.isFinite(price) && price > 0 && Number.isFinite(compareAt) && compareAt > price
  const displayPrice = hasSale ? price : price
  const originalPrice = hasSale ? compareAt : NaN
  const discountPct = hasSale ? Math.round((1 - price / compareAt) * 100) : 0

  const href = `/store/${storeSlug}/products/${product.handle}`

  if (listView) {
    return (
      <Link
        href={href}
        className="group flex items-center gap-4 rounded-xl border p-3 transition-shadow hover:shadow-md"
        style={{ borderColor: T.border, background: T.paper }}
      >
        <div
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border"
          style={{ borderColor: T.border, background: T.borderSoft }}
        >
          {product.image_url ? (
            <img src={product.image_url} alt={product.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ color: T.inkFaint }}>
              <IconImagePlaceholder />
            </div>
          )}
          {hasSale && (
            <span
              className="absolute left-0 top-0 px-1.5 py-0.5 text-[10px] font-extrabold text-white"
              style={{ background: T.brick, borderRadius: '0 0 6px 0' }}
            >
              -{discountPct}%
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold transition-colors group-hover:text-[#9C7A3C]" style={{ color: T.ink, fontFamily: FONT_DISPLAY }}>
            {product.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {formatPrice(displayPrice) && (
              <span className="text-[14px] font-bold tabular-nums" style={{ color: hasSale ? T.brick : T.ink }}>
                {formatPrice(displayPrice)} {CURRENCY_CODE}
              </span>
            )}
            {hasSale && formatPrice(originalPrice) && (
              <span className="text-[12px] line-through tabular-nums" style={{ color: T.inkFaint }}>
                {formatPrice(originalPrice)} {CURRENCY_CODE}
              </span>
            )}
          </div>
        </div>

        <span className="shrink-0 text-[13px] font-semibold" style={{ color: T.brass }}>عرض</span>
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-2xl border transition-shadow hover:shadow-md"
      style={{ borderColor: T.border, background: T.paper }}
    >
      {/* Image */}
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={{ background: T.borderSoft }}
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color: T.inkFaint }}>
            <IconImagePlaceholder />
          </div>
        )}
        {hasSale && (
          <div className="absolute left-0 top-4 select-none drop-shadow-sm">
            <div
              className="flex items-center gap-1 py-1.5 pl-3 pr-4 text-[11px] font-extrabold tracking-wide text-white"
              style={{
                background: T.brick,
                clipPath: 'polygon(0 0, 100% 0, 82% 50%, 100% 100%, 0 100%)',
                fontFamily: FONT_DISPLAY,
              }}
            >
              <IconTag /> -{discountPct}%
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5">
        <h3
          className="truncate text-[14px] font-bold transition-colors group-hover:text-[#9C7A3C]"
          style={{ color: T.ink, fontFamily: FONT_DISPLAY }}
        >
          {product.title}
        </h3>

        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          {formatPrice(displayPrice) && (
            <span className="text-[14px] font-extrabold tabular-nums" style={{ color: hasSale ? T.brick : T.ink }}>
              {formatPrice(displayPrice)} {CURRENCY_CODE}
            </span>
          )}
          {hasSale && formatPrice(originalPrice) && (
            <span className="text-[12px] line-through tabular-nums" style={{ color: T.inkFaint }}>
              {formatPrice(originalPrice)} {CURRENCY_CODE}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

/* ── Main Page ─────────────────────────────────────────────────────── */
export default function CollectionDetailPage() {
  const params = useParams()
  const storeSlug = (params?.slug as string) || ''
  const collectionHandle = (params?.handle as string) || ''

  const [collection, setCollection] = useState<CollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sort, setSort] = useState<SortKey>('default')
  const [sortOpen, setSortOpen] = useState(false)
  const [listView, setListView] = useState(false)

  useEffect(() => {
    if (!storeSlug || !collectionHandle) return
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    fetch(`/api/storefront/${storeSlug}/collections/${collectionHandle}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then((data: CollectionDetail) => {
        if (!cancelled) setCollection(data)
      })
      .catch(() => { if (!cancelled) setNotFound(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [storeSlug, collectionHandle])

  const sortedProducts = useMemo(
    () => (collection ? sortProducts(collection.products, sort) : []),
    [collection, sort],
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <IconSpinner style={{ color: T.borderSoft } as React.CSSProperties} />
      </div>
    )
  }

  if (notFound || !collection) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center" style={{ fontFamily: FONT_BODY }}>
        <p className="text-lg font-semibold" style={{ color: T.ink }}>المجموعة غير موجودة</p>
        <p className="text-sm" style={{ color: T.inkFaint }}>هذا الرابط غير صحيح أو تم حذف المجموعة.</p>
        <Link
          href={`/store/${storeSlug}/collections`}
          className="mt-4 rounded-xl px-5 py-2.5 text-[13px] font-bold text-white transition-colors"
          style={{ background: T.ink }}
        >
          عرض جميع المجموعات
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: FONT_BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@400;500;700&display=swap');
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .product-card-anim { animation: fadeUp 0.35s ease both; }
      `}</style>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:py-12">
        {/* ── Breadcrumb ── */}
        {/*
        <nav className="mb-8 flex flex-wrap items-center gap-1.5 text-[13px]" style={{ color: T.inkFaint }}>
          <Link href={`/store/${storeSlug}`} className="flex items-center gap-1 transition-colors hover:text-[#1B1B18]">
            <IconHome /> الرئيسية
          </Link>
          <span style={{ color: T.border }}>/</span>
          <Link href={`/store/${storeSlug}/collections`} className="transition-colors hover:text-[#1B1B18]">
            المجموعات
          </Link>
          <span style={{ color: T.border }}>/</span>
          <span className="font-semibold" style={{ color: T.inkSoft }}>{collection.name}</span>
        </nav>
        */}

        
        <nav className="mb-8 flex flex-wrap items-center gap-1.5 text-[13px]" style={{ color: T.inkFaint }}>
          <span className="flex items-center gap-1">
            <Link href={`/store/${storeSlug}`} className="flex items-center gap-1 transition-colors hover:text-[#1B1B18]">
              <IconHome /> الرئيسية
            </Link>
          </span>
          <span style={{ color: T.border }}>/</span>
          <Link href={`/store/${storeSlug}/collections/all`} className="transition-colors hover:text-[#1B1B18]">
            Shop All
          </Link>
          <span style={{ color: T.border }}>/</span>
          <span className="font-semibold" style={{ color: T.inkSoft }}>{collection.name}</span>
        </nav>
        
        <h2>{collection.name}</h2>

        {/* ── Collection hero ── */}
        {collection.image_url && (
          <div className="relative mb-8 h-48 w-full overflow-hidden rounded-2xl sm:h-64">
            <img
              src={collection.image_url}
              alt={collection.name}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(27,27,24,0.55), transparent)' }} />
            <div className="absolute bottom-5 left-5">
              <h1 className="text-[26px] font-extrabold text-white sm:text-[32px]" style={{ fontFamily: FONT_DISPLAY }}>
                {collection.name}
              </h1>
              {collection.description && (
                <p className="mt-1 max-w-xl text-[13px] text-white/80">{collection.description}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Heading (no hero image) ── */}
        {!collection.image_url && (
          <div className="mb-8">
            <h1 className="text-[26px] font-extrabold sm:text-[32px]" style={{ color: T.ink, fontFamily: FONT_DISPLAY }}>
              {collection.name}
            </h1>
            <div className="mt-2 h-[3px] w-12 rounded-full" style={{ background: T.brassStrong }} />
            {collection.description && (
              <p className="mt-3 max-w-2xl text-[14px]" style={{ color: T.inkFaint }}>{collection.description}</p>
            )}
          </div>
        )}

        {/* ── Toolbar: count + sort + view toggle ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px]" style={{ color: T.inkFaint }}>
            {collection.products.length} {collection.products.length === 1 ? 'منتج' : 'منتجات'}
          </p>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: T.border }}>
              <button
                onClick={() => setListView(false)}
                className="flex h-8 w-8 items-center justify-center transition-colors"
                style={{ background: !listView ? T.ink : 'white', color: !listView ? 'white' : T.inkFaint }}
                title="عرض شبكة"
              >
                <IconGrid />
              </button>
              <button
                onClick={() => setListView(true)}
                className="flex h-8 w-8 items-center justify-center transition-colors"
                style={{ background: listView ? T.ink : 'white', color: listView ? 'white' : T.inkFaint }}
                title="عرض قائمة"
              >
                <IconList />
              </button>
            </div>

            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setSortOpen((o) => !o)}
                className="flex h-8 items-center gap-2 rounded-lg border px-3 text-[12px] font-medium transition-colors hover:bg-[#FBF9F5]"
                style={{ borderColor: T.border, color: T.inkSoft }}
              >
                {SORT_OPTIONS.find((o) => o.value === sort)?.label}
                <span style={{ transform: sortOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s', display: 'flex' }}>
                  <IconChevronDown />
                </span>
              </button>

              {sortOpen && (
                <div
                  className="absolute left-0 top-full z-20 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border bg-white py-1 shadow-lg"
                  style={{ borderColor: T.border }}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setSort(opt.value); setSortOpen(false) }}
                      className="flex w-full items-center px-3 py-2 text-right text-[13px] transition-colors hover:bg-[#FBF9F5]"
                      style={{ color: sort === opt.value ? T.brass : T.inkSoft, fontWeight: sort === opt.value ? 700 : 400 }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Empty collection ── */}
        {collection.products.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: T.paper, color: T.inkFaint }}>
              <IconImagePlaceholder />
            </span>
            <p className="text-[15px] font-semibold" style={{ color: T.ink }}>لا توجد منتجات في هذه المجموعة بعد</p>
            <Link
              href={`/store/${storeSlug}/collections`}
              className="text-[13px] font-semibold underline"
              style={{ color: T.brass }}
            >
              استعرض باقي المجموعات
            </Link>
          </div>
        )}

        {/* ── Products grid / list ── */}
        {sortedProducts.length > 0 && (
          <div
            className={listView
              ? 'flex flex-col gap-3'
              : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'}
          >
            {sortedProducts.map((product, idx) => (
              <div
                key={product.id}
                className="product-card-anim"
                style={{ animationDelay: `${idx * 0.04}s` }}
              >
                <ProductCard
                  product={product}
                  storeSlug={storeSlug}
                  collectionHandle={collectionHandle}
                  listView={listView}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Click outside to close sort dropdown */}
      {sortOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
      )}
    </div>
  )
}

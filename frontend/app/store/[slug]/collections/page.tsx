'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

/* ══════════════════════════════════════════════════════════════════════
   Storefront — All Collections Page
   /store/[slug]/collections
   GET /api/storefront/{storeSlug}/collections
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
}

const FONT_DISPLAY = "'Cairo', sans-serif"
const FONT_BODY = "'Tajawal', sans-serif"

interface CollectionItem {
  id: number
  name: string
  handle: string
  description: string | null
  image_url: string | null
  product_count: number
}

const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
)
const IconImagePlaceholder = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)
const IconSpinner = ({ className = '' }: { className?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)
const IconHome = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

export default function StorefrontCollectionsPage() {
  const params = useParams()
  const storeSlug = (params?.slug as string) || ''

  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!storeSlug) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/storefront/${storeSlug}/collections`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then((data: CollectionItem[]) => {
        if (!cancelled) setCollections(data)
      })
      .catch(() => { if (!cancelled) setNotFound(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [storeSlug])

  const filtered = useMemo(() => {
    if (!query.trim()) return collections
    const q = query.trim().toLowerCase()
    return collections.filter((c) => c.name.toLowerCase().includes(q))
  }, [collections, query])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <IconSpinner style={{ color: T.borderSoft } as React.CSSProperties} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center" style={{ fontFamily: FONT_BODY }}>
        <p className="text-lg font-semibold" style={{ color: T.ink }}>لا يمكن عرض المجموعات</p>
        <p className="text-sm" style={{ color: T.inkFaint }}>المتجر غير موجود أو حدث خطأ.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: FONT_BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@400;500;700&display=swap');
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .collection-card { animation: fadeUp 0.4s ease both; }
      `}</style>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:py-12">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-1.5 text-[13px]" style={{ color: T.inkFaint }}>
          <Link href={`/store/${storeSlug}`} className="flex items-center gap-1 transition-colors hover:text-[#1B1B18]">
            <IconHome /> الرئيسية
          </Link>
          <span style={{ color: T.border }}>/</span>
          <span style={{ color: T.inkSoft, fontWeight: 600 }}>جميع المجموعات</span>
        </nav>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-[28px] font-extrabold sm:text-[34px]" style={{ color: T.ink, fontFamily: FONT_DISPLAY }}>
            المجموعات
          </h1>
          <div className="mt-2 h-[3px] w-14 rounded-full" style={{ background: T.brassStrong }} />
          {collections.length > 0 && (
            <p className="mt-3 text-[14px]" style={{ color: T.inkFaint }}>
              {collections.length} مجموعة متاحة
            </p>
          )}
        </div>

        {/* Search */}
        {collections.length > 4 && (
          <div className="relative mb-8 max-w-sm">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T.inkFaint }}>
              <IconSearch />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث في المجموعات..."
              dir="rtl"
              className="h-10 w-full rounded-xl border pl-9 pr-4 text-[13px] outline-none transition-shadow"
              style={{
                borderColor: T.border,
                background: T.paper,
                color: T.ink,
                fontFamily: FONT_BODY,
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${T.brassStrong}33`)}
              onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
            />
          </div>
        )}

        {/* Empty state */}
        {collections.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: T.paper, color: T.inkFaint }}>
              <IconImagePlaceholder />
            </span>
            <p className="text-[15px] font-semibold" style={{ color: T.ink }}>لا توجد مجموعات بعد</p>
          </div>
        )}

        {/* No results */}
        {query.trim() && filtered.length === 0 && collections.length > 0 && (
          <div className="py-16 text-center">
            <p className="text-[14px] font-semibold" style={{ color: T.ink }}>لا نتائج لـ "{query}"</p>
            <p className="mt-1 text-[13px]" style={{ color: T.inkFaint }}>جرّب كلمة بحث مختلفة.</p>
          </div>
        )}

        {/* Collections grid */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c, idx) => (
              <Link
                key={c.id}
                href={`/store/${storeSlug}/collections/${c.handle}`}
                className="collection-card group block overflow-hidden rounded-2xl border transition-shadow hover:shadow-md"
                style={{
                  borderColor: T.border,
                  background: T.paper,
                  animationDelay: `${idx * 0.05}s`,
                }}
              >
                {/* Image */}
                <div
                  className="relative aspect-[4/3] w-full overflow-hidden"
                  style={{ background: T.borderSoft }}
                >
                  {c.image_url ? (
                    <img
                      src={c.image_url}
                      alt={c.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center" style={{ color: T.inkFaint }}>
                      <IconImagePlaceholder />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-bold" style={{ color: T.ink, fontFamily: FONT_DISPLAY }}>
                      {c.name}
                    </h2>
                    {c.description && (
                      <p className="mt-0.5 line-clamp-1 text-[12px]" style={{ color: T.inkFaint }}>
                        {c.description}
                      </p>
                    )}
                    <p className="mt-1.5 text-[12px] font-medium" style={{ color: T.brass }}>
                      {c.product_count} {c.product_count === 1 ? 'منتج' : 'منتجات'}
                    </p>
                  </div>
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors group-hover:bg-[#1B1B18] group-hover:text-white"
                    style={{ border: `1.5px solid ${T.border}`, color: T.inkFaint }}
                  >
                    <IconChevronRight />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'

const T = {
  ink: '#1B1B18',
  inkSoft: '#4A473E',
  inkFaint: '#9C9482',
  border: '#E7E2D8',
}

const IconHome = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const IconChevron = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

interface CollectionRef {
  name: string
  handle: string
}

interface BreadcrumbBlockProps {
  productTitle: string
  productCategory?: string | null
  collections?: CollectionRef[] | null
  storeSlug: string
}

export function BreadcrumbBlock({
  productTitle,
  productCategory,
  collections,
  storeSlug,
}: BreadcrumbBlockProps) {
  const FONT_BODY = "'Tajawal', sans-serif"

  const primaryCollection =
    collections && collections.length > 0 ? collections[0] : null

  const segments: { label: string; href?: string }[] = [
    {
      label: 'الرئيسية',
      href: `/store/${storeSlug}`,
    },
    // {
    //   label: 'Shop All',
    //   href: `/store/${storeSlug}/collections/all`,
    // },
  ]

  // إضافة اسم الـ Collection إذا كان المنتج تابع لها
  if (primaryCollection) {
    segments.push({
      label: primaryCollection.name,
      href: `/store/${storeSlug}/collections/${primaryCollection.handle}`,
    })
  }

  // اسم المنتج
  segments.push({
    label: productTitle,
  })

  return (
    <nav
      className="mb-6 flex flex-wrap items-center gap-2 text-[13px]"
      style={{ color: T.inkFaint, fontFamily: FONT_BODY }}
      aria-label="breadcrumb"
    >
      {segments.map((seg, index) => {
        const isLast = index === segments.length - 1

        return (
          <span
            key={`${seg.label}-${index}`}
            className="flex items-center gap-2 min-w-0"
          >
            {index > 0 && (
              <span
                className="flex items-center"
                style={{ color: T.border }}
                aria-hidden="true"
              >
                <IconChevron />
              </span>
            )}

            {seg.href && !isLast ? (
              <Link
                href={seg.href}
                className="flex items-center gap-1 truncate font-medium transition-colors hover:text-[#1B1B18]"
              >
                {index === 0 && <IconHome />}
                <span>{seg.label}</span>
              </Link>
            ) : (
              <span
                className={`flex items-center gap-1 truncate ${
                  isLast ? 'font-semibold' : 'font-medium'
                }`}
                style={{
                  color: isLast ? T.inkSoft : T.inkFaint,
                  maxWidth: isLast ? '320px' : undefined,
                }}
                title={isLast ? seg.label : undefined}
                aria-current={isLast ? 'page' : undefined}
              >
                {index === 0 && <IconHome />}
                <span>{seg.label}</span>
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
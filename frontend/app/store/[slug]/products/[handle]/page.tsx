'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { BreadcrumbBlock } from '@/components/breadcrumb-patch'
import { useStore } from '../../components/StoreContext'   // ضيفه فوق مع الـ imports — عدّل المسار حسب مكان الملف الفعلي


/* ══════════════════════════════════════════════════════════════════════
   Public Product Detail Page
   ------------------------------------------------------------------
   /store/{storeSlug}/products/{handle}
   GET /api/storefront/{storeSlug}/products/{handle}

   "Boutique / artisan" visual identity:
   - Warm ink (#1B1B18) instead of flat black + brass (#9C7A3C) as the
     signature accent instead of the usual terracotta/neon-green.
   - Warm paper white (#FBF9F5) for the buy-box card, visually separating
     it from the neutral white gallery background (kept neutral so
     product photos show their true colors).
   - Title and price in Cairo (ExtraBold/Black) — strong visual identity —
     labels and body text in Tajawal — same font pairing used elsewhere.
   - Signature element: a real cut-ribbon discount badge (instead of the
     usual rounded pill) sitting on the image like an actual price tag.
   - Real buy-box, real color swatches, sticky mobile add-to-cart,
     trust row, clear stock details — exactly like a professional store.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Design tokens ────────────────────────────────────────────────────── */
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
  pine: '#2F6F52',
  amber: '#B98B3E',
}

const FONT_DISPLAY = "'Cairo', sans-serif"
const FONT_BODY = "'Tajawal', sans-serif"

/* ── Types ────────────────────────────────────────────────────────────── */
interface ProductOptionValue { id: string; value: string }
interface ProductOption {
  id: string
  name: string
  values: ProductOptionValue[]
  colors?: Record<string, string>
  displayType?: 'buttons' | 'select' | 'tabs' | 'input'
}

interface ProductVariant {
  id: string
  title: string
  price: string | number | null
  compare_at_price: string | number | null
  inventory_qty: number
  continue_selling: boolean
  sku?: string | null
  option1?: string | null
  option2?: string | null
  option3?: string | null
  image_url?: string | null
}

interface ProductImage { url: string; alt?: string | null }

interface ProductDetail {
  id: string
  title: string
  description: string | null
  handle: string
  category: string | null
  productType: { id: string; name: string } | null
  images: ProductImage[]
  variants: ProductVariant[]
  options: ProductOption[]
  collections: { name: string; handle: string }[]   // ⬅️ جديد
}

function resolveOptionColor(opt: ProductOption, value: string): string | null {
  const key = value.trim().toLowerCase()
  if (opt.colors && opt.colors[key]) return opt.colors[key]
  return resolveColor(value)
}

const CURRENCY_CODE = 'EGP'

/* ── Helpers: numbers & price ────────────────────────────────────────── */
function toNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN
  if (typeof raw === 'number') return raw
  const str = String(raw).trim().replace(/[^\d.-]/g, '')
  if (str === '') return NaN
  return parseFloat(str)
}

function formatAmount(n: number): string {
  const hasFraction = Math.round(n * 100) % 100 !== 0
  return n.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

/* ── Helpers: color resolution ───────────────────────────────────────── */
const COLOR_HEX: Record<string, string> = {
  red: '#DC2626',
  blue: '#2563EB',
  'navy blue': '#1E3A8A', navy: '#1E3A8A',
  green: '#16A34A',
  black: '#18181B',
  white: '#FFFFFF',
  yellow: '#EAB308',
  purple: '#9333EA',
  pink: '#EC4899',
  orange: '#F97316',
  gray: '#6B7280', grey: '#6B7280',
  brown: '#78350F',
  beige: '#E7D8BD',
  gold: '#CA9A3D',
  silver: '#C0C0C0',
  cream: '#F5F0E6',
  maroon: '#7F1D1D',
  teal: '#0F766E',
  olive: '#6B7B2A',
  mint: '#8FE1C9',
  lavender: '#C4B5FD',
  khaki: '#A99A6B',
  multicolor: 'conic-gradient(from 0deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)',
}

function resolveColor(value: string): string | null {
  const key = value.trim().toLowerCase()
  if (COLOR_HEX[key]) return COLOR_HEX[key]
  if (/^#[0-9a-f]{3,8}$/i.test(value.trim())) return value.trim()
  if (typeof window !== 'undefined' && typeof CSS !== 'undefined' && CSS.supports?.('color', key)) {
    if (/^[a-z]+$/.test(key)) return key
  }
  return null
}

function isColorOption(name: string): boolean {
  const n = name.trim().toLowerCase()
  return n === 'color' || n === 'colour'
}

/* ── Helpers: stock ───────────────────────────────────────────────────── */
function getStockInfo(qty: number, continueSelling: boolean): { text: string; tone: 'ok' | 'low' | 'out' } {
  if (qty <= 0 && continueSelling) return { text: 'In stock — ships once prepared', tone: 'ok' }
  if (qty <= 0) return { text: 'Out of stock', tone: 'out' }
  if (qty <= 5) return { text: `Only ${qty} left in stock`, tone: 'low' }
  return { text: 'In stock', tone: 'ok' }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/* ── Icons ────────────────────────────────────────────────────────────── */
const IconChevronLeft = ({ className = '' }: { className?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
)
const IconChevronRight = ({ className = '' }: { className?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
)
const IconMinus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
const IconCheck = ({ className = '' }: { className?: string }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="20 6 9 17 4 12" /></svg>
)
const IconBag = ({ className = '' }: { className?: string }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)
const IconShield = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const IconTruck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="6" width="14" height="11" rx="1" /><path d="M15 9h4l3 4v4h-7z" /><circle cx="6" cy="19" r="1.6" /><circle cx="17.5" cy="19" r="1.6" />
  </svg>
)
const IconRepeat = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
const IconImagePlaceholder = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
)
const IconSpinner = ({ className = '' }: { className?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
)
const IconZoomIn = ({ className = '' }: { className?: string }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
  </svg>
)
const IconX = ({ className = '' }: { className?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

/* ── Discount ribbon (signature element) ─────────────────────────────────
   A real cut-ribbon badge instead of the usual rounded pill — a flag
   shape via clip-path, attached to the image's top-left edge like an
   actual price tag on a boutique product. */
function DiscountRibbon({ pct }: { pct: number }) {
  return (
    <div className="absolute left-0 top-5 z-10 select-none drop-shadow-md">
      <div
        className="flex items-center py-1.5 pl-3.5 pr-5 text-[12px] font-extrabold tracking-wide text-white"
        style={{
          background: T.brick,
          fontFamily: FONT_DISPLAY,
          clipPath: 'polygon(0 0, 100% 0, 82% 50%, 100% 100%, 0 100%)',
        }}
      >
        -{pct}%
      </div>
    </div>
  )
}

/* ── Price block (signature price hierarchy) ─────────────────────────────
   Pricing rule for this data model:
   - `price`            → always present.
   - `compare_at_price`  → optional.
   Whichever of the two is the larger number is treated as the original
   (struck-through) price, and the smaller one as the current selling
   price — this works correctly no matter which field holds which value. */
function IconTag({ className = '' }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L4 3a1 1 0 0 0-1 1l.24 5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.82Z" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PriceBlock({
  price, salePrice, size = 'lg',
}: { price: number; salePrice: number; size?: 'lg' | 'sm' }) {
  const hasSale = Number.isFinite(salePrice) && salePrice > 0 && Number.isFinite(price) && salePrice < price
  const mainPrice = hasSale ? salePrice : price
  const discountPct = hasSale ? Math.round((1 - salePrice / price) * 100) : 0
  const savedAmount = hasSale ? price - salePrice : 0

  if (!Number.isFinite(mainPrice)) {
    return <span className="text-sm" style={{ color: T.inkFaint }}>Price unavailable</span>
  }

  const priceSize = size === 'lg' ? 'text-[32px] sm:text-[38px]' : 'text-2xl'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-extrabold leading-none tracking-tight tabular-nums ${priceSize}`}
            style={{ color: hasSale ? T.brick : T.ink, fontFamily: FONT_DISPLAY }}
          >
            {formatAmount(mainPrice)}
          </span>
          <span className="text-[13px] font-bold" style={{ color: hasSale ? T.brick : T.brass }}>{CURRENCY_CODE}</span>
        </div>

        {hasSale && (
          <span className="text-[15px] font-medium line-through tabular-nums" style={{ color: T.inkFaint }}>
            {formatAmount(price)} {CURRENCY_CODE}
          </span>
        )}

        {hasSale && (
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-extrabold leading-none text-white"
            style={{ background: T.brick, fontFamily: FONT_DISPLAY }}
          >
            <IconTag />
            Save {discountPct}%
          </span>
        )}
      </div>

      {hasSale && (
        <span className="text-[12px] font-medium" style={{ color: T.pine }}>
          You saved {formatAmount(savedAmount)} {CURRENCY_CODE} off the original price
        </span>
      )}

      {size === 'lg' && <span className="mt-0.5 h-[3px] w-12 rounded-full" style={{ background: T.brassStrong }} />}
    </div>
  )
}

/* ── Image gallery / slider with zoom + lightbox ─────────────────────── */
/* ── Image gallery / slider with zoom + lightbox ─────────────────────── */
function Gallery({ images, title, discountPct }: { images: ProductImage[]; title: string; discountPct?: number | null }) {
  const [index, setIndex] = useState(0)
  const [isZooming, setIsZooming] = useState(false)
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 })
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const touchX = useRef<number | null>(null)
  const thumbsRailRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<Record<number, HTMLButtonElement | null>>({})

  // Manual drag-to-scroll state for the thumbnail rail (mouse only —
  // touch already scrolls natively via touch-action: pan-x).
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef({ startX: 0, startScrollLeft: 0, moved: false })

  useEffect(() => { setIndex(0) }, [images.length, images[0]?.url])
  useEffect(() => { setIsZooming(false) }, [index])

  // Keep the active thumbnail in view whenever the main image changes —
  // whether that happened by clicking a thumb, swiping, or the arrows.
  // scrollIntoView with block/inline "nearest" only moves the rail if the
  // active thumb is actually out of view, so it never fights a scroll the
  // user is doing manually.
  useEffect(() => {
    const el = thumbRefs.current[index]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [index])

  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false)
      if (e.key === 'ArrowLeft') go(1)
      if (e.key === 'ArrowRight') go(-1)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen])

  const go = useCallback((delta: number) => {
    setIndex((i) => {
      const n = images.length
      if (n === 0) return 0
      return (i + delta + n) % n
    })
  }, [images.length])

  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(dx) > 45) go(dx > 0 ? -1 : 1)
    touchX.current = null
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoomPos({ x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) })
  }

  // On desktop, hovering the horizontal thumb strip and using the mouse
  // wheel should scroll the strip sideways instead of scrolling the page.
  // Only kicks in when the strip actually has horizontal overflow to
  // scroll — otherwise the page scroll is left alone.
  const handleThumbsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = thumbsRailRef.current
    if (!el) return
    const isHorizontalLayout = el.scrollWidth > el.clientWidth
    if (!isHorizontalLayout) return // desktop vertical rail: let native vertical scroll happen
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    el.scrollLeft += e.deltaY
  }

  // Real click-and-drag scrolling for the thumb rail (both the mobile
  // horizontal strip and the desktop vertical rail — whichever axis is
  // actually scrollable). This is what makes the grab/grabbing cursor
  // mean something instead of just looking like it.
  const handleThumbsMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = thumbsRailRef.current
    if (!el) return
    const isHorizontalLayout = el.scrollWidth > el.clientWidth
    const isVerticalLayout = el.scrollHeight > el.clientHeight
    if (!isHorizontalLayout && !isVerticalLayout) return

    setIsDragging(true)
    dragState.current = {
      startX: isHorizontalLayout ? e.clientX : e.clientY,
      startScrollLeft: isHorizontalLayout ? el.scrollLeft : el.scrollTop,
      moved: false,
    }
    e.preventDefault() // stop text/image selection while dragging
  }

  const handleThumbsMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const el = thumbsRailRef.current
    if (!el) return
    const isHorizontalLayout = el.scrollWidth > el.clientWidth
    const pos = isHorizontalLayout ? e.clientX : e.clientY
    const delta = pos - dragState.current.startX

    if (Math.abs(delta) > 4) dragState.current.moved = true

    if (isHorizontalLayout) {
      el.scrollLeft = dragState.current.startScrollLeft - delta
    } else {
      el.scrollTop = dragState.current.startScrollLeft - delta
    }
  }

  const endThumbsDrag = () => {
    if (!isDragging) return
    setIsDragging(false)
  }

  // If the user actually dragged (not just clicked), swallow the click
  // that would otherwise fire on the thumbnail button underneath the
  // cursor and select the wrong image.
  const handleThumbClickCapture = (e: React.MouseEvent) => {
    if (dragState.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      dragState.current.moved = false
    }
  }

  if (images.length === 0) {
    return (
      <div
        className="flex aspect-square w-full items-center justify-center rounded-2xl border"
        style={{ borderColor: T.border, background: T.paper, color: T.inkFaint }}
      >
        <IconImagePlaceholder />
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes galleryFade { from { opacity: 0 } to { opacity: 1 } }

        /* Desktop vertical thumbnail rail — scrollbar fully hidden.
           It was rendering as a thick, always-visible orange bar glued
           to the edge of the rail, which broke the clean boutique look.
           Scrolling still works fine via wheel/drag — it just doesn't
           need a visible track. */
        .pdp-thumbs-rail {
          scrollbar-width: none;       /* Firefox */
          -ms-overflow-style: none;    /* old Edge/IE */
        }
        .pdp-thumbs-rail::-webkit-scrollbar {
          display: none;               /* Chrome/Safari/Edge */
        }

        /* Mobile horizontal strip — same treatment: no visible scrollbar,
           smooth touch scroll only. touch-action: pan-x locks the
           gesture to the horizontal axis so the page doesn't fight it,
           and overscroll-behavior-x:contain stops the strip's own
           scroll from bleeding into the page scroll. No scroll-snap on
           purpose — snap-to-item fought the user's drag mid-gesture and
           felt "stuck"/springy. */
        .pdp-thumbs-strip {
          scrollbar-width: none;
          -ms-overflow-style: none;
          overscroll-behavior-x: contain;
          touch-action: pan-x;
          -webkit-overflow-scrolling: touch;
        }
        .pdp-thumbs-strip::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* overflow-hidden is the safety net: whatever happens inside, this
          box can never exceed the viewport width, so the page itself can
          never grow a horizontal scrollbar. */}
      <div className="grid w-full grid-cols-1 gap-3 overflow-hidden sm:grid-cols-[68px_1fr] sm:items-start sm:gap-4">
        {/* Main image — shown first on mobile, right column on sm+ */}
        <div
          className="group relative order-1 min-w-0 cursor-zoom-in overflow-hidden rounded-2xl border bg-white sm:order-2"
          style={{ borderColor: T.border }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onMouseEnter={() => setIsZooming(true)}
          onMouseLeave={() => setIsZooming(false)}
          onMouseMove={handleMouseMove}
          onClick={() => setLightboxOpen(true)}
        >
          <div className="aspect-square w-full overflow-hidden bg-white">
            <img
              key={index}
              src={images[index]?.url}
              alt={images[index]?.alt || title}
              className="h-full w-full object-cover"
              style={{
                transform: isZooming ? 'scale(2)' : 'scale(1)',
                transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                transition: isZooming ? 'none' : 'transform 0.35s ease',
                animation: 'galleryFade 0.3s ease',
              }}
            />
          </div>

          {!!discountPct && <DiscountRibbon pct={discountPct} />}

          <span
            className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-bold opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100"
            style={{ color: T.inkSoft }}
          >
            <IconZoomIn /> Click to zoom
          </span>

          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); go(-1) }}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 opacity-60 shadow-md ring-1 ring-black/5 transition-all duration-200 hover:scale-105 hover:opacity-100 hover:bg-white active:scale-95 sm:opacity-0 sm:group-hover:opacity-100"
                style={{ color: T.ink }}
              >
                <IconChevronLeft />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); go(1) }}
                aria-label="Next image"
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 opacity-60 shadow-md ring-1 ring-black/5 transition-all duration-200 hover:scale-105 hover:opacity-100 hover:bg-white active:scale-95 sm:opacity-0 sm:group-hover:opacity-100"
                style={{ color: T.ink }}
              >
                <IconChevronRight />
              </button>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                {images.map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i === index ? 20 : 6,
                      background: i === index ? T.ink : 'rgba(255,255,255,0.9)',
                      boxShadow: i === index ? 'none' : '0 0 0 1px rgba(0,0,0,0.1)',
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Thumbnails — shown below the main image on mobile, left rail
            on sm+. Bigger squares (72px) with breathing room (padding on
            the strip) so nothing looks cramped or clipped at the edges.
            Mouse drag-to-scroll: mousedown starts the drag, mousemove
            (while dragging) moves the scroll position, mouseup/mouseleave
            ends it. Cursor switches grab -> grabbing while active. */}
        {images.length > 1 && (
          <div
            ref={thumbsRailRef}
            onWheel={handleThumbsWheel}
            onMouseDown={handleThumbsMouseDown}
            onMouseMove={handleThumbsMouseMove}
            onMouseUp={endThumbsDrag}
            onMouseLeave={endThumbsDrag}
            onClickCapture={handleThumbClickCapture}
            className="pdp-thumbs-strip pdp-thumbs-rail order-2 flex w-full min-w-0 gap-2.5 overflow-x-auto overflow-y-hidden px-0.5 py-1 sm:order-1 sm:h-auto sm:max-h-[min(560px,80vh)] sm:w-auto sm:flex-col sm:gap-2 sm:overflow-x-hidden sm:overflow-y-auto sm:px-0 sm:py-0"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            {images.map((img, i) => (
              <button
                key={img.url + i}
                ref={(el) => { thumbRefs.current[i] = el }}
                onClick={() => setIndex(i)}
                aria-label={`Image ${i + 1}`}
                draggable={false}
                className="relative aspect-square w-[72px] shrink-0 overflow-hidden rounded-xl border-2 transition-all sm:w-[68px] sm:rounded-lg sm:border"
                style={{
                  borderColor: i === index ? T.ink : T.border,
                  boxShadow: i === index ? `0 0 0 1px ${T.ink}` : 'none',
                }}
              >
                <img
                  src={img.url}
                  alt={img.alt || title}
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {i !== index && (
                  <span className="absolute inset-0 bg-white/0 transition-colors hover:bg-white/10" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            onClick={() => setLightboxOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <IconX />
          </button>

          <div
            className="relative flex max-h-[88vh] max-w-[88vw] items-center justify-center"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <img
              key={index}
              src={images[index]?.url}
              alt={images[index]?.alt || title}
              className="max-h-[88vh] max-w-[88vw] rounded-lg object-contain"
              style={{ animation: 'galleryFade 0.3s ease' }}
            />

            {images.length > 1 && (
              <>
                <button
                  onClick={() => go(-1)}
                  aria-label="Previous image"
                  className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:-left-14"
                >
                  <IconChevronLeft />
                </button>
                <button
                  onClick={() => go(1)}
                  aria-label="Next image"
                  className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:-right-14"
                >
                  <IconChevronRight />
                </button>
                <div className="absolute -bottom-9 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {images.map((_, i) => (
                    <span
                      key={i}
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: i === index ? 20 : 6,
                        background: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ── Color select dropdown (custom, shows swatch per option) ──────────── */
function OptionSelectDropdown({
  opt, optIndex, product, value, onChange, isValueOutOfStock, showSwatch,
}: {
  opt: ProductOption
  optIndex: number
  product: ProductDetail
  value: string
  onChange: (v: string) => void
  isValueOutOfStock: (optionName: string, value: string) => boolean
  showSwatch: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getVisual = (val: string) => {
    if (!showSwatch) return { hex: null, imageUrl: null }
    const variantImage = product.variants.find((vr) => {
      const v = [vr.option1, vr.option2, vr.option3][optIndex]
      return v === val && !!vr.image_url
    })?.image_url || null
    const hex = variantImage ? null : resolveOptionColor(opt, val)
    return { hex, imageUrl: variantImage }
  }

  const selectedVisual = getVisual(value)

  const renderDot = (hex: string | null, imageUrl: string | null) => {
    if (!showSwatch) return null
    const needsBorder = !imageUrl && hex?.toLowerCase() === '#ffffff'
    return (
      <span
        className={`relative inline-block shrink-0 overflow-hidden rounded-[4px] ${needsBorder ? 'border' : ''}`}
        style={{ width: 18, height: 18, background: imageUrl ? T.paper : hex || T.paper, borderColor: needsBorder ? T.border : undefined }}
      >
        {imageUrl && <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      </span>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-bold outline-none"
        style={{ borderColor: T.border, color: T.ink, background: '#fff', fontFamily: FONT_BODY }}
      >
        {renderDot(selectedVisual.hex, selectedVisual.imageUrl)}
        <span className="flex-1 truncate text-left">{value || '—'}</span>
        <span style={{ color: T.inkFaint, display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>

      {open && (
        <div
          className="absolute z-20 mt-1.5 w-full overflow-y-auto rounded-lg border bg-white shadow-lg"
          style={{ borderColor: T.border, maxHeight: 260 }}
        >
          {opt.values.map((v) => {
            const oos = isValueOutOfStock(opt.name, v.value)
            const visual = getVisual(v.value)
            const isSelected = v.value === value
            return (
              <button
                key={v.id}
                type="button"
                disabled={oos}
                onClick={() => { onChange(v.value); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: isSelected ? T.paper : '#fff', color: T.ink, fontFamily: FONT_BODY }}
                onMouseEnter={(e) => { if (!oos) (e.currentTarget as HTMLElement).style.background = T.paper }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isSelected ? T.paper : '#fff' }}
              >
                {renderDot(visual.hex, visual.imageUrl)}
                <span className="flex-1 truncate text-left">{v.value}</span>
                {oos && <span className="text-[11px]" style={{ color: T.inkFaint }}>غير متاح</span>}
                {isSelected && !oos && <span style={{ color: T.brass, display: 'flex' }}><IconCheck /></span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
/* ── Color swatch button (signature element) ──────────────────────────── */
function ColorSwatch({
  label, hex, imageUrl, selected, outOfStock, onClick,
}: { label: string; hex: string | null; imageUrl?: string | null; selected: boolean; outOfStock: boolean; onClick: () => void }) {
  const needsBorder = !imageUrl && hex?.toLowerCase() === '#ffffff'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={outOfStock}
      title={outOfStock ? `${label} — currently unavailable` : label}
      aria-pressed={selected}
      className="group/swatch flex flex-col items-center gap-1.5 disabled:cursor-not-allowed"
    >
      <span
        className="relative flex items-center justify-center rounded-sm transition-all duration-150"
        style={{
          padding: 3,
          height: 25,
          width: 25,
          boxShadow: selected
            ? `0 0 0 2px ${T.ink}`
            : `inset 0 0 0 1px ${T.border}`,
        }}
        onMouseEnter={(e) => { if (!selected && !outOfStock) (e.currentTarget as HTMLElement).style.boxShadow = `inset 0 0 0 1.5px ${T.brassStrong}` }}
        onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLElement).style.boxShadow = `inset 0 0 0 1px ${T.border}` }}
      >
        <span
          className={`relative h-full w-full overflow-hidden rounded-[4px] ${needsBorder ? 'border' : ''} ${outOfStock ? 'opacity-35 grayscale-[30%]' : ''}`}
          style={{ background: imageUrl ? T.paper : hex || T.paper, borderColor: needsBorder ? T.border : undefined }}
        >
          {imageUrl && (
            <img src={imageUrl} alt={label} className="absolute inset-0 h-full w-full object-cover" />
          )}
        </span>

        {outOfStock && (
          <span className="pointer-events-none absolute inset-[3px] overflow-hidden rounded-[9px]">
            <span className="absolute left-1/2 top-1/2 h-[1.5px] w-[150%] -translate-x-1/2 -translate-y-1/2 rotate-45" style={{ background: T.inkFaint }} />
          </span>
        )}
      </span>

      <span
        className="max-w-[64px] truncate text-[11px] font-medium"
        style={{ color: selected ? T.ink : T.inkFaint, fontFamily: FONT_BODY }}
      >
        {label}
      </span>
    </button>
  )
}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function ProductDetailPage() {
  const params = useParams()
  const storeSlug = (params?.slug as string) || ''
  const handle = (params?.handle as string) || ''

  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const { addToCart } = useStore()
  
  useEffect(() => {
    if (!storeSlug || !handle) return
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    fetch(`/api/storefront/${storeSlug}/products/${handle}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then((data: ProductDetail) => {
        if (cancelled) return
        const normalized: ProductDetail = {
          ...data,
          options: (data.options || []).map((o: any) => ({
            ...o,
            displayType: o.displayType || o.display_type || 'buttons',
            colors: o.colors ?? undefined,
          })),
        }
        setProduct(normalized)
        const defaultVariant =
          normalized.variants.find((v) => (v.inventory_qty || 0) > 0 || v.continue_selling) || normalized.variants[0]
        const initial: Record<string, string> = {}
        normalized.options.forEach((opt, i) => {
          const fromVariant = defaultVariant
            ? [defaultVariant.option1, defaultVariant.option2, defaultVariant.option3][i]
            : null
          initial[opt.name] = fromVariant || opt.values[0]?.value || ''
        })
        setSelections(initial)
        setQty(1)
      })
      .catch(() => { if (!cancelled) setNotFound(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [storeSlug, handle])

  const selectedVariant = useMemo(() => {
  if (!product) return undefined
  if (product.options.length === 0) return product.variants[0]
  const tuple = product.options.map((o) => (o.displayType === 'input' ? null : (selections[o.name] ?? null)))
  return product.variants.find((v) => {
    const vTuple = [v.option1 ?? null, v.option2 ?? null, v.option3 ?? null].slice(0, product.options.length)
    return vTuple.every((val, i) => product.options[i].displayType === 'input' ? true : val === tuple[i])
  })
}, [product, selections])

  const galleryImages = useMemo(() => {
    if (!product) return []
    const imgs = [...product.images]
    if (selectedVariant?.image_url && !imgs.some((i) => i.url === selectedVariant.image_url)) {
      imgs.unshift({ url: selectedVariant.image_url, alt: product.title })
    }
    return imgs
  }, [product, selectedVariant])

  const rawPrice = toNumber(selectedVariant?.price)
  const rawCompare = toNumber(selectedVariant?.compare_at_price)
  const bothValid = Number.isFinite(rawPrice) && rawPrice > 0 && Number.isFinite(rawCompare) && rawCompare > 0
  const originalPrice = bothValid ? Math.max(rawPrice, rawCompare) : rawPrice
  const salePriceRaw = bothValid && rawPrice !== rawCompare ? Math.min(rawPrice, rawCompare) : NaN

  const stock = selectedVariant ? getStockInfo(selectedVariant.inventory_qty || 0, selectedVariant.continue_selling) : { text: '', tone: 'ok' as const }
  const maxQty = selectedVariant
    ? (selectedVariant.continue_selling ? 99 : Math.max(selectedVariant.inventory_qty || 0, 0))
    : 0
  const canBuy = !!selectedVariant && (maxQty > 0 || selectedVariant.continue_selling)

  const hasDiscount = Number.isFinite(salePriceRaw) && salePriceRaw > 0 && Number.isFinite(originalPrice) && salePriceRaw < originalPrice
  const discountPct = hasDiscount ? Math.round((1 - salePriceRaw / originalPrice) * 100) : 0

  const stockDotColor = stock.tone === 'ok' ? T.pine : stock.tone === 'low' ? T.amber : T.brick
  const stockTextColor = stock.tone === 'ok' ? T.pine : stock.tone === 'low' ? T.amber : T.brick
  
  /* Only touch selections (and therefore only re-render) when the value
     actually changes. Clicking an option that is already selected is a
     no-op — it must never reset quantity or anything else. */
  const selectValue = (optionName: string, value: string) => {
    setSelections((prev) => (prev[optionName] === value ? prev : { ...prev, [optionName]: value }))
  }

  /* Quantity resets to 1 whenever the resolved variant actually changes
     (i.e. a different option value was picked). Re-clicking a value that
     is already selected never reaches here, because selectValue() above
     is a no-op in that case — selections stays the same object, so this
     effect never re-fires and quantity is left untouched. */
  useEffect(() => {
    if (!selectedVariant) return
    setQty(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant?.id])

  const isValueOutOfStock = (optionName: string, value: string): boolean => {
  if (!product) return false
  const tuple = product.options.map((o) => {
    if (o.displayType === 'input') return null
    return o.name === optionName ? value : selections[o.name] ?? null
  })
  const match = product.variants.find((v) => {
    const vTuple = [v.option1 ?? null, v.option2 ?? null, v.option3 ?? null].slice(0, product.options.length)
    return vTuple.every((val, i) => product.options[i].displayType === 'input' ? true : val === tuple[i])
  })
  if (!match) return false
  return (match.inventory_qty || 0) <= 0 && !match.continue_selling
}


  // ... جوه الـ component:

  const handleAddToCart = () => {
    if (!canBuy || !selectedVariant) return
    addToCart({
      variantId: selectedVariant.id,
      productId: product.id,
      productHandle: product.handle,
      title: product.title,
      variantTitle: selectedVariant.title !== 'Default Title' ? selectedVariant.title : undefined,
      price: hasDiscount ? salePriceRaw : originalPrice,
      image: galleryImages[0]?.url || null,
      maxQty: selectedVariant.continue_selling ? undefined : selectedVariant.inventory_qty,
    }, qty)
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <IconSpinner style={{ color: T.borderSoft }} />
      </div>
    )
  }

  if (notFound || !product) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center" style={{ fontFamily: FONT_BODY }}>
        <p className="text-lg font-semibold" style={{ color: T.ink }}>Product unavailable</p>
        <p className="text-sm" style={{ color: T.inkFaint }}>This link is invalid or the product has been removed.</p>
      </div>
    )
  }

  const plainDescription = product.description ? stripHtml(product.description) : ''

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: FONT_BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Tajawal:wght@400;500;700&display=swap');
      `}</style>

      <div className="mx-auto max-w-6xl px-5 py-8 pb-28 sm:py-12 sm:pb-12">
        {/* Breadcrumb */}
        <BreadcrumbBlock
  productTitle={product.title}
  productCategory={product.category}
  collections={product.collections}
  storeSlug={storeSlug}
/>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          {/* ── Gallery ── */}
          <Gallery images={galleryImages} title={product.title} discountPct={hasDiscount ? discountPct : null} />

          {/* ── Buy box ── */}
          <div className="lg:sticky lg:top-6">
            <div className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: T.border, background: T.paper }}>
              {product.productType?.name && (
                <span
                  className="mb-2 block text-[11px] font-bold uppercase"
                  style={{ color: T.brass, letterSpacing: '0.14em', fontFamily: FONT_BODY }}
                >
                  {product.productType.name}
                </span>
              )}
              <h1
                className="text-[22px] font-extrabold leading-snug sm:text-[26px]"
                style={{ color: T.ink, fontFamily: FONT_DISPLAY }}
              >
                {product.title}
              </h1>

              <div className="mt-4">
                <PriceBlock price={originalPrice} salePrice={salePriceRaw} />
              </div>

              {/* Stock */}
              {selectedVariant && (
                <div className="mt-3 flex items-center gap-1.5 text-[13px] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: stockDotColor }} />
                  <span style={{ color: stockTextColor }}>
                    {stock.text}
                  </span>
                </div>
              )}

              <div className="my-5 border-t border-dashed" style={{ borderColor: T.border }} />

              {/* Options */}
              {product.options.length > 0 && (
                <div className="flex flex-col gap-5">
                  {product.options.map((opt, optIndex) => {
  const displayType = opt.displayType || 'buttons'
  const colorMode = displayType === 'buttons' && isColorOption(opt.name)
  const isSelectRow = displayType === 'select'

  return (
    <div key={opt.id} className={isSelectRow ? 'flex items-center gap-3' : undefined}>
      <div
        className={isSelectRow ? 'flex shrink-0 items-baseline gap-2' : 'mb-2.5 flex items-baseline gap-2'}
        style={isSelectRow ? { minWidth: 90 } : undefined}
      >
        <span className="text-[13px] font-bold" style={{ color: T.inkSoft }}>{opt.name}</span>
        {displayType !== 'input' && selections[opt.name] && (
          <span className="text-[13px]" style={{ color: T.inkFaint }}>{selections[opt.name]}</span>
        )}
      </div>

      <div className={isSelectRow ? 'shrink-0' : undefined} style={isSelectRow ? { width: 150 } : undefined}>
        {displayType === 'select' ? (
          isColorOption(opt.name) ? (
            <OptionSelectDropdown
              opt={opt}
              optIndex={optIndex}
              product={product}
              value={selections[opt.name] || ''}
              onChange={(v) => selectValue(opt.name, v)}
              isValueOutOfStock={isValueOutOfStock}
              showSwatch={isColorOption(opt.name)}
            />
          ) : (
            <OptionSelectDropdown
              opt={opt}
              optIndex={optIndex}
              product={product}
              value={selections[opt.name] || ''}
              onChange={(v) => selectValue(opt.name, v)}
              isValueOutOfStock={isValueOutOfStock}
              showSwatch={isColorOption(opt.name)}
            />
          )

        ) : displayType === 'tabs' ? (
          <div className="inline-flex flex-wrap gap-1 rounded-lg border p-1" style={{ borderColor: T.border }}>
            {opt.values.map((v) => {
              const isSelected = selections[opt.name] === v.value
              const oos = isValueOutOfStock(opt.name, v.value)
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectValue(opt.name, v.value)}
                  disabled={oos}
                  className="rounded-md px-3.5 py-1.5 text-[13px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: isSelected ? T.ink : 'transparent',
                    color: isSelected ? '#fff' : T.inkSoft,
                    fontFamily: FONT_BODY,
                  }}
                >
                  {v.value}
                </button>
              )
            })}
          </div>

        ) : colorMode ? (
          <div className="flex flex-wrap gap-3">
            {opt.values.map((v) => {
              const isSelected = selections[opt.name] === v.value
              const oos = isValueOutOfStock(opt.name, v.value)
              const variantImage = product.variants.find((vr) => {
                const val = [vr.option1, vr.option2, vr.option3][optIndex]
                return val === v.value && !!vr.image_url
              })?.image_url || null
              const hex = variantImage ? null : resolveOptionColor(opt, v.value)

              if (!variantImage && !hex) {
                return (
                  <button
                    key={v.id}
                    onClick={() => selectValue(opt.name, v.value)}
                    disabled={oos}
                    className="relative rounded-lg px-3.5 py-2 text-[13px] font-bold transition-all duration-150 disabled:cursor-not-allowed"
                    style={{
                      boxShadow: isSelected
                        ? `0 0 0 1.5px ${T.ink}, 0 2px 6px rgba(27,27,24,0.10)`
                        : `inset 0 0 0 1px ${T.border}`,
                      background: isSelected ? '#fff' : T.paper,
                      color: oos ? T.inkFaint : isSelected ? T.ink : T.inkSoft,
                      fontFamily: FONT_BODY,
                      opacity: oos ? 0.55 : 1,
                    }}
                    onMouseEnter={(e) => { if (!isSelected && !oos) (e.currentTarget as HTMLElement).style.boxShadow = `inset 0 0 0 1.5px ${T.brassStrong}` }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.boxShadow = `inset 0 0 0 1px ${T.border}` }}
                  >
                    {v.value}
                    {oos && <span className="pointer-events-none absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-current opacity-70" />}
                  </button>
                )
              }

              return (
                <ColorSwatch
                  key={v.id}
                  label={v.value}
                  hex={hex}
                  imageUrl={variantImage}
                  selected={isSelected}
                  outOfStock={oos}
                  onClick={() => selectValue(opt.name, v.value)}
                />
              )
            })}
          </div>

        ) : (
          <div className="flex flex-wrap gap-2">
            {opt.values.map((v) => {
              const isSelected = selections[opt.name] === v.value
              const oos = isValueOutOfStock(opt.name, v.value)
              return (
                <button
                  key={v.id}
                  onClick={() => selectValue(opt.name, v.value)}
                  disabled={oos}
                  className="relative min-w-[38px] rounded-lg px-2 py-2 text-[13px] font-bold transition-all duration-150 disabled:cursor-not-allowed"
                  style={{
                    boxShadow: isSelected
                      ? `0 0 0 1.5px ${T.ink}, 0 2px 6px rgba(27,27,24,0.10)`
                      : `inset 0 0 0 1px ${T.border}`,
                    background: isSelected ? '#fff' : T.paper,
                    color: oos ? T.inkFaint : isSelected ? T.ink : T.inkSoft,
                    fontFamily: FONT_BODY,
                    opacity: oos ? 0.55 : 1,
                  }}
                  onMouseEnter={(e) => { if (!isSelected && !oos) (e.currentTarget as HTMLElement).style.boxShadow = `inset 0 0 0 1.5px ${T.brassStrong}` }}
                  onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.boxShadow = `inset 0 0 0 1px ${T.border}` }}
                >
                  {v.value}
                  {oos && <span className="pointer-events-none absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-current opacity-70" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})}
                </div>
              )}

              {/* Quantity + CTA */}
              <div className="mt-6 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-bold" style={{ color: T.inkSoft }}>Quantity</span>
                  <div className="flex h-11 w-fit items-center rounded-xl border" style={{ borderColor: T.border, background: '#fff' }}>
                    <button
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      disabled={!canBuy}
                      className="flex h-full w-10 items-center justify-center transition-colors disabled:opacity-30"
                      style={{ color: T.inkSoft }}
                    >
                      <IconMinus />
                    </button>
                    <span className="w-9 text-center text-[14px] font-bold tabular-nums" style={{ color: T.ink }}>{qty}</span>
                    <button
                      onClick={() => setQty((q) => Math.min(maxQty || 1, q + 1))}
                      disabled={!canBuy || (maxQty > 0 && qty >= maxQty)}
                      className="flex h-full w-10 items-center justify-center transition-colors disabled:opacity-30"
                      style={{ color: T.inkSoft }}
                    >
                      <IconPlus />
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleAddToCart}
                  disabled={!canBuy}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-bold text-white shadow-sm transition-colors"
                  style={{
                    background: !canBuy ? '#C9C4B6' : added ? T.pine : T.ink,
                    cursor: !canBuy ? 'not-allowed' : 'pointer',
                    fontFamily: FONT_BODY,
                  }}
                >
                  {!canBuy ? (
                    'Out of stock'
                  ) : added ? (
                    <><IconCheck className="text-white" /> Added to cart</>
                  ) : (
                    <><IconBag /> Add to cart</>
                  )}
                </button>
              </div>

              {selectedVariant?.sku && (
                <p className="mt-3 text-[12px]" style={{ color: T.inkFaint }}>SKU: {selectedVariant.sku}</p>
              )}

              {/* Trust row */}
              <div className="mt-6 grid grid-cols-3 gap-2 rounded-xl border p-3.5 text-center" style={{ borderColor: T.borderSoft, background: '#fff' }}>
                <div className="flex flex-col items-center gap-1.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: T.paper, color: T.brass }}>
                    <IconShield />
                  </span>
                  <span className="text-[10.5px] font-medium leading-tight" style={{ color: T.inkSoft }}>Secure payment</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: T.paper, color: T.brass }}>
                    <IconTruck />
                  </span>
                  <span className="text-[10.5px] font-medium leading-tight" style={{ color: T.inkSoft }}>Order tracking</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: T.paper, color: T.brass }}>
                    <IconRepeat />
                  </span>
                  <span className="text-[10.5px] font-medium leading-tight" style={{ color: T.inkSoft }}>Easy returns</span>
                </div>
              </div>
            </div>

            {/* Description */}
            {plainDescription && (
              <div className="mt-8">
                <h2 className="mb-3 text-[15px] font-extrabold" style={{ color: T.ink, fontFamily: FONT_DISPLAY }}>Product details</h2>
                <div
                  className="prose prose-sm max-w-none text-[14px] leading-relaxed [&_img]:rounded-lg [&_a]:underline"
                  style={{ color: T.inkSoft }}
                  dangerouslySetInnerHTML={{ __html: product.description || '' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky mobile buy bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t bg-white/95 px-4 py-3 backdrop-blur sm:hidden"
        style={{ borderColor: T.border }}
      >
        <div className="min-w-0 flex-1">
          <PriceBlock price={originalPrice} salePrice={salePriceRaw} size="sm" />
        </div>
        <button
          onClick={handleAddToCart}
          disabled={!canBuy}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold text-white transition-colors"
          style={{
            background: !canBuy ? '#C9C4B6' : added ? T.pine : T.ink,
            cursor: !canBuy ? 'not-allowed' : 'pointer',
            fontFamily: FONT_BODY,
          }}
        >
          {!canBuy ? 'Out of stock' : added ? <><IconCheck className="text-white" /> Added</> : <><IconBag /> Add to cart</>}
        </button>
      </div>
    </div>
  )
}
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'

/* ── Types matching the actual API response shape ───────────────────────── */
interface ProductTag {
  product_id: string
  tag_id: string
  tag: { id: string; name: string }
}

interface ProductVariantLite {
  id?: string
  price: string | number | null
  inventory_qty: number
  option1?: string | null
  option2?: string | null
  option3?: string | null
  sku?: string | null
}

interface Product {
  id: string
  title: string
  handle: string
  status: string
  category: string | null
  /** Prisma returns the relation as `productType`, not `product_type` */
  productType: { id: string; name: string } | null
  tags: ProductTag[]
  created_at: string
  images: { url: string; alt: string }[]
  variants: ProductVariantLite[]
  _count: { variants: number }
  preview_url?: string
}

const CURRENCY = 'EGP'

const STATUS_STYLES: Record<string, { label: string; badge: string; dot: string }> = {
  active:   { label: 'Active',   badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15', dot: 'bg-emerald-500' },
  draft:    { label: 'Draft',    badge: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10',      dot: 'bg-slate-400'   },
  archived: { label: 'Archived', badge: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15',       dot: 'bg-amber-500'   },
  /* جديد: حالة Unlisted — المنتج مش بيظهر في القائمة العادية ولا نتايج
     البحث في المتجر، لكن بيفضل شغال لو حد فتح لينكه المباشر بالظبط. */
  unlisted: { label: 'Unlisted', badge: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/15',    dot: 'bg-violet-500'  },
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'archived', label: 'Archived' },
]

/* ── Helpers ──────────────────────────────────────────────────────────── */
const normalizeStatus = (s: string) => (s || '').toLowerCase()

function toNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN
  if (typeof raw === 'number') return raw
  const str = String(raw).trim().replace(/[^\d.-]/g, '')
  if (str === '') return NaN
  return parseFloat(str)
}

function getPriceDisplay(variants: ProductVariantLite[]): string | null {
  const prices = variants
    .map(v => toNumber((v as any)?.compare_at_price))
    .filter(n => Number.isFinite(n) && n > 0)
  if (prices.length === 0) return null
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max
    ? `${min.toFixed(2)} ${CURRENCY}`
    : `${min.toFixed(2)} – ${max.toFixed(2)} ${CURRENCY}`
}

function getQtyDisplay(qty: number): { text: string; className: string } {
  if (qty <= 0) return { text: 'Out of stock', className: 'text-red-500 font-medium' }
  if (qty === 1) return { text: '1 (Low stock)', className: 'text-orange-500 font-medium' }
  return { text: String(qty), className: 'text-slate-700 font-medium' }
}

function hasRealVariants(variants: ProductVariantLite[]): boolean {
  if (variants.length > 1) return true
  const v = variants[0]
  return !!(v && (v.option1 || v.option2 || v.option3))
}

/**
 * جديد: بيبني لينك المنتج المباشر. لو الباك اند بعت preview_url جاهز
 * بنستخدمه زي ما هو، وإلا بنبنيه من storeSlug + handle كـ fallback.
 * نمط الرابط هنا "/store/{slug}/products/{handle}" — عدّله لو الراوت
 * الفعلي عندك مختلف.
 */
function buildProductLink(product: Product, storeSlug: string, origin: string): string {
  if (product.preview_url) return product.preview_url
  if (!storeSlug || !origin) return ''
  return `${origin}/store/${storeSlug}/products/${product.handle}`
}

/* ── Icons ────────────────────────────────────────────────────────────── */
const IconDots = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
  </svg>
)
const IconEye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
)
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)
const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)
const IconLink = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" />
  </svg>
)
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)
const IconBox = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)
const IconImagePlaceholder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)
const IconSpinner = ({ className = '' }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconChevronDown = ({ className = '' }: { className?: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

function useHoverFixedPopover() {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recalc = useCallback(() => {
    if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect())
  }, [])

  useEffect(() => {
    if (!open) return
    recalc()
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open, recalc])

  const clearCloseTimer = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const show = () => { clearCloseTimer(); recalc(); setOpen(true) }
  const scheduleHide = () => { clearCloseTimer(); closeTimer.current = setTimeout(() => setOpen(false), 150) }

  useEffect(() => () => clearCloseTimer(), [])

  return { open, rect, anchorRef, show, scheduleHide }
}

function useClickFixedPopover() {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const recalc = useCallback(() => {
    if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect())
  }, [])

  const toggle = () => {
    if (!open) recalc()
    setOpen(o => !o)
  }
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    recalc()
    const handleOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) close()
    }
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', handleOutside)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      window.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open, recalc])

  return { open, rect, anchorRef, toggle, close }
}

/* ── Availability hover popover ───────────────────────────────────────── */
function AvailabilityCell({ variants }: { variants: ProductVariantLite[] }) {
  const { open, rect, anchorRef, show, scheduleHide } = useHoverFixedPopover()

  if (!hasRealVariants(variants)) {
    const qty = variants[0]?.inventory_qty || 0
    const { text, className } = getQtyDisplay(qty)
    return <span className={`text-sm ${className}`}>{text}</span>
  }

  const total = variants.reduce((s, v) => s + (v.inventory_qty || 0), 0)

  return (
    <div
      ref={anchorRef}
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <span className="inline-flex cursor-default items-center gap-1 text-sm font-semibold text-slate-900">
        {total}
        <IconChevronDown className={`text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </span>

      {open && rect && (
        <div
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed',
            top: rect.bottom + 10,
            left: rect.left + rect.width / 2,
            transform: 'translateX(-50%)',
            zIndex: 9999,
          }}
          className="w-72 overflow-visible rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white" />

          <div className="relative rounded-2xl bg-white">
            <div className="grid grid-cols-3 gap-3 border-b border-slate-100 px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Variant</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">On shelf</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">In progress</span>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {variants.map((v, i) => {
                const label = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || 'Default'
                const qty = v.inventory_qty || 0
                const { text, className } = getQtyDisplay(qty)
                return (
                  <div key={i} className="grid grid-cols-3 gap-3 px-4 py-2">
                    <span className="truncate text-sm text-slate-600">{label}</span>
                    <span className={`text-sm ${className}`}>{text}</span>
                    <span className="text-sm text-slate-400">0</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Row actions (3-dot menu) ─────────────────────────────────────────── */
function RowActionsMenu({
  product, productLink, onEdit, onDuplicate, onDelete, deleting,
}: {
  product: Product
  productLink: string
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const { open, rect, anchorRef, toggle, close } = useClickFixedPopover()
  const MENU_WIDTH = 208 // w-52
  const [copied, setCopied] = useState(false)

  const run = (fn: () => void) => { close(); fn() }

  const copyLink = async () => {
    if (!productLink) return
    try {
      await navigator.clipboard.writeText(productLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard قد ترفض بصمت — تجاهل */ }
  }

  return (
    <div ref={anchorRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          open ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <IconDots />
      </button>

      {open && rect && (
        <div
          role="menu"
          style={{ position: 'fixed', top: rect.bottom + 6, left: rect.right - MENU_WIDTH, zIndex: 9999 }}
          className="w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg ring-1 ring-black/5"
        >
          {productLink && (
            <a
              href={productLink}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span className="text-slate-400"><IconEye /></span> عرض المنتج
            </a>
          )}
          {productLink && (
            <button
              onClick={() => run(() => { copyLink() })}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span className="text-slate-400"><IconLink /></span>
              {copied ? '✓ اتنسخ اللينك' : 'نسخ اللينك المباشر'}
            </button>
          )}
          <button
            onClick={() => run(onEdit)}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <span className="text-slate-400"><IconEdit /></span> تعديل
          </button>
          <button
            onClick={() => run(onDuplicate)}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <span className="text-slate-400"><IconCopy /></span> نسخ
          </button>
          <div className="my-1.5 border-t border-slate-100" />
          <button
            onClick={() => run(onDelete)}
            disabled={deleting}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? <IconSpinner /> : <IconTrash />}
            حذف
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function ProductsPage() {
  const router = useRouter()
  const params = useParams()
  const storeSlug = (params?.storeSlug as string) || ''

  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  /* origin المتصفح — بنجيبها بعد الـ mount بس عشان منعملش hydration
     mismatch (window مش موجودة وقت الـ SSR). */
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setSearch(searchInput)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchProducts = async () => {
    setLoading(true)
    try {
      const qp = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) qp.set('search', search)
      if (status) qp.set('status', status)
      const res = await fetch(`/api/stores/products?${qp}`)
      const data = await res.json()
      setProducts(data.products || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProducts() }, [page, status, search])

  const toggleSelect = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(selected.size === products.length ? new Set() : new Set(products.map(p => p.id)))

  const goToEdit = (id: string) => router.push(`/stores-building/products/${id}/edit`)

  const deleteProduct = async (id: string) => {
    if (!confirm('Delete this product?')) return
    setDeleting(id)
    try { await fetch(`/api/stores/products/${id}`, { method: 'DELETE' }); fetchProducts() }
    finally { setDeleting(null) }
  }

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} products?`)) return
    await Promise.all([...selected].map(id => fetch(`/api/stores/products/${id}`, { method: 'DELETE' })))
    setSelected(new Set()); fetchProducts()
  }

  const duplicateProduct = async (id: string) => {
    await fetch(`/api/stores/products/${id}/duplicate`, { method: 'POST' })
    fetchProducts()
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* Header */}
        <div className="mb-7 flex items-start justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Products</h1>
          <a
            href="/stores-building/products/new"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add product
          </a>
        </div>

        {/* Filters */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch />
            </span>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="ابحث بالاسم أو SKU…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition-shadow placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div className="ml-auto inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-2">
            {STATUS_FILTERS.map(f => {
              const isActive = status === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => { setStatus(f.value); setPage(1) }}
                  aria-pressed={isActive}
                  className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-white hover:text-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <span className="text-[13px] font-semibold text-blue-700">{selected.size} selected</span>
            <button onClick={bulkDelete} className="text-[13px] font-medium text-red-600 hover:underline">Delete selected</button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-[13px] text-slate-500 hover:underline">Cancel</button>
          </div>
        )}

        {/* Table card */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <IconSpinner className="h-7 w-7 text-slate-300" />
              <span className="text-sm text-slate-400">Loading products…</span>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20">
              <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <IconBox />
              </div>
              <p className="text-[15px] font-semibold text-slate-700">No products yet</p>
              <p className="text-[13px] text-slate-400">Add your first product to get started</p>
              <a href="/stores-building/products/new" className="mt-3 rounded-xl bg-slate-900 px-4.5 py-2.5 text-[13px] font-semibold text-white">Add product</a>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="w-11 py-3.5 pl-4 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={selected.size === products.length && products.length > 0}
                      onChange={toggleAll}
                      className="h-[15px] w-[15px] cursor-pointer accent-slate-900"
                    />
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Product</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Category</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Price</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Availability</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Type</th>
                  <th className="w-14 py-3.5 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, idx) => {
                  const statusKey = normalizeStatus(product.status)
                  const cfg = STATUS_STYLES[statusKey] || STATUS_STYLES.draft
                  const isLast = idx === products.length - 1
                  const typeName = product.productType?.name ?? null
                  const priceDisplay = getPriceDisplay(product.variants || [])
                  const productLink = buildProductLink(product, storeSlug, origin)

                  return (
                    <tr
                      key={product.id}
                      onClick={() => goToEdit(product.id)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50 ${isLast ? '' : 'border-b border-slate-100'}`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 pl-4 pr-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(product.id)}
                          onChange={() => toggleSelect(product.id)}
                          className="h-[15px] w-[15px] cursor-pointer accent-slate-900"
                        />
                      </td>

                      {/* Product name + thumbnail */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3" title={product.title}>
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                            {product.images?.[0] ? (
                              <img src={product.images[0].url} alt={product.title} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-slate-300"><IconImagePlaceholder /></span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{product.title}</div>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5 text-[13px] text-slate-500">
                        {product.category || <span className="text-slate-300">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      </td>

                      {/* Price */}
                      <td className="px-4 py-3.5 text-sm font-semibold text-slate-900">
                        {priceDisplay || <span className="font-medium text-slate-400">N/A</span>}
                      </td>

                      {/* Availability */}
                      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <AvailabilityCell variants={product.variants || []} />
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3.5 text-[13px] text-slate-400">
                        {typeName || <span className="text-slate-200">—</span>}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pl-2 pr-4">
                        <RowActionsMenu
                          product={product}
                          productLink={productLink}
                          deleting={deleting === product.id}
                          onEdit={() => goToEdit(product.id)}
                          onDuplicate={() => duplicateProduct(product.id)}
                          onDelete={() => deleteProduct(product.id)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5">
              <span className="text-[13px] text-slate-400">Page {page} of {pages}</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
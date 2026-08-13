'use client'

import { useStoreOptional } from './StoreContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import {
  Bars3Icon, XMarkIcon, MagnifyingGlassIcon, ShoppingBagIcon, UserCircleIcon,
} from '@heroicons/react/24/outline'
import { API_URL } from '@/lib/config'

/* ── بناء شجرة القائمة من الـ flat list (بالاعتماد على parent_id) ── */
function buildMenuTree(flat: any[]) {
  const map = new Map<string, any>()
  flat.forEach((item) => map.set(String(item.id), { ...item, children: [] }))

  const roots: any[] = []
  flat.forEach((item) => {
    const node = map.get(String(item.id))
    const parentId = item.parent_id ? String(item.parent_id) : null
    if (parentId && map.has(parentId)) {
      map.get(parentId).children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortRec = (nodes: any[]) => {
    nodes.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

/* ── لوحة الـ dropdown — بترسم صف لكل عنصر، ولو العنصر عنده أبناء
     بترسم flyout جنبه (جهة اليمين) recursive لأي عمق تداخل ── */
function DropdownPanel({ items }: { items: any[] }) {
  return (
    <div
      style={{
        background: '#fff', border: '1px solid #eee', borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.12)', padding: 8, minWidth: 200,
      }}
    >
      {items.map((child: any) => (
        <DropdownRow key={child.id} item={child} />
      ))}
    </div>
  )
}

function DropdownRow({ item }: { item: any }) {
  const [open, setOpen] = useState(false)
  const hasChildren = item.children?.length > 0

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => hasChildren && setOpen(true)}
      onMouseLeave={() => hasChildren && setOpen(false)}
    >
      <Link
        href={item.url}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', borderRadius: 8, fontSize: 13.5, textDecoration: 'none',
          color: '#111', whiteSpace: 'nowrap', gap: 12,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f7f7f7')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        <span>{item.title}</span>
        {hasChildren && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </Link>

      {hasChildren && (
        // paddingLeft بدل marginLeft — بيقفل فجوة الـ hover عشان
        // الماوس ميخرجش من حدود الـ div وهو رايح للـ flyout
        <div
          style={{
            position: 'absolute', top: 0, left: '100%', paddingLeft: 6,
            opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden',
            transform: open ? 'translateX(0)' : 'translateX(-6px)',
            transition: 'opacity .15s, transform .15s', zIndex: 40,
          }}
        >
          <DropdownPanel items={item.children} />
        </div>
      )}
    </div>
  )
}

/* ── عنصر القائمة الرئيسي في الـ nav bar + أول dropdown ── */
function NavItemWithDropdown({ item }: { item: any }) {
  const [open, setOpen] = useState(false)
  const hasChildren = item.children?.length > 0

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => hasChildren && setOpen(true)}
      onMouseLeave={() => hasChildren && setOpen(false)}
    >
      <Link
        href={item.url}
        style={{ fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        {item.title}
        {hasChildren && (
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </Link>

      {hasChildren && (
        // paddingTop بدل marginTop — نفس السبب بالظبط
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, paddingTop: 8,
            opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden',
            transform: open ? 'translateY(0)' : 'translateY(-6px)',
            transition: 'opacity .15s, transform .15s', zIndex: 30,
          }}
        >
          <DropdownPanel items={item.children} />
        </div>
      )}
    </div>
  )
}

/* ── قائمة الموبايل — accordion recursive لأي عمق تداخل ── */
function MobileMenuTree({ items, onNavigate, depth = 0 }: { items: any[]; onNavigate: () => void; depth?: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      {items.map((item: any) => {
        const hasChildren = item.children?.length > 0
        const isOpen = expanded.has(String(item.id))
        return (
          <div key={item.id}>
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f5f5f5' }}>
              <Link
                href={item.url}
                onClick={onNavigate}
                style={{ flex: 1, display: 'block', padding: `14px 20px 14px ${20 + depth * 16}px`, fontSize: 14, textDecoration: 'none' }}
              >
                {item.title}
              </Link>
              {hasChildren && (
                <button
                  onClick={() => toggle(String(item.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px' }}
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
            </div>

            {hasChildren && isOpen && (
              <div style={{ background: '#fafafa' }}>
                <MobileMenuTree items={item.children} onNavigate={onNavigate} depth={depth + 1} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export default function Header({
  store,
  isMobile  = false,
  isPreview = false,
  onSearchOpen,
  onCartOpen,
  onMenuOpen,
}: {
  store: any
  isMobile?:  boolean
  isPreview?: boolean
  onSearchOpen?: () => void
  onCartOpen?:   () => void
  onMenuOpen?:   () => void
}) {
  /* ── State — يُستخدم فقط على الموقع الحقيقي (مش في الـ preview) ── */
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen]         = useState(false)
  const [cartOpen, setCartOpen]             = useState(false)
  const [scrolled, setScrolled]             = useState(false)

  const storeCtx = useStoreOptional()
  const cart = storeCtx?.cart ?? []
  const cartCount = storeCtx?.cartCount ?? 0
  const cartTotal = storeCtx?.cartTotal ?? 0
  const removeFromCart = storeCtx?.removeFromCart ?? (() => {})
  const updateCartQty = storeCtx?.updateCartQty ?? (() => {})

  const router = useRouter()
  /* في preview الأدمن مفيش تنقّل حقيقي — بنمنع الزرار من عمل حاجة هناك */
  const handleCheckout = () => {
    if (isPreview) return
    setCartOpen(false)
    router.push(`/store/${store.slug}/checkout`)
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!searchOpen) { setSearchQuery(''); setSearchResults([]); return }
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) return
    const q = searchQuery.trim()
    if (!q) { setSearchResults([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`${API_URL}/stores/api/storefront/${store.slug}/products?search=${encodeURIComponent(q)}&limit=6`)
        .then((r) => r.json())
        .then((data) => setSearchResults(data.products || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery, searchOpen, store.slug])

  /* الـ preview يستخدم callbacks — الموقع الحقيقي يستخدم state محلي */
  const handleMenuOpen   = () => isPreview ? onMenuOpen?.()   : setMobileMenuOpen(true)
  const handleSearchOpen = () => isPreview ? onSearchOpen?.() : setSearchOpen(true)
  const handleCartOpen   = () => isPreview ? onCartOpen?.()   : setCartOpen(true)

  const theme = store?.theme || {}
  const h     = theme?.header || {}
  const menu  = store?.menus?.find((m: any) => String(m.id) === String(h.menuId))
           || store?.menus?.find((m: any) => m.items?.length > 0)
  const items = menu?.items || []
  const menuTree = useMemo(() => buildMenuTree(items), [items])

  const logoPos    = h.logoPosition   || 'left'
  const menuPos    = h.menuPosition   || 'center'
  const menuRow    = h.menuRow        || 'top'
  const searchPos  = h.searchPosition || 'right'
  const searchRow  = h.searchRow      || 'top'
  const showSearch = !!h.showSearch
  const rowH       = h.desktopHeight  || 80
  const divPx      = Math.min(5, Number(h.dividerThickness || 0))
  const borderPx   = Math.min(5, Number(h.borderThickness  || 0))

  // أضف بعد state الـ scrolled
const [isMobileScreen, setIsMobileScreen] = useState(false)
useEffect(() => {
  const check = () => setIsMobileScreen(window.innerWidth < 1024)
  check()
  window.addEventListener('resize', check)
  return () => window.removeEventListener('resize', check)
}, [])

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  /* ── Search Slot ──────────────────────────────────────────────────── */
  type SearchSlot = 'left-standalone' | 'left-after-logo' | 'right-after-logo' | 'right-before-icons' | 'bottom-row'
  let searchSlot: SearchSlot | null = null
  if (showSearch) {
    if (menuRow === 'bottom' && searchRow === 'bottom') {
      searchSlot = 'bottom-row'
    } else if (searchPos === 'left') {
      searchSlot = logoPos === 'left' ? 'left-after-logo' : 'left-standalone'
    } else {
      searchSlot = logoPos === 'right' ? 'right-after-logo' : 'right-before-icons'
    }
  }

  const ctnStyle: React.CSSProperties =
    h.width === 'full'
      ? { paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' }
      : { maxWidth: 1280, marginLeft: 'auto', marginRight: 'auto', paddingLeft: 24, paddingRight: 24, width: '100%', boxSizing: 'border-box' }

  /* ── العناصر الأساسية ──────────────────────────────────────────────── */
  const LogoEl = h.logo
    ? <img src={h.logo} alt={store.name}
           style={{ width: h.logoWidth || 160, display: 'block', objectFit: 'contain', flexShrink: 0 }} />
    : <Link href="/"
            style={{ fontWeight: 700, fontSize: 22, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {store.name}
      </Link>

  const NavEl = (
  <nav style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
    {menuTree.map((item: any) => (
      <NavItemWithDropdown key={item.id} item={item} />
    ))}
  </nav>
)

  const SearchIcon = (
    <button onClick={handleSearchOpen} aria-label="بحث"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}>
      <MagnifyingGlassIcon style={{ width: 20, height: 20 }} />
    </button>
  )

  const IconsGroup = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
      {h.showAccount && (
        <button aria-label="الحساب"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
          <UserCircleIcon style={{ width: 20, height: 20 }} />
        </button>
      )}
      {h.showCart && (
        <button onClick={handleCartOpen} aria-label="السلة"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', position: 'relative' }}>
          <ShoppingBagIcon style={{ width: 20, height: 20 }} />
          {!isPreview && cartCount > 0 && (
            <span style={{
              position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16, borderRadius: 999,
              background: '#DC2626', color: '#fff', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1,
            }}>
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </button>
      )}
    </span>
  )

  /* ── بناء الأعمدة ──────────────────────────────────────────────────── */
  const leftItems:   React.ReactNode[] = []
  const centerItems: React.ReactNode[] = []
  const rightItems:  React.ReactNode[] = []

  if (searchSlot === 'left-standalone') leftItems.push(<span key="search-ls">{SearchIcon}</span>)
  if (logoPos === 'left') {
    leftItems.push(<span key="logo">{LogoEl}</span>)
    if (searchSlot === 'left-after-logo') leftItems.push(<span key="search-al">{SearchIcon}</span>)
  }
  if (menuPos === 'left') leftItems.push(<span key="menu">{NavEl}</span>)

  if (logoPos === 'center') centerItems.push(<span key="logo">{LogoEl}</span>)
  if (menuPos === 'center') centerItems.push(<span key="menu">{NavEl}</span>)

  if (logoPos === 'right') {
    rightItems.push(<span key="logo">{LogoEl}</span>)
    if (searchSlot === 'right-after-logo') rightItems.push(<span key="search-ar">{SearchIcon}</span>)
  }
  if (menuPos === 'right') rightItems.push(<span key="menu">{NavEl}</span>)
  if (searchSlot === 'right-before-icons') rightItems.push(<span key="search-bi">{SearchIcon}</span>)
  rightItems.push(<span key="icons">{IconsGroup}</span>)

  /* ── isMobile overrides ────────────────────────────────────────────── */
  const showIfMobile: React.CSSProperties = isPreview
  ? { display: isMobile ? 'flex' : 'none' }
  : {}   // ← الموقع الحقيقي: Tailwind (lg:hidden / hidden lg:flex) بيتحكم
const hideIfMobile: React.CSSProperties = isPreview
  ? { display: isMobile ? 'none' : 'flex' }
  : {}

  /* ═══════════════════════════════════════════════════════════════════
     صف واحد (menuRow = 'top')
  ═══════════════════════════════════════════════════════════════════ */
  const SingleRow = (
    <div style={{ ...ctnStyle, height: rowH, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', columnGap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifySelf: 'start', minWidth: 0 }}>
        <button onClick={handleMenuOpen} className="lg:hidden"
                style={{ ...showIfMobile, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
          <Bars3Icon style={{ width: 24, height: 24 }} />
        </button>
        <div className="hidden lg:flex" style={{ ...hideIfMobile, alignItems: 'center', gap: 16, minWidth: 0 }}>
          {leftItems}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, justifySelf: 'center', whiteSpace: 'nowrap' }}>
        {centerItems}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifySelf: 'end' }}>
        <div className="flex lg:hidden" style={{ ...showIfMobile, alignItems: 'center', gap: 16 }}>
          {showSearch && SearchIcon}
          {IconsGroup}
        </div>
        <div className="hidden lg:flex" style={{ ...hideIfMobile, alignItems: 'center', gap: 16 }}>
          {rightItems}
        </div>
      </div>
    </div>
  )

  /* ═══════════════════════════════════════════════════════════════════
     صفين (menuRow = 'bottom')
  ═══════════════════════════════════════════════════════════════════ */
  const topLeftItems:   React.ReactNode[] = []
  const topRightItems:  React.ReactNode[] = []
  const topCenterItems: React.ReactNode[] = []

  if (searchSlot === 'left-standalone') topLeftItems.push(<span key="search-ls">{SearchIcon}</span>)
  if (logoPos === 'left') {
    topLeftItems.push(<span key="logo">{LogoEl}</span>)
    if (searchSlot === 'left-after-logo') topLeftItems.push(<span key="search-al">{SearchIcon}</span>)
  }
  if (logoPos === 'center') topCenterItems.push(<span key="logo">{LogoEl}</span>)
  if (logoPos === 'right') {
    topRightItems.push(<span key="logo">{LogoEl}</span>)
    if (searchSlot === 'right-after-logo') topRightItems.push(<span key="search-ar">{SearchIcon}</span>)
  }
  if (searchSlot === 'right-before-icons') topRightItems.push(<span key="search-bi">{SearchIcon}</span>)
  topRightItems.push(<span key="icons">{IconsGroup}</span>)

  const StackedLayout = (
    <div>
      <div style={{ ...ctnStyle, height: rowH, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', columnGap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifySelf: 'start' }}>
          <button onClick={handleMenuOpen} className="lg:hidden"
                  style={{ ...showIfMobile, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            <Bars3Icon style={{ width: 24, height: 24 }} />
          </button>
          <div className="hidden lg:flex" style={{ ...hideIfMobile, alignItems: 'center', gap: 12 }}>
            {topLeftItems}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifySelf: 'center' }}>
          {topCenterItems}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifySelf: 'end' }}>
          <div className="flex lg:hidden" style={{ ...showIfMobile, alignItems: 'center', gap: 16 }}>
            {showSearch && SearchIcon}
            {IconsGroup}
          </div>
          <div className="hidden lg:flex" style={{ ...hideIfMobile, alignItems: 'center', gap: 16 }}>
            {topRightItems}
          </div>
        </div>
      </div>

      {divPx > 0 && (
        h.dividerWidth === 'full'
          ? <div style={{ borderTop: `${divPx}px solid ${h.borderColor || '#e5e5e5'}` }} />
          : <div style={ctnStyle}><div style={{ borderTop: `${divPx}px solid ${h.borderColor || '#e5e5e5'}` }} /></div>
      )}

      <div className="hidden lg:flex"
           style={{ ...hideIfMobile, ...ctnStyle, paddingTop: 12, paddingBottom: 12, alignItems: 'center', gap: 16 }}>
        {searchSlot === 'bottom-row' && searchPos === 'left' && SearchIcon}
        {menuPos === 'left'   && NavEl}
        {menuPos === 'center' && <div style={{ margin: '0 auto' }}>{NavEl}</div>}
        {menuPos === 'right'  && <div style={{ marginLeft: 'auto' }}>{NavEl}</div>}
        {searchSlot === 'bottom-row' && searchPos === 'right' && (
          <div style={{ marginLeft: menuPos !== 'right' ? 'auto' : undefined }}>{SearchIcon}</div>
        )}
      </div>
    </div>
  )

  /* ══════════════════════════════════════════════════════════════════════
   Mobile Layout — ثابت دايماً بغض النظر عن إعدادات الكمبيوتر
   menuRow, menuPosition, logoPosition, searchPosition كلها للكمبيوتر بس
══════════════════════════════════════════════════════════════════════ */
if (isMobile && isPreview) {
  return (
    <>
      {h.announcementBar?.enabled && (
        <a
          href={h.announcementBar.link || '#'}
          style={{
            display: 'block', textAlign: 'center', padding: '8px 16px', fontSize: 14,
            background: h.announcementBar.background || '#000',
            color: h.announcementBar.color || '#fff', textDecoration: 'none',
          }}
        >
          {h.announcementBar.text}
        </a>
      )}

      <header
        className={h.sticky ? 'sticky top-0 z-40' : ''}
        style={{
          background: h.background || '#fff',
          color: h.textColor || '#111',
          borderBottom: borderPx > 0 ? `${borderPx}px solid ${h.borderColor || '#e5e5e5'}` : undefined,
        }}
      >
        <div
          style={{
            ...ctnStyle,
            height: h.mobileHeight || 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* يسار: زر القائمة */}
          <button
            onClick={handleMenuOpen}
            aria-label="القائمة"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
          >
            <Bars3Icon style={{ width: 24, height: 24 }} />
          </button>

          {/* وسط: اللوجو */}
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            {h.logo ? (
              <img
                src={h.logo}
                alt={store.name}
                style={{ width: h.mobileLogoWidth || 120, display: 'block', objectFit: 'contain' }}
              />
            ) : (
              <Link href="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {store.name}
              </Link>
            )}
          </div>

          {/* يمين: بحث + أيقونات */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            {showSearch && SearchIcon}
            {IconsGroup}
          </span>
        </div>
      </header>
    </>
  )
}

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <>
      {h.announcementBar?.enabled && (
        <a href={h.announcementBar.link || '#'}
           style={{ display: 'block', textAlign: 'center', padding: '8px 16px', fontSize: 14,
                    background: h.announcementBar.background || '#000',
                    color: h.announcementBar.color || '#fff', textDecoration: 'none' }}>
          {h.announcementBar.text}
        </a>
      )}

      <header className={h.sticky ? 'sticky top-0 z-40' : ''}
              style={{ background: h.background || '#fff', color: h.textColor || '#111',
                       backdropFilter: scrolled ? 'blur(8px)' : undefined, transition: 'backdrop-filter 0.3s' }}>
        {menuRow === 'top' ? SingleRow : StackedLayout}
        {borderPx > 0 && <div style={{ height: borderPx, background: h.borderColor || '#e5e5e5' }} />}
      </header>

      {/* ══════════════════════════════════════════════════════════════
          الـ Overlays تُرسم هنا فقط على الموقع الحقيقي (position: fixed)
          في الـ preview، الـ StoreFrontRenderer يرسمها بـ position: absolute
      ══════════════════════════════════════════════════════════════ */}
      {!isPreview && (
        <>
          {/* Mobile Drawer */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, transition: 'visibility 0.2s',
                        visibility: mobileMenuOpen ? 'visible' : 'hidden' }}>
            <div onClick={() => setMobileMenuOpen(false)}
                 style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: 300,
                          background: '#fff', boxShadow: '4px 0 24px rgba(0,0,0,0.15)',
                          transition: 'transform 0.3s',
                          transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)' }}>
              <div style={{ padding: 20, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>القائمة</span>
                <button onClick={() => setMobileMenuOpen(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <XMarkIcon style={{ width: 24, height: 24 }} />
                </button>
              </div>
              <MobileMenuTree items={menuTree} onNavigate={() => setMobileMenuOpen(false)} />
            </div>
          </div>

          {/* Search Modal — ديسكتوب */}
                {isMobileScreen ? (
            /* موبايل: Shopify-style opacity fade — شاشة كاملة */
            <div
              style={{
                position:      'fixed', inset: 0, zIndex: 60,
                opacity:       searchOpen ? 1 : 0,
                pointerEvents: searchOpen ? 'auto' : 'none',
                transition:    'opacity 0.25s ease',
                background:    '#fff',
                display:       'flex',
                flexDirection: 'column',
              }}
            >
              {/* شريط البحث */}
              <div
                style={{
                  padding:      '14px 16px',
                  borderBottom: '1px solid #e5e5e5',
                  display:      'flex',
                  alignItems:   'center',
                  gap:          10,
                }}
              >
                <MagnifyingGlassIcon style={{ width: 20, height: 20, color: '#888', flexShrink: 0 }} />
                <input
                    autoFocus={searchOpen}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث عن منتجات..."
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent' }}
                  />
                <button
                  onClick={() => setSearchOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                >
                  <XMarkIcon style={{ width: 22, height: 22, color: '#555' }} />
                </button>
              </div>
              {/* منطقة النتائج */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
                {searchQuery.trim() === '' ? (
                  <p style={{ color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 14 }}>ابدأ الكتابة للبحث</p>
                ) : searching ? (
                  <p style={{ color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 14 }}>جاري البحث...</p>
                ) : searchResults.length === 0 ? (
                  <p style={{ color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 14 }}>لا توجد نتائج</p>
                ) : (
                  searchResults.map((p: any) => (
                    <Link key={p.id} href={`/store/${store.slug}/products/${p.handle}`} onClick={() => setSearchOpen(false)}
                          style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f2f2f2', textDecoration: 'none', color: '#111' }}>
                      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: '#f5f5f5' }}>
                        {p.images?.[0]?.url && <img src={p.images[0].url} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.title}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* كمبيوتر: مودال متمركز */
            searchOpen && (
              <div
                onClick={() => setSearchOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.4)' }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: '#fff', maxWidth: 560, margin: '60px auto 0',
                    borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontWeight: 600, fontSize: 18 }}>بحث</span>
                    <button onClick={() => setSearchOpen(false)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                      <XMarkIcon style={{ width: 24, height: 24 }} />
                    </button>
                  </div>
                  <input
                    autoFocus
                    placeholder="ابحث عن منتجات..."
                    style={{
                      width: '100%', border: '1px solid #e5e5e5', borderRadius: 10,
                      padding: '12px 16px', fontSize: 15, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )
          )}

          {/* Cart Drawer */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, transition: 'visibility 0.2s', visibility: cartOpen ? 'visible' : 'hidden' }}>
            <div onClick={() => setCartOpen(false)}
                 style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
            <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 360, maxWidth: '90vw',
                          background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
                          transition: 'transform 0.3s', display: 'flex', flexDirection: 'column',
                          transform: cartOpen ? 'translateX(0)' : 'translateX(100%)' }}>
              <div style={{ padding: 20, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 18 }}>
                  سلة التسوق {cartCount > 0 ? `(${cartCount})` : ''}
                </span>
                <button onClick={() => setCartOpen(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <XMarkIcon style={{ width: 24, height: 24 }} />
                </button>
              </div>

              {cart.length === 0 ? (
                <div style={{ padding: 24, color: '#999', textAlign: 'center', marginTop: 40 }}>
                  السلة فارغة
                </div>
              ) : (
                <>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
                    {cart.map((item) => (
                      <div key={item.variantId} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #f2f2f2' }}>
                        <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: '#f5f5f5' }}>
                          {item.image && (
                            <img src={item.image} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                          </p>
                          {item.variantTitle && (
                            <p style={{ fontSize: 12, color: '#999', margin: '2px 0 0' }}>{item.variantTitle}</p>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #eee', borderRadius: 8 }}>
                              <button onClick={() => updateCartQty(item.variantId, item.qty - 1)}
                                      style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>−</button>
                              <span style={{ fontSize: 13, minWidth: 16, textAlign: 'center' }}>{item.qty}</span>
                              <button onClick={() => updateCartQty(item.variantId, item.qty + 1)}
                                      style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>+</button>
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>
                              {(item.price * item.qty).toLocaleString('en-US')}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => removeFromCart(item.variantId)} aria-label="إزالة"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', alignSelf: 'flex-start' }}>
                          <XMarkIcon style={{ width: 16, height: 16 }} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: 20, borderTop: '1px solid #eee', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontSize: 14, fontWeight: 700 }}>
                      <span>الإجمالي</span>
                      <span>{cartTotal.toLocaleString('en-US')}</span>
                    </div>
                    <button
                      onClick={handleCheckout}
                      disabled={isPreview}
                      style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                               background: '#111', color: '#fff', fontWeight: 700,
                               cursor: isPreview ? 'not-allowed' : 'pointer', fontSize: 14,
                               opacity: isPreview ? 0.6 : 1 }}
                    >
                      إتمام الشراء
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
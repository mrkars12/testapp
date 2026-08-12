'use client'

import { useState, useEffect } from 'react'

import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { ThemeData, ThemeSection } from '../page'
import Header from '@/app/store/[slug]/components/Header'

import {
  SlideshowSection,
  HeroSection,
  ProductGridSection,
  FeaturedCollectionSection,
  NewsletterSection,
  RichTextSection,
  TextBannerSection,
} from '@/app/store/[slug]/components/Sections'

interface LivePreviewProps {
  storeSlug: string
  store: any
  theme: ThemeData
  sections: ThemeSection[]
  onSelectSection?: (section: any) => void
  selectedSectionId?: string | null
  isPreviewMode?: boolean
  isMobile?: boolean
}

export default function LivePreview({
  storeSlug,
  store,
  theme,
  sections,
  onSelectSection,
  selectedSectionId,
  isPreviewMode = false,
  isMobile = false,
}: LivePreviewProps) {
  return (
    <StoreFrontRenderer
      store={store}
      theme={theme}
      sections={sections}
      storeSlug={storeSlug}
      onSelectSection={onSelectSection}
      selectedSectionId={selectedSectionId}
      isPreviewMode={isPreviewMode}
      isMobile={isMobile}
    />
  )
}

/* ══════════════════════════════════════════════════════════════════════
   StoreFrontRenderer
══════════════════════════════════════════════════════════════════════ */
function StoreFrontRenderer({
  store,
  theme,
  sections,
  storeSlug,
  onSelectSection,
  selectedSectionId,
  isPreviewMode,
  isMobile,
}: {
  store: any
  theme: ThemeData
  sections: ThemeSection[]
  storeSlug: string
  onSelectSection?: (section: any) => void
  selectedSectionId?: string | null
  isPreviewMode?: boolean
  isMobile?: boolean
}) {
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [cartOpen,   setCartOpen]   = useState(false)

  useEffect(() => {
    const { headingFont, bodyFont } = theme?.typography || {}
    const fonts = [...new Set([headingFont, bodyFont].filter(Boolean))]
    if (!fonts.length) return

    const id = 'theme-editor-fonts'
    let link = document.getElementById(id) as HTMLLinkElement
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    const query = fonts.map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')
    link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`
  }, [theme?.typography?.headingFont, theme?.typography?.bodyFont])

  const h     = (theme?.header as any) || {}
  const items: any[] =
    store?.menus?.find((m: any) => String(m.id) === String(h.menuId))?.items
    ?? store?.menus?.find((m: any) => m.items?.length > 0)?.items
    ?? []

  const activeSections = sections
    ?.filter((s: any) => (s.isActive ?? s.is_active) === true)
    ?.sort((a: any, b: any) => (a.sort_order || a.sortOrder) - (b.sort_order || b.sortOrder))

  return (
    <div
      style={{
        position:      'relative',
        overflow:      'hidden',
        height:        '100%',
        display:       'flex',
        flexDirection: 'column',
        backgroundColor: theme?.colors?.background || '#ffffff',
        ['--color-primary'        as any]: theme?.colors?.primary        || '#2563eb',
        ['--color-secondary'      as any]: theme?.colors?.secondary      || '#64748b',
        ['--color-accent'         as any]: theme?.colors?.accent         || '#f59e0b',
        ['--color-background'     as any]: theme?.colors?.background     || '#ffffff',
        ['--color-surface'        as any]: theme?.colors?.surface        || '#f8fafc',
        ['--color-border'         as any]: theme?.colors?.border         || '#e2e8f0',
        ['--color-text-primary'   as any]: theme?.colors?.textPrimary    || '#0f172a',
        ['--color-text-secondary' as any]: theme?.colors?.textSecondary  || '#64748b',
        ['--color-text-muted'     as any]: theme?.colors?.textMuted      || '#94a3b8',
        ['--color-header-bg'      as any]: theme?.colors?.headerBg       || '#ffffff',
        ['--color-header-text'    as any]: theme?.colors?.headerText     || '#0f172a',
        ['--color-footer-bg'      as any]: theme?.colors?.footerBg       || '#0f172a',
        ['--color-footer-text'    as any]: theme?.colors?.footerText     || '#ffffff',
        ['--font-heading'  as any]: `'${theme?.typography?.headingFont || 'Inter'}', sans-serif`,
        ['--font-body'     as any]: `'${theme?.typography?.bodyFont    || 'Inter'}', sans-serif`,
        ['--base-size'     as any]: theme?.typography?.baseSize || '16px',
        ['--font-h1'       as any]: theme?.typography?.h1Size   || '2.5rem',
        ['--font-h2'       as any]: theme?.typography?.h2Size   || '2rem',
        ['--font-h3'       as any]: theme?.typography?.h3Size   || '1.5rem',
        ['--line-height'   as any]: theme?.typography?.lineHeight || 1.6,
        fontFamily: `'${theme?.typography?.bodyFont || 'Inter'}', sans-serif`,
        fontSize:    theme?.typography?.baseSize || '16px',
        lineHeight:  theme?.typography?.lineHeight || 1.6,
        color:       theme?.colors?.textPrimary || '#0f172a',
      }}
    >
      {!isPreviewMode && (
        <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-center">
          <span className="text-xs font-medium text-amber-800">Preview Mode</span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Header */}
        <Header
          store={{ ...store, theme }}
          isMobile={isMobile}
          isPreview={true}
          onMenuOpen={()   => setMenuOpen(true)}
          onSearchOpen={() => setSearchOpen(true)}
          onCartOpen={()   => setCartOpen(true)}
        />

        {/* Sections */}
        <main>
          {activeSections?.length > 0 ? (
            activeSections.map((section: any) => (
              <SectionWrapper
                key={section.id}
                section={section}
                store={store}
                theme={theme}
                isSelected={selectedSectionId === section.id}
                isPreviewMode={isPreviewMode}
                onSelect={() => onSelectSection?.(section)}
                isMobile={isMobile}   /* ← CRITICAL: must be forwarded */
              />
            ))
          ) : (
            <div className="py-20 text-center text-gray-400">
              <p>No active sections</p>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer
          className="py-12 px-6"
          style={{
            backgroundColor: theme?.colors?.footerBg || '#0f172a',
            color:            theme?.colors?.footerText || '#ffffff',
          }}
        >
          <div className="max-w-7xl mx-auto text-center">
            <h3 className="text-lg font-bold mb-2">{store?.name || storeSlug}</h3>
            <p className="opacity-70 text-sm">© 2026 All rights reserved</p>
          </div>
        </footer>
      </div>

      {/* ── Menu Drawer — conditionally rendered (React way, no CSS tricks) */}
      {menuOpen && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50 }}>
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }}
          />
          <div
            style={{
              position: 'absolute', left: 0, top: 0,
              height: '100%', width: '75%', maxWidth: 280,
              background: '#fff',
              boxShadow: '4px 0 24px rgba(0,0,0,0.15)',
              overflowY: 'auto',
            }}
          >
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #eee',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Menu</span>
              <button
                onClick={() => setMenuOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <XMarkIcon style={{ width: 22, height: 22 }} />
              </button>
            </div>
            {items.map((item: any) => (
              <Link
                key={item.id}
                href={item.url}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'block', padding: '14px 20px',
                  borderBottom: '1px solid #f3f3f3',
                  fontSize: 14, textDecoration: 'none', color: 'inherit',
                }}
              >
                {item.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Search ──────────────────────────────────────────────────── */}
      {isMobile ? (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 60,
            opacity:       searchOpen ? 1 : 0,
            pointerEvents: searchOpen ? 'auto' : 'none',
            transition:    'opacity 0.25s ease',
            background:    '#fff',
            display:       'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{
            padding:      '14px 16px',
            borderBottom: '1px solid #e5e5e5',
            display:      'flex',
            alignItems:   'center',
            gap:          10,
          }}>
            <MagnifyingGlassIcon style={{ width: 20, height: 20, color: '#888', flexShrink: 0 }} />
            <input
              autoFocus={searchOpen}
              placeholder="Search"
              style={{
                flex:       1,
                border:     'none',
                outline:    'none',
                fontSize:   15,
                background: 'transparent',
              }}
            />
            <button
              onClick={() => setSearchOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
            >
              <XMarkIcon style={{ width: 22, height: 22, color: '#555' }} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
            <p style={{ color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
              No products found.
            </p>
          </div>
        </div>
      ) : (
        searchOpen && (
          <div
            onClick={() => setSearchOpen(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.4)' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#fff', maxWidth: 520, margin: '50px auto 0',
                borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontWeight: 600, fontSize: 18 }}>Search</span>
                <button onClick={() => setSearchOpen(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <XMarkIcon style={{ width: 24, height: 24 }} />
                </button>
              </div>
              <input
                autoFocus
                placeholder="Search products..."
                style={{
                  width: '100%', border: '1px solid #e5e5e5', borderRadius: 10,
                  padding: '12px 16px', fontSize: 15, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )
      )}

      {/* ── Cart Drawer — conditionally rendered (React way, no CSS tricks) */}
      {cartOpen && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50 }}>
          <div
            onClick={() => setCartOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }}
          />
          <div
            style={{
              position: 'absolute', right: 0, top: 0,
              height: '100%', width: '80%', maxWidth: 340,
              background: '#fff',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #eee',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Cart</span>
              <button
                onClick={() => setCartOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <XMarkIcon style={{ width: 22, height: 22 }} />
              </button>
            </div>
            <div style={{ padding: 24, color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 14 }}>
              Your cart is empty
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══ SectionWrapper ═══════════════════════════════════════════════════ */
function SectionWrapper({ section, store, theme, isSelected, isPreviewMode, onSelect, isMobile }: any) {
  const [isHovered, setIsHovered] = useState(false)
  const showOverlay = !isPreviewMode && (isHovered || isSelected)

  return (
    <div
      className={`relative transition-all duration-200 ${showOverlay ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => { if (!isPreviewMode) { e.stopPropagation(); onSelect?.() } }}
    >
      {showOverlay && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full z-50 flex items-center gap-1 bg-gray-900 text-white rounded-t-lg px-2 py-1.5 shadow-lg">
          <span className="text-xs font-medium px-2 border-l border-gray-700">
            {getSectionLabel(section.type)}
          </span>
          <span className="text-xs text-gray-400">{section.name}</span>
        </div>
      )}
      {/* Pass isMobile down to the renderer */}
      <SectionRenderer section={section} store={store} theme={theme} isMobile={isMobile} />
    </div>
  )
}

/* ══ SectionRenderer ══════════════════════════════════════════════════ */
// NOTE: isMobile MUST be forwarded to SlideshowSection or mobile images won't show.
function SectionRenderer({ section, isMobile }: any) {
  const { type, settings } = section
  switch (type) {
    case 'hero':                return <HeroSection settings={settings} />
    case 'featured_collection': return <FeaturedCollectionSection settings={settings} />
    case 'product_grid':        return <ProductGridSection settings={settings} />
    case 'newsletter':          return <NewsletterSection settings={settings} />
    case 'rich_text':           return <RichTextSection settings={settings} />
    case 'text_banner':         return <TextBannerSection settings={settings} />
    case 'slideshow':           return <SlideshowSection settings={settings} isMobile={isMobile} />
    default:                    return null
  }
}

function getSectionLabel(type: string): string {
  const labels: Record<string, string> = {
    hero: 'Main Banner', featured_collection: 'Featured Collection',
    product_grid: 'Product Grid', text_banner: 'Text Banner',
    image_banner: 'Image Banner', newsletter: 'Newsletter',
    rich_text: 'Rich Text', testimonials: 'Testimonials',
    video: 'Video', slideshow: 'Slideshow',
  }
  return labels[type] || type
}

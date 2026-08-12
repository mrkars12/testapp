'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { Monitor, Smartphone } from 'lucide-react'

import ThemeSidebar from './components/ThemeSidebar'
import SectionsPanel from './components/SectionsPanel'
import SectionEditor from './components/SectionEditor'
import ColorPicker from './components/ColorPicker'
import TypographyEditor from './components/TypographyEditor'
import HeaderEditor from './components/HeaderEditor'
import LivePreview from './components/LivePreview'

export type EditorTab = 'sections' | 'colors' | 'typography' | 'header' | 'footer'

export interface ThemeColors {
  primary: string; secondary: string; accent: string; background: string
  surface: string; textPrimary: string; textSecondary: string; textMuted: string
  border: string; headerBg: string; headerText: string; footerBg: string; footerText: string
}

export interface ThemeTypography {
  headingFont: string; bodyFont: string; baseSize: string; scale: number
  h1Size: string; h2Size: string; h3Size: string; lineHeight: number; letterSpacing: string
}

export interface ThemeHeader {
  logo: string; logoPosition: 'left' | 'center' | 'right'
  menuPosition: 'left' | 'center' | 'right'; menuRow: 'top' | 'bottom'
  menuId: string | null; searchRow: 'top' | 'bottom'
  logoWidth: number; mobileLogoWidth: number; sticky: boolean
  showSearch: boolean; showAccount: boolean; showCart: boolean
  desktopHeight: number; mobileHeight: number; borderWidth: 'page' | 'full'
  searchPosition: 'left' | 'right'; background: string; textColor: string; borderColor: string
  dividerThickness: number; dividerWidth: 'page' | 'full'; borderThickness: number
  announcementBar: { enabled: boolean; text: string; link: string; background: string; color: string }
}

export interface ThemeData {
  colors: ThemeColors; typography: ThemeTypography; header: ThemeHeader; footer: any
}

export interface ThemeSection {
  id: string; type: string; name: string; settings: any
  blocks: any[]; sortOrder: number; isActive: boolean; pageType: string
}

const DEFAULT_COLORS: ThemeColors = {
  primary: '#2563eb', secondary: '#64748b', accent: '#f59e0b', background: '#ffffff',
  surface: '#f8fafc', textPrimary: '#0f172a', textSecondary: '#64748b', textMuted: '#94a3b8',
  border: '#e2e8f0', headerBg: '#ffffff', headerText: '#0f172a', footerBg: '#0f172a', footerText: '#ffffff',
}

const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  headingFont: 'Inter', bodyFont: 'Inter', baseSize: '16px', scale: 1.25,
  h1Size: '2.5rem', h2Size: '2rem', h3Size: '1.5rem', lineHeight: 1.6, letterSpacing: 'normal',
}

const DEFAULT_HEADER: ThemeHeader = {
  logo: '', logoPosition: 'left', menuPosition: 'center', menuRow: 'top', menuId: null,
  logoWidth: 160, mobileLogoWidth: 120, sticky: true, showSearch: true, showAccount: true,
  showCart: true, desktopHeight: 80, mobileHeight: 64, searchRow: 'top',
  dividerThickness: 0, dividerWidth: 'page', borderThickness: 0, borderWidth: 'full',
  background: '#ffffff', textColor: '#111111', borderColor: '#e5e5e5',
  announcementBar: { enabled: false, text: '', link: '', background: '#000000', color: '#ffffff' },
}

function mergeThemeData(raw: any): ThemeData {
  if (!raw) return null as any
  return {
    colors: { ...DEFAULT_COLORS, ...(raw?.colors || {}) },
    typography: { ...DEFAULT_TYPOGRAPHY, ...(raw?.typography || {}) },
    header: { ...DEFAULT_HEADER, ...(raw?.header || {}) },
    footer: raw?.footer || {},
  }
}

export default function ThemeEditorPage() {
  const { storeSlug } = useParams()
  const [activeTab, setActiveTab] = useState<EditorTab>('sections')
  const [theme, setTheme] = useState<ThemeData | null>(null)
  const [sections, setSections] = useState<ThemeSection[]>([])
  const [selectedSection, setSelectedSection] = useState<ThemeSection | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [error, setError] = useState<string | null>(null)
  const [storeData, setStoreData] = useState<any>(null)
  const [deletedSections, setDeletedSections] = useState<string[]>([])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadTheme = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const [themeRes, sectionsRes, storesRes, menusRes] = await Promise.all([
        api.get('/stores/theme'),
        api.get('/stores/theme/sections?pageType=home'),
        api.get('/stores'),
        api.get('/stores/menus'),
      ])
      setTheme(mergeThemeData(themeRes.data))
      setSections((sectionsRes.data || []).map((s: any) => ({
        ...s, id: String(s.id), sortOrder: s.sort_order, isActive: s.is_active, pageType: s.page_type,
      })))
      const store = storesRes.data?.[0]
      setStoreData({ ...store, menus: menusRes.data || [] })
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [storeSlug])

  useEffect(() => { loadTheme() }, [loadTheme])


  const handleAddSection = (type: string, index?: number) => {
    const newSection: ThemeSection = {
      id: `temp-${Date.now()}`, type, name: getSectionName(type),
      settings: getDefaultSettings(type), blocks: [],
      sortOrder: index !== undefined ? index : sections.length, isActive: true, pageType: 'home',
    }
    setSections((prev) => {
      const next = [...prev]
      if (index !== undefined) { next.splice(index, 0, newSection); return next.map((s, i) => ({ ...s, sortOrder: i })) }
      return [...prev, newSection]
    })
    setSelectedSection(newSection); setDirty(true)
  }

  const handleUpdateSection = (sectionId: string, updates: Partial<ThemeSection>) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, ...updates } : s)))
    if (selectedSection?.id === sectionId) setSelectedSection((prev) => prev ? { ...prev, ...updates } : null)
    setDirty(true)
  }

  const handleDeleteSection = (sectionId: string) => {
    setDeletedSections(prev => [...prev, sectionId])
    setSections(prev => prev.filter(s => s.id !== sectionId))
    setDirty(true)
  }

  const handleToggleSection = (sectionId: string, isActive: boolean) => handleUpdateSection(sectionId, { isActive })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sections.findIndex((s) => s.id === active.id)
    const newIndex = sections.findIndex((s) => s.id === over.id)
    setSections(arrayMove(sections, oldIndex, newIndex).map((s, i) => ({ ...s, sortOrder: i })))
    setDirty(true)
  }

  const handleUpdateColors = (colors: ThemeColors) => { setTheme((p) => p ? { ...p, colors } : null); setDirty(true) }
  const handleUpdateTypography = (typography: ThemeTypography) => { setTheme((p) => p ? { ...p, typography } : null); setDirty(true) }
  const handleUpdateHeader = (header: ThemeHeader) => { setTheme((p) => p ? { ...p, header } : null); setDirty(true) }

  const handleSave = async () => {
    if (!theme) { alert('لا يوجد ثيم للحفظ'); return }
    setSaving(true); setError(null)
    try {
      await api.put('/stores/theme', { colors: theme.colors, typography: theme.typography, header: theme.header, footer: theme.footer })
      const tempSections = sections.filter((s) => s.id.startsWith('temp-'))
      const existingSections = sections.filter((s) => !s.id.startsWith('temp-'))
      const createdSections: ThemeSection[] = []
      for (const s of tempSections) {
        const res = await api.post('/stores/theme/sections', { type: s.type, name: s.name, settings: s.settings, blocks: s.blocks, sortOrder: s.sortOrder, pageType: s.pageType })
        createdSections.push(res.data)
      }
      for (const s of existingSections) {
        await api.put(`/stores/theme/sections/${s.id}`, { name: s.name, settings: s.settings, blocks: s.blocks, sortOrder: s.sortOrder, isActive: s.isActive })
      }
      const allSections = [...existingSections, ...createdSections]
      for (const sectionId of deletedSections) await api.delete(`/stores/theme/sections/${sectionId}`)
      await api.put('/stores/theme/sections/reorder', { sections: allSections.map((s, i) => ({ id: s.id, sortOrder: i })) })
      await api.post('/stores/theme/publish')
      setDeletedSections([]); setDirty(false); await loadTheme()
      alert('تم الحفظ بنجاح!')
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'فشل الحفظ'
      setError(msg); alert('فشل الحفظ: ' + msg)
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500">جاري تحميل الثيم...</p>
      </div>
    </div>
  )

  if (error && !theme) return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center p-8 bg-red-50 rounded-xl border border-red-200 max-w-md">
        <p className="text-red-600 mb-4">{error}</p>
        <button onClick={loadTheme} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">إعادة المحاولة</button>
      </div>
    </div>
  )

  const safeTheme = theme || { colors: DEFAULT_COLORS, typography: DEFAULT_TYPOGRAPHY, header: DEFAULT_HEADER, footer: {} }

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">

      {/* ══ Top Bar ══════════════════════════════════════════════════ */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0 sticky top-0 z-50">

        {/* يسار */}
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900">محرر الثيم</h1>
          <span className="text-sm text-gray-500">{storeSlug}</span>
          {dirty && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">تغييرات غير محفوظة</span>}
        </div>

        {/* وسط: Desktop / Mobile toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setPreviewDevice('desktop')}
            title="وضع الكمبيوتر"
            className={`p-2 rounded-md transition-all ${previewDevice === 'desktop' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Monitor size={18} />
          </button>
          <button
            onClick={() => setPreviewDevice('mobile')}
            title="وضع الموبايل"
            className={`p-2 rounded-md transition-all ${previewDevice === 'mobile' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Smartphone size={18} />
          </button>
        </div>

        {/* يمين */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isPreviewMode ? 'bg-blue-600 text-white' : 'border border-gray-300 hover:bg-gray-50 text-gray-700'}`}
          >
            {isPreviewMode ? 'إغلاق المعاينة' : 'معاينة'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-6 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-red-600 text-sm text-center">{error}</div>}

      {/* ══ Main Content ═════════════════════════════════════════════ */}
            {/* ══ Main Content ═════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden min-w-0">

        {/* ── Sidebar يسار ─────────────────────────────────────────── */}
        {!isPreviewMode && (
          <div
            className="w-72 bg-white border-r shrink-0 flex flex-col overflow-hidden"
            style={{ height: '100%', position: 'sticky', top: 0 }}
          >
            {/* Tabs */}
            <ThemeSidebar activeTab={activeTab} onTabChange={setActiveTab} />

            {/* محتوى السايدبار — يسكرول */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="p-5 pb-24">
                {activeTab === 'sections' && (
                  <SectionsPanel
                    sections={sections} selectedSection={selectedSection}
                    onSelect={setSelectedSection} onAdd={handleAddSection}
                    onDelete={handleDeleteSection} onToggle={handleToggleSection}
                    onDragEnd={handleDragEnd} sensors={sensors}
                  />
                )}
                {activeTab === 'colors'     && <ColorPicker colors={safeTheme.colors} onChange={handleUpdateColors} />}
                {activeTab === 'typography' && <TypographyEditor typography={safeTheme.typography} onChange={handleUpdateTypography} />}
                {activeTab === 'header'     && <HeaderEditor header={safeTheme.header} menus={storeData?.menus || []} onChange={handleUpdateHeader} />}
              </div>
            </div>
          </div>
        )}

        {/* ══ منطقة المعاينة ══════════════════════════════════════════ */}
        <div className="flex-1 overflow-hidden bg-gray-100 flex items-start justify-center p-1.5 min-w-0">
          <div
            style={{
              position:     'relative',
              width:        previewDevice === 'mobile' ? 390 : '100%',
              maxWidth:     previewDevice === 'mobile' ? 390 : '1280px',
              height:       'calc(100dvh - 56px - 32px)',
              overflow:     'hidden',
              transition:   'width 0.3s ease',
              borderRadius: previewDevice === 'mobile' ? 20 : 8,
              boxShadow:    '0 8px 32px rgba(0,0,0,0.14)',
              background:   '#fff',
            }}
          >
            <LivePreview
              storeSlug={String(storeSlug)}
              store={storeData}
              theme={safeTheme}
              sections={sections}
              isPreviewMode={isPreviewMode}
              selectedSectionId={selectedSection?.id || null}
              onSelectSection={setSelectedSection}
              isMobile={previewDevice === 'mobile'}
            />
          </div>
        </div>

        {/* ── Sidebar يمين ──────────────────────────────────────────── */}
        {!isPreviewMode && selectedSection && activeTab === 'sections' && (
          <div
            className="w-72 bg-white border-l shrink-0 flex flex-col overflow-hidden"
            style={{ height: '100%', position: 'sticky', top: 0 }}
          >
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="p-5 pb-24">
                <SectionEditor
                  section={selectedSection}
                  onChange={(u) => handleUpdateSection(selectedSection.id, u)}
                />
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function getSectionName(type: string): string {
  const names: Record<string, string> = {
    hero: 'بانر رئيسي', featured_collection: 'مجموعة مميزة', product_grid: 'شبكة منتجات',
    text_banner: 'بانر نصي', image_banner: 'بانر صور', newsletter: 'نشرة بريدية',
    rich_text: 'نص منسق', testimonials: 'آراء العملاء', video: 'فيديو', slideshow: 'عرض شرائح',
  }
  return names[type] || type
}

function getDefaultSettings(type: string): any {
  const defaults: Record<string, any> = {
    hero: {
      title: 'Welcome to Our Store',
      subtitle: 'Discover our latest products',
      buttonText: 'Shop Now',
      buttonLink: '/collections/all',
      imageUrl: '',
      overlayOpacity: 0.4,
      textAlignment: 'center',
      height: 'medium',
    },
    featured_collection: {
      title: 'Featured Products',
      collectionId: '',
      productsLimit: 4,
      columns: 4,
      showPrice: true,
      showQuickAdd: true,
    },
    product_grid: {
      title: 'All Products',
      collectionId: '',
      productsLimit: 8,
      columns: 4,
      pagination: true,
    },
    text_banner: {
      text: 'Free shipping on orders over $50',
      backgroundColor: '#000000',
      textColor: '#ffffff',
      fontSize: 'medium',
      link: '',
    },
    newsletter: {
      title: 'Subscribe to Our Newsletter',
      subtitle: 'Get the latest offers and news',
      buttonText: 'Subscribe',
      successMessage: 'Thank you for subscribing!',
    },
    rich_text: {
      title: 'Section Title',
      content: 'Write your content here...',
      alignment: 'center',
    },
    slideshow: {
      // ← sliderStyle MUST be set here or the style picker won't know which is active
      sliderStyle: 'classic',
      slides: [
        {
          id: `slide-${Date.now()}`,
          imageUrl: '',
          mobileImageUrl: '',        // ← required for mobile image to work
          title: 'First Slide Title',
          subtitle: 'Add an engaging description for your products here',
          buttonText: 'Shop Now',
          buttonLink: '/collections/all',
          buttonStyle: 'filled',
        },
        {
          id: `slide-${Date.now() + 1}`,
          imageUrl: '',
          mobileImageUrl: '',
          title: 'Second Slide Title',
          subtitle: 'Exclusive deals and offers',
          buttonText: 'Discover More',
          buttonLink: '/collections/sale',
          buttonStyle: 'outline',
        },
      ],
      autoPlay: true,
      autoPlaySpeed: 4000,
      showArrows: true,
      arrowStyle: 'circle',
      showDots: true,
      // dotStyle now applies to EVERY slider style. Options:
      // 'circle' | 'line' | 'number' | 'thumbnail' | 'bar' | 'segments'
      // ('bar' & 'segments' are rectangular loading indicators under the image)
      dotStyle: 'circle',
      textAlignment: 'center',        // centered — content sits in the middle of the image
      thumbnailStripAlign: 'center',  // centre the thumbnail row (right / center / left)
      overlayOpacity: 0.45,
      height: 'large',
      // ── Content Style (new) ────────────────────────────────────────────
      // Applied to ALL 5 slider types via helpers in Sections.tsx.
      // title/subtitle/button: absent value = element not rendered (React).
      verticalPosition: 'center', // 'top' | 'center' | 'bottom' — vertical
                                  // position of the content block (incl. a
                                  // button-only slide) over the image.
                                  // center = level with the slider arrows.
      titleSize:    'lg',      // 'sm' | 'md' | 'lg' | 'xl'
      subtitleSize: 'md',      // 'sm' | 'md' | 'lg'
      btnShape:     'rounded', // 'pill' | 'rounded' | 'square'
      btnColor:     '',        // hex — empty = falls back to --color-primary
    },
  }
  return defaults[type] || {}
}


function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const next = [...array]
  const [removed] = next.splice(from, 1)
  next.splice(to, 0, removed)
  return next
}
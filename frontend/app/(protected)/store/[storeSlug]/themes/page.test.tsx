import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import ThemeEditorPage from './page'
import { __resetStoreBootstrapForTests } from '@/lib/storeBootstrap'

// This is the exact regression this page was reported for: opening
// /store/<slug>/themes DIRECTLY (no Dashboard/Sidebar visit
// first) must load real theme data on its own — it must NOT depend on
// StoreSwitcher (a Sidebar-only component, never rendered by this
// full-screen editor route) having run first. This test deliberately
// renders ONLY <ThemeEditorPage/> — no Sidebar, no StoreSwitcher — to
// prove the page is self-sufficient. The store now comes from the URL
// segment, which is available on the very first render, so the page has
// nothing to wait for before fetching.
vi.mock('next/navigation', () => ({
  useParams: () => ({ storeSlug: 'easy-orders' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('./components/ThemeSidebar', () => ({ default: () => <div /> }))
vi.mock('./components/SectionsPanel', () => ({ default: () => <div /> }))
vi.mock('./components/SectionEditor', () => ({ default: () => <div /> }))
vi.mock('./components/ColorPicker', () => ({ default: () => <div /> }))
vi.mock('./components/TypographyEditor', () => ({ default: () => <div /> }))
vi.mock('./components/HeaderEditor', () => ({ default: () => <div /> }))
vi.mock('./components/LivePreview', () => ({ default: () => <div /> }))

const RESPONSES: Record<string, any> = {
  '/stores/theme': { colors: {}, typography: {}, header: {}, footer: {} },
  '/stores/menus': [],
}

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: {
      get: vi.fn(async (url: string) => {
        if (url === '/stores') {
          return { data: [{ id: 1, name: 'Easy Orders', slug: 'easy-orders' }] }
        }
        if (url.startsWith('/stores/theme/sections')) return { data: [] }
        return { data: RESPONSES[url] ?? {} }
      }),
    },
  }
})

describe('ThemesPage direct load — no Sidebar/StoreSwitcher mounted', () => {
  beforeEach(() => {
    __resetStoreBootstrapForTests()
    // A real deep link would have the layout mirror this before the page
    // renders; set it directly since the layout isn't in this tree.
  })

  afterEach(cleanup)

  it('loads the theme of the store its URL names, without visiting Dashboard first', async () => {
    render(<ThemeEditorPage />)

    // No infinite "جاري تحميل الثيم..." — the page reads the store from
    // the URL and reaches real content on its own.
    await waitFor(() => expect(screen.queryByText('جاري تحميل الثيم...')).toBeNull(), { timeout: 3000 })

    expect(screen.getByText('easy-orders')).toBeTruthy()
  })
})

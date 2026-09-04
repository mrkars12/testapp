import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Sidebar from './Sidebar'
import { useStoreBootstrap, __resetStoreBootstrapForTests } from '@/lib/storeBootstrap'

let mockParams: Record<string, string> = {}
let mockPathname = '/verify-email'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => mockParams,
  usePathname: () => mockPathname,
}))

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Merchant' }, logout: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, default: { get: vi.fn(async () => ({ data: [] })), patch: vi.fn() } }
})

const STORES = [
  { id: 2, name: 'Test Shop', slug: 'test123c', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 1, name: 'DartPay', slug: 'dartpay', createdAt: '2024-01-01T00:00:00.000Z', is_default: true },
]

function hrefOf(label: string): string | null {
  const link = screen.getByText(label).closest('a')
  return link?.getAttribute('href') ?? null
}

beforeEach(() => {
  mockParams = {}
  mockPathname = '/verify-email'
  __resetStoreBootstrapForTests()
  useStoreBootstrap.setState({ status: 'ready', stores: STORES, error: null })
})

afterEach(cleanup)

/**
 * Store-route split (Part 7/8): "المتاجر" (store grid) and "إضافة متجر"
 * (create store) used to live in the main sidebar. Both are store-agnostic
 * actions, and they now live exclusively in the Store Switcher — a second
 * entry point in the main nav for the same two actions was redundant, and
 * the task explicitly requires the main sidebar not to carry them anymore.
 */
describe('Sidebar no longer carries store-agnostic actions', () => {
  it('does not render "المتاجر" or "إضافة متجر" anywhere in the main nav', () => {
    render(<Sidebar />)
    expect(screen.queryByText('المتاجر')).toBeNull()
    expect(screen.queryByText('إضافة متجر')).toBeNull()
  })
})

/**
 * Dashboard is the store ROOT — a distinct destination from every section
 * beneath it, and must never share active state with Products (or any
 * other section) just because the URL happens to start with the same
 * store-scoped prefix.
 */
describe('Sidebar Dashboard is the store root, not a slug-free /dashboard route, and never co-activates with a section', () => {
  it('links Dashboard to the active store root', () => {
    mockParams = { storeSlug: 'test123c' }
    mockPathname = '/store/test123c'
    render(<Sidebar />)
    expect(hrefOf('Dashboard')).toBe('/store/test123c')
  })

  it('is active at the store root and NOT active on a section page', () => {
    mockParams = { storeSlug: 'test123c' }
    mockPathname = '/store/test123c/products'
    render(<Sidebar />)

    const dashboardLink = screen.getByText('Dashboard').closest('a')
    const productsLink = screen.getByText('Products').closest('a')
    // The active highlight is the plain (non-"hover:") class — every link
    // carries the "hover:bg-[...]" variant regardless of active state, so
    // that substring alone can't distinguish them.
    const activeHighlight = /(?<!hover:)bg-\[hsl\(240_4\.8%_95\.9%\)\]/
    expect(productsLink?.className).toMatch(activeHighlight)
    expect(dashboardLink?.className).not.toMatch(activeHighlight)
  })
})

describe('Sidebar store-scoped links carry the active store', () => {
  beforeEach(() => {
    mockParams = { storeSlug: 'test123c' }
    mockPathname = '/store/test123c/products'
  })

  it.each([
    ['Products', 'products'],
    ['Orders', 'orders'],
    ['Collections', 'collections'],
    ['Menus', 'menus'],
    ['Pages', 'pages'],
    ['Themes', 'themes'],
    ['Settings', 'settings'],
  ])('points %s at the active store\'s own %s page', (label, section) => {
    render(<Sidebar />)
    expect(hrefOf(label)).toBe(`/store/test123c/${section}`)
  })

  it('points Payments at the active store\'s payment settings', () => {
    render(<Sidebar />)
    expect(hrefOf('Payments')).toBe('/store/test123c/settings/payments')
  })

  it('never points a store-scoped link at Products except Products itself', () => {
    // The reported symptom: clicking Orders/Settings/Payments ended up on
    // Products. Every non-Products item must keep its own section.
    render(<Sidebar />)
    for (const label of ['Orders', 'Collections', 'Menus', 'Pages', 'Themes', 'Settings', 'Payments']) {
      expect(hrefOf(label)).not.toMatch(/\/products$/)
    }
  })
})

/**
 * On store-agnostic routes the URL names no store. Links used to fall back
 * to slug-free stubs, so each click rendered a redirect spinner, fetched
 * the store list, then navigated again — a visible double navigation.
 */
describe('Sidebar resolves a store on store-agnostic routes', () => {
  it('builds direct store-scoped links from the default store, with no redirect hop', () => {
    mockParams = {}
    mockPathname = '/verify-email'

    render(<Sidebar />)

    // dartpay is the explicit default; the links resolve to it directly
    // rather than pointing at `/store/orders` and bouncing.
    expect(hrefOf('Orders')).toBe('/store/dartpay/orders')
    expect(hrefOf('Products')).toBe('/store/dartpay/products')
    expect(hrefOf('Payments')).toBe('/store/dartpay/settings/payments')
  })

  it('prefers the URL slug over the default when the URL names a store', () => {
    // The default must never override the store the user is actually in.
    mockParams = { storeSlug: 'test123c' }
    mockPathname = '/store/test123c/orders'

    render(<Sidebar />)
    expect(hrefOf('Orders')).toBe('/store/test123c/orders')
  })

  it('falls back to the slug-free stub only when no store can be resolved', () => {
    // Store list still loading, or the user owns nothing. The stub exists
    // precisely for this case.
    useStoreBootstrap.setState({ status: 'loading', stores: [], error: null })
    mockParams = {}
    mockPathname = '/verify-email'

    render(<Sidebar />)
    expect(hrefOf('Orders')).toBe('/store/orders')
  })
})

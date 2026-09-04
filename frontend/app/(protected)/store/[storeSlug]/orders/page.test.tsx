import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import OrdersPage from './page'
import { __resetStoreBootstrapForTests } from '@/lib/storeBootstrap'

const router = { push: vi.fn(), replace: vi.fn() }
let mockParams: Record<string, string> = {}
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => mockParams,
}))

const ORDERS_BY_STORE: Record<string, { order_number: string }[]> = {
  'easy-orders': [{ order_number: 'EO-1' }],
  'test-store': [{ order_number: 'TS-1' }],
}

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: {
      get: vi.fn(async (url: string) => {
        if (url === '/stores') {
          return {
            data: Object.keys(ORDERS_BY_STORE).map((slug, i) => ({ id: i + 1, name: slug, slug })),
          }
        }
        const slug = actual.getStoreHeaders()['X-Store-Slug'] || ''
        const orders = ORDERS_BY_STORE[slug] || []
        return { data: { orders, total: orders.length, pages: 1 } }
      }),
    },
  }
})

// Orders stands in for the pattern every store-scoped admin section
// follows: it reads the active store from the `[storeSlug]` URL segment
// and loads only that store's data. Switching stores is a navigation to a
// new slug, so the assertion that matters is that no request for store A
// is ever answered with store B's rows on screen.
describe('OrdersPage loads the store its URL segment names', () => {
  beforeEach(() => {
    __resetStoreBootstrapForTests()
    mockParams = {}
    window.history.replaceState({}, '', '/')
  })

  afterEach(cleanup)

  it("loads the URL's store, and shows another store's orders only after navigating to it", async () => {
    // Both the route params AND the address bar name the store, because
    // that is what a real navigation does — and the request header is read
    // straight from the URL.
    mockParams = { storeSlug: 'easy-orders' }
    window.history.replaceState({}, '', '/store/easy-orders/orders')
    render(<OrdersPage />)

    await waitFor(() => screen.getByText('#EO-1'))
    expect(screen.queryByText('#TS-1')).toBeNull()

    // Switching stores navigates to `/store/test-store/orders`;
    // the `[storeSlug]` layout keys the subtree on the slug, so the page
    // is a fresh instance rather than the same one mutating in place.
    cleanup()
    mockParams = { storeSlug: 'test-store' }
    window.history.replaceState({}, '', '/store/test-store/orders')
    render(<OrdersPage />)

    await waitFor(() => screen.getByText('#TS-1'))
    // The decisive assertion: no store A row survives under store B.
    expect(screen.queryByText('#EO-1')).toBeNull()
  })
})

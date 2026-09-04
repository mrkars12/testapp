import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import StoreIndexPage from './page'
import StoreDashboardHome from './[storeSlug]/page'
import { __resetStoreBootstrapForTests } from '@/lib/storeBootstrap'

const push = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => mockStoreParams,
}))

let mockStoreParams: Record<string, string> = {}
let storesResponse: any[] = []
let listShouldFail = false

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: {
      get: vi.fn(async () => {
        if (listShouldFail) throw new Error('network')
        return { data: storesResponse }
      }),
      patch: vi.fn(async () => ({})),
    },
  }
})

beforeEach(() => {
  push.mockClear()
  replace.mockClear()
  listShouldFail = false
  storesResponse = []
  mockStoreParams = {}
  __resetStoreBootstrapForTests()
})

afterEach(cleanup)

/**
 * `/store` names no store, so it must resolve the user's
 * ORIGINAL / PRIMARY store and redirect into that store's dashboard. The
 * point of these is that the resolution is deterministic and comes from the
 * store data, not from array position or anything a previous session left
 * behind.
 */
describe('GET /store resolves the original store', () => {
  it('redirects to the ORIGINAL store, not the is_default one', async () => {
    // Mirrors the real QA account: `test123c` is the first store ever
    // created; `dartpay` is newer and merely carries the user-selected
    // default flag. Entering the dashboard must open the original.
    storesResponse = [
      { id: 1, name: 'Test', slug: 'test123c', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'DartPay', slug: 'dartpay', createdAt: '2025-01-01T00:00:00.000Z', is_default: true },
    ]
    render(<StoreIndexPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/test123c'))
    expect(replace).not.toHaveBeenCalledWith('/store/dartpay')
  })

  it('uses the earliest-created store when nothing is marked', async () => {
    storesResponse = [
      { id: 5, name: 'Newer', slug: 'newer', createdAt: '2025-09-09T00:00:00.000Z' },
      { id: 2, name: 'DartPay', slug: 'dartpay', createdAt: '2023-04-04T00:00:00.000Z' },
    ]
    render(<StoreIndexPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/dartpay'))
  })

  it('still resolves deterministically when no default is marked at all', async () => {
    // Nothing carries `is_default`. The original store is defined purely by
    // creation order, so this is unaffected.
    storesResponse = [
      { id: 9, name: 'Later', slug: 'later', createdAt: '2026-02-02T00:00:00.000Z' },
      { id: 3, name: 'Earlier', slug: 'earlier', createdAt: '2024-02-02T00:00:00.000Z' },
    ]
    render(<StoreIndexPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/earlier'))
  })

  it('redirects with the single store the user owns', async () => {
    storesResponse = [{ id: 1, name: 'Only', slug: 'only-store' }]
    render(<StoreIndexPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/only-store'))
  })

  it('shows the create-store flow, and redirects nowhere, with no stores', async () => {
    storesResponse = []
    render(<StoreIndexPage />)

    await waitFor(() => screen.getByText('لا يوجد متجر'))
    expect(screen.getByRole('button', { name: /إضافة متجر جديد/ })).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it('does not strand the user on a spinner when the store list fails', async () => {
    listShouldFail = true
    render(<StoreIndexPage />)

    // 'error' is terminal: with no list there is nothing to resolve, so the
    // create-store flow is the only actionable thing left to show.
    await waitFor(() => screen.getByText('لا يوجد متجر'))
    expect(replace).not.toHaveBeenCalled()
  })

  it('replaces rather than pushes, so Back does not re-run the redirect', async () => {
    storesResponse = [{ id: 1, name: 'Only', slug: 'only-store' }]
    render(<StoreIndexPage />)

    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('never persists the resolved store anywhere shared', async () => {
    // The redirect puts the slug in the URL and stops there. Writing it to
    // storage would make the *default* store a sticky global and break the
    // two-tab guarantee.
    storesResponse = [{ id: 1, name: 'Only', slug: 'only-store', is_default: true }]
    render(<StoreIndexPage />)

    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(document.cookie).not.toContain('only-store')
  })
})

/**
 * `/store/<slug>` is the store dashboard HOME. It renders; it does
 * not forward anywhere. These assert the page itself, since the old
 * redirect-shim assertions no longer describe it.
 */
describe('GET /store/[storeSlug] renders the dashboard root', () => {
  it('renders the store root without redirecting', async () => {
    storesResponse = [
      { id: 1, name: 'DartPay', slug: 'dartpay', currency: 'SAR', status: '1', createdAt: '2024-01-01T00:00:00.000Z' },
    ]
    mockStoreParams = { storeSlug: 'dartpay' }

    render(<StoreDashboardHome />)

    await waitFor(() => expect(screen.getByText('DartPay')).toBeTruthy())
    // Selecting a store must not bounce the user into the catalogue.
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('shows the slug from the URL before the store list resolves', () => {
    // The slug is authoritative immediately, so the heading is never blank
    // and never shows another store while loading.
    storesResponse = []
    mockStoreParams = { storeSlug: 'test123c' }

    render(<StoreDashboardHome />)
    expect(screen.getByText('/test123c')).toBeTruthy()
  })

  it('links every section under the store in the URL', async () => {
    storesResponse = [
      { id: 1, name: 'DartPay', slug: 'dartpay', createdAt: '2024-01-01T00:00:00.000Z' },
    ]
    mockStoreParams = { storeSlug: 'dartpay' }

    render(<StoreDashboardHome />)

    await waitFor(() => expect(screen.getByText('المنتجات')).toBeTruthy())
    const href = (label: string) => screen.getByText(label).closest('a')?.getAttribute('href')
    expect(href('المنتجات')).toBe('/store/dartpay/products')
    expect(href('الطلبات')).toBe('/store/dartpay/orders')
    expect(href('بوابات الدفع')).toBe('/store/dartpay/settings/payments')
    expect(href('التصميم')).toBe('/store/dartpay/themes')
  })

  it('does not claim the store is unknown while the list is still loading', async () => {
    storesResponse = []
    mockStoreParams = { storeSlug: 'dartpay' }

    render(<StoreDashboardHome />)
    // Before the fetch settles there is nothing to conclude.
    expect(screen.queryByText(/لم يتم العثور على هذا المتجر/)).toBeNull()
  })
})

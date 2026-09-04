import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import StoreSwitcher from './StoreSwitcher'
import { getStoreHeaders } from '@/lib/api'
import { __resetStoreBootstrapForTests } from '@/lib/storeBootstrap'

const push = vi.fn((path: string) => window.history.pushState({}, '', path))

let mockParams: Record<string, string> = {}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => mockParams,
}))

// Two stores whose display `name` deliberately does not match their real
// backend `slug`, so any code path that (wrongly) derives the active slug
// from the visible name/label instead of `store.slug` gets caught.
const STORES = [
  { id: 1, name: 'My Test Store', slug: 'store-a', is_default: true },
  { id: 2, name: 'Second Shop Display Name', slug: 'store-b', is_default: false },
]

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: {
      get: vi.fn(async () => ({ data: STORES })),
      patch: vi.fn(async () => ({})),
    },
  }
})

async function openAndPickSecondStore() {
  render(<StoreSwitcher />)
  fireEvent.click(screen.getByRole('button', { name: /My Test Store|جارٍ|اختر المتجر/ }))
  await waitFor(() => screen.getByText('Second Shop Display Name'))
  fireEvent.click(screen.getByText('Second Shop Display Name'))
}

/**
 * The store lives in the URL, so switching stores is a navigation. These
 * assert the slug that ends up in the URL comes from `store.slug` and not
 * from the visible display name, and that the user keeps their place in
 * the app across the switch.
 */
describe('StoreSwitcher navigates to the target store slug', () => {
  beforeEach(() => {
    push.mockClear()
    __resetStoreBootstrapForTests()
    mockParams = { storeSlug: 'store-a' }
    window.history.pushState({}, '', '/store/store-a/products')
  })

  afterEach(cleanup)

  it('navigates to the new slug and keeps the user on the same section', async () => {
    await openAndPickSecondStore()

    // Same section (products), new store — switching stores must not also
    // throw away where the user was.
    expect(push).toHaveBeenCalledWith('/store/store-b/products')
  })

  it('uses store.slug, never the display name, to build the URL', async () => {
    await openAndPickSecondStore()

    const target = push.mock.calls[0]?.[0]
    expect(target).toContain('store-b')
    expect(target).not.toContain('Second Shop Display Name')
  })

  it('preserves a nested section across the switch', async () => {
    mockParams = { storeSlug: 'store-a' }
    window.history.pushState({}, '', '/store/store-a/settings/payments')

    await openAndPickSecondStore()

    expect(push).toHaveBeenCalledWith('/store/store-b/settings/payments')
  })

  it('preserves a deep nested section across the switch', async () => {
    // The section regex captures the whole remainder, so arbitrarily deep
    // sections survive rather than collapsing to the first segment.
    mockParams = { storeSlug: 'store-a' }
    window.history.pushState({}, '', '/store/store-a/themes/editor')

    await openAndPickSecondStore()

    expect(push).toHaveBeenCalledWith('/store/store-b/themes/editor')
  })

  it('keeps the user on the store ROOT when the current URL names no section', async () => {
    // Store root -> store root. Selecting a store is not a request to open
    // Products; forcing a section here would mean the user can never move
    // between store home pages.
    mockParams = { storeSlug: 'store-a' }
    window.history.pushState({}, '', '/store/store-a')

    await openAndPickSecondStore()

    expect(push).toHaveBeenCalledWith('/store/store-b')
    expect(push).not.toHaveBeenCalledWith('/store/store-b/products')
  })

  it('never sends a store-root switch to Products', async () => {
    // Guards the specific regression: a switcher that appended a default
    // section made "select store" and "open catalogue" the same action.
    for (const path of ['/store/store-a', '/store/store-a/']) {
      push.mockClear()
      cleanup()
      __resetStoreBootstrapForTests()
      mockParams = { storeSlug: 'store-a' }
      window.history.pushState({}, '', path)

      await openAndPickSecondStore()

      const target = push.mock.calls[0]?.[0]
      expect(target, `from ${path}`).not.toMatch(/\/products$/)
    }
  })

  it('never sends the user to Products when they were somewhere else', async () => {
    // The regression this guards: a switcher that always navigates to the
    // dashboard default silently discards the user's place in the app.
    for (const section of ['orders', 'settings/payments', 'collections', 'menus']) {
      push.mockClear()
      cleanup()
      __resetStoreBootstrapForTests()
      mockParams = { storeSlug: 'store-a' }
      window.history.pushState({}, '', `/store/store-a/${section}`)

      await openAndPickSecondStore()

      expect(push).toHaveBeenCalledWith(`/store/store-b/${section}`)
    }
  })

  it('NEVER navigates to the post-login chooser (/select-store) — the switcher is the in-dashboard mechanism', async () => {
    for (const path of ['/store/store-a', '/store/store-a/orders', '/store/store-a/settings/payments']) {
      push.mockClear()
      cleanup()
      __resetStoreBootstrapForTests()
      mockParams = { storeSlug: 'store-a' }
      window.history.pushState({}, '', path)

      await openAndPickSecondStore()

      for (const call of push.mock.calls) {
        expect(String(call[0]), `from ${path}`).not.toContain('/select-store')
      }
    }
  })

  it('scopes requests to the store the URL names', async () => {
    // The header follows the URL segment, so after the switch navigation
    // every store-scoped request carries the new slug.
    window.history.pushState({}, '', '/store/store-b/products')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })
  })
})

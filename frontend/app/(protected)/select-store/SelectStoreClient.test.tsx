import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SelectStoreClient from './SelectStoreClient'
import { __resetStoreBootstrapForTests } from '@/lib/storeBootstrap'

const push = vi.fn()
const replace = vi.fn()
const logout = vi.fn()

/**
 * ONE router object, created once — not a fresh one per render.
 *
 * This mock used to be `useRouter: () => ({ push, replace })`, which
 * hands the component a NEW object on every single render. Next's real
 * `useRouter()` returns a stable, context-memoised handle, and
 * `SelectStoreClient` relies on that: it lists `router` in the
 * dependency array of the effect that resolves a 0-or-1-store visit.
 *
 * With an unstable identity that effect re-ran after every render, and
 * the effect is not inert — it calls `authedHome()`, which calls
 * `refreshStoreBootstrap()`, which is `ensureStoreBootstrap(force =
 * true)`, which unconditionally `setState`s. So:
 *
 *     render → new router → effect → authedHome → setState → render → …
 *
 * an unbounded async loop that allocated a promise chain and a recorded
 * `vi.fn` call on every pass. The worker died with
 * "FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript
 * heap out of memory", which vitest surfaces only as the much less
 * helpful "Worker exited unexpectedly".
 *
 * That is why the full frontend suite could never finish: 43 of 44
 * files passed and this one took the worker down with it, and the
 * failure looked environmental (a "sandbox worker crash") rather than
 * like the deterministic bug it is. It reproduces with this file run
 * entirely on its own.
 *
 * The fix is to honour the real hook's contract. A stable object is
 * strictly more faithful than an unstable one, so every assertion below
 * is unchanged and none is weakened.
 */
const router = { push, replace }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ logout }),
}))

let storesResponse: Array<Record<string, unknown>> = []

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: { get: vi.fn(async () => ({ data: storesResponse })), patch: vi.fn() },
  }
})

beforeEach(() => {
  push.mockClear()
  replace.mockClear()
  logout.mockClear()
  storesResponse = []
  __resetStoreBootstrapForTests()
})

afterEach(cleanup)

/**
 * `/select-store` is the dedicated post-login chooser for 2+ stores (Part
 * 11 of FINAL_ACCOUNT_LOGIN_STORE_ARCHITECTURE_REPORT.md) — distinct from
 * the removed `/store/all` permanent store-list page. It exists only to
 * pick a store, so selecting one must be a direct navigation with no
 * intermediate hop.
 */
describe('SelectStoreClient — the post-login multi-store chooser', () => {
  it('shows the required Arabic title and subtitle', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', currency: 'SAR', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', currency: 'USD', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('اختر المتجر')).toBeTruthy())
    expect(screen.getByText('اختر المتجر الذي تريد الوصول إليه')).toBeTruthy()
  })

  it('renders one card per store, with name, slug and currency', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', currency: 'SAR', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', currency: 'USD', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop A')).toBeTruthy())
    expect(screen.getByText('Shop B')).toBeTruthy()
    expect(screen.getByText('/shop-a')).toBeTruthy()
    expect(screen.getByText('SAR')).toBeTruthy()
    expect(screen.getByText('USD')).toBeTruthy()
  })

  it('selecting a card REPLACES the chooser history entry with /store/<slug> (no push, so Back cannot re-enter the chooser)', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop B')).toBeTruthy())
    fireEvent.click(screen.getByText('Shop B').closest('button')!)

    expect(replace).toHaveBeenCalledWith('/store/shop-b')
    expect(replace).toHaveBeenCalledTimes(1)
    // A `push` here is the bug: it would leave `/select-store` in history.
    expect(push).not.toHaveBeenCalled()
  })

  it('never shows a "تعيين كافتراضي" action or default-store badge', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', is_default: true, createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop A')).toBeTruthy())
    expect(screen.queryByText('تعيين كافتراضي')).toBeNull()
    expect(screen.queryByText('المتجر الافتراضي')).toBeNull()
  })

  it('resolves a direct visit with exactly one store straight into it, not a one-card chooser', async () => {
    storesResponse = [{ id: 1, name: 'Only', slug: 'only-store', createdAt: '2024-01-01T00:00:00.000Z' }]
    render(<SelectStoreClient />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/only-store'))
    expect(screen.queryByText('اختر المتجر')).toBeNull()
  })

  it('resolves a direct visit with zero stores into the create-store flow', async () => {
    storesResponse = []
    render(<SelectStoreClient />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/new'))
  })

  it('offers a "تسجيل الخروج" action that calls the real logout flow, not a bare /login navigation', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop A')).toBeTruthy())
    fireEvent.click(screen.getByText('تسجيل الخروج'))

    expect(logout).toHaveBeenCalledTimes(1)
    // The chooser must NOT roll its own "go to /login" — logout() owns that.
    expect(push).not.toHaveBeenCalledWith('/login')
    expect(replace).not.toHaveBeenCalledWith('/login')
  })

  it('never links to /store/all', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    const { container } = render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop A')).toBeTruthy())
    expect(screen.queryByText('عرض كل المتاجر')).toBeNull()
    expect(container.querySelector('a[href="/store/all"]')).toBeNull()
  })

  it('offers "+ إنشاء متجر جديد" to create another store', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop A')).toBeTruthy())
    fireEvent.click(screen.getByText('+ إنشاء متجر جديد'))
    expect(replace).toHaveBeenCalledWith('/store/new')
    expect(push).not.toHaveBeenCalled()
  })

  it('renders the "تسجيل الخروج" button visibly, separated from the store cards and the create-store link', async () => {
    storesResponse = [
      { id: 1, name: 'Shop A', slug: 'shop-a', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 2, name: 'Shop B', slug: 'shop-b', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    render(<SelectStoreClient />)

    await waitFor(() => expect(screen.getByText('Shop A')).toBeTruthy())
    const logoutBtn = screen.getByRole('button', { name: /تسجيل الخروج/ })
    expect(logoutBtn).toBeTruthy()
    // It sits in its own bordered footer block, after the create-store link.
    const footer = logoutBtn.closest('div')
    expect(footer?.className).toContain('border-t')
  })
})

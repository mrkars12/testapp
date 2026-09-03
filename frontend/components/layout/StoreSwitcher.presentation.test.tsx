import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import StoreSwitcher from './StoreSwitcher'
import { __resetStoreBootstrapForTests, orderStoresForDisplay } from '@/lib/storeBootstrap'
import api from '@/lib/api'

const push = vi.fn()
let mockParams: Record<string, string> = {}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => mockParams,
}))

// Deliberately adversarial: returned in an order that is WRONG for display,
// with the user-selected DEFAULT store (`dartpay`) sitting in the middle of
// the creation timeline. Any code that renders fetch order, reaches for
// `stores[0]`, or sorts `is_default` first fails here — the last of those
// being the actual regression this fixture guards.
const STORES = [
  { id: 3, name: 'Newest Shop', slug: 'newest', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 1, name: 'Oldest Shop', slug: 'oldest', createdAt: '2020-01-01T00:00:00.000Z' },
  { id: 2, name: 'DartPay', slug: 'dartpay', createdAt: '2024-01-01T00:00:00.000Z', is_default: true },
]

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: { get: vi.fn(async () => ({ data: STORES })), patch: vi.fn(async () => ({})) },
  }
})

async function openMenu() {
  render(<StoreSwitcher />)
  fireEvent.click(screen.getAllByRole('button')[0])
  // getAllBy, not getBy: when DartPay is the ACTIVE store its name also
  // appears on the collapsed trigger, so a single-match query throws.
  await waitFor(() => expect(screen.getAllByText('DartPay').length).toBeGreaterThan(0))
}

/**
 * The store rows inside the open menu, in DOM order.
 *
 * The collapsed trigger is excluded by its `aria-haspopup`: it renders the
 * ACTIVE store's name and slug too, so a naive text match picks it up as a
 * fourth "row" and puts the active store at index 0 regardless of the
 * real list order — which would make an ordering assertion pass or fail
 * for entirely the wrong reason.
 */
function storeRowsInOrder(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter((el) => el.getAttribute('aria-haspopup') !== 'menu')
    .filter((el) => /\/(dartpay|oldest|newest)\b/.test(el.textContent || ''))
}

beforeEach(() => {
  push.mockClear()
  __resetStoreBootstrapForTests()
  vi.mocked(api.get).mockResolvedValue({ data: STORES } as never)
  mockParams = { storeSlug: 'oldest' }
  window.history.pushState({}, '', '/store/oldest/products')
})

afterEach(cleanup)

/**
 * The switcher is the one place a merchant sees every store at once, so
 * which store is the DEFAULT and which is CURRENTLY OPEN both have to be
 * readable at a glance — and they are different facts.
 */
describe('StoreSwitcher presents stores in a deliberate order', () => {
  it('puts the ORIGINAL (first-created) store first, not the is_default one', async () => {
    await openMenu()

    const rows = storeRowsInOrder()
    expect(rows.length).toBe(3)
    // `Oldest Shop` (2020) is the original. `DartPay` carries is_default but
    // was created in 2024 — it must NOT be promoted to the top.
    expect(rows[0].textContent).toContain('Oldest Shop')
    expect(rows[0].textContent).not.toContain('DartPay')
  })

  it('orders the remaining stores by creation date, ignoring is_default', async () => {
    await openMenu()

    const rows = storeRowsInOrder()
    expect(rows[1].textContent).toContain('DartPay')
    expect(rows[2].textContent).toContain('Newest Shop')
  })

  it('renders the same order the dashboard entry redirect resolves', async () => {
    // The top row and the store `/store` redirects into must be
    // the same store; they share one comparator so they cannot drift.
    expect(orderStoresForDisplay(STORES)[0].slug).toBe('oldest')

    await openMenu()
    expect(storeRowsInOrder()[0].textContent).toContain('Oldest Shop')
  })
})

describe('StoreSwitcher marks ORIGINAL and ACTIVE, and drops "default" entirely', () => {
  it('labels the original store in words, not only a star', async () => {
    await openMenu()

    // A bare star means nothing to a user who does not know the convention.
    const originalRow = storeRowsInOrder().find((r) => r.textContent?.includes('Oldest Shop'))!
    expect(within(originalRow).getByText('المتجر الأصلي')).toBeTruthy()
  })

  it('marks the active store with its own separate indicator', async () => {
    await openMenu()

    // Scoped to the row: the collapsed trigger also reports the current
    // store, so a document-wide query legitimately matches twice.
    const activeRow = storeRowsInOrder().find((r) => r.textContent?.includes('Oldest Shop'))!
    expect(within(activeRow).getByText('الحالي')).toBeTruthy()
  })

  it('shows original and active on different rows when they differ', async () => {
    await openMenu()

    const rows = storeRowsInOrder()
    const dartpayRow = rows.find((r) => r.textContent?.includes('DartPay'))!
    const oldestRow = rows.find((r) => r.textContent?.includes('Oldest Shop'))!

    expect(within(dartpayRow).queryByText('الحالي')).toBeNull()
    expect(within(oldestRow).getByText('الحالي')).toBeTruthy()
  })

  /**
   * The active store is the URL alone (Part 10/19 of the store-route
   * split). "is_default"/"تعيين كافتراضي" used to be a separately editable
   * preference — exactly the second source of truth that principle rules
   * out — so the switcher neither shows nor offers it anymore, even for a
   * store the backend still marks `is_default` internally.
   */
  it('never shows "المتجر الافتراضي" or a "تعيين كافتراضي" action, even for an is_default store', async () => {
    await openMenu()

    for (const label of ['Oldest Shop', 'DartPay', 'Newest Shop']) {
      const row = storeRowsInOrder().find((r) => r.textContent?.includes(label))!
      expect(within(row).queryByText('المتجر الافتراضي')).toBeNull()
      expect(within(row).queryByText('تعيين كافتراضي')).toBeNull()
    }
  })

  it('never calls the set-default endpoint from anywhere in the switcher', async () => {
    await openMenu()
    expect(api.patch).not.toHaveBeenCalled()
  })
})


describe('StoreSwitcher chrome actions point at the right routes', () => {
  /**
   * `/store/all` (the old permanent "all stores" page) was removed
   * entirely — this menu already lists every store directly above, so a
   * second "see all stores" action pointed at a standalone product page
   * was exactly the invented landing surface the architecture forbids.
   */
  it('never shows "عرض كل المتاجر" or links to /store/all', async () => {
    await openMenu()
    expect(screen.queryByText('عرض كل المتاجر')).toBeNull()
    expect(push).not.toHaveBeenCalledWith('/store/all')
  })

  it('keeps "إنشاء متجر جديد" on the existing create-store route', async () => {
    await openMenu()
    fireEvent.click(screen.getByText('إنشاء متجر جديد'))

    expect(push).toHaveBeenCalledWith('/store/new')
  })
})

/**
 * The collapsed trigger is visible on every dashboard screen, so what it
 * says is the most-read text in this component.
 */
describe('StoreSwitcher trigger never asks for a store one already has', () => {
  it('shows the ORIGINAL store on store-agnostic routes instead of "اختر المتجر"', async () => {
    // A store-agnostic protected route (e.g. `/verify-email`) names no
    // store. Telling a merchant who owns three stores to "choose a store"
    // is wrong — the dashboard already knows which one it would open, and
    // that is the original store, not the default one.
    mockParams = {}
    window.history.pushState({}, '', '/verify-email')

    render(<StoreSwitcher />)
    const trigger = await waitFor(() => {
      const t = screen.getAllByRole('button')[0]
      expect(t.textContent).toContain('Oldest Shop')
      return t
    })

    expect(trigger.textContent).not.toContain('اختر المتجر')
    expect(trigger.textContent).toContain('المتجر الأصلي')
    expect(trigger.textContent).not.toContain('DartPay')
  })

  it('shows the store from the URL when the URL names one', async () => {
    mockParams = { storeSlug: 'newest' }
    window.history.pushState({}, '', '/store/newest/products')

    render(<StoreSwitcher />)
    await waitFor(() => {
      expect(screen.getAllByRole('button')[0].textContent).toContain('Newest Shop')
    })
    expect(screen.getAllByRole('button')[0].textContent).not.toContain('اختر المتجر')
  })

  it('names the dropdown as a store switcher', async () => {
    // The prompt to choose belongs on a menu the user deliberately opened.
    await openMenu()
    expect(screen.getByText('تبديل المتجر')).toBeTruthy()
  })
})


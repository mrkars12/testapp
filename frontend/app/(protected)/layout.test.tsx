import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import ProtectedLayout from './layout'
import { useAuthState } from '@/lib/authState'

const replace = vi.fn()
let mockPathname = '/verify-email'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace, push: vi.fn() }),
}))

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter' }),
  Cairo: () => ({ variable: '--font-cairo' }),
  Tajawal: () => ({ variable: '--font-tajawal' }),
}))

let mockUser: any = null
const refreshUser = vi.fn(async () => null)
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, isSessionReady: true, isLoading: false, refreshUser }),
}))

vi.mock('@/components/layout/Sidebar', () => ({ default: () => <div data-testid="merchant-shell-sidebar" /> }))
vi.mock('@/components/layout/TopMenu', () => ({ default: () => <div data-testid="merchant-shell-topmenu" /> }))
vi.mock('@/components/NotificationSound', () => ({ default: () => null }))
vi.mock('@/components/AuthGuard', () => ({ default: ({ children }: any) => children }))
vi.mock('@/components/StoreUnavailable', () => ({ default: () => <div data-testid="store-unavailable">هذه الصفحة غير متاحة</div> }))
vi.mock('@/components/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ fetchLatest: vi.fn(async () => {}) }) },
}))
vi.mock('@/components/balanceStore', () => ({
  useBalanceStore: { getState: () => ({ fetch: vi.fn(async () => {}) }) },
}))
vi.mock('@/lib/device', () => ({
  useDevicesStore: { getState: () => ({ fetchDevices: vi.fn(async () => {}) }) },
}))

let mockStores: Array<{ slug: string }> = []
let mockStoreStatus = 'ready'
vi.mock('@/lib/storeBootstrap', () => ({
  ensureStoreBootstrap: vi.fn(async () => {}),
  resolvePostAuthTarget: vi.fn(async () => '/store/resolved-store'),
  useStoreBootstrap: (sel: (s: { stores: unknown; status: string }) => unknown) =>
    sel({ stores: mockStores, status: mockStoreStatus }),
}))

const shell = () => screen.queryByTestId('merchant-shell-sidebar')
const rejected = () => screen.queryByTestId('store-unavailable')
const content = () => screen.queryByTestId('page-content')
const PAGE = <div data-testid="page-content">page</div>

beforeEach(() => {
  replace.mockClear()
  refreshUser.mockClear()
  mockUser = null
  mockStores = []
  mockStoreStatus = 'ready'
  mockPathname = '/verify-email'
  useAuthState.setState({ status: 'booting', sessionId: null })
})

afterEach(cleanup)

describe('ProtectedLayoutContent — unauthenticated access', () => {
  it('redirects an unauthenticated visitor away from a protected route to /login with intended', async () => {
    mockPathname = '/verify-email'
    useAuthState.setState({ status: 'unauthenticated', sessionId: null })
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?intended=/))
    })
  })

  it('redirects an unauthenticated visitor to /login preserving the exact store deep link', async () => {
    mockPathname = '/store/dartpay/orders'
    useAuthState.setState({ status: 'unauthenticated', sessionId: null })
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await vi.waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        `/login?intended=${encodeURIComponent('/store/dartpay/orders')}`,
      )
    })
  })
})

describe('ProtectedLayoutContent — email verification is three-state (UNKNOWN ≠ UNVERIFIED)', () => {
  it('a verified user (timestamp present) is NOT bounced to /verify-email', async () => {
    mockPathname = '/store/mine'
    mockUser = { id: 1, email_verified_at: '2026-01-01T00:00:00.000Z' }
    mockStores = [{ slug: 'mine' }]
    useAuthState.setState({ status: 'authenticated', sessionId: 's1' })
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(replace).not.toHaveBeenCalled()
    expect(content()).toBeTruthy()
  })

  it('a thin user object with NO email_verified_at key is treated as UNKNOWN — no redirect, holds a neutral blocker, pulls the authoritative profile', async () => {
    mockPathname = '/store/mine'
    mockUser = { id: 1, email: 'a@b.c', username: 'a' } // thin login seed, no key
    mockStores = [{ slug: 'mine' }]
    useAuthState.setState({ status: 'authenticated', sessionId: 's1' })
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await vi.waitFor(() => expect(refreshUser).toHaveBeenCalled())
    expect(replace).not.toHaveBeenCalledWith('/verify-email')
    expect(content()).toBeNull()
    expect(rejected()).toBeNull()
  })

  it('an authoritative profile with email_verified_at === null IS bounced to /verify-email', async () => {
    mockPathname = '/store/mine'
    mockUser = { id: 1, email: 'a@b.c', username: 'a', accounttype: 'individual', email_verified_at: null }
    mockStores = [{ slug: 'mine' }]
    useAuthState.setState({ status: 'authenticated', sessionId: 's1' })
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/verify-email'))
  })
})

describe('ProtectedLayoutContent — store authorization at the shell boundary', () => {
  const verified = () => {
    mockUser = { id: 1, email_verified_at: '2026-01-01T00:00:00.000Z' }
    useAuthState.setState({ status: 'authenticated', sessionId: 's1' })
  }

  it('owned slug → merchant shell + page render', async () => {
    mockPathname = '/store/test123'
    verified()
    mockStores = [{ slug: 'test123' }, { slug: 'vbb' }]
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(shell()).toBeTruthy()
    expect(content()).toBeTruthy()
    expect(rejected()).toBeNull()
  })

  it('foreign slug → StoreUnavailable, and the merchant shell NEVER mounts', async () => {
    mockPathname = '/store/dartpay'
    verified()
    mockStores = [{ slug: 'test123' }, { slug: 'vbb' }]
    mockStoreStatus = 'ready'
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejected()).toBeTruthy()
    expect(shell()).toBeNull()
    expect(content()).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('foreign child route (/store/dartpay/settings/payments) → StoreUnavailable, no shell', async () => {
    mockPathname = '/store/dartpay/settings/payments'
    verified()
    mockStores = [{ slug: 'test123' }]
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejected()).toBeTruthy()
    expect(shell()).toBeNull()
  })

  it('non-existent slug behaves identically to a foreign one (no enumeration)', async () => {
    mockPathname = '/store/no-such-store-zzz'
    verified()
    mockStores = [{ slug: 'test123' }]
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejected()).toBeTruthy()
    expect(shell()).toBeNull()
  })

  it('store list not resolved yet → neutral blocker, NOT a rejection and NOT the shell', async () => {
    mockPathname = '/store/dartpay'
    verified()
    mockStores = []
    mockStoreStatus = 'loading'
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(rejected()).toBeNull()
    expect(shell()).toBeNull()
    expect(content()).toBeNull()
  })

  it('slug-free routes under /store are never run through store authorization', async () => {
    verified()
    mockStores = [{ slug: 'test123' }]
    for (const p of ['/store', '/store/new', '/store/all', '/store/orders', '/store/settings']) {
      cleanup()
      mockPathname = p
      render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
      await new Promise((r) => setTimeout(r, 0))
      expect(rejected(), `${p} must not be rejected`).toBeNull()
    }
  })

  it('valid empty owned store still renders (zero stores-data is not "no access")', async () => {
    mockPathname = '/store/test123'
    verified()
    mockStores = [{ slug: 'test123' }] // owned; the store itself may have zero orders/products
    render(<ProtectedLayout>{PAGE}</ProtectedLayout>)
    await new Promise((r) => setTimeout(r, 0))
    expect(content()).toBeTruthy()
    expect(rejected()).toBeNull()
  })
})

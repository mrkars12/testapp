import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import RootEntry from './RootEntry'

/**
 * Root `/` gate: an authenticated visitor is handed to `/store` (the ONE
 * slug resolver) — NEVER `/select-store`, and `/` never renders as an
 * authenticated page. A guest sees the landing.
 */

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

let mockStatus = 'unauthenticated'
vi.mock('@/lib/authState', () => ({
  useAuthState: Object.assign(
    (sel?: (s: { status: string }) => unknown) => (sel ? sel({ status: mockStatus }) : { status: mockStatus }),
    { getState: () => ({ status: mockStatus }) },
  ),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ isLoading: false, isSessionReady: true }),
}))

beforeEach(() => { replace.mockClear(); mockStatus = 'unauthenticated' })
afterEach(cleanup)

describe('RootEntry', () => {
  it('authenticated -> router.replace("/store"), never "/select-store", landing not shown', async () => {
    mockStatus = 'authenticated'
    render(<RootEntry landing={<div>LANDING</div>} />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store'))
    expect(replace).not.toHaveBeenCalledWith('/select-store')
    expect(screen.queryByText('LANDING')).toBeNull()
  })

  it('unauthenticated -> renders the landing, no redirect', async () => {
    mockStatus = 'unauthenticated'
    render(<RootEntry landing={<div>LANDING</div>} />)
    expect(screen.getByText('LANDING')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it('still resolving (booting) -> neither landing nor redirect', async () => {
    mockStatus = 'booting'
    render(<RootEntry landing={<div>LANDING</div>} />)
    expect(screen.queryByText('LANDING')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })
})

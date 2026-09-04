import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

/**
 * Regression: `AuthProvider.logout()` (and the session-expired handler)
 * hit `POST /auth/logout` with a bodyless `fetch`, which sends no
 * `Content-Type`. The backend cookie-CSRF guard
 * (`backend/src/common/csrf-protection.middleware.ts`) 403s any
 * authenticated POST whose Content-Type isn't `application/json`, so the
 * request was rejected and the server session cookie was never cleared —
 * logout only reset client state (verified in a real browser: after
 * "logout", `GET /auth/me` still returned `authenticated:true` and
 * protected routes still rendered).
 *
 * This asserts the logout request now declares `application/json`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/store/test123',
}))
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { authenticated: false, user: null } }), post: vi.fn().mockResolvedValue({ data: {} }) },
  dispatchSessionExpired: vi.fn(),
}))
vi.mock('@/lib/device', () => ({
  useDevicesStore: Object.assign(() => ({}), { getState: () => ({ fetchDevices: vi.fn(), markDeviceLoggedOut: vi.fn() }) }),
}))
vi.mock('js-cookie', () => ({ default: { remove: vi.fn(), get: vi.fn() } }))
vi.mock('@/lib/fingerprint', () => ({ getHardwareFingerprint: vi.fn().mockResolvedValue('fp') }))
const { resetStoreBootstrap } = vi.hoisted(() => ({ resetStoreBootstrap: vi.fn() }))
vi.mock('@/lib/storeBootstrap', () => ({
  authedHome: vi.fn().mockResolvedValue('/store/test123'),
  resolvePostAuthTarget: vi.fn().mockResolvedValue('/store/test123'),
  resetStoreBootstrap,
}))
vi.mock('@/lib/socket', () => ({
  socket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), removeAllListeners: vi.fn(), connected: false, roomsJoined: false },
}))
vi.mock('@/lib/useIdleLogout', () => ({ useIdleLogout: vi.fn() }))

const setStatus = vi.fn()
const setSession = vi.fn()
let mockStatus = 'authenticated'
type AuthSlice = { status: string }
vi.mock('@/lib/authState', () => ({
  useAuthState: Object.assign(
    (sel?: (s: AuthSlice) => unknown) => (sel ? sel({ status: mockStatus }) : { status: mockStatus }),
    { getState: () => ({ status: mockStatus, setStatus, setSession }) },
  ),
}))

import { AuthProvider, useAuth } from './AuthProvider'

function LogoutButton() {
  const { logout } = useAuth()
  return <button onClick={() => logout()}>go</button>
}

describe('AuthProvider logout request', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.restoreAllMocks()
    mockStatus = 'authenticated'
    ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = class {
      postMessage() {}
      close() {}
      onmessage: ((ev: MessageEvent) => void) | null = null
    }
  })

  it('sends POST /auth/logout with Content-Type application/json (CSRF guard)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <LogoutButton />
        </AuthProvider>
      </QueryClientProvider>,
    )

    screen.getByText('go').click()

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/auth/logout'))
      expect(call, 'a fetch to /auth/logout should have been made').toBeTruthy()
      const init = call![1] || {}
      expect(init.method).toBe('POST')
      const headers = new Headers(init.headers || {})
      expect(headers.get('content-type')).toMatch(/application\/json/i)
    })
  })

  it('is an account boundary: wipes the previous user\'s store bootstrap state', async () => {
    resetStoreBootstrap.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider><LogoutButton /></AuthProvider>
      </QueryClientProvider>,
    )
    screen.getByText('go').click()
    await waitFor(() => expect(resetStoreBootstrap).toHaveBeenCalled())
  })
})

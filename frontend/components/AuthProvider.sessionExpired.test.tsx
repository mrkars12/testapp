import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

/**
 * Session-expiry hardening: `lib/api.ts` dispatches `auth:session_expired`
 * on ANY 401 from any background API call. The handler must NOT
 * hard-redirect on a lone/transient 401 — it re-verifies `/auth/me` first,
 * and only navigates (softly, via the router) on a confirmed dead session.
 * An explicit idle timeout is trusted and skips the re-check.
 */

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/store/test123',
}))
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { authenticated: true, user: { id: '1' } } }), post: vi.fn().mockResolvedValue({ data: {} }) },
  dispatchSessionExpired: vi.fn(),
}))
vi.mock('@/lib/device', () => ({
  useDevicesStore: Object.assign(() => ({}), { getState: () => ({ fetchDevices: vi.fn(), markDeviceLoggedOut: vi.fn() }) }),
}))
vi.mock('js-cookie', () => ({ default: { remove: vi.fn(), get: vi.fn() } }))
vi.mock('@/lib/fingerprint', () => ({ getHardwareFingerprint: vi.fn().mockResolvedValue('fp') }))
vi.mock('@/lib/storeBootstrap', () => ({
  authedHome: vi.fn().mockResolvedValue('/store/test123'),
  resolvePostAuthTarget: vi.fn().mockResolvedValue('/store/test123'),
  resetStoreBootstrap: vi.fn(),
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

import { AuthProvider } from './AuthProvider'

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider><div>child</div></AuthProvider>
    </QueryClientProvider>,
  )
}

describe('AuthProvider — auth:session_expired', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    replace.mockClear(); setStatus.mockClear()
    mockStatus = 'authenticated'
    ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = class {
      postMessage() {}
      close() {}
      onmessage: ((ev: MessageEvent) => void) | null = null
    }
  })

  it('TRANSIENT 401: /auth/me still authenticated -> no redirect, no logout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/auth/me')
        ? { ok: true, status: 200, json: async () => ({ authenticated: true, user: { id: '1' } }) }
        : { ok: true, status: 200, json: async () => ({}) },
    ))
    mount()
    window.dispatchEvent(new CustomEvent('auth:session_expired', { detail: { reason: 'session_expired' } }))
    await new Promise((r) => setTimeout(r, 60))
    expect(replace).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalledWith('logging_out')
  })

  it('REAL expiry: /auth/me 401 -> soft router.replace to /login?reason=timeout&intended=…', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/auth/me')
        ? { ok: false, status: 401, json: async () => ({ authenticated: false }) }
        : { ok: true, status: 200, json: async () => ({}) },
    ))
    mount()
    window.dispatchEvent(new CustomEvent('auth:session_expired', { detail: { reason: 'session_expired' } }))
    await waitFor(() => {
      const call = replace.mock.calls.find((c) => String(c[0]).startsWith('/login'))
      expect(call, 'should navigate to /login').toBeTruthy()
      expect(call![0]).toMatch(/^\/login\?reason=timeout&intended=/)
    })
  })
})

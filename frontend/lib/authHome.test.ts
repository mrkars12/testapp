import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useStoreBootstrap,
  authedHome,
  resolvePostAuthTarget,
  resetStoreBootstrap,
  __resetStoreBootstrapForTests,
} from './storeBootstrap'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, default: { get: vi.fn(), patch: vi.fn() } }
})
import api from './api'

/**
 * `authedHome(context, intended?)` is THE one post-auth destination
 * resolver. It:
 *   - validates `intended` (safe, not a temporary auth route, and — for a
 *     `/store/<slug>` link — a store the CURRENT user owns), else discards
 *   - otherwise runs store-count resolution
 *   - lands on `/select-store` ONLY for a fresh-login / account-switch
 *     context with 2+ stores and no valid intended
 */
describe('authedHome — single post-auth destination', () => {
  beforeEach(() => {
    __resetStoreBootstrapForTests()
    vi.mocked(api.get).mockReset()
    useStoreBootstrap.setState({ status: 'idle', stores: [], error: null })
  })

  const withStores = (
    stores: Array<{ id: number; name: string; slug: string; createdAt?: string }>,
  ) => {
    vi.mocked(api.get).mockResolvedValue({ data: stores })
  }
  const TWO = [
    { id: 1, name: 'A', slug: 'aaa', createdAt: '2026-08-01T00:00:00Z' },
    { id: 2, name: 'B', slug: 'bbb', createdAt: '2026-08-20T00:00:00Z' },
  ]

  it('0 stores -> /store/new (every context)', async () => {
    withStores([])
    for (const c of ['fresh-login', 'resume', 'deep-link', 'account-switch'] as const) {
      expect(await authedHome(c)).toBe('/store/new')
    }
  })

  it('1 store -> /store/<slug> (never the chooser)', async () => {
    withStores([{ id: 1, name: 'Only', slug: 'only', createdAt: '2026-01-01T00:00:00Z' }])
    expect(await authedHome('fresh-login')).toBe('/store/only')
    expect(await authedHome('resume')).toBe('/store/only')
    expect(await authedHome('account-switch')).toBe('/store/only')
  })

  it('2+ stores + fresh-login / account-switch -> /select-store', async () => {
    withStores(TWO)
    expect(await authedHome('fresh-login')).toBe('/select-store')
    expect(await authedHome('account-switch')).toBe('/select-store')
  })

  it('2+ stores + resume / deep-link -> the ORIGINAL store, NEVER /select-store', async () => {
    withStores([...TWO].reverse())
    expect(await authedHome('resume')).toBe('/store/aaa')
    expect(await authedHome('deep-link')).toBe('/store/aaa')
  })

  describe('intended validation', () => {
    it('honours an intended /store/<slug> the user OWNS (beats the chooser)', async () => {
      withStores(TWO)
      expect(await authedHome('fresh-login', '/store/bbb/orders')).toBe('/store/bbb/orders')
      expect(await authedHome('fresh-login', encodeURIComponent('/store/bbb/orders'))).toBe('/store/bbb/orders')
    })

    it('DISCARDS an intended /store/<slug> the user does NOT own -> falls back to resolution', async () => {
      withStores(TWO) // owns aaa, bbb — not "someone-elses"
      expect(await authedHome('fresh-login', '/store/someone-elses/orders')).toBe('/select-store')
      expect(await authedHome('resume', '/store/someone-elses')).toBe('/store/aaa')
    })

    it('DISCARDS a non-relative / protocol-relative intended', async () => {
      withStores(TWO)
      expect(await authedHome('resume', 'https://evil.example/x')).toBe('/store/aaa')
      expect(await authedHome('resume', '//evil.example/x')).toBe('/store/aaa')
    })

    it('DISCARDS an intended that is itself a temporary auth route', async () => {
      withStores(TWO)
      for (const p of ['/login', '/register', '/register/account-information', '/verify-email', '/select-store', '/', '/auth/oauth-success']) {
        expect(await authedHome('resume', p)).toBe('/store/aaa')
      }
    })

    it('keeps a safe non-store protected intended (e.g. /settings/security)', async () => {
      withStores(TWO)
      expect(await authedHome('fresh-login', '/settings/security')).toBe('/settings/security')
    })
  })

  it('resolvePostAuthTarget is authedHome("fresh-login")', async () => {
    withStores(TWO)
    expect(await resolvePostAuthTarget()).toBe('/select-store')
  })

  it('resetStoreBootstrap wipes stores + status', () => {
    useStoreBootstrap.setState({ status: 'ready', stores: TWO as never, error: null })
    resetStoreBootstrap()
    expect(useStoreBootstrap.getState().stores).toEqual([])
    expect(useStoreBootstrap.getState().status).toBe('idle')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useStoreBootstrap,
  ensureStoreBootstrap,
  refreshStoreBootstrap,
  resolveOriginalStoreSlug,
  resolveDefaultStoreSlug,
  orderStoresForDisplay,
  __resetStoreBootstrapForTests,
} from './storeBootstrap'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, default: { get: vi.fn(), patch: vi.fn() } }
})

import api, { getStoreHeaders } from './api'

/**
 * The bootstrap loads the user's store list and nothing more. Which store
 * is *active* is decided by the `[storeSlug]` URL segment, so this module
 * must never select one — a background list refresh landing late could
 * otherwise re-scope a page the user is already looking at.
 */
describe('storeBootstrap loads the store list without ever choosing a store', () => {
  beforeEach(() => {
    __resetStoreBootstrapForTests()
    vi.mocked(api.get).mockReset()
  })

  it('reaches a terminal ready state with zero stores, never stuck loading', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] })
    await ensureStoreBootstrap()
    expect(useStoreBootstrap.getState().status).toBe('ready')
    expect(useStoreBootstrap.getState().stores).toEqual([])
  })

  it('never makes a store active, even when exactly one exists', async () => {
    // The URL decides. Selecting here would make a deep link to store B
    // briefly act as store A while the list resolved.
    window.history.replaceState({}, '', '/dashboard')
    vi.mocked(api.get).mockResolvedValueOnce({ data: [{ id: 1, name: 'Only', slug: 'only' }] })
    await ensureStoreBootstrap()

    expect(useStoreBootstrap.getState().stores).toHaveLength(1)
    // A store-agnostic URL still has no active store after the list lands.
    expect(getStoreHeaders()).toEqual({})
  })

  it('leaves the URL-named store untouched when the list arrives', async () => {
    // A late background refresh must not re-scope a page the user is
    // already looking at — the classic way store A's data ends up rendered
    // under store B.
    window.history.replaceState({}, '', '/store/store-b/products')
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [
        { id: 1, name: 'A', slug: 'store-a', is_default: true },
        { id: 2, name: 'B', slug: 'store-b' },
      ],
    })
    await ensureStoreBootstrap()

    // A default exists and is NOT store-b; the URL still wins.
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })
  })

  it('is idempotent: two concurrent callers trigger one network request', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 1, name: 'A', slug: 'store-a' }] })
    await Promise.all([ensureStoreBootstrap(), ensureStoreBootstrap()])
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch once ready unless explicitly forced', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 1, name: 'A', slug: 'store-a' }] })
    await ensureStoreBootstrap()
    await ensureStoreBootstrap()
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1)

    await refreshStoreBootstrap()
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2)
  })

  it('surfaces a failed list fetch as an error state, not an endless load', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network'))
    await ensureStoreBootstrap()
    expect(useStoreBootstrap.getState().status).toBe('error')
  })
})

/**
 * THE business rule, and the one that was previously wrong.
 *
 * ORIGINAL store = the first store the account ever created. It is a fact
 * about history and never moves.
 *
 * DEFAULT store  = `is_default`, a preference the user moves with
 *                  `PATCH /stores/:slug/default`.
 *
 * These coincide on a fresh account only because `createStore` sets
 * `is_default: existingCount === 0`. The moment a user picks a different
 * default they diverge — and an implementation that sorted `is_default`
 * first then promoted the NEWEST store to the top of the switcher and to
 * the dashboard entry point. The fixture below is the real shape of the QA
 * account that exposed it.
 */
const QA_ACCOUNT = [
  { id: 1, name: 'test', slug: 'test', createdAt: '2026-08-04T10:14:41.651Z', is_default: false },
  { id: 7, name: 'tt', slug: 'tt', createdAt: '2026-08-21T16:37:36.908Z', is_default: false },
  { id: 8, name: 'cc', slug: 'cc', createdAt: '2026-08-24T10:28:14.694Z', is_default: false },
  { id: 9, name: 'dartpay', slug: 'dartpay', createdAt: '2026-08-24T11:11:59.978Z', is_default: true },
]

describe('resolveOriginalStoreSlug resolves the FIRST-CREATED store', () => {
  it('returns null with no stores', () => {
    expect(resolveOriginalStoreSlug([])).toBeNull()
  })

  it('returns the only store when there is exactly one', () => {
    expect(resolveOriginalStoreSlug([{ id: 1, name: 'A', slug: 'store-a' }])).toBe('store-a')
  })

  it('picks the oldest store on the real QA account, not the is_default one', () => {
    // The regression, pinned against production data: `test` is the
    // original (2026-08-04); `dartpay` is the NEWEST (2026-08-24) and only
    // carries the user-selected default flag.
    expect(resolveOriginalStoreSlug(QA_ACCOUNT)).toBe('test')
    expect(resolveOriginalStoreSlug(QA_ACCOUNT)).not.toBe('dartpay')
  })

  it('does not let is_default promote the newest store', () => {
    expect(
      resolveOriginalStoreSlug([
        { id: 1, name: 'First', slug: 'first', createdAt: '2020-01-01T00:00:00.000Z' },
        { id: 2, name: 'Newest', slug: 'newest', createdAt: '2026-01-01T00:00:00.000Z', is_default: true },
      ]),
    ).toBe('first')
  })

  it('is unaffected by the order the API returns stores in', () => {
    // `stores[0]` is positional; a backend `orderBy` change must not move
    // the dashboard entry store.
    const forward = resolveOriginalStoreSlug(QA_ACCOUNT)
    const reversed = resolveOriginalStoreSlug([...QA_ACCOUNT].reverse())
    const shuffled = resolveOriginalStoreSlug([QA_ACCOUNT[2], QA_ACCOUNT[0], QA_ACCOUNT[3], QA_ACCOUNT[1]])
    expect([forward, reversed, shuffled]).toEqual(['test', 'test', 'test'])
  })

  it('breaks createdAt ties on id, then slug, so the answer is total-ordered', () => {
    const t = '2024-03-03T00:00:00.000Z'
    expect(
      resolveOriginalStoreSlug([
        { id: 8, name: 'H', slug: 'h', createdAt: t },
        { id: 3, name: 'C', slug: 'c', createdAt: t },
      ]),
    ).toBe('c')
  })

  it('does not let a missing createdAt masquerade as the original', () => {
    // `undefined` must not read as epoch 0 and steal the "first created"
    // claim from a store with a real timestamp.
    expect(
      resolveOriginalStoreSlug([
        { id: 2, name: 'NoDate', slug: 'no-date' },
        { id: 1, name: 'Dated', slug: 'dated', createdAt: '2024-01-01T00:00:00.000Z' },
      ]),
    ).toBe('dated')
  })

  it('still resolves a store when every createdAt is missing or unparseable', () => {
    expect(
      resolveOriginalStoreSlug([
        { id: 6, name: 'F', slug: 'f', createdAt: 'not-a-date' },
        { id: 2, name: 'B', slug: 'b' },
      ]),
    ).toBe('b')
  })
})

describe('the DEFAULT store stays a separate, still-supported concept', () => {
  it('reports the user-selected default independently of the original', () => {
    // Both concepts must remain readable; the fix separates them rather
    // than deleting `is_default`.
    expect(resolveDefaultStoreSlug(QA_ACCOUNT)).toBe('dartpay')
    expect(resolveOriginalStoreSlug(QA_ACCOUNT)).toBe('test')
  })

  it('returns null when the user has chosen no default', () => {
    expect(resolveDefaultStoreSlug([{ id: 1, name: 'A', slug: 'a', createdAt: '2024-01-01T00:00:00.000Z' }])).toBeNull()
  })

  it('coincides with the original on a fresh single-store account', () => {
    // `createStore` sets is_default on the first store, so the two agree
    // until the user moves the default. This is why they were conflatable.
    const fresh = [{ id: 1, name: 'Only', slug: 'only', createdAt: '2024-01-01T00:00:00.000Z', is_default: true }]
    expect(resolveDefaultStoreSlug(fresh)).toBe('only')
    expect(resolveOriginalStoreSlug(fresh)).toBe('only')
  })
})

describe('orderStoresForDisplay lists stores oldest-first', () => {
  it('orders the QA account by creation date, default flag ignored', () => {
    expect(orderStoresForDisplay(QA_ACCOUNT).map((s) => s.slug))
      .toEqual(['test', 'tt', 'cc', 'dartpay'])
  })

  it('produces the same order regardless of input order', () => {
    expect(orderStoresForDisplay([...QA_ACCOUNT].reverse()).map((s) => s.slug))
      .toEqual(['test', 'tt', 'cc', 'dartpay'])
  })

  it('agrees with resolveOriginalStoreSlug on the first row', () => {
    // The switcher's top row and the dashboard entry destination must be
    // the same store by construction.
    expect(orderStoresForDisplay(QA_ACCOUNT)[0].slug).toBe(resolveOriginalStoreSlug(QA_ACCOUNT))
  })
})

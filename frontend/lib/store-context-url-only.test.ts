import { describe, it, expect, beforeEach } from 'vitest'
import { readStoreSlugFromLocation } from './storeSlug'
import { getStoreHeaders } from './api'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The architecture this suite defends: the active store is the URL segment
 * and nothing else.
 *
 *   URL -> storeSlug -> X-Store-Slug -> backend tenant context
 *
 * Not: URL -> some store -> API. A second authority for the same fact is
 * what produced every bug in this area — a stale mirror leaking the previous
 * tenant's slug onto the first request after a switch, and a render-time
 * write to keep it in step that triggered "Cannot update a component while
 * rendering a different component".
 */

const FRONTEND_ROOT = path.resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.name === 'node_modules' || e.name.startsWith('.')) return []
    if (e.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : []
  })
}

/** Admin source only. The public storefront is a different app surface. */
function adminSources(): string[] {
  return [
    ...sourceFiles(path.join(FRONTEND_ROOT, 'app', '(protected)')),
    ...sourceFiles(path.join(FRONTEND_ROOT, 'lib')),
    ...sourceFiles(path.join(FRONTEND_ROOT, 'components')),
  ]
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('1-7. the URL is the only source of the active store', () => {
  it('reads the active store from a store-scoped pathname', () => {
    window.history.replaceState({}, '', '/store/dartpay/products')
    expect(readStoreSlugFromLocation()).toBe('dartpay')

    window.history.replaceState({}, '', '/store/test123c/settings/payments')
    expect(readStoreSlugFromLocation()).toBe('test123c')
  })

  it('sends the URL slug as X-Store-Slug', () => {
    window.history.replaceState({}, '', '/store/dartpay/products')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'dartpay' })
  })

  it('has no in-memory store that could go stale', () => {
    // The old `lib/activeStore.ts` Zustand mirror is gone outright. There is
    // no second authority left to disagree with the URL, so "URL beats stale
    // state" is true by construction rather than by resolution order — which
    // is why this asserts the module's absence rather than trying to
    // out-race it.
    expect(fs.existsSync(path.join(FRONTEND_ROOT, 'lib', 'activeStore.ts'))).toBe(false)
    const apiSrc = fs.readFileSync(path.join(FRONTEND_ROOT, 'lib', 'api.ts'), 'utf8')
    expect(apiSrc).not.toMatch(/getActiveStoreSlug/)
  })

  it('resolves purely from the URL, with no React and no prior state', () => {
    // A reload reconstructs the active store from the address bar alone.
    window.history.replaceState({}, '', '/store/store-z/orders/42')
    expect(readStoreSlugFromLocation()).toBe('store-z')
  })

  it('invents no store when the URL names none', () => {
    // Not a remembered slug, not stores[0], not the default store. A
    // store-agnostic route has no active store, and guessing one here is how
    // a request gets attributed to the wrong tenant.
    window.history.replaceState({}, '', '/dashboard')
    expect(readStoreSlugFromLocation()).toBeNull()
    expect(getStoreHeaders()).toEqual({})
  })

  it('does not mistake sibling routes for store slugs', () => {
    for (const p of ['/store/new', '/store/all', '/store']) {
      window.history.replaceState({}, '', p)
      expect(readStoreSlugFromLocation(), p).toBeNull()
    }
  })
})

describe('8-10. switching stores is a navigation, and tabs are independent', () => {
  it('A -> B updates the request header immediately', () => {
    window.history.replaceState({}, '', '/store/store-a/orders')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-a' })

    window.history.replaceState({}, '', '/store/store-b/orders')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })
  })

  it('B -> A updates it back, with nothing sticky in between', () => {
    window.history.replaceState({}, '', '/store/store-b/orders')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })

    window.history.replaceState({}, '', '/store/store-a/orders')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-a' })
  })

  it('keeps two tabs on two stores independent', () => {
    // Each tab has its own URL and the header is a pure function of it, so
    // there is no shared value for one tab to overwrite in the other.
    window.history.replaceState({}, '', '/store/dartpay/products')
    const tabA = getStoreHeaders()
    window.history.replaceState({}, '', '/store/test123c/products')
    const tabB = getStoreHeaders()
    window.history.replaceState({}, '', '/store/dartpay/products')
    const tabAAgain = getStoreHeaders()

    expect(tabA).toEqual({ 'X-Store-Slug': 'dartpay' })
    expect(tabB).toEqual({ 'X-Store-Slug': 'test123c' })
    expect(tabAAgain).toEqual(tabA)
  })
})

describe('16. payment settings cannot cross tenants', () => {
  it('scopes payment settings to the store in the URL', () => {
    // `/stores/payment-settings` carries no slug in its path: which store's
    // gateways come back is decided ENTIRELY by this header.
    window.history.replaceState({}, '', '/store/store-a/settings/payments')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-a' })

    window.history.replaceState({}, '', '/store/store-b/settings/payments')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })
  })
})

describe('18. the active store is never written to a persistence API', () => {
  it('writes nothing when the header is resolved', () => {
    const cookieBefore = document.cookie
    window.history.replaceState({}, '', '/store/dartpay/products')
    getStoreHeaders()

    expect(Object.keys(localStorage)).toEqual([])
    expect(Object.keys(sessionStorage)).toEqual([])
    expect(document.cookie).toBe(cookieBefore)
  })

  it('has no admin source that persists or broadcasts a store slug', () => {
    // Static sweep, because the guarantee is that the CODE cannot do it —
    // a runtime assertion only proves the paths a test happened to walk.
    // Storage of unrelated things (auth, balance, notifications, the
    // shopper's cart on the public storefront) is untouched by this.
    const STORE_WORDS = /(store|tenant|slug)/i
    const PERSIST = /(localStorage|sessionStorage|document\.cookie|Cookies\.(set|remove)|new BroadcastChannel|persist\()/

    const offenders: string[] = []
    for (const file of adminSources()) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // comments discuss it deliberately
        if (PERSIST.test(line) && STORE_WORDS.test(line)) {
          offenders.push(`${path.relative(FRONTEND_ROOT, file)}:${i + 1}`)
        }
      })
    }

    expect(offenders, `store context persisted at: ${offenders.join(', ')}`).toEqual([])
  })

  it('keeps the deleted mirror deleted', () => {
    expect(fs.existsSync(path.join(FRONTEND_ROOT, 'lib', 'activeStore.ts'))).toBe(false)
  })
})

describe('17. no render-time synchronisation remains', () => {
  it('has no store-scoped layout writing global state during render', () => {
    const layout = fs.readFileSync(
      path.join(FRONTEND_ROOT, 'app', '(protected)', 'store', '[storeSlug]', 'layout.tsx'),
      'utf8',
    )
    // The layout used to call `setState` during render to keep the mirror in
    // step, which React reports as updating another component mid-render.
    expect(layout).not.toMatch(/\.setState\(/)
    expect(layout).not.toMatch(/useActiveStore/)
  })

  it('has no admin component reading the active store from a global store', () => {
    const offenders = adminSources().filter((f) =>
      /from\s+['"]@?\/?(lib\/)?activeStore['"]/.test(fs.readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})

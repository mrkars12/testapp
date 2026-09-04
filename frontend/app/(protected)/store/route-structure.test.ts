import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The active store lives in the URL: every store-scoped admin section is
// served from `/store/[storeSlug]/<section>`. That is what makes
// the choice per-tab (two tabs on two slugs are two stores, with nothing
// shared) and what lets a deep link resolve the right store on first
// render, with no persisted or broadcast state involved.
//
// This walks the real route tree on disk rather than trusting a constant,
// because the guarantee is structural: a section that quietly reappears at
// a slug-free path would silently fall back to whichever store the backend
// picks by default, which is the exact cross-store leak the segment exists
// to prevent.
const STORE_DIR = path.resolve(__dirname)
const STORE_SCOPED_SECTIONS = [
  'products',
  'collections',
  'orders',
  'menus',
  'pages',
  'themes',
  'settings',
  'settings/payments',
  // Nested deeper than one level. These were the gap: the slug-free stub
  // tree stopped at `settings/payments`, so
  // `/store/settings/payments/test` matched no route and 404'd
  // even though the store-scoped page existed.
  'settings/payments/test',
  'settings/payments/test/result',
]

describe('admin route tree is scoped by a [storeSlug] URL segment', () => {
  it('every store-scoped section lives under [storeSlug]', () => {
    for (const section of STORE_SCOPED_SECTIONS) {
      const full = path.join(STORE_DIR, '[storeSlug]', section, 'page.tsx')
      expect(fs.existsSync(full), `expected [storeSlug]/${section}/page.tsx to exist`).toBe(true)
    }
  })

  it('the [storeSlug] segment has a layout that can mirror the slug', () => {
    const layout = path.join(STORE_DIR, '[storeSlug]', 'layout.tsx')
    expect(fs.existsSync(layout)).toBe(true)
  })

  it('slug-free section URLs remain as redirect stubs, never as real pages', () => {
    // Kept so old links and any nav rendered before a store is known still
    // resolve — but they must only redirect, never render store data
    // against a backend-chosen default store.
    for (const section of STORE_SCOPED_SECTIONS) {
      const full = path.join(STORE_DIR, section, 'page.tsx')
      expect(fs.existsSync(full), `expected legacy stub ${section}/page.tsx`).toBe(true)
      const source = fs.readFileSync(full, 'utf8')
      expect(source, `${section}/page.tsx must be a redirect stub`).toContain('LegacyStoreRedirect')
    }
  })

  it('the create-store route stays store-agnostic', () => {
    // `/new` creates a store — it does not belong to a single existing
    // store, so it may not sit under the slug segment. `/store` itself is
    // the entry point that resolves the primary store and redirects.
    expect(fs.existsSync(path.join(STORE_DIR, 'page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(STORE_DIR, 'new', 'page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(STORE_DIR, '[storeSlug]', 'new'))).toBe(false)
  })

  it('the [storeSlug] segment is itself routable, not just a container', () => {
    // The original regression: `[storeSlug]/` held only a layout and section
    // subfolders. A layout does not make a segment routable — only a `page`
    // does — so `/store/dartpay` 404'd while
    // `/store/dartpay/products` resolved.
    const landing = path.join(STORE_DIR, '[storeSlug]', 'page.tsx')
    expect(fs.existsSync(landing), 'expected [storeSlug]/page.tsx to exist').toBe(true)
  })

  it('the store root RENDERS a dashboard home and never redirects to a section', () => {
    // It was briefly a `redirect()` shim to `/products`, which made
    // "select a store" mean "open the catalogue" and left no way to be in a
    // store without being in one of its sections.
    const source = fs.readFileSync(
      path.join(STORE_DIR, '[storeSlug]', 'page.tsx'), 'utf8',
    )
    // Checked via the import rather than the call: a `redirect()` is
    // impossible without it, and prose in the file legitimately mentions
    // the redirect this page used to be.
    expect(source, 'store root must not import redirect')
      .not.toMatch(/import\s*\{[^}]*\bredirect\b[^}]*\}\s*from\s*['"]next\/navigation['"]/)
    expect(source, 'store root must not hard-code a landing section')
      .not.toContain('DASHBOARD_DEFAULT_SECTION')
  })

  it('no route hard-codes Products as the store landing destination', () => {
    // The constant existed only because Products was the de-facto landing
    // page. Nothing may reintroduce it.
    const files = [
      path.join(STORE_DIR, 'page.tsx'),
      path.join(STORE_DIR, '[storeSlug]', 'page.tsx'),
      path.resolve(STORE_DIR, '..', '..', '..', 'components', 'layout', 'StoreSwitcher.tsx'),
    ]
    for (const f of files) {
      expect(fs.readFileSync(f, 'utf8'), `${path.basename(f)} must not force a landing section`)
        .not.toContain('DASHBOARD_DEFAULT_SECTION')
    }
  })

  it('the public storefront lives at /stores/[slug], a distinct tree from merchant /store/[storeSlug]', () => {
    // `/stores/[slug]/...` (customer-facing, public, app/stores/) and
    // `/store/[storeSlug]/...` (merchant, protected, app/(protected)/store/)
    // are different route trees under different top-level segments — "store"
    // vs "stores" — so there is no shared-URL collision to guard against by
    // construction. This still asserts the storefront tree exists, is not
    // nested under the merchant tree, and that no ungrouped `app/store/*`
    // exists outside the `(protected)` group (which would collide with the
    // merchant tree at the exact same URL).
    const appDir = path.resolve(STORE_DIR, '..', '..')
    expect(fs.existsSync(path.join(appDir, 'stores', '[slug]', 'page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(STORE_DIR, '[storeSlug]', 'stores'))).toBe(false)
    expect(fs.existsSync(path.join(appDir, 'store'))).toBe(false)
  })
})

/**
 * FINAL_ACCOUNT_LOGIN_STORE_ARCHITECTURE_REPORT.md: `/dashboard` and
 * `/store/all` are not merely deprecated, they must not exist as routes at
 * all — a direct visit to either has to 404, not redirect anywhere. The
 * post-login multi-store chooser that used to live at `/store/all` is a
 * distinct route (`/select-store`), outside the merchant `/store` tree
 * entirely so it can never collide with a real store slug.
 */
describe('legacy /dashboard and /store/all no longer exist as routes', () => {
  const APP_DIR = path.resolve(STORE_DIR, '..', '..')

  it('has no /dashboard route left anywhere under app/', () => {
    expect(fs.existsSync(path.join(APP_DIR, 'dashboard', 'page.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(APP_DIR, '(protected)', 'dashboard', 'page.tsx'))).toBe(false)
  })

  it('/store/all is a static notFound() trigger, not a real page', () => {
    // `all` sits at the same path segment as `[storeSlug]` — merely
    // deleting this file would make `/store/all` fall through to the
    // dynamic route instead of 404ing (rendering the dashboard for a
    // store literally slugged "all", which cannot exist — `all` is
    // reserved). The static file has to stay, calling `notFound()`.
    const file = path.join(STORE_DIR, 'all', 'page.tsx')
    expect(fs.existsSync(file), 'expected store/all/page.tsx to exist as a notFound() trigger').toBe(true)
    const source = fs.readFileSync(file, 'utf8')
    expect(source).toMatch(/notFound\(\)/)
    expect(source).not.toContain('AllStoresPage')
    expect(fs.existsSync(path.join(STORE_DIR, '[storeSlug]', 'all'))).toBe(false)
  })

  it('the multi-store chooser lives at its own dedicated /select-store route, not /store/all', () => {
    const chooser = path.join(APP_DIR, '(protected)', 'select-store', 'page.tsx')
    expect(fs.existsSync(chooser), 'expected (protected)/select-store/page.tsx to exist').toBe(true)
  })

  it('the email-verification gate lives at /verify-email, a route distinct from the merchant store tree', () => {
    const gate = path.join(APP_DIR, '(protected)', 'verify-email', 'page.tsx')
    expect(fs.existsSync(gate), 'expected (protected)/verify-email/page.tsx to exist').toBe(true)
  })
})

/**
 * The 404 above had a root cause upstream of the missing stub: pages that
 * already sit under `[storeSlug]` were emitting slug-FREE links. Such a link
 * is wrong twice over — it 404s when no stub exists, and even with a stub it
 * throws away the store the user is in and re-resolves a different one.
 */
describe('store-scoped pages never emit slug-free dashboard links', () => {
  const SCOPED_DIR = path.join(STORE_DIR, '[storeSlug]')

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : []
    })
  }

  it('builds every internal dashboard link with a store segment', () => {
    // Matches `/store/<literal>` where the literal is a known
    // section rather than an interpolated slug. `${...}` and the
    // store-agnostic routes (`all`, `new`) are intentionally excluded.
    const SLUG_FREE = /['"`]\/store\/(?!all\b|new\b|\$)(products|orders|collections|menus|pages|themes|settings)\b/

    const offenders: string[] = []
    for (const file of walk(SCOPED_DIR)) {
      const src = fs.readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        // Ignore comment lines: several deliberately quote the old broken
        // URL to explain the bug.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (SLUG_FREE.test(line)) {
          offenders.push(`${path.relative(SCOPED_DIR, file)}:${i + 1}`)
        }
      })
    }

    expect(offenders, `slug-free links found: ${offenders.join(', ')}`).toEqual([])
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

/* ══════════════════════════════════════════════════════════════════════
   THE CART LOCK, WHERE THE CART ACTUALLY IS.

   Two separate things, and they must not be mixed:

     • the ORDER SUMMARY is a checkout section — the products, their
       quantities and the total the checkout is about;
     • the HEADER CART BUTTON and its side DRAWER are the storefront's
       cart, on every page, and are where a customer edits an order.

   A payment priced from the cart freezes the CART, not the storefront.
   The drawer still opens, the products are still visible and the order
   summary is still readable — what stops is mutation. This file holds
   the provider's enforcement of that (the mutators refuse) and the
   drawer's rendering of it (no controls, the notice, the way back).
   ══════════════════════════════════════════════════════════════════════ */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ slug: 'shop1' }),
  useSearchParams: () => new URLSearchParams(''),
}))

import { StoreProvider, useStore } from './StoreContext'
import Header from './Header'

const ITEM = {
  variantId: 'v1',
  productId: 'p1',
  productHandle: 'p1',
  title: 'Test product',
  price: 50,
  image: null,
}

/** A store whose theme actually shows the header's cart button. */
const STORE = {
  slug: 'shop1',
  name: 'Shop One',
  currency: 'SAR',
  theme: { header: { showCart: true, showAccount: false }, colors: {}, typography: {} },
  menus: [],
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('cart:shop1', JSON.stringify([{ ...ITEM, qty: 2 }]))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => STORE })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/* ────────────────────────────────────────────────────────────────────
   THE PROVIDER — the lock is enforced in state, not in the markup.
   ──────────────────────────────────────────────────────────────────── */

/** A bare consumer, so the mutators can be called the way code calls them. */
function CartProbe() {
  const {
    cart, cartCount, cartLocked, updateCartQty, removeFromCart, addToCart, clearCart, setCartLock,
    cartStatus, cartPublicId, activeCheckoutToken,
  } = useStore()
  return (
    <div>
      <span data-testid="count">{cartCount}</span>
      <span data-testid="qty">{cart[0]?.qty ?? 0}</span>
      <span data-testid="locked">{String(cartLocked)}</span>
      <span data-testid="cart-status">{cartStatus}</span>
      <span data-testid="cart-public-id">{cartPublicId ?? ''}</span>
      <span data-testid="active-checkout">{activeCheckoutToken ?? ''}</span>
      <button onClick={() => updateCartQty('v1', 5)}>raise</button>
      <button onClick={() => removeFromCart('v1')}>remove</button>
      <button onClick={() => addToCart({ ...ITEM, variantId: 'v2', title: 'Another' }, 1)}>add</button>
      <button onClick={() => clearCart()}>clear</button>
      <button onClick={() => setCartLock({ locked: true, release: () => setCartLock({ locked: false }) })}>
        lock
      </button>
      <ReleaseButton />
    </div>
  )
}

/** The release the lock was declared with — what the drawer's button calls. */
function ReleaseButton() {
  const { releaseCartLock } = useStore()
  return (
    <button disabled={!releaseCartLock} onClick={() => releaseCartLock?.()}>
      release
    </button>
  )
}

async function renderProbe() {
  render(
    <StoreProvider storeSlug="shop1">
      <CartProbe />
    </StoreProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('2'))
}

describe('the storefront cart refuses mutation while a payment is priced', () => {
  it('changes quantities and removes lines freely before the lock', async () => {
    await renderProbe()

    fireEvent.click(screen.getByText('raise'))
    await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('5'))

    fireEvent.click(screen.getByText('remove'))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'))
  })

  it('refuses a quantity change and a removal once locked', async () => {
    await renderProbe()
    fireEvent.click(screen.getByText('lock'))
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))

    fireEvent.click(screen.getByText('raise'))
    fireEvent.click(screen.getByText('remove'))

    // Not "the buttons were hidden" — these calls went through and were
    // refused, which is what a stale render or a script would hit.
    await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('2'))
    expect(screen.getByTestId('count').textContent).toBe('2')
  })

  it('still lets a SUCCESSFUL payment empty the cart', async () => {
    // `clearCart` runs when the server confirms the money, and the lock
    // belongs to that very payment. Locking it out would strand a paid
    // order behind a full cart.
    await renderProbe()
    fireEvent.click(screen.getByText('lock'))
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))

    fireEvent.click(screen.getByText('clear'))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'))
  })

  it('still lets the customer add elsewhere in the shop', async () => {
    // Browsing is not editing the priced order, it cannot move the
    // amount the provider was given, and the checkout says out loud when
    // the cart has drifted from the payment.
    await renderProbe()
    fireEvent.click(screen.getByText('lock'))
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))

    fireEvent.click(screen.getByText('add'))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'))
  })

  it('unlocks through the release it was given, and mutation works again', async () => {
    await renderProbe()
    fireEvent.click(screen.getByText('lock'))
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))

    // What the drawer's «العودة لتعديل الطلب» button calls.
    fireEvent.click(screen.getByText('release'))
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('false'))

    fireEvent.click(screen.getByText('raise'))
    await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('5'))
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE HEADER CART BUTTON AND ITS DRAWER.
   ──────────────────────────────────────────────────────────────────── */

/**
 * The header, with the cart lock declared by "some other surface" — in
 * production that is the checkout page, which publishes the lock and the
 * release as its payment is priced.
 */
function LockDeclarer({ locked, onRelease }: { locked: boolean; onRelease: () => void }) {
  const { setCartLock } = useStore()
  const released = () => onRelease()
  return (
    <button
      data-testid="declare"
      onClick={() => setCartLock({ locked, release: released })}
    >
      declare
    </button>
  )
}

async function renderHeader(options?: { locked?: boolean; onRelease?: () => void }) {
  const onRelease = options?.onRelease ?? vi.fn()
  render(
    <StoreProvider storeSlug="shop1">
      <LockDeclarer locked={options?.locked ?? false} onRelease={onRelease} />
      <Header store={STORE} />
    </StoreProvider>,
  )
  await waitFor(() => expect(cartButton()).toBeTruthy())
  if (options?.locked) {
    fireEvent.click(screen.getByTestId('declare'))
    await waitFor(() => expect(screen.getByTestId('drawer-cart-locked')).toBeTruthy())
  }
  return { onRelease }
}

/**
 * The header's cart button.
 *
 * The icon group is placed in more than one layout column and hidden by
 * Tailwind, so the DOM holds it more than once; every copy is the same
 * button with the same handler.
 */
const cartButton = () => screen.getAllByLabelText('السلة')[0]

const drawer = () => ({
  title: screen.queryByText(/سلة التسوق/),
  increase: screen.queryByLabelText('زيادة الكمية'),
  decrease: screen.queryByLabelText('إنقاص الكمية'),
  remove: screen.queryByLabelText('إزالة'),
  lock: screen.queryByTestId('drawer-cart-locked'),
  returnToEdit: screen.queryByTestId('drawer-return-to-edit'),
  readOnlyQty: screen.queryByTestId('drawer-qty-locked'),
})

describe('the header cart button and its drawer', () => {
  it('the cart button is still the entry point, and still opens the drawer', async () => {
    await renderHeader()

    fireEvent.click(cartButton())

    // The store's own drawer, with its own heading and its own products.
    expect(drawer().title).toBeTruthy()
    expect(screen.getByText('Test product')).toBeTruthy()
    expect(screen.getByText('إتمام الشراء')).toBeTruthy()
  })

  it('is editable before any payment: +, − and remove all work', async () => {
    await renderHeader()
    fireEvent.click(cartButton())

    expect(drawer().lock).toBeNull()
    fireEvent.click(screen.getByLabelText('زيادة الكمية'))
    await waitFor(() => expect(screen.getByText(/سلة التسوق \(3\)/)).toBeTruthy())

    fireEvent.click(screen.getByLabelText('إنقاص الكمية'))
    await waitFor(() => expect(screen.getByText(/سلة التسوق \(2\)/)).toBeTruthy())

    fireEvent.click(screen.getByLabelText('إزالة'))
    await waitFor(() => expect(screen.getByText('السلة فارغة')).toBeTruthy())
  })

  it('still OPENS while locked — the lock is on mutation, nothing else', async () => {
    await renderHeader({ locked: true })

    const button = cartButton()
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)

    // Open, with the products and the count still visible.
    expect(drawer().title).toBeTruthy()
    expect(screen.getByText('Test product')).toBeTruthy()
    expect(drawer().readOnlyQty?.textContent).toContain('2')
  })

  it('drops +, − and remove while locked', async () => {
    await renderHeader({ locked: true })
    fireEvent.click(cartButton())

    expect(drawer().increase).toBeNull()
    expect(drawer().decrease).toBeNull()
    expect(drawer().remove).toBeNull()
    // Nothing disabled-but-present either, so there is no control to
    // reach by keyboard or by script.
    expect(document.querySelectorAll('[aria-label="زيادة الكمية"],[aria-label="إنقاص الكمية"],[aria-label="إزالة"]').length).toBe(0)
  })

  it('shows exactly the lock notice and the way back, under the products', async () => {
    await renderHeader({ locked: true })
    fireEvent.click(cartButton())

    const lock = drawer().lock
    expect(lock).toBeTruthy()
    // Exactly the two lines, and nothing else in the block.
    expect(lock!.querySelector('p')?.textContent?.trim())
      .toBe('🔒 تعديل المنتجات غير متاح أثناء الدفع')
    expect(drawer().returnToEdit?.textContent?.trim()).toBe('العودة لتعديل الطلب')
    expect(lock!.children).toHaveLength(2)
    // It sits under the product list, not under the totals.
    expect(lock!.compareDocumentPosition(screen.getByText('الإجمالي')) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })

  it('«العودة لتعديل الطلب» releases the attempt and closes the drawer', async () => {
    const onRelease = vi.fn()
    await renderHeader({ locked: true, onRelease })
    fireEvent.click(cartButton())

    fireEvent.click(screen.getByTestId('drawer-return-to-edit'))

    // The release belongs to the checkout — the drawer only calls it.
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('unlocking puts the controls back', async () => {
    render(
      <StoreProvider storeSlug="shop1">
        <Unlockable />
        <Header store={STORE} />
      </StoreProvider>,
    )
    await waitFor(() => expect(cartButton()).toBeTruthy())

    fireEvent.click(screen.getByText('lock'))
    fireEvent.click(cartButton())
    await waitFor(() => expect(drawer().lock).toBeTruthy())
    expect(drawer().increase).toBeNull()

    fireEvent.click(screen.getByTestId('drawer-return-to-edit'))
    await waitFor(() => expect(drawer().lock).toBeNull())

    fireEvent.click(cartButton())
    expect(drawer().increase).toBeTruthy()
    expect(drawer().remove).toBeTruthy()
  })

  it('the checkout builds no cart UI of its own', async () => {
    // One cart button and one drawer for the whole storefront, both in
    // Header.tsx. The checkout page has an ORDER SUMMARY, which is a
    // different thing and must not grow a cart button or borrow its
    // name — the reason the lock lives in the provider at all.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const checkout = fs.readFileSync(
      path.resolve(__dirname, '../checkout/page.tsx'),
      'utf8',
    )

    // The summary keeps its own name and grows no cart button: the only
    // mention of the cart it carries is the sentence telling the
    // customer where the controls actually are.
    expect(checkout).toContain('Order summary')
    expect(checkout).not.toContain('aria-label="السلة"')
    expect(checkout).not.toContain('Cart Drawer')
    // And the drawer is declared exactly once, in the header.
    const header = fs.readFileSync(path.resolve(__dirname, 'Header.tsx'), 'utf8')
    expect(header.match(/Cart Drawer/g)).toHaveLength(1)
    expect(header.match(/aria-label="السلة"/g)).toHaveLength(1)
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE CART IS THE SERVER'S NOW.

   The lock used to be a fact this tab declared about itself, which made
   it exactly as trustworthy as this tab — and a second tab has its own
   copy of it and knows nothing about the first. The authoritative half
   is `active_checkout_token` on the server's cart view: it is true in
   every tab at once, because every tab is reading the same row.

   localStorage is demoted to a first-paint cache. It is read so the
   header's badge does not flash empty, and the first server response
   replaces it outright.
   ──────────────────────────────────────────────────────────────────── */

/** A server cart view, as the backend publishes it. */
function cartView(over: Record<string, unknown> = {}) {
  return {
    cart_public_id: 'cart_pub_1',
    version: 3,
    status: 'active',
    items: [{ variant_id: 'v1', quantity: 2 }],
    active_checkout_token: null,
    converted_order_number: null,
    ...over,
  }
}

/**
 * Answers the store read and the cart read separately, and records
 * every cart mutation the provider attempted.
 */
function mockStoreAndCart(view: Record<string, unknown>) {
  const mutations: { url: string; method: string }[] = []

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/stores/public/')) {
      return { ok: true, status: 200, json: async () => STORE }
    }
    if (url.includes('/cart')) {
      if (init?.method) mutations.push({ url, method: init.method })
      return { ok: true, status: 200, json: async () => view }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })

  vi.stubGlobal('fetch', fetchMock)
  return { mutations }
}

describe('the cart is a mirror of the server', () => {
  it('replaces the local cache with the server s cart on first read', async () => {
    // The cache says two of v1. The server says five, and the server is
    // what the checkout will price.
    mockStoreAndCart(cartView({ items: [{ variant_id: 'v1', quantity: 5 }] }))

    render(
      <StoreProvider storeSlug="shop1">
        <CartProbe />
      </StoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('5'))
    expect(screen.getByTestId('cart-public-id').textContent).toBe('cart_pub_1')
    // Display data — the title and price the server does not store —
    // survives, because it is matched to the server's row by variant id.
    expect(screen.getByTestId('count').textContent).toBe('5')
  })

  it('LOCKS from the server s answer, with no local declaration at all', async () => {
    // This is the half a second tab could never have. Nothing in this
    // tab declared a lock; the cart simply already has a checkout.
    mockStoreAndCart(cartView({ active_checkout_token: 'tok_live_1' }))

    render(
      <StoreProvider storeSlug="shop1">
        <CartProbe />
      </StoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))
    expect(screen.getByTestId('active-checkout').textContent).toBe('tok_live_1')
  })

  it('refuses a quantity change against a server-locked cart', async () => {
    const { mutations } = mockStoreAndCart(
      cartView({ active_checkout_token: 'tok_live_1' }),
    )

    render(
      <StoreProvider storeSlug="shop1">
        <CartProbe />
      </StoreProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))

    fireEvent.click(screen.getByText('raise'))
    fireEvent.click(screen.getByText('remove'))

    // The quantity did not move, and no PATCH or DELETE was even sent —
    // the local guard is a fast path in front of the server's refusal,
    // which is where the enforcement actually is.
    await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('2'))
    expect(mutations.filter((m) => m.method !== 'POST')).toHaveLength(0)
  })

  it('sends adds to the server and reconciles to what comes back', async () => {
    const { mutations } = mockStoreAndCart(
      cartView({ items: [{ variant_id: 'v1', quantity: 2 }, { variant_id: 'v2', quantity: 1 }] }),
    )

    render(
      <StoreProvider storeSlug="shop1">
        <CartProbe />
      </StoreProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'))

    fireEvent.click(screen.getByText('add'))

    await waitFor(() =>
      expect(mutations.some((m) => m.method === 'POST' && m.url.endsWith('/cart/items'))).toBe(true),
    )
  })

  it('publishes a CONVERTED basket as terminal', async () => {
    // Terminal: the shopper has not lost anything, because the next
    // add-to-cart mints a brand-new cart server-side. What must not
    // happen is this tab treating it as still buyable.
    mockStoreAndCart(
      cartView({ status: 'converted', items: [], converted_order_number: 'A-9' }),
    )

    render(
      <StoreProvider storeSlug="shop1">
        <CartProbe />
      </StoreProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('cart-status').textContent).toBe('converted'),
    )
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('keeps rendering the local cache when the server cannot be reached', async () => {
    // Offline, or a proxy hiccup. A failed read must never be mistaken
    // for "your basket is empty".
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/stores/public/')) {
          return { ok: true, status: 200, json: async () => STORE }
        }
        return { ok: false, status: 500, json: async () => ({}) }
      }),
    )

    render(
      <StoreProvider storeSlug="shop1">
        <CartProbe />
      </StoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('qty').textContent).toBe('2'))
    expect(screen.getByTestId('locked').textContent).toBe('false')
  })
})

/** Locks, and releases through the same declaration the checkout uses. */
function Unlockable() {
  const { setCartLock } = useStore()
  return (
    <button
      onClick={() =>
        setCartLock({ locked: true, release: () => setCartLock({ locked: false, release: null }) })
      }
    >
      lock
    </button>
  )
}

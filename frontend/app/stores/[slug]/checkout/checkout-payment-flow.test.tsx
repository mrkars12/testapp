import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

/* ══════════════════════════════════════════════════════════════════════
   Regression proof for the embedded-first / same-tab-redirect checkout.

   What this file exists to prevent coming back:

     • the two-tab flow — a "جاري الدفع" page in tab 1 while the gateway
       lived in tab 2, with the outcome depending on which page happened
       to be mounted where, and a declined payment stranding the payer on
       the provider's page with nothing sending them back;
     • an outcome decided by anything other than the server;
     • a customer losing their cart, their order, or their checkout
       because a payment failed.

   Every assertion below is about the CUSTOMER storefront checkout. The
   merchant Test Payment tool is a separate surface with its own flow and
   is deliberately untouched by any of this.
   ══════════════════════════════════════════════════════════════════════ */

const push = vi.fn()
let searchParams = new URLSearchParams('')

/*
 * `router.replace` changes the URL, and therefore the query.
 *
 * The checkout uses it to take a spent token back OUT of the URL. An
 * inert mock left the token in `searchParams` forever, so a test could
 * never see the page as it exists after a retry — the same blind spot
 * that hid the amount bug, in the other direction.
 */
const replace = vi.fn((url: string) => {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  setSearchParams(new URLSearchParams(query))
})

/*
 * `useSearchParams` is REACTIVE here, like the real one.
 *
 * Next's App Router patches `window.history.replaceState` so that a raw
 * call to it re-renders every `useSearchParams()` consumer with the new
 * query. The checkout relies on that: it writes the checkout token into
 * the URL with `history.replaceState` while the payment is in flight.
 *
 * Modelling `replaceState` as an inert `vi.fn()` — which this file did —
 * meant `searchParams` never changed in a test, so no test could see the
 * state the page is actually in once the token lands in the URL. A real
 * amount-display bug lived in exactly that blind spot. The store below
 * closes it.
 */
const searchParamsListeners = new Set<() => void>()

function setSearchParams(next: URLSearchParams) {
  searchParams = next
  searchParamsListeners.forEach((notify) => notify())
}

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useRouter: () => ({ push, replace, refresh: vi.fn() }),
    useParams: () => ({ slug: 'shop1' }),
    useSearchParams: () =>
      useSyncExternalStore(
        (notify: () => void) => {
          searchParamsListeners.add(notify)
          return () => searchParamsListeners.delete(notify)
        },
        () => searchParams,
        () => searchParams,
      ),
  }
})

const ITEM = {
  variantId: 'v1',
  productId: 'p1',
  productHandle: 'p1',
  title: 'Test product',
  price: 100,
  image: null,
  qty: 1,
}

/**
 * The store context, with a cart that really empties.
 *
 * `clearCart` has to actually clear: several assertions below are about
 * what the page shows *after* the cart is gone (the amount, the summary),
 * and a mock that keeps the cart forever would pass them for the wrong
 * reason.
 */
let cart: (typeof ITEM)[] = [ITEM]
const cartListeners = new Set<() => void>()
/**
 * A real quantity update, for the same reason `clearCart` is real.
 *
 * An inert `vi.fn()` here meant no test could see what the page does
 * when the cart changes UNDER a payment — which is exactly where the
 * cart/checkout mismatch lived.
 */
const updateCartQty = vi.fn((variantId: string, qty: number) => {
  cart = qty <= 0
    ? cart.filter((item) => item.variantId !== variantId)
    : cart.map((item) => (item.variantId === variantId ? { ...item, qty } : item))
  cartListeners.forEach((notify) => notify())
})

const removeFromCart = vi.fn((variantId: string) => {
  cart = cart.filter((item) => item.variantId !== variantId)
  cartListeners.forEach((notify) => notify())
})

/**
 * The storefront's cart lock, as the provider implements it.
 *
 * The page does not keep the lock to itself — it publishes it, and the
 * header's cart drawer renders from the same fact. Recorded here so the
 * assertions can see WHAT was published, and hold the release callback
 * the drawer's button would call.
 *
 * The mutators above stay unconditional on purpose: in a real browser
 * the provider refuses them while locked (asserted in
 * StoreContext.cartLock.test.tsx), and a direct call here stands for the
 * OTHER TAB, which has its own provider and no lock at all.
 */
let publishedLock: { locked: boolean; release: (() => void) | null } = { locked: false, release: null }
const setCartLock = vi.fn((lock: { locked: boolean; release?: (() => void) | null }) => {
  publishedLock = {
    locked: lock.locked,
    release: lock.locked ? lock.release ?? publishedLock.release ?? null : null,
  }
})

/** This browser's cart, as the server names it in a cross-tab ping. */
const CART_PUBLIC_ID = 'cart_pub_1'

/**
 * The basket's server-side state, mutable so a test can move it.
 *
 * `converted` is terminal and means an order exists for this basket —
 * placed here or in another tab.
 */
let cartStatus: 'active' | 'converted' | 'abandoned' = 'active'
const refreshCart = vi.fn(async () => {})

const clearCart = vi.fn(() => {
  cart = []
  // The real StoreProvider holds the cart in React state, so clearing it
  // re-renders. Subscribers make this mock do the same — otherwise the
  // page would keep rendering a cart that no longer exists and the
  // assertions about what shows *after* a successful payment would pass
  // for the wrong reason.
  cartListeners.forEach((notify) => notify())
})

vi.mock('../components/StoreContext', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useStore: () => {
      const current = useSyncExternalStore(
        (notify: () => void) => {
          cartListeners.add(notify)
          return () => cartListeners.delete(notify)
        },
        () => cart,
        () => cart,
      )
      return {
        store: { currency: 'SAR' },
        storeSlug: 'shop1',
        cart: current,
        cartCount: current.length,
        cartTotal: current.reduce((sum, item) => sum + item.price * item.qty, 0),
        updateCartQty,
        removeFromCart,
        clearCart,
        cartLocked: publishedLock.locked,
        releaseCartLock: publishedLock.release,
        setCartLock,
        /*
         * The SERVER's answers about the basket.
         *
         * `cartStatus` is what a second tab learns when the first one
         * pays, and it is the whole trigger for tearing the provider's
         * form out of the document. Held in a mutable binding so a test
         * can make the server change its mind, exactly as the cart
         * itself is.
         */
        cartStatus,
        cartPublicId: CART_PUBLIC_ID,
        cartVersion: 1,
        activeCheckoutToken: null,
        convertedOrderNumber: cartStatus === 'converted' ? 'A-1003' : null,
        refreshCart,
      }
    },
  }
})

/**
 * The provider's form loader.
 *
 * `loadMoyasarForm` really injects a <script> from cdn.moyasar.com, which
 * jsdom cannot fetch — and which no test should reach out to anyway. The
 * loader and the mount are stubbed; `readFormConfig` and
 * `resolveFormVersion` are kept real, because what the page hands the
 * provider is exactly what these assertions are about.
 */
// vi.hoisted: vi.mock's factory is lifted above these declarations, so
// plain consts would not exist yet when it runs.
const { loadMoyasarForm, mountMoyasarForm } = vi.hoisted(() => ({
  loadMoyasarForm: vi.fn(async () => ({ init: vi.fn() })),
  /*
   * A provider that actually RENDERS into the element it is handed.
   *
   * An inert `vi.fn()` meant the container stayed empty forever, so no
   * test could see the window between "the next action arrived" and
   * "there are card fields on screen" — which is where a real browser
   * spent ~1s showing the panel's method row, amount and "change payment
   * method" button around an empty box. The page now waits for real
   * content before showing that chrome, and this mock is what lets the
   * assertions below see either behaviour.
   */
  mountMoyasarForm: vi.fn((...args: unknown[]) => {
    // Rest-typed so the call-argument readers below (`providerConfig`
    // reads [3], `formHandlers` reads [4]) still see the real arity.
    const element = args[1] as HTMLElement | undefined
    if (!element) return
    const field = document.createElement('div')
    field.className = 'mysr-form'
    element.appendChild(field)
  }),
}))

vi.mock('@/lib/payments/moyasarForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/moyasarForm')>()
  return { ...actual, loadMoyasarForm, mountMoyasarForm }
})

import CheckoutPage from './page'
import { PHASE_HEADLINE } from '@/lib/payments/checkoutMachine'

const TOKEN = 'a1b2c3d4e5f60718'
const GATEWAY_URL = 'https://api.moyasar.com/v1/invoices/inv_123'

/** A gateway that officially requires a hosted page. */
const REDIRECT_OFFERING = {
  id: 'offering-redirect',
  method: 'card',
  gateway: 'moyasar',
  name_ar: 'بطاقة',
  name_en: 'Card',
  commitment_kind: 'funds_secured',
  position: 0,
  policy: null,
  presentation_mode: 'same_tab_redirect',
  next_action_kinds: ['redirect'],
}

/** Cash on delivery: never leaves the site. */
const OFFLINE_OFFERING = {
  id: 'offering-cod',
  method: 'cod',
  gateway: 'cod',
  name_ar: 'الدفع عند الاستلام',
  name_en: 'Cash on delivery',
  commitment_kind: 'promise_accepted',
  position: 1,
  policy: null,
  presentation_mode: 'offline',
  next_action_kinds: [],
}

let assign: ReturnType<typeof vi.fn>
let openSpy: ReturnType<typeof vi.fn>
/** A POST next action submits a hidden form; jsdom cannot navigate, so it
    is stubbed and inspected instead. */
let submitSpy: ReturnType<typeof vi.spyOn>
let reload: ReturnType<typeof vi.fn>
let replaceState: ReturnType<typeof vi.fn>

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

/**
 * Wires `fetch` for the three storefront endpoints this page uses.
 * `statuses` is consumed one reading at a time so a test can make the
 * server change its mind between polls.
 */
function mockApi(options: {
  offerings?: unknown[]
  checkout?: unknown
  checkoutStatus?: number
  statuses?: unknown[]
}) {
  const statuses = [...(options.statuses ?? [])]
  const calls: { url: string; init?: RequestInit }[] = []

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })

    if (url.includes('/payment-methods')) {
      return json(options.offerings ?? [REDIRECT_OFFERING])
    }
    if (url.endsWith('/sync') && init?.method === 'POST') {
      return json({})
    }
    if (url.includes('/checkout/') ) {
      const next = statuses.length > 1 ? statuses.shift() : statuses[0]
      return json(next ?? { payment_status: 'processing', order: null })
    }
    if (url.endsWith('/checkout') && init?.method === 'POST') {
      return json(options.checkout ?? {}, options.checkoutStatus ?? 200)
    }
    return json({}, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

async function fillForm() {
  await waitFor(() => screen.getByText('بطاقة'))
  fireEvent.change(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'Jane Doe' } })
  fireEvent.change(screen.getByPlaceholderText('+1 555 000 0000'), { target: { value: '+1 555 000 0000' } })
  fireEvent.change(screen.getByPlaceholderText('jane@example.com *'), { target: { value: 'jane@example.com' } })
  fireEvent.change(screen.getByPlaceholderText('123 Main St, Apt 4B'), { target: { value: '123 Main St, Apt 4B' } })
  fireEvent.change(screen.getByPlaceholderText('Cairo'), { target: { value: 'Cairo' } })
}

function payButton() {
  return screen.getByRole('button', { name: /place order/i })
}

beforeEach(() => {
  push.mockClear()
  replace.mockClear()
  clearCart.mockClear()
  updateCartQty.mockClear()
  removeFromCart.mockClear()
  mountMoyasarForm.mockClear()
  loadMoyasarForm.mockClear()
  loadMoyasarForm.mockResolvedValue({ init: vi.fn() })
  cart = [ITEM]
  cartStatus = 'active'
  refreshCart.mockClear()
  // The succession record lives here (lib/payments/checkoutSync.ts) and
  // is per TAB: one test's chain must not be visible to the next.
  try { sessionStorage.clear() } catch { /* jsdom always has it */ }
  setCartLock.mockClear()
  publishedLock = { locked: false, release: null }
  cartListeners.clear()
  setSearchParams(new URLSearchParams(''))

  assign = vi.fn()
  openSpy = vi.fn()
  submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
  reload = vi.fn()
  searchParamsListeners.clear()
  // Next patches this to keep `useSearchParams()` in sync; so does this.
  replaceState = vi.fn((_state: unknown, _title: unknown, url?: string) => {
    if (typeof url === 'string') {
      const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
      setSearchParams(new URLSearchParams(query))
    }
  })

  vi.stubGlobal('open', openSpy)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: 'https://shop.test',
      href: 'https://shop.test/stores/shop1/checkout',
      assign,
      reload,
    },
  })
  Object.defineProperty(window, 'history', {
    configurable: true,
    value: { ...window.history, replaceState },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ────────────────────────────────────────────────────────────────────
   Legacy two-tab UI — the strings themselves

   These exist because a report once claimed this UI was gone and the
   claim could not be checked at a glance. The strings below are the
   merchant Test Payment tool's waiting screen
   (app/(protected)/store/[storeSlug]/settings/payments/test/page.tsx),
   which is a DIFFERENT surface and is allowed to keep them. What must
   never happen is any of them rendering in the CUSTOMER checkout.
   ──────────────────────────────────────────────────────────────────── */

const LEGACY_TWO_TAB_STRINGS = [
  'أكمل الدفع',
  'تم فتح صفحة الدفع في نافذة جديدة',
  'إلغاء والرجوع',
  'إلغاء والعودة',
  'نافذة جديدة',
]

function expectNoLegacyTwoTabUi() {
  for (const legacy of LEGACY_TWO_TAB_STRINGS) {
    expect(screen.queryByText(new RegExp(legacy))).toBeNull()
  }
}

describe('the legacy two-tab screen can never render in the customer checkout', () => {
  it('is absent on the idle checkout', async () => {
    mockApi({})
    render(<CheckoutPage />)
    await fillForm()
    expectNoLegacyTwoTabUi()
  })

  it('is absent at every moment of a redirect payment', async () => {
    mockApi({ checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } } })
    render(<CheckoutPage />)
    await fillForm()
    expectNoLegacyTwoTabUi()

    fireEvent.click(payButton())
    await waitFor(() => expect(assign).toHaveBeenCalled())
    // The instant the old flow used to show "تم فتح صفحة الدفع في نافذة جديدة".
    expectNoLegacyTwoTabUi()
  })

  it('is absent on the return, whatever the outcome', async () => {
    for (const status of ['captured', 'failed', 'cancelled', 'requires_action']) {
      cleanup()
      searchParams = new URLSearchParams(`token=${TOKEN}`)
      mockApi({ statuses: [{ payment_status: status, order: status === 'captured' ? { order_number: 'A-1', payment_status: 'PAID', total: '10' } : null }] })
      render(<CheckoutPage />)
      await waitFor(() => screen.getByRole('status'))
      expectNoLegacyTwoTabUi()
    }
  })

  it('never opens a window, under any next action the backend can return', async () => {
    const actions = [
      { kind: 'redirect', url: GATEWAY_URL, method: 'GET' },
      { kind: 'redirect', url: GATEWAY_URL, method: 'POST', form_fields: { a: 'b' } },
      { kind: 'bank_instructions', iban: 'X' },
      null,
    ]
    for (const next_action of actions) {
      cleanup()
      openSpy.mockClear()
      // The offline branches empty the cart; each iteration needs its own.
      cart = [ITEM]
      cartListeners.clear()
      searchParams = new URLSearchParams('')
      mockApi({ checkout: { checkout_token: TOKEN, next_action, order: { order_number: 'A-1' } } })
      render(<CheckoutPage />)
      await fillForm()
      fireEvent.click(payButton())
      await waitFor(() => expect(assign.mock.calls.length + push.mock.calls.length + submitSpy.mock.calls.length).toBeGreaterThan(0))
      expect(openSpy).not.toHaveBeenCalled()
    }
  })

  it('renders no anchor or form that targets another window', async () => {
    mockApi({ checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'POST', form_fields: { a: 'b' } } } })
    const { container } = render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(submitSpy).toHaveBeenCalled())
    expect(container.querySelector('[target="_blank"]')).toBeNull()
    expect(document.querySelector('form[target]')).toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────
   Same-tab redirect
   ──────────────────────────────────────────────────────────────────── */

describe('a gateway that requires a hosted page', () => {
  it('takes THIS tab to the provider — no second tab, no popup', async () => {
    mockApi({ checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } } })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(assign).toHaveBeenCalledWith(GATEWAY_URL))
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('writes the checkout token into this tab before it leaves', async () => {
    // Without this, a Back from the provider — or a refresh at any point
    // after — lands on a checkout with no idea which payment to verify.
    mockApi({ checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } } })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(null, '', `/stores/shop1/checkout?token=${TOKEN}`),
    )
  })

  it('sends the return URL back to this same checkout page', async () => {
    // Not the home page, not a store chooser, not a generic waiting page.
    const { calls } = mockApi({
      checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } },
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(assign).toHaveBeenCalled())
    const post = calls.find((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')!
    const body = JSON.parse(String(post.init!.body))
    expect(body.return_url).toBe('https://shop.test/stores/shop1/checkout')
  })

  it('never sends the amount, currency or store from the client', async () => {
    const { calls } = mockApi({
      checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } },
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(assign).toHaveBeenCalled())
    const post = calls.find((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')!
    const body = JSON.parse(String(post.init!.body))
    expect(body.amount).toBeUndefined()
    expect(body.currency).toBeUndefined()
    expect(body.total).toBeUndefined()
    expect(body.store_id).toBeUndefined()
    // The store comes from the URL path and is authorized server-side.
    expect(post.url).toBe('/api/storefront/shop1/checkout')
  })

  it('does not clear the cart on the way out', async () => {
    // Clearing it here is what made a declined payment unrecoverable:
    // the customer came back to an empty cart and an unpaid order.
    mockApi({ checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } } })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(clearCart).not.toHaveBeenCalled()
  })

  it('refuses to navigate to a non-http action URL', async () => {
    mockApi({
      checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: 'javascript:alert(1)', method: 'GET' } },
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(assign).not.toHaveBeenCalled()
  })
})

/* ────────────────────────────────────────────────────────────────────
   Coming back — the same checkout, verified by the server
   ──────────────────────────────────────────────────────────────────── */

describe('returning from the provider', () => {
  it('shows the amount the SERVER recorded, not the emptied cart', async () => {
    // The cart is cleared the moment a payment succeeds, so reading the
    // live cart after that renders a completed payment as "0".
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({
      statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID', total: '250' } }],
    })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.getByText('250 SAR')).toBeTruthy()
  })

  it('does not present an auto-selected method as the one that was paid with', async () => {
    // After a return, the radio on screen is a default this page picked
    // for a form the customer never filled in.
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID', total: '250' } }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.queryByText('طريقة الدفع')).toBeNull()
    expect(screen.getByText('إجمالي الطلب')).toBeTruthy()
  })

  it('drops the cart summary once the cart it described has been emptied', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID', total: '250' } }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    // "0 items / 0 SAR" beside a paid 250 SAR order describes nothing
    // that is true.
    await waitFor(() => expect(screen.queryByText('Order summary')).toBeNull())
  })

  it('verifies with the server and shows success on the same page', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    const { calls } = mockApi({
      statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID', total: '100' } }],
    })

    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    // The server was asked; the URL parameter alone decided nothing.
    expect(calls.some((c) => c.url.endsWith(`/checkout/${TOKEN}`))).toBe(true)
    expect(screen.getByText('A-1001')).toBeTruthy()
    /*
     * No `/sync` here, deliberately. Sync exists to pull provider state
     * when OUR record might be behind; this record already reads
     * `captured`, which is terminal, so there is nothing a provider call
     * could add and no reason to make one every time a settled checkout
     * is opened again. The two cases where our record is NOT terminal —
     * a genuine first return, and reconciliation from a browser event —
     * still sync, and are asserted where they happen.
     */
    expect(calls.some((c) => c.url.endsWith(`/checkout/${TOKEN}/sync`))).toBe(false)
  })

  it('updates without reloading the document', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID' } }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    expect(reload).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('empties the cart only once the server confirms the money', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID' } }] })

    render(<CheckoutPage />)
    await waitFor(() => expect(clearCart).toHaveBeenCalled())
  })

  it('keeps a declined payment inside the checkout, with a way to retry', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'failed', order: null }] })

    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'تغيير طريقة الدفع' })).toBeTruthy()
    // Not sent to login, a store chooser, a home page or anywhere else.
    expect(push).not.toHaveBeenCalled()
    expect(clearCart).not.toHaveBeenCalled()
  })

  it('says cancelled, not failed, when the payer walked away', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}&stripe_cancelled=1`)
    mockApi({ statuses: [{ payment_status: 'cancelled', order: null }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم إلغاء عملية الدفع'))
    expect(screen.queryByText('لم تتم عملية الدفع')).toBeNull()
  })

  it('stays pending — and does NOT claim the order is paid — on an intermediate state', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'requires_action', order: null }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('جارٍ معالجة الدفع'))
    expect(screen.queryByText('تم الدفع بنجاح')).toBeNull()
    expect(clearCart).not.toHaveBeenCalled()
  })

  it('does not treat a provider cancel parameter as an outcome', async () => {
    // The customer can complete a payment and still land on a cancel URL.
    // The server's word wins.
    searchParams = new URLSearchParams(`token=${TOKEN}&stripe_cancelled=1`)
    mockApi({ statuses: [{ payment_status: 'captured', order: { order_number: 'A-1001', payment_status: 'PAID' } }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
  })

  it('ignores a malformed token instead of asking the server about it', async () => {
    searchParams = new URLSearchParams('token=../../admin')
    const { calls } = mockApi({})

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('بطاقة'))
    expect(calls.some((c) => c.url.includes('admin'))).toBe(false)
  })

  it('recovers the payment context after a refresh mid-payment', async () => {
    // A refresh while the payment is in flight is just a page load with
    // the token still in the URL — the checkout picks the same payment
    // back up rather than starting a second one.
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    const { calls } = mockApi({ statuses: [{ payment_status: 'processing', order: null }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('جارٍ معالجة الدفع'))
    expect(calls.some((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')).toBe(false)
  })
})

/* ────────────────────────────────────────────────────────────────────
   Retry
   ──────────────────────────────────────────────────────────────────── */

describe('retry after a failure', () => {
  it('says what is missing, and "change payment method" is what returns to the form', async () => {
    // The server sent no payer details, so this retry cannot repeat the
    // payment. It says so ON THE FAILURE PANEL and stays there: silently
    // rendering the data-entry screen reads as "your order was thrown
    // away", which is not what happened.
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ statuses: [{ payment_status: 'failed', order: null }] })

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByRole('alert'))
    expect(screen.getByRole('alert').textContent).toMatch(/اختر طريقة دفع أخرى/)
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()

    // The way on is the other button, which is what it has always meant.
    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Jane Doe')).toBeTruthy())
    expect(replace).toHaveBeenCalledWith('/stores/shop1/checkout', { scroll: false })
  })
})

/* ────────────────────────────────────────────────────────────────────
   Duplicate protection
   ──────────────────────────────────────────────────────────────────── */

describe('pressing Pay more than once', () => {
  it('starts exactly one payment', async () => {
    const { calls } = mockApi({
      checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } },
    })
    render(<CheckoutPage />)
    await fillForm()

    const button = payButton()
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')).toHaveLength(1)
  })

  it('carries an idempotency key so a retried request cannot double-charge', async () => {
    const { calls } = mockApi({
      checkout: { checkout_token: TOKEN, next_action: { kind: 'redirect', url: GATEWAY_URL, method: 'GET' } },
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(assign).toHaveBeenCalled())
    const post = calls.find((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')!
    const headers = post.init!.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeTruthy()
  })

  it('does not start a second payment when the server says one is in flight', async () => {
    mockApi({ checkout: { message: 'This order is already being placed.' }, checkoutStatus: 409 })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => screen.getByText('هذا الطلب قيد المعالجة بالفعل — انتظر لحظة من فضلك.'))
    expect(assign).not.toHaveBeenCalled()
  })
})

/* ────────────────────────────────────────────────────────────────────
   Capability-driven method list
   ──────────────────────────────────────────────────────────────────── */

describe('which methods the checkout will offer', () => {
  it('never offers a method whose action kind it cannot render', async () => {
    mockApi({
      offerings: [
        REDIRECT_OFFERING,
        { ...OFFLINE_OFFERING, id: 'offering-kiosk', name_en: 'Kiosk', next_action_kinds: ['reference_code'] },
      ],
    })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('بطاقة'))
    expect(screen.queryByText('Kiosk')).toBeNull()
  })

  it('tells the customer whether paying will move the page', async () => {
    mockApi({ offerings: [REDIRECT_OFFERING, OFFLINE_OFFERING] })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('بطاقة'))
    expect(screen.getByText('تحويل آمن ثم العودة لهذه الصفحة')).toBeTruthy()
    expect(screen.getByText('الدفع داخل هذه الصفحة')).toBeTruthy()
  })

  it('takes an offline method straight to the order confirmation', async () => {
    mockApi({
      offerings: [OFFLINE_OFFERING],
      checkout: { checkout_token: TOKEN, next_action: null, order: { order_number: 'A-1002' } },
    })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('الدفع عند الاستلام'))

    fireEvent.change(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByPlaceholderText('+1 555 000 0000'), { target: { value: '+1 555 000 0000' } })
    fireEvent.change(screen.getByPlaceholderText('123 Main St, Apt 4B'), { target: { value: '123 Main St' } })
    fireEvent.change(screen.getByPlaceholderText('Cairo'), { target: { value: 'Cairo' } })
    fireEvent.click(payButton())

    await waitFor(() => expect(push).toHaveBeenCalledWith('/stores/shop1/checkout/success?order=A-1002'))
    // Nothing left the site.
    expect(assign).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('never claims success for an offline order it has no server figures for', async () => {
    // The offline path polls nothing — no gateway was involved — so there
    // is no server order total to show. Entering the PAID panel here
    // rendered "تم الدفع بنجاح" next to a total of 0, because the cart had
    // just been emptied. The confirmation page owns this outcome.
    mockApi({
      offerings: [OFFLINE_OFFERING],
      checkout: { checkout_token: TOKEN, next_action: null, order: { order_number: 'A-1002' } },
    })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('الدفع عند الاستلام'))

    fireEvent.change(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByPlaceholderText('+1 555 000 0000'), { target: { value: '+1 555 000 0000' } })
    fireEvent.change(screen.getByPlaceholderText('123 Main St, Apt 4B'), { target: { value: '123 Main St' } })
    fireEvent.change(screen.getByPlaceholderText('Cairo'), { target: { value: 'Cairo' } })
    fireEvent.click(payButton())

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(screen.queryByText('تم الدفع بنجاح')).toBeNull()
    expect(screen.queryByText('0 SAR')).toBeNull()
  })

  it('refuses an action kind it has no renderer for, rather than faking one', async () => {
    // The checkout renders `redirect`, `bank_instructions`, `none` and
    // `client_sdk`. Anything else must be said out loud — never wrapped
    // in an improvised surface the provider never published.
    mockApi({
      offerings: [REDIRECT_OFFERING],
      checkout: {
        checkout_token: TOKEN,
        next_action: { kind: 'reference_code', reference: 'REF-1' },
      },
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => screen.getByText('طريقة الدفع هذه غير مدعومة حالياً — اختر طريقة أخرى.'))
    expect(assign).not.toHaveBeenCalled()
  })
})

/* ────────────────────────────────────────────────────────────────────
   Embedded — the provider's own form, inside this page

   "Embedded" here means precisely one thing: the provider's official
   component runs in our checkout and our code never sees a card field.
   It does NOT mean an iframe wrapped around a hosted page, and it does
   NOT mean card fields of our own posting to our backend — the second
   would be the single worst outcome this whole flow can produce.
   ──────────────────────────────────────────────────────────────────── 
   ──────────────────────────────────────────────────────────────────── */

/** A gateway whose account is configured for its in-page form. */
const EMBEDDED_OFFERING = {
  ...REDIRECT_OFFERING,
  id: 'offering-embedded',
  presentation_mode: 'embedded',
  next_action_kinds: ['redirect', 'client_sdk'],
}

const CLIENT_SDK_ACTION = {
  kind: 'client_sdk',
  publishable_key: 'pk_test_visible_by_design',
  config: {
    amount: 10000,
    currency: 'SAR',
    description: 'Order A-1003',
    callback_url: `https://shop.test/stores/shop1/checkout?token=${TOKEN}`,
    methods: ['creditcard'],
    metadata: { intent_id: 'pi_1' },
  },
  sdk_hints: { form_version: '1.19.0' },
}

const embeddedCheckout = {
  checkout_token: TOKEN,
  next_action: CLIENT_SDK_ACTION,
  order: { order_number: 'A-1003' },
}

/**
 * What the server says on a GENUINE first return, before our confirm
 * binds the provider's payment to the intent. The confirm is what moves
 * it on — so a fixture whose very first read is already PAID describes a
 * return that has already been confirmed, not a new one.
 */
const UNCONFIRMED_RETURN = {
  payment_status: 'processing',
  attempt_status: 'requires_action',
  payment_attempt_started: true,
  order: null,
}

describe('Embedded checkout — the provider form is mounted, not simulated', () => {
  it('mounts the provider form in this page instead of leaving the site', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    // The whole point: no tab left, no window opened, no hosted page.
    expect(assign).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    expect(submitSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('embedded-payment-form')).toBeTruthy()
    expectNoLegacyTwoTabUi()
  })

  it('offers an embedded gateway instead of hiding it', async () => {
    // While nothing could render `client_sdk`, such an offering was
    // filtered out of the list. Now that it can be paid with, hiding it
    // would hide a working payment method.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await waitFor(() => expect(screen.getByText('بطاقة')).toBeTruthy())
  })

  it('gives the provider its publishable key and the server-priced amount, and nothing else', async () => {
    const { calls } = mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const [, element, publishableKey, rawConfig] = mountMoyasarForm.mock.calls[0]
    // The mock is rest-typed (see its definition), so the config comes
    // back as `unknown`; it is the provider's own config object.
    const config = rawConfig as { amount: number; currency: string; callback_url: string }
    expect(element).toBe(screen.getByTestId('embedded-payment-form'))
    // A publishable key is meant to be in the browser. A secret key is
    // not, and the backend never puts one in a next action.
    expect(publishableKey).toBe('pk_test_visible_by_design')
    expect(JSON.stringify(config)).not.toMatch(/sk_(test|live)_/)

    // The amount the form charges is the one the SERVER priced. The
    // client never sent an amount or a currency to create the checkout.
    expect(config.amount).toBe(10000)
    expect(config.currency).toBe('SAR')
    const created = calls.find((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    const body = JSON.parse(String(created?.init?.body))
    expect(body.amount).toBeUndefined()
    expect(body.currency).toBeUndefined()

    // The payer comes back to THIS checkout, carrying its token.
    expect(config.callback_url).toContain(`/stores/shop1/checkout?token=${TOKEN}`)
  })

  it('never renders a card field of its own', async () => {
    // Card entry belongs to the provider's component and nowhere else.
    // A field here would mean a card number reaching our origin.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const container = screen.getByTestId('embedded-payment-form')
    /*
     * We hand the provider an empty element and contribute NOTHING to it.
     *
     * Asserted as "everything in here came from the provider" rather than
     * "this is empty": the mock now renders into the element, as the real
     * provider does, so an empty container would no longer prove anything
     * about our own markup. The security claim is unchanged — no field of
     * ours, and no card input anywhere on the page.
     */
    expect(Array.from(container.children).every((child) => child.className === 'mysr-form')).toBe(true)
    for (const input of Array.from(document.querySelectorAll('input'))) {
      const text = `${input.getAttribute('name') ?? ''} ${input.getAttribute('placeholder') ?? ''}`
      expect(text).not.toMatch(/card|cvv|cvc|expiry|بطاقة/i)
    }
  })

  it('writes the token into this tab before the form can send the payer to 3DS', async () => {
    // A 3DS challenge is a top-level hop to the bank. The page that
    // receives them back has to know which checkout to verify.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    expect(replaceState).toHaveBeenCalledWith(null, '', `/stores/shop1/checkout?token=${TOKEN}`)
  })

  it('mounts once, however many times the page re-renders', async () => {
    // Two mounts into the same element means two sets of card fields.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    const { rerender } = render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    rerender(<CheckoutPage />)
    rerender(<CheckoutPage />)

    expect(mountMoyasarForm).toHaveBeenCalledTimes(1)
  })

  it('says so when the form cannot load, instead of showing an empty box', async () => {
    loadMoyasarForm.mockRejectedValueOnce(new Error('offline'))
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => screen.getByText(/تعذّر تحميل نموذج الدفع الآمن/))
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
    // Never claims an outcome it does not have.
    expect(screen.queryByText('تم الدفع بنجاح')).toBeNull()
  })

  it('lets the customer back out to another payment method', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))

    // Back to the editable checkout, with the cart and the form intact,
    // and the spent token out of the URL.
    await waitFor(() => expect(payButton()).toBeTruthy())
    expect(clearCart).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Jane Doe')).toHaveProperty('value', 'Jane Doe')
    expect(replace).toHaveBeenCalledWith('/stores/shop1/checkout', { scroll: false })
  })
})

describe('Embedded return — the payment id is a claim the server settles', () => {
  it('confirms the provider payment id server-side, then renders the server verdict', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc123456`)
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [
        UNCONFIRMED_RETURN,
        { payment_status: 'succeeded', order: { order_number: 'A-1003', total: '100', payment_status: 'paid' } },
      ],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    const confirm = calls.find((c) => c.url.endsWith(`/checkout/${TOKEN}/confirm`))
    expect(confirm).toBeTruthy()
    expect(JSON.parse(String(confirm?.init?.body))).toEqual({ payment_reference: 'pay_abc123456' })

    // The verdict came from the server's own record, not the URL.
    const synced = calls.find((c) => c.url.endsWith(`/checkout/${TOKEN}/sync`))
    expect(synced).toBeTruthy()
    expect(screen.getByText(/A-1003/)).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })

  it('confirms once, not once per render', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc123456`)
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [
        UNCONFIRMED_RETURN,
        { payment_status: 'succeeded', order: { order_number: 'A-1003', total: '100', payment_status: 'paid' } },
      ],
    })
    const { rerender } = render(<CheckoutPage />)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    rerender(<CheckoutPage />)

    expect(calls.filter((c) => c.url.endsWith('/confirm')).length).toBe(1)
  })

  it('shows a refused confirmation as the server sees it, never as paid', async () => {
    // A payment id that does not belong to this checkout — a tampered
    // one, or someone else's — is refused by the backend, which checks
    // it against the intent's amount, currency and account. The page
    // must render what the server still has, which is not a payment.
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_someoneelse1`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [{ payment_status: 'failed', order: null }],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.queryByText('تم الدفع بنجاح')).toBeNull()
    expect(clearCart).not.toHaveBeenCalled()
  })

  it('ignores a malformed payment id rather than putting it in a request path', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}&id=../../admin`)
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [{ payment_status: 'processing', order: null }],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('جارٍ معالجة الدفع'))
    expect(calls.some((c) => c.url.includes('/confirm'))).toBe(false)
    expect(calls.some((c) => c.url.includes('admin'))).toBe(false)
  })
})

describe('payment experiences vs merchant offerings', () => {
  /*
   * The backend groups a merchant's offerings by the PROVIDER FORM that
   * hosts them, so what arrives here is one entry per payment
   * experience, not one per enabled method. These tests hold the
   * checkout to that: one card form is one choice, and Apple Pay — which
   * Moyasar cannot host inside the embedded form without merchant
   * validation configuration we do not have — is a separate, honestly
   * labelled redirect.
   */
  const CARD_FORM = {
    id: '50', method: 'card', gateway: 'moyasar', name_ar: null, name_en: null,
    commitment_kind: 'funds_secured', position: 0,
    methods: ['card', 'mada'], offering_ids: ['50', '51'], form_id: 'moyasar_form_card',
    presentation_mode: 'embedded', next_action_kinds: ['client_sdk'],
  }
  const APPLE_PAY = {
    id: '52', method: 'apple_pay', gateway: 'moyasar', name_ar: null, name_en: null,
    commitment_kind: 'funds_secured', position: 2,
    methods: ['apple_pay'], offering_ids: ['52'], form_id: 'moyasar_invoice_apple_pay',
    presentation_mode: 'same_tab_redirect', next_action_kinds: ['redirect'],
  }

  it('card + mada arrive as ONE choice, named for both networks', async () => {
    mockApi({ offerings: [CARD_FORM, APPLE_PAY] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('بطاقة ائتمانية · مدى'))
    // The whole point: no second card choice that opens the same form.
    expect(screen.queryByText('بطاقة ائتمانية')).toBeNull()
    expect(screen.queryByText('مدى')).toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('states the true presentation per experience, not per account', async () => {
    mockApi({ offerings: [CARD_FORM, APPLE_PAY] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('بطاقة ائتمانية · مدى'))
    // Embedded says so; the redirect says so. Before grouping, Apple Pay
    // inherited the account's 'embedded' mode and claimed it would be
    // paid inside the page — then handed the tab to Moyasar.
    expect(screen.getAllByText('الدفع داخل هذه الصفحة')).toHaveLength(1)
    expect(screen.getAllByText('تحويل آمن ثم العودة لهذه الصفحة')).toHaveLength(1)
  })

  it('selecting the grouped experience submits a real offering row', async () => {
    mockApi({ offerings: [CARD_FORM, APPLE_PAY] })
    render(<CheckoutPage />)

    const label = await waitFor(() => screen.getByText('بطاقة ائتمانية · مدى'))
    fireEvent.click(label)
    // Grouping changes what the customer is shown, never what the
    // payment core is handed: the id is the representative offering.
    expect(screen.getAllByRole('radio')[0]).toHaveProperty('checked', true)
  })

  it('a merchant display name still wins over the derived label', async () => {
    mockApi({ offerings: [{ ...CARD_FORM, name_ar: 'بطاقة مخصصة' }] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('بطاقة مخصصة'))
    expect(screen.queryByText('بطاقة ائتمانية · مدى')).toBeNull()
  })

  it('an older backend that sends no grouping still gets distinct labels', async () => {
    // Forward compatibility in reverse: a deploy where the backend has
    // not been updated publishes one entry per offering and no
    // `methods`. Each must still be named for itself rather than
    // collapsing to a generic string.
    mockApi({
      offerings: [
        { id: '1', method: 'card', gateway: 'moyasar', name_ar: null, name_en: null, commitment_kind: 'funds_secured', position: 0, presentation_mode: 'embedded', next_action_kinds: ['redirect', 'client_sdk'] },
        { id: '2', method: 'mada', gateway: 'moyasar', name_ar: null, name_en: null, commitment_kind: 'funds_secured', position: 1, presentation_mode: 'embedded', next_action_kinds: ['redirect', 'client_sdk'] },
        { id: '3', method: 'apple_pay', gateway: 'moyasar', name_ar: null, name_en: null, commitment_kind: 'funds_secured', position: 2, presentation_mode: 'embedded', next_action_kinds: ['redirect', 'client_sdk'] },
      ],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('بطاقة ائتمانية'))
    expect(screen.getByText('مدى')).toBeTruthy()
    expect(screen.getByText('Apple Pay')).toBeTruthy()
  })
})

/* ────────────────────────────────────────────────────────────────────
   The idle embedded form

   A customer opened the provider's payment form, typed nothing,
   submitted nothing, and switched to another tab. When they came back
   the checkout said "جارٍ التحقق من نتيجة الدفع" — for a payment that
   did not exist.

   The cause was that everything downstream treated the *existence of a
   checkout* as the existence of a payment. A `PaymentAttempt` row and an
   intent in `processing` are created when the form is PREPARED, so every
   authoritative read answered "something is in flight", and every
   browser event — focus, visibilitychange, pageshow, a cross-tab ping,
   a refresh — was enough to ask.

   The invariant these tests hold down:

       MOUNT ≠ SUBMISSION.  TYPING ≠ SUBMISSION.  A TAB ≠ SUBMISSION.

   Not by reconciling less for real payments — the group below this one
   proves those still reconcile — but by asking, first, whether there is
   a payment at all. The server answers that with
   `payment_attempt_started`, which is false for an embedded attempt with
   no provider payment bound to it.
   ──────────────────────────────────────────────────────────────────── */

/** What the server says about a form that was mounted and never used. */
const UNSUBMITTED_STATUS = {
  payment_status: 'processing',
  attempt_status: 'requires_action',
  payment_attempt_started: false,
  order: null,
}

const VERIFYING_HEADLINE = 'جارٍ التحقق من نتيجة الدفع…'

/** Takes the checkout to a mounted, untouched provider form. */
async function mountIdleForm(statuses: unknown[] = [UNSUBMITTED_STATUS]) {
  const api = mockApi({
    offerings: [EMBEDDED_OFFERING],
    checkout: embeddedCheckout,
    statuses,
  })
  render(<CheckoutPage />)
  await fillForm()
  fireEvent.click(payButton())
  await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
  return api
}

/** The handlers the page gave the provider's form on mount. */
function formHandlers() {
  const [, , , , handlers] = mountMoyasarForm.mock.calls[0]
  return handlers as { onInitiating?: () => void; onCompleted?: () => void }
}

function expectNoVerification() {
  expect(screen.queryByText(VERIFYING_HEADLINE)).toBeNull()
  expect(screen.queryByText('جارٍ معالجة الدفع')).toBeNull()
  expect(screen.queryByText('جارٍ تأكيد الدفع…')).toBeNull()
}

describe('an untouched embedded form is not a payment', () => {
  it('stays on the form when the customer switches tabs and comes back', async () => {
    const { calls } = await mountIdleForm()

    // Exactly what a tab switch and a return fire.
    fireEvent(document, new Event('visibilitychange'))
    fireEvent(window, new Event('focus'))
    fireEvent(window, new Event('pageshow'))

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(`/checkout/${TOKEN}`))).toBe(true),
    )

    // The form is still there and the page still says "your turn".
    expect(screen.getByTestId('embedded-payment-form')).toBeTruthy()
    expect(screen.getByText('أدخل بيانات البطاقة')).toBeTruthy()
    expectNoVerification()
  })

  it('asks the provider for nothing while there is nothing to ask about', async () => {
    // The read that decides is a plain GET of our own record. No
    // `/sync`, so no provider call, no fact, no server-side activity at
    // all on behalf of a payment nobody made.
    const { calls } = await mountIdleForm()

    fireEvent(window, new Event('focus'))
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(`/checkout/${TOKEN}`))).toBe(true),
    )

    expect(calls.some((c) => c.url.endsWith('/sync'))).toBe(false)
  })

  it('ignores a cross-tab ping for a checkout with no payment', async () => {
    await mountIdleForm()

    // A `checkout_changed` message is a hint to go and ask, never an
    // outcome. Asking is exactly what happens; moving is not.
    const channel = new BroadcastChannel('checkout_payment_sync')
    channel.postMessage({ type: 'checkout_changed', token: TOKEN })
    await waitFor(() => expect(screen.getByTestId('embedded-payment-form')).toBeTruthy())
    channel.close()

    expectNoVerification()
  })

  it('does not treat typing in the provider s fields as a submission', async () => {
    // The card fields belong to the provider's component and this page
    // cannot see them — which is the point. What it must not do is infer
    // a payment from the customer being busy in there.
    await mountIdleForm()

    fireEvent.input(screen.getByTestId('embedded-payment-form'))
    fireEvent(window, new Event('focus'))

    await waitFor(() => expect(screen.getByTestId('embedded-payment-form')).toBeTruthy())
    expectNoVerification()
  })

  it('comes back to a usable checkout after a refresh before submitting', async () => {
    // The refresh case: the token is in the URL because the form was
    // mounted, and this page load used to start in RETURNING and
    // announce a verification on the strength of that alone.
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [UNSUBMITTED_STATUS],
    })

    render(<CheckoutPage />)

    // The checkout form is back and fillable; nothing claims a payment.
    await waitFor(() => screen.getByPlaceholderText('Jane Doe'))
    expectNoVerification()
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
  })

  it('opens the gate the moment the provider says the payer submitted', async () => {
    // `on_initiating` is the provider's own "this customer is submitting
    // now", and it is the earliest honest signal there is — the payment
    // object does not exist yet, so the server cannot know.
    const { calls } = await mountIdleForm([
      UNSUBMITTED_STATUS,
      { payment_status: 'captured', payment_attempt_started: true, order: { order_number: 'A-1003', payment_status: 'PAID', total: '100' } },
    ])

    formHandlers().onInitiating?.()

    fireEvent(window, new Event('focus'))

    // Now — and only now — the page is allowed to reconcile with the
    // provider, and a settled payment takes the form away.
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/sync'))).toBe(true))
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
  })

  it('does not tear the form down for a payment that is merely in flight', async () => {
    // After a submit the form owns what happens next — a 3DS challenge,
    // an STC Pay OTP modal, an Apple Pay sheet. A non-terminal reading
    // arriving from a tab switch must not unmount it, or the customer
    // loses the challenge they were in the middle of.
    await mountIdleForm([{ ...UNSUBMITTED_STATUS, payment_attempt_started: true }])

    formHandlers().onInitiating?.()
    fireEvent(window, new Event('focus'))
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(screen.getByTestId('embedded-payment-form')).toBeTruthy())
    expectNoVerification()
  })

  it('still verifies a real return, with or without the new field', async () => {
    // The protection this must never weaken. A provider payment id on
    // the return URL is proof a payment was made, whatever else is true.
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc12345`)
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [
        UNCONFIRMED_RETURN,
        { payment_status: 'captured', payment_attempt_started: true, order: { order_number: 'A-1003', payment_status: 'PAID', total: '100' } },
      ],
    })

    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(
      calls.some((c) => c.url.endsWith(`/checkout/${TOKEN}/confirm`) && c.init?.method === 'POST'),
    ).toBe(true)
  })
})

/* ────────────────────────────────────────────────────────────────────
   TWO TABS, ONE PURCHASE — BEFORE EITHER OF THEM PAYS.

   The server refuses to create a second checkout for one cart and hands
   back the incumbent instead. What this page must do with that answer
   is behave exactly as if it had created that checkout itself: same
   token in the URL, same next action, same switch. A "converged"
   special case in the UI would be a second code path through the
   payment surface, which is the thing this whole page exists not to
   have.
   ──────────────────────────────────────────────────────────────────── */
describe('a second tab converges on the first tab s checkout', () => {
  it('adopts the incumbent checkout and mounts ITS form, creating nothing', async () => {
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      // 200, not 201: nothing was created. The body is the incumbent's
      // own record with `converged` on it.
      checkout: {
        ...embeddedCheckout,
        // A live checkout has no order yet — the order is what a
        // SUCCESSFUL payment produces, and nothing has been paid here.
        order: null,
        converged: true,
        cart_status: 'active',
        payment_status: 'processing',
        attempt_status: 'requires_action',
      },
      statuses: [UNSUBMITTED_STATUS],
    })

    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    // The incumbent's form, mounted from the incumbent's config.
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    expect(screen.getByTestId('embedded-payment-form')).toBeTruthy()

    // Its token is in this tab's URL, so a refresh or a return resolves
    // to the one checkout both tabs are on.
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      expect.stringContaining(`token=${TOKEN}`),
    )

    // And exactly one POST was made from this tab.
    const posts = calls.filter(
      (c) => c.url.endsWith('/checkout') && c.init?.method === 'POST',
    )
    expect(posts).toHaveLength(1)
  })

  it('asks once more when the other tab is mid-provider-call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    let attempt = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        attempt += 1
        // The cart claim is held: another request is between its claim
        // and the checkout it is about to create. Not an error, and
        // definitely not a reason to start a second purchase.
        if (attempt === 1) return json({ code: 'checkout_in_flight' }, 409)
        return json({
          ...embeddedCheckout,
          order: null,
          converged: true,
          cart_status: 'active',
        })
      }
      if (url.includes('/checkout/')) return json(UNSUBMITTED_STATUS)
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(attempt).toBe(1))

    // Nothing was created, and nothing claims a payment happened.
    expect(screen.queryByText(PHASE_HEADLINE.PAID)).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // One retry, and it converges.
    await waitFor(() => expect(attempt).toBe(2))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    vi.useRealTimers()
  })

  it('refuses to pay a basket that is already an order, and says so', async () => {
    const destroy = vi.fn()
    vi.stubGlobal('Moyasar', { init: vi.fn(), destroy })

    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: { code: 'cart_converted', order_number: 'A-1003' },
      checkoutStatus: 409,
      statuses: [UNSUBMITTED_STATUS],
    })

    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    // The SERVER refused. The screen follows the server, and no form is
    // ever mounted for a purchase that already happened.
    await waitFor(() => expect(screen.getByText(PHASE_HEADLINE.PAID)).toBeTruthy())
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    expect(refreshCart).toHaveBeenCalled()
  })
})

/* ────────────────────────────────────────────────────────────────────
   ONE TAB PAYS — THE OTHER TAB'S FORM LEAVES THE DOCUMENT.

   This is the requirement that actually protects money, and it is the
   only one in this file where a UI detail IS the safety property.

   Two tabs share one server-side cart, so they share one checkout. When
   the payment settles in tab A, tab B is still sitting on a mounted
   provider form — a live, working way to charge the same card again.
   Hiding it with CSS is not enough: a hidden form is still payable,
   still focusable, still submittable. It has to be REMOVED.

   Nothing here learns the outcome from the cross-tab message. The ping
   carries a token and a cart id and nothing else; what changes the
   screen is tab B's own authoritative read, which comes back saying the
   basket was converted.
   ──────────────────────────────────────────────────────────────────── */
describe('after the payment succeeds elsewhere, the mounted form is destroyed', () => {
  /** What the server says once this basket has become an order. */
  const CONVERTED_STATUS = {
    payment_status: 'captured',
    attempt_status: 'succeeded',
    payment_attempt_started: true,
    cart_status: 'converted',
    order: { order_number: 'A-1003', payment_status: 'PAID', total: '100.00' },
  }

  it('empties the container, runs the provider teardown, and leaves nothing payable', async () => {
    /*
     * The provider's own teardown, so the assertion can see it run.
     * `destroyPaymentForm` asks for it and then empties the element
     * regardless — the next assertion holds whether or not a provider
     * offers one, which is the point of doing both.
     */
    const destroy = vi.fn()
    vi.stubGlobal('Moyasar', { init: vi.fn(), destroy })

    // A form is mounted and on screen, unpaid.
    await mountIdleForm([UNSUBMITTED_STATUS])

    const container = screen.getByTestId('embedded-payment-form')
    expect(container.childElementCount).toBeGreaterThan(0)

    // The other tab pays. From here on the SERVER says the basket is an
    // order — which is the only thing this page is allowed to believe.
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [CONVERTED_STATUS],
    })

    // The other tab settles. A ping is a HINT, never an outcome.
    await act(async () => {
      const channel = new BroadcastChannel('checkout_payment_sync')
      channel.postMessage({
        type: 'checkout_changed',
        token: TOKEN,
        cartPublicId: CART_PUBLIC_ID,
      })
      channel.close()
    })

    // The page asked the server, and the server said the basket is gone.
    await waitFor(() => expect(screen.getByText(PHASE_HEADLINE.PAID)).toBeTruthy())

    // THE FORM IS OUT OF THE DOCUMENT — not hidden, not disabled, gone.
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
    expect(container.childElementCount).toBe(0)
    expect(container.isConnected).toBe(false)

    // The provider was asked to tear its own instance down as well.
    expect(destroy).toHaveBeenCalled()

    // And there is no way left to pay: no provider chrome, and no
    // submit control of ours anywhere on the screen.
    expect(screen.queryByText('أدخل بيانات البطاقة')).toBeNull()
    expect(screen.queryByRole('button', { name: /place order/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /المحاولة مرة أخرى/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /تغيير طريقة الدفع/ })).toBeNull()
  })

  it('does not remove the form while the basket is still active', async () => {
    // The counterweight: a tab switch, a ping, or any other browser
    // event on a LIVE basket must leave the customer's form exactly
    // where it is. A teardown that fires too eagerly is its own outage.
    const destroy = vi.fn()
    vi.stubGlobal('Moyasar', { init: vi.fn(), destroy })

    await mountIdleForm([{ ...UNSUBMITTED_STATUS, cart_status: 'active' }])

    await act(async () => {
      const channel = new BroadcastChannel('checkout_payment_sync')
      channel.postMessage({
        type: 'checkout_changed',
        token: TOKEN,
        cartPublicId: CART_PUBLIC_ID,
      })
      channel.close()
    })

    await waitFor(() =>
      expect(screen.getByTestId('embedded-payment-form')).toBeTruthy(),
    )
    expect(destroy).not.toHaveBeenCalled()
    expect(screen.getByText('أدخل بيانات البطاقة')).toBeTruthy()
  })
})

/* ────────────────────────────────────────────────────────────────────
   BROWSER BACK AFTER A SUCCESSFUL PAYMENT

   The payment is PAID and stays PAID. What was wrong was the UI a
   history navigation put on screen on the way there:

       PAID → Back → "جارٍ تأكيد الدفع…" + "0 SAR" → PAID

   Two independent defects, both reachable from any FRESH MOUNT that
   carries the provider's payment id in the URL — which is what Back
   (on a bfcache miss), Forward, and a refresh of the return URL all
   produce, because a remount resets every ref the page guards with:

     1. the confirm effect re-POSTed a confirmation for a payment the
        server had already settled, and drove the page through
        PROVIDER_CONFIRMATION to announce it;
     2. `amountLabel` fell back to the live cart — emptied the moment
        the payment succeeded — so an unknown amount rendered as 0.

   The invariant:

       A RESTORED SNAPSHOT IS HISTORY, NOT A PAYMENT.
       AN UNKNOWN AMOUNT IS NOT 0.
   ──────────────────────────────────────────────────────────────────── */

const PAID_STATUS = {
  payment_status: 'captured',
  attempt_status: 'succeeded',
  payment_attempt_started: true,
  order: { order_number: 'A-1003', payment_status: 'PAID', total: '100' },
}

/**
 * A fresh mount on the return URL, with the cart already emptied —
 * exactly the state Back/Forward/refresh restores after a payment.
 */
function remountOnPaidReturn(statuses: unknown[] = [PAID_STATUS]) {
  cart = []
  searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc12345`)
  const api = mockApi({ offerings: [EMBEDDED_OFFERING], statuses })
  render(<CheckoutPage />)
  return api
}

function confirmPosts(calls: { url: string; init?: RequestInit }[]) {
  return calls.filter(
    (c) => c.url.endsWith(`/checkout/${TOKEN}/confirm`) && c.init?.method === 'POST',
  )
}

/**
 * Every headline the page renders, in order.
 *
 * The defect is a state that DISAPPEARS — asserting on the final DOM
 * would pass while the customer still saw the wrong thing for two
 * seconds. A MutationObserver records what was actually on screen, so a
 * transient false state fails the test.
 */
function recordHeadlines(): string[] {
  const seen: string[] = []
  const headlines = Object.values(PHASE_HEADLINE).filter((h) => h !== '')
  const capture = () => {
    for (const h of headlines) {
      if (screen.queryByText(h) && seen[seen.length - 1] !== h) seen.push(h)
    }
  }
  const observer = new MutationObserver(capture)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  capture()
  return seen
}

describe('browser Back after a payment that is already PAID', () => {
  it('never announces "جارٍ تأكيد الدفع…" for a payment the server already settled', async () => {
    const seen = recordHeadlines()
    remountOnPaidReturn()

    // The defect: the restored page claimed to be confirming a payment
    // that was finished before this mount existed.
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain('جارٍ تأكيد الدفع…')
    expect(screen.queryByText('جارٍ تأكيد الدفع…')).toBeNull()
  })

  it('never renders 0 for an amount it has not read yet', async () => {
    remountOnPaidReturn()

    // The cart is empty and the server total has not arrived. "0 SAR"
    // is a lie about a real payment; a neutral placeholder is not.
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
    expect(screen.getByText('100 SAR')).toBeTruthy()
  })

  it('does not confirm a payment the server has already settled', async () => {
    const { calls } = remountOnPaidReturn()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(confirmPosts(calls)).toHaveLength(0)
  })
})

describe('history navigation around a PAID checkout', () => {
  /** Back onto the entry written before the tab left: token, no id. */
  function remountOnBareToken(statuses: unknown[] = [PAID_STATUS]) {
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    const api = mockApi({ offerings: [EMBEDDED_OFFERING], statuses })
    render(<CheckoutPage />)
    return api
  }

  it('B — Back onto the pre-redirect entry resolves to PAID, never to 0', async () => {
    const seen = recordHeadlines()
    const { calls } = remountOnBareToken()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain('جارٍ تأكيد الدفع…')
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
    expect(screen.getByText('100 SAR')).toBeTruthy()
    // A bare token is not a provider payment id: nothing to confirm.
    expect(confirmPosts(calls)).toHaveLength(0)
  })

  it('C — Back then Forward lands on the return entry and stays PAID', async () => {
    // Back: the pre-redirect entry.
    remountOnBareToken()
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    cleanup()

    // Forward: the return entry, provider id and all, mounted fresh.
    const seen = recordHeadlines()
    const { calls } = remountOnPaidReturn()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain('جارٍ تأكيد الدفع…')
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
    expect(confirmPosts(calls)).toHaveLength(0)
  })

  it('D — Back then Refresh re-reads the server and stays PAID', async () => {
    remountOnBareToken()
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    cleanup()

    // A refresh is another fresh mount of the same URL.
    const seen = recordHeadlines()
    const { calls } = remountOnBareToken()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain('جارٍ تأكيد الدفع…')
    expect(screen.getByText('100 SAR')).toBeTruthy()
    expect(confirmPosts(calls)).toHaveLength(0)
    expect(reload).not.toHaveBeenCalled()
  })

  it('A — a bfcache restore of a PAID page re-reads the server and stays PAID', async () => {
    const seen = recordHeadlines()
    remountOnPaidReturn()
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // The real restore: the JS heap survived, so this is the SAME mount
    // being shown again — exactly what pageshow{persisted:true} means.
    const restore = new Event('pageshow') as Event & { persisted?: boolean }
    Object.defineProperty(restore, 'persisted', { value: true })
    fireEvent(window, restore)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain('جارٍ تأكيد الدفع…')
    expect(seen).not.toContain('جارٍ معالجة الدفع')
    expect(screen.getByText('100 SAR')).toBeTruthy()
  })

  it('I/J — no history navigation starts a new attempt or a new payment', async () => {
    const { calls } = remountOnPaidReturn()
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    fireEvent(window, new Event('pageshow'))
    fireEvent(window, new Event('focus'))
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // A new PaymentAttempt would come from POST /checkout; a duplicate
    // payment from a confirm or a mounted provider form. None happen.
    const created = calls.filter(
      (c) => c.url.endsWith('/checkout') && c.init?.method === 'POST',
    )
    expect(created).toHaveLength(0)
    expect(confirmPosts(calls)).toHaveLength(0)
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('10 — a tab still showing the form still converges to PAID (multi-tab)', async () => {
    // The opposite case, and it must keep working: this tab never left,
    // the payment was completed elsewhere, and a ping arrives.
    await mountIdleForm([
      { ...UNSUBMITTED_STATUS, payment_attempt_started: true },
      PAID_STATUS,
    ])

    fireEvent(window, new Event('focus'))

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    /*
     * The cart is emptied by the PAID effect, one render after the phase
     * lands — so wait for the summary to go before asserting the amount
     * is shown once. Asserting straight after the headline was a race:
     * under load the summary was still on screen with its own copy of
     * the figure, and the query failed for finding too many.
     */
    await waitFor(() => expect(screen.queryByTestId('summary-total')).toBeNull())
    expect(screen.getByText('100 SAR')).toBeTruthy()
  })
})

/* ────────────────────────────────────────────────────────────────────
   ROUND 2 — the intermediate VERIFYING screen, reproduced in a real
   browser by the merchant:

       PAID (SAR 50, order 1037) → Back → "جارٍ التحقق من نتيجة الدفع…"
       with amount "—" → PAID

   The first fix removed the false "جارٍ تأكيد الدفع…" and the false
   "0 SAR". It deliberately left the page in RETURNING for the duration
   of one authoritative read, on the reasoning that RETURNING is a
   neutral restoring state. It is not: RETURNING renders "جارٍ التحقق
   من نتيجة الدفع…", which tells a customer whose payment finished
   minutes ago that it is being verified now.

   A restored page must claim NOTHING about the payment until the server
   has answered — not even that it is checking.
   ──────────────────────────────────────────────────────────────────── */

const VERIFY_HEADLINE = 'جارٍ التحقق من نتيجة الدفع…'
const RESTORING_HEADLINE = 'جارٍ تحميل صفحة الدفع…'

describe('a restored PAID checkout claims nothing before the server answers', () => {
  it('A — PAID → Back shows no verification screen and no unknown amount', async () => {
    const seen = recordHeadlines()
    remountOnPaidReturn()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // The exact symptom the merchant reported in a real browser.
    expect(seen).not.toContain(VERIFY_HEADLINE)
    expect(seen).not.toContain('جارٍ تأكيد الدفع…')
    expect(seen).not.toContain('جارٍ معالجة الدفع')
    // "—" is right for an unknown amount and wrong beside a known result.
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.getByText('100 SAR')).toBeTruthy()
  })

  it('A — the only thing shown before the answer is the neutral restoring state', async () => {
    remountOnPaidReturn()

    // Claims nothing about the payment: no phase, no amount, no verdict.
    expect(screen.getByText(RESTORING_HEADLINE)).toBeTruthy()
    expect(screen.queryByText(VERIFY_HEADLINE)).toBeNull()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.queryByText(RESTORING_HEADLINE)).toBeNull()
  })

  it('B — Back → Forward onto the return entry never verifies again', async () => {
    const seen = recordHeadlines()
    const { calls } = remountOnPaidReturn()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain(VERIFY_HEADLINE)
    expect(confirmPosts(calls)).toHaveLength(0)
  })

  it('C — Back → Refresh on a bare token never verifies again', async () => {
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    const seen = recordHeadlines()
    const { calls } = mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [PAID_STATUS] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(seen).not.toContain(VERIFY_HEADLINE)
    expect(screen.getByText('100 SAR')).toBeTruthy()
    expect(confirmPosts(calls)).toHaveLength(0)
  })

  it('D — a GENUINE first return still verifies and still confirms (CASE A)', async () => {
    // The semantics that must not change: the payment is not terminal
    // yet, so the customer is told it is being confirmed, and the
    // provider payment id is bound server-side exactly as before.
    const seen = recordHeadlines()
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc12345`)
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [UNCONFIRMED_RETURN, PAID_STATUS],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    // It DID confirm — this is the case that should. (Whether the
    // confirmation headline is painted is a timing detail of how fast
    // the provider answers, so it is not asserted; the request is.)
    expect(confirmPosts(calls)).toHaveLength(1)
    expect(seen).not.toContain('جارٍ معالجة الدفع')
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE AMOUNT ON A NORMAL, PRE-PAYMENT CHECKOUT

   `AMOUNT_UNKNOWN` ("—") exists because an unknown amount must not
   render as 0. It is right for that. It is wrong the moment it stands
   in for an amount the page already knows.

   The blind spot: the checkout writes its token into the URL with
   `history.replaceState` when the provider's form mounts. Next re-runs
   `useSearchParams()` on that, so `returnContext.token` starts matching
   `token` — and `arrivedByReturn`, which exists to stop the CART being
   read as the amount after a provider return, starts being true on a
   checkout that never went anywhere. The cart was then refused as a
   source, no server total existed yet (nothing polls while the form is
   up), and the panel showed "—" beside a live payment form.
   ──────────────────────────────────────────────────────────────────── */

describe('the amount a normal checkout shows before any payment', () => {
  /** The amount as the PAYMENT PANEL shows it, not the order summary. */
  function panelAmount(): string | null {
    const form = screen.getByTestId('embedded-payment-form')
    const panel = form.closest('div')?.parentElement ?? form.parentElement
    return panel?.textContent?.match(/(\d[\d,]*\s*SAR)|—/)?.[0] ?? null
  }

  it('A — shows the real total on the provider form, never "—"', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    // The customer is looking at card fields. The amount is known, and
    // "—" beside a live payment form is the bug.
    expect(screen.queryByText('—')).toBeNull()
    expect(panelAmount()).toBe('100 SAR')
  })

  it('A — the token landing in the URL does not make this a "return"', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    // The page really did rewrite its own URL — this is the condition
    // that used to flip `arrivedByReturn` and hide the amount.
    expect(replaceState).toHaveBeenCalled()
    expect(String(replaceState.mock.calls[0]?.[2])).toContain(`token=${TOKEN}`)
    // The live URL really does carry the token now — the exact condition
    // that used to be misread as "returned from a provider".
    expect(searchParams.get('token')).toBe(TOKEN)
    expect(screen.queryByText('—')).toBeNull()
    expect(panelAmount()).toBe('100 SAR')
  })

  it('C — a plain checkout with a cart and no server total shows the cart total', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING] })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('بطاقة'))

    expect(screen.queryByText('—')).toBeNull()
  })

  it('D/E/F — a returned PAID checkout still shows the SERVER total, not the cart', async () => {
    // The cart says something else entirely; the server is authoritative.
    cart = [{ ...ITEM, price: 999 }]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc12345`)
    mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [PAID_STATUS] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.getByText('100 SAR')).toBeTruthy()
    expect(screen.queryByText('999 SAR')).toBeNull()
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
  })

  it('E — PAID → Back with an EMPTY cart still shows the server total, never 0', async () => {
    const { calls } = remountOnPaidReturn()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.getByText('100 SAR')).toBeTruthy()
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
    expect(confirmPosts(calls)).toHaveLength(0)
  })

  it('B — "—" is still used when the amount is genuinely unknown', async () => {
    // No cart, no server total yet, and a real payment to resolve: the
    // one case the placeholder is for. It must NOT become 0.
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [{ ...UNCONFIRMED_RETURN, order: null }],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText(VERIFY_HEADLINE))
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────
   A DECLINED PAYMENT: the amount, and what "try again" does.

   Two defects, reproduced from a real decline:

     1. the failed screen showed "—" for the amount. There is no Order
        for a declined checkout — an Order is created when a payment
        SUCCEEDS — so `order.total` was absent and the page had nothing
        authoritative left. A decline does not make the price unknown:
        the checkout's own quoted total is on the server and is now
        published as `total`.

     2. "المحاولة مرة أخرى" dropped the customer into IDLE, which renders
        the entire data-entry screen again — contact, shipping, payment
        method — for someone who only wanted to present another card.
        It also shared a handler with "تغيير طريقة الدفع", which really
        does mean "take me back to the methods".
   ──────────────────────────────────────────────────────────────────── */

/** A declined attempt: intent failed, no order, checkout total known. */
const DECLINED_STATUS = {
  payment_status: 'failed',
  attempt_status: 'failed',
  attempt_sequence: 1,
  payment_attempt_started: true,
  currency: 'SAR',
  total: '50',
  order: null,
}

describe('a declined payment shows the real amount', () => {
  it('A — the failed screen shows the checkout total, not "—"', async () => {
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1`)
    mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [DECLINED_STATUS] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.getByText('50 SAR')).toBeTruthy()
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
  })

  it('G — refreshing the failed checkout keeps the state and the amount', async () => {
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [DECLINED_STATUS] })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.getByText('50 SAR')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('still shows "—" when the server reports no total at all', async () => {
    // The placeholder keeps its job: unknown is not zero.
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [{ ...DECLINED_STATUS, total: null }],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
  })

  it('an order total still wins over the checkout total', async () => {
    // What was actually charged beats what was quoted.
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc12345`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [{ ...PAID_STATUS, total: '50' }],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.getByText('100 SAR')).toBeTruthy()
    expect(screen.queryByText('50 SAR')).toBeNull()
  })
})

describe('"try again" after a decline', () => {
  /** Declines the payment from inside the provider form, in-page. */
  async function declineInPage() {
    const api = mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [DECLINED_STATUS],
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    // The provider reports the payment, and the server says it failed.
    // Reconciliation is what carries a terminal verdict into a page
    // whose provider form is still mounted (`applyReconciledState`).
    formHandlers().onInitiating?.()
    formHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    return api
  }

  it('B/C — goes straight back to the payment form, not the data entry screen', async () => {
    await declineInPage()
    mountMoyasarForm.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    // The provider's form is mounted again...
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    // ...and the customer was never sent back to re-enter anything.
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()
    expect(screen.queryByPlaceholderText('123 Main St, Apt 4B')).toBeNull()
  })

  it('D — the retry really starts another payment, with a fresh idempotency key', async () => {
    const { calls } = await declineInPage()
    const before = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(before).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))

    const after = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(after).toHaveLength(2)

    // A spent key would replay the DECLINED checkout instead of making
    // a new payment — the one thing a retry must never do.
    const keyOf = (c: { init?: RequestInit }) =>
      (c.init?.headers as Record<string, string>)?.['Idempotency-Key']
    expect(keyOf(after[0])).toBeTruthy()
    expect(keyOf(after[1])).toBeTruthy()
    expect(keyOf(after[1])).not.toBe(keyOf(after[0]))
  })

  it('keeps "change payment method" meaning the methods, not a retry', async () => {
    // The two buttons are different intents and must stay different.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))
    await waitFor(() => expect(payButton()).toBeTruthy())
    expect(screen.getByPlaceholderText('Jane Doe')).toHaveProperty('value', 'Jane Doe')
  })

  it('H — asks explicitly when the details are NOT available anywhere', async () => {
    // The 3DS-redirect case with the details withheld: a fresh document,
    // so `form` is empty, and the server sent no copy either. Guessing
    // would be worse than asking — but so is answering by putting the
    // whole checkout back on screen with no explanation.
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1`)
    mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [DECLINED_STATUS] })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByRole('alert'))
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    // Still the failure panel — not a checkout that looks like a new order.
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()
    expect(screen.queryByPlaceholderText('123 Main St, Apt 4B')).toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE REAL DECLINE PATH: a 3DS decline returns through a REDIRECT.

   Moyasar sends the payer back to
   `checkout?token=…&id=…&status=failed` — a brand-new document. The
   React form is empty there, so the page offering "try again" held none
   of the contact or shipping details the customer had already given, and
   the only honest thing it could do was ask for them again.

   The server had them all along, on the checkout row. It now hands them
   back, and the retry uses them.
   ──────────────────────────────────────────────────────────────────── */

/** A decline as it actually arrives: redirect, plus the server's copy. */
const DECLINED_WITH_DETAILS = {
  ...DECLINED_STATUS,
  customer: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1 555 000 0000',
    address_line: '123 Main St, Apt 4B',
    city: 'Cairo',
  },
  selected_offering_id: 'offering-embedded',
}

describe('retry after a 3DS decline (the redirect path)', () => {
  function arriveOnDecline(status: unknown = DECLINED_WITH_DETAILS) {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    const api = mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [status],
    })
    render(<CheckoutPage />)
    return api
  }

  it('A — shows the decline with the real amount', async () => {
    arriveOnDecline()
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.getByText('50 SAR')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('B/C — retry goes straight to the provider form, asking for nothing again', async () => {
    arriveOnDecline()
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    // Straight back to paying — no contact, no shipping, no method screen.
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()
    expect(screen.queryByPlaceholderText('123 Main St, Apt 4B')).toBeNull()
  })

  it('D/I — the retry creates one new payment, and no duplicate order', async () => {
    const { calls } = arriveOnDecline()
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const created = calls.filter(
      (c) => c.url.endsWith('/checkout') && c.init?.method === 'POST',
    )
    expect(created).toHaveLength(1)
    // The details it paid with are the server's, not re-typed ones.
    const body = JSON.parse(String(created[0].init?.body))
    expect(body.customer_name).toBe('Jane Doe')
    expect(body.address_line).toBe('123 Main St, Apt 4B')
    expect(body.city).toBe('Cairo')
    expect(body.payment_offering_id).toBe('offering-embedded')
  })

  it('does not re-select a method the merchant has since disabled', async () => {
    // The checkout row remembers an offering that is no longer offered.
    arriveOnDecline({ ...DECLINED_WITH_DETAILS, selected_offering_id: 'offering-gone' })
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    // No selection it could honour, so it says which decision is left —
    // rather than paying by a method the merchant has turned off, and
    // rather than reopening the whole checkout without saying why.
    await waitFor(() => screen.getByRole('alert'))
    expect(screen.getByRole('alert').textContent).toMatch(/لم تعد متاحة/)
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()

    // And the chooser is one click away, with the methods on it.
    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))
    await waitFor(() => expect(payButton()).toBeTruthy())
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0)
  })

  it('never overwrites something the customer has typed', async () => {
    arriveOnDecline()
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))
    await waitFor(() => expect(payButton()).toBeTruthy())

    // The customer corrects their address on the way back.
    const address = screen.getByPlaceholderText('123 Main St, Apt 4B')
    fireEvent.change(address, { target: { value: '9 New Road' } })
    expect(address).toHaveProperty('value', '9 New Road')

    // A later status read must not put the old one back.
    fireEvent(window, new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByPlaceholderText('123 Main St, Apt 4B')).toHaveProperty(
      'value',
      '9 New Road',
    )
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE SERVER MAY REFUSE TO HAND BACK THE PAYER'S DETAILS.

   The checkout token is a bearer capability, so the status endpoint
   returns contact and address only while the checkout can still be paid.
   For a paid, expired or abandoned checkout it sends `customer: null`.

   The page must work either way: it may never assume the details are
   there, and it must never pretend they were.
   ──────────────────────────────────────────────────────────────────── */

describe('when the server withholds the payer details', () => {
  it('a PAID checkout still renders its result and amount', async () => {
    // The gate removes PII, not the outcome.
    cart = []
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_abc12345`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      statuses: [{ ...PAID_STATUS, customer: null, selected_offering_id: null }],
    })
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.getByText('100 SAR')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('a decline without details falls back to the form instead of guessing', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1`)
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [{ ...DECLINED_STATUS, customer: null, selected_offering_id: null }],
    })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    // The amount is still right — that is not PII and is not gated.
    expect(screen.getByText('50 SAR')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    // No details to pay with, so it asks rather than inventing any —
    // and asks on the panel the customer is already looking at.
    await waitFor(() => screen.getByRole('alert'))
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))
    await waitFor(() => expect(payButton()).toBeTruthy())
    expect((screen.getByPlaceholderText('Jane Doe') as HTMLInputElement).value).toBe('')
  })

  it('never sends an order note it was not given', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    const { calls } = mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [DECLINED_WITH_DETAILS],
    })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const created = calls.find((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    const body = JSON.parse(String(created?.init?.body))
    // The note is not returned by the server and is not fabricated here.
    expect(body.notes).toBeUndefined()
    expect(body.customer_name).toBe('Jane Doe')
    expect(body.customer_email).toBe('jane@example.com')
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE VISIBLE RETRY TRANSITION.

   Reproduced in a real browser: a declined payment, "المحاولة مرة أخرى",
   and the customer watching the entire checkout come back — Contact
   information, Shipping address, the payment-method chooser — before the
   provider's card fields finally appeared.

   Nothing was wrong with what the retry DID. It released the settled
   attempt and created the replacement checkout exactly as designed; the
   defect was the phase it waited in. `CREATING_PAYMENT` keeps the
   data-entry form mounted on purpose — the customer pressed Place order
   ON that form and it stays under them with a spinner on its button —
   and the retry borrowed it for a request made from a failure panel,
   where there is no form and re-rendering one reads as "start over".

   The tests below are about the WINDOW, not the destination. Every
   earlier retry test asserts what is on screen once the provider's form
   has mounted, which is why none of them could see this: the whole
   defect lives between the click and that mount. So the checkout POST is
   held open here, and the assertions are made while it is in flight.

   The architecture is deliberately untouched: still one new checkout,
   one new PaymentIntent and one new PaymentAttempt per retry.
   ──────────────────────────────────────────────────────────────────── */

/** Everything the retry must never put on screen while preparing. */
function expectNoDataEntryScreen() {
  // C — contact information
  expect(screen.queryByText('Contact information')).toBeNull()
  expect(screen.queryByPlaceholderText('Jane Doe')).toBeNull()
  expect(screen.queryByPlaceholderText('+1 555 000 0000')).toBeNull()
  // D — shipping address
  expect(screen.queryByText('Shipping address')).toBeNull()
  expect(screen.queryByPlaceholderText('123 Main St, Apt 4B')).toBeNull()
  expect(screen.queryByPlaceholderText('Cairo')).toBeNull()
  // E — the payment-method chooser
  expect(screen.queryAllByRole('radio')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: /place order/i })).toBeNull()
}

/**
 * `mockApi`, with the checkout POST held open until the test releases it.
 *
 * The point of the whole file below: the defect is only observable while
 * that request is in flight, so a mock that answers immediately cannot
 * see it.
 */
function mockApiWithHeldCheckout(options: {
  offerings?: unknown[]
  checkout?: unknown
  statuses?: unknown[]
}) {
  const statuses = [...(options.statuses ?? [])]
  const calls: { url: string; init?: RequestInit }[] = []
  let release: (() => void) | null = null
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/payment-methods')) return json(options.offerings ?? [EMBEDDED_OFFERING])
    if (url.endsWith('/sync') && init?.method === 'POST') return json({})
    if (url.endsWith('/checkout') && init?.method === 'POST') {
      await held
      return json(options.checkout ?? embeddedCheckout)
    }
    if (url.includes('/checkout/')) {
      const next = statuses.length > 1 ? statuses.shift() : statuses[0]
      return json(next ?? { payment_status: 'processing', order: null })
    }
    return json({}, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { calls, releaseCheckout: () => release?.() }
}

const RETRY_HEADLINE = 'جارٍ تجهيز الدفع…'

describe('FAILED → المحاولة مرة أخرى → the provider form, and nothing else', () => {
  /** Arrives on the failure exactly as a 3DS decline does: a redirect. */
  function arriveOnDecline(status: unknown = DECLINED_WITH_DETAILS) {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    return mockApiWithHeldCheckout({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [status],
    })
  }

  it('A/C/D/E — the data-entry screen never appears while the retry prepares', async () => {
    const { releaseCheckout } = arriveOnDecline()
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    // The checkout POST is still open. This is the exact window in which
    // the whole checkout used to come back.
    await waitFor(() => screen.getByTestId('retry-preparing'))
    expectNoDataEntryScreen()

    releaseCheckout()
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    // ...and it does not appear on the way out of the window either.
    expectNoDataEntryScreen()
  })

  it('B — the window ends at the provider form', async () => {
    const { releaseCheckout } = arriveOnDecline()
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => screen.getByTestId('retry-preparing'))

    releaseCheckout()
    await waitFor(() => expect(screen.getByTestId('embedded-payment-form')).toBeTruthy())
    expect(screen.queryByTestId('retry-preparing')).toBeNull()
  })

  it('shows a neutral PREPARING state — never a confirmation or a verification', async () => {
    const { releaseCheckout } = arriveOnDecline()
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => screen.getByTestId('retry-preparing'))

    expect(screen.getByText(RETRY_HEADLINE)).toBeTruthy()
    // Preparing a retry is not confirming a payment. Nothing has been
    // submitted and there is nothing to verify.
    expectNoVerification()
    expect(screen.queryByText(PHASE_HEADLINE.PROVIDER_CONFIRMATION)).toBeNull()
    expect(screen.queryByText(PHASE_HEADLINE.VERIFYING)).toBeNull()

    releaseCheckout()
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
  })

  it('G/M — a card retry repeats the offering the customer already chose', async () => {
    const { calls, releaseCheckout } = arriveOnDecline()
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    releaseCheckout()
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(created).toHaveLength(1)
    expect(JSON.parse(String(created[0].init?.body)).payment_offering_id).toBe('offering-embedded')
  })

  it('L — an STC Pay retry goes to the same embedded form, not back to the chooser', async () => {
    // STC Pay is one of the methods the ONE Moyasar form hosts, so a
    // retry of it is a retry of that form — there is no second provider
    // experience to route to and none is created here.
    const STC_OFFERING = {
      ...EMBEDDED_OFFERING,
      id: 'offering-stcpay',
      method: 'stcpay',
      name_ar: 'STC Pay',
      name_en: 'STC Pay',
      methods: ['stcpay'],
    }
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    const { calls, releaseCheckout } = mockApiWithHeldCheckout({
      offerings: [STC_OFFERING],
      checkout: {
        ...embeddedCheckout,
        next_action: {
          ...CLIENT_SDK_ACTION,
          config: { ...CLIENT_SDK_ACTION.config, methods: ['stcpay'] },
        },
      },
      statuses: [{ ...DECLINED_WITH_DETAILS, selected_offering_id: 'offering-stcpay' }],
    })
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => screen.getByTestId('retry-preparing'))
    expectNoDataEntryScreen()

    releaseCheckout()
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(JSON.parse(String(created[0].init?.body)).payment_offering_id).toBe('offering-stcpay')
    // The provider's own form, with STC Pay among its methods — one
    // embedded experience, not a duplicate one.
    const [, , , config] = mountMoyasarForm.mock.calls[0]
    expect((config as { methods?: string[] }).methods).toEqual(['stcpay'])
  })

  it('F — "تغيير طريقة الدفع" still means the chooser, and is a different handler', async () => {
    arriveOnDecline()
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))

    await waitFor(() => expect(payButton()).toBeTruthy())
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0)
    expect(screen.getByText('Contact information')).toBeTruthy()
    // It is NOT a retry: nothing was created and no form was mounted.
    expect(screen.queryByTestId('retry-preparing')).toBeNull()
    expect(mountMoyasarForm).not.toHaveBeenCalled()
  })

  it('I/O — a double click cannot make two checkouts or two provider forms', async () => {
    const { calls, releaseCheckout } = arriveOnDecline()
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    const retry = screen.getByRole('button', { name: 'المحاولة مرة أخرى' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    fireEvent.click(retry)

    await waitFor(() => screen.getByTestId('retry-preparing'))
    // The button is gone with the panel it was on, which is the first
    // line of defence; the ref behind it is the one that holds when two
    // clicks land before React has re-rendered.
    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()

    releaseCheckout()
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    expect(calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')).toHaveLength(1)
    expect(mountMoyasarForm).toHaveBeenCalledTimes(1)
  })

  it('J/N/O — a successful retry produces exactly one PAID order, at the real amount', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    const RETRY_TOKEN = 'b1b2c3d4e5f60719'
    const calls: { url: string; init?: RequestInit }[] = []
    // The failed checkout answers for its own token; the retry's new
    // checkout answers for the new one. Keyed on the token, so the two
    // attempts really are independent records.
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        return json({ ...embeddedCheckout, checkout_token: RETRY_TOKEN })
      }
      if (url.includes(RETRY_TOKEN)) {
        return json({ ...PAID_STATUS, attempt_sequence: 1, total: '50' })
      }
      if (url.includes(TOKEN)) return json(DECLINED_WITH_DETAILS)
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    expect(screen.getByText('50 SAR')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    // The payer pays, and the server settles it.
    formHandlers().onInitiating?.()
    formHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    // One order, from one new checkout. The declined attempt is not
    // touched and is not re-created.
    expect(calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')).toHaveLength(1)
    expect(screen.getAllByText('رقم الطلب:')).toHaveLength(1)
  })

  it('K — a second decline is still a failure the customer can retry from', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    const RETRY_TOKEN = 'b1b2c3d4e5f60719'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        return json({ ...embeddedCheckout, checkout_token: RETRY_TOKEN })
      }
      // The replacement attempt declines too, for the same 50.
      if (url.includes(RETRY_TOKEN)) return json({ ...DECLINED_WITH_DETAILS, attempt_sequence: 1 })
      if (url.includes(TOKEN)) return json(DECLINED_WITH_DETAILS)
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    formHandlers().onInitiating?.()
    formHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))

    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    // N — the amount is the checkout's own, not "—" and not 0.
    expect(screen.getByText('50 SAR')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
    // ...and the retry is still on offer, with nothing re-entered.
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    expectNoDataEntryScreen()
  })

  it('a retry whose checkout request fails stays on the failure, not on a blank form', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') throw new Error('network')
      if (url.includes('/checkout/')) return json(DECLINED_WITH_DETAILS)
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByRole('alert'))
    // Back where it came from, saying what happened — and still retryable.
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    expectNoDataEntryScreen()
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE ASYNCHRONOUS ROUTER WINDOW.

   Found in a real browser, invisible to every test above it.

   `replace` is mocked in this file as if it applied instantly, and
   `history.replaceState` really does. Next's router does not: it
   schedules the navigation, so after `releaseAttempt` there is a window
   in which the page holds a NEW payment while the URL still carries the
   OLD one's `?id=`.

   The confirm effect is gated on the phase not being settled, and a
   retry is the one thing that unsettles it — so in that window it woke
   up, POSTed a confirmation for the payment the customer had just been
   told had failed, and announced "جارٍ تأكيد الدفع…" and then "جارٍ
   التحقق من نتيجة الدفع…" over the retry's own preparing state. A
   verification of a spent attempt, on top of a payment nobody had made.

   The test below restores the real timing by deferring the replace.
   ──────────────────────────────────────────────────────────────────── */

describe('a retry does not confirm the attempt it just released', () => {
  it('makes no confirm call and shows no verification while the URL catches up', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)

    const calls: { url: string; init?: RequestInit }[] = []
    const RETRY_TOKEN = 'b1b2c3d4e5f60719'
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        return json({ ...embeddedCheckout, checkout_token: RETRY_TOKEN })
      }
      if (url.includes('/checkout/')) return json(DECLINED_WITH_DETAILS)
      return json({}, 404)
    }))

    render(<CheckoutPage />)
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    // The real router: the URL changes a tick LATER, not on the call.
    replace.mockImplementationOnce((url: string) => {
      const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
      setTimeout(() => setSearchParams(new URLSearchParams(query)), 30)
    })

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    // The released payment is never confirmed, in that window or after it.
    expect(calls.filter((c) => c.url.includes('/confirm'))).toHaveLength(0)
    // ...and the retry's own state was never overwritten by one.
    expectNoVerification()
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE CART IS NOT THE CHECKOUT.

   Observed: the order summary reads 250 SAR while the provider's form
   charges 50. It looks like a money bug and is not one.

   A checkout is a SNAPSHOT. `POST /checkout` sends `items[]` and NO
   amount; the server prices those lines from its own product rows and
   that single figure becomes `quote_total_minor`, the PaymentIntent's
   `amount_minor`, the amount handed to the provider and, on success, the
   Order total. `assertFactBelongsToIntent` then refuses any provider
   payment whose amount is not the intent's. The money is server-
   authoritative end to end and was never in question.

   What was wrong is that the summary kept its +/- and remove controls
   while that snapshot was being paid — so the customer could raise the
   quantity, watch the summary say 250, and pay 50. The screen implied a
   relationship between the cart and the payment that the architecture
   does not have.

   These tests are about that implication.
   ──────────────────────────────────────────────────────────────────── */

function quantityControls() {
  return {
    increase: screen.queryByLabelText('Increase quantity'),
    decrease: screen.queryByLabelText('Decrease quantity'),
    remove: screen.queryByLabelText('Remove item'),
  }
}

describe('the cart cannot drift away from the payment it is being charged for', () => {
  it('the cart is editable before any payment exists', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()

    const controls = quantityControls()
    expect(controls.increase).toBeTruthy()
    expect(controls.remove).toBeTruthy()
    expect(screen.queryByTestId('cart-locked-note')).toBeNull()
    expect(screen.getByTestId('summary-total').textContent).toContain('100')
  })

  it('A — the quantity controls are gone once the provider form is up', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const controls = quantityControls()
    expect(controls.increase).toBeNull()
    expect(controls.decrease).toBeNull()
    expect(controls.remove).toBeNull()
    // And the page says why, rather than simply going inert.
    expect(screen.getByTestId('cart-locked-note')).toBeTruthy()
  })

  it('the summary shows the PRICED total, not a cart that moved afterwards', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    // Another tab raises the quantity — the one route still open, since
    // this page's own controls are gone.
    updateCartQty('v1', 5)

    await waitFor(() => expect(screen.getByTestId('cart-diverged')).toBeTruthy())
    // 100, not 500: the snapshot is what the provider was given.
    expect(screen.getByTestId('summary-total').textContent).toContain('100')
    expect(screen.getByTestId('summary-total').textContent).not.toContain('500')
    // The payment panel agrees with it. (More than one node carries the
    // figure — the panel and the line — which is the point.)
    expect(screen.getAllByText('100 SAR').length).toBeGreaterThan(0)
    expect(screen.queryByText('500 SAR')).toBeNull()
  })

  it('E — a quantity DECREASE cannot silently shrink the payment either', async () => {
    cart = [{ ...ITEM, qty: 4 }]
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    updateCartQty('v1', 1)

    await waitFor(() => expect(screen.getByTestId('cart-diverged')).toBeTruthy())
    expect(screen.getByTestId('summary-total').textContent).toContain('400')
  })

  it('A/B — the amount sent is the cart at the moment Pay was pressed', async () => {
    // Covers the "rapid changes then pay" race: there is no race in the
    // money path, because the click handler reads the committed cart and
    // the server prices THAT. Asserted rather than assumed.
    const { calls } = mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()

    updateCartQty('v1', 2)
    updateCartQty('v1', 3)
    updateCartQty('v1', 5)
    await waitFor(() => expect(screen.getByTestId('summary-total').textContent).toContain('500'))

    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(created).toHaveLength(1)
    const body = JSON.parse(String(created[0].init?.body))
    expect(body.items).toEqual([{ variant_id: 'v1', quantity: 5 }])
    // The browser still sends no amount at all — the server prices it.
    expect(body.amount).toBeUndefined()
    expect(body.total).toBeUndefined()
    expect(body.currency).toBeUndefined()
  })

  it('releasing the attempt makes the cart editable again, and re-prices it', async () => {
    const { calls } = mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'تغيير طريقة الدفع' }))
    await waitFor(() => expect(payButton()).toBeTruthy())

    // Editable again, and no longer claiming a snapshot.
    expect(quantityControls().increase).toBeTruthy()
    expect(screen.queryByTestId('cart-locked-note')).toBeNull()
    expect(screen.queryByTestId('cart-diverged')).toBeNull()

    updateCartQty('v1', 2)
    // Let the change land before pressing Pay. A real browser delivers
    // these as two separate events with a render between them; firing
    // them in one tick is a test artefact, not the customer's timing.
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('200'),
    )

    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(created).toHaveLength(2)
    // The second checkout is priced from the NEW cart, by the server.
    expect(JSON.parse(String(created[1].init?.body)).items).toEqual([
      { variant_id: 'v1', quantity: 2 },
    ])
  })

  it('a resumed checkout locks the cart even though the snapshot is gone', async () => {
    // After a refresh the React snapshot no longer exists, but the
    // payment does. Editability is keyed on the payment, not on the
    // snapshot, precisely so this case is not a hole.
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [UNCONFIRMED_RETURN] })
    render(<CheckoutPage />)

    await waitFor(() => expect(screen.queryByTestId('cart-locked-note')).toBeTruthy())
    expect(quantityControls().increase).toBeNull()
    expect(quantityControls().remove).toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────
   A FAILED RETRY NAMES THE ACTION THAT WORKS.
   ──────────────────────────────────────────────────────────────────── */

describe('retry failures are classified, not generic', () => {
  function arriveOnDecline(checkoutStatus: number, checkoutBody: unknown) {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}&id=pay_declined1&status=failed`)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        return json(checkoutBody, checkoutStatus)
      }
      if (url.includes('/checkout/')) return json(DECLINED_WITH_DETAILS)
      return json({}, 404)
    }))
    render(<CheckoutPage />)
  }

  it('a disabled method drops the retry button and promotes the chooser', async () => {
    arriveOnDecline(400, { message: 'Selected payment method is not available.' })
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByTestId('retry-notice'))
    expect(screen.getByTestId('retry-notice').getAttribute('data-action')).toBe('change_method')
    // The button the server has already refused is not left on offer.
    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()
    expect(screen.getByRole('button', { name: 'تغيير طريقة الدفع' })).toBeTruthy()
    // Still the failure panel — not a checkout pretending to be new.
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()
    expect(screen.queryByText('Contact information')).toBeNull()
  })

  it('a 5xx keeps the retry, because the checkout is not the problem', async () => {
    arriveOnDecline(503, { message: 'upstream unavailable' })
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByTestId('retry-notice'))
    expect(screen.getByTestId('retry-notice').getAttribute('data-action')).toBe('retry')
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    expectNoDataEntryScreen()
  })

  it('an out-of-stock snapshot says start over rather than "try again"', async () => {
    arriveOnDecline(400, { message: 'Not enough stock for "Test product".' })
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByTestId('retry-notice'))
    expect(screen.getByTestId('retry-notice').getAttribute('data-action')).toBe('restart_checkout')
    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()
  })

  it('never reaches a bare error screen — the failure context is kept', async () => {
    arriveOnDecline(500, {})
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByTestId('retry-notice'))
    // The amount, the outcome and a way forward all survive.
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()
    expect(screen.getByText('50 SAR')).toBeTruthy()
    expectNoDataEntryScreen()
  })
})

/* ────────────────────────────────────────────────────────────────────
   EDIT → LOCK → RETURN TO EDIT

   The cart is editable until the server prices a payment, frozen from
   that instant, and editable again only through one explicit release —
   «العودة لتعديل الطلب» — which is a different action from «تغيير طريقة
   الدفع» and must never let the old amount, the old intent or the old
   provider payment follow the customer into the next one.
   ──────────────────────────────────────────────────────────────────── */

/** The lock as this page renders it, and as it publishes it. */
function lockUi() {
  return {
    notice: screen.queryByTestId('cart-locked-note'),
    published: publishedLock.locked,
    release: publishedLock.release,
  }
}

/**
 * Presses «العودة لتعديل الطلب».
 *
 * The button itself is in the storefront's cart drawer (Header.tsx), so
 * what a checkout-page test can press is the callback that button calls
 * — the one this page published. The drawer's own rendering of it is
 * asserted in components/Header.cartLock.test.tsx.
 */
async function returnToEditOrder() {
  const release = publishedLock.release
  expect(release).toBeTruthy()
  await act(async () => { release!() })
}

/**
 * A checkout endpoint that answers each POST differently.
 *
 * `mockApi` replays one canned checkout forever, which cannot tell a
 * second payment apart from a replay of the first — precisely the
 * distinction these assertions are about.
 */
function mockApiSequence(checkouts: unknown[], statuses: unknown[] = []) {
  const remaining = [...checkouts]
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
    if (url.endsWith('/sync') && init?.method === 'POST') return json({})
    if (url.endsWith('/checkout') && init?.method === 'POST') {
      return json(remaining.length > 1 ? remaining.shift() : remaining[0])
    }
    if (url.includes('/checkout/')) {
      return json(statuses[0] ?? { payment_status: 'processing', order: null })
    }
    return json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

/** The same embedded checkout, at another price and another token. */
function embeddedCheckoutAt(amountMinor: number, token: string) {
  return {
    checkout_token: token,
    next_action: {
      ...CLIENT_SDK_ACTION,
      config: {
        ...CLIENT_SDK_ACTION.config,
        amount: amountMinor,
        callback_url: `https://shop.test/stores/shop1/checkout?token=${token}`,
        metadata: { intent_id: `pi_${token}` },
      },
    },
    order: { order_number: 'A-1003' },
  }
}

/** The config the provider's own form was actually initialised with. */
function providerConfig(callIndex: number) {
  return mountMoyasarForm.mock.calls[callIndex]?.[3] as { amount: number; callback_url: string }
}

async function payAndLock() {
  await fillForm()
  fireEvent.click(payButton())
  await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
}

describe('before payment starts, the cart is fully editable', () => {
  it('1/5 — "+" raises the quantity and the order summary follows it', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()

    fireEvent.click(screen.getByLabelText('Increase quantity'))

    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('200'),
    )
    // And the button that starts the payment quotes the same figure.
    expect(payButton().textContent).toContain('200')
  })

  it('2/5 — "−" lowers the quantity and the order summary follows it', async () => {
    cart = [{ ...ITEM, qty: 3 }]
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    expect(screen.getByTestId('summary-total').textContent).toContain('300')

    fireEvent.click(screen.getByLabelText('Decrease quantity'))

    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('200'),
    )
  })

  it('3 — remove takes a line out of the summary', async () => {
    cart = [{ ...ITEM, qty: 1 }, { ...ITEM, variantId: 'v2', title: 'Second product', price: 40 }]
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()
    expect(screen.getByTestId('summary-total').textContent).toContain('140')

    fireEvent.click(screen.getAllByLabelText('Remove item')[1])

    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('100'),
    )
    expect(screen.queryByText('Second product')).toBeNull()
  })

  it('4/16 — removing the LAST product goes straight to the empty-cart page', async () => {
    const { calls } = mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await fillForm()

    fireEvent.click(screen.getByLabelText('Remove item'))

    await waitFor(() => expect(screen.getByText('Your cart is empty')).toBeTruthy())
    // Nothing of the checkout is left standing behind it.
    expect(screen.queryByTestId('summary-total')).toBeNull()
    expect(screen.queryByRole('button', { name: /place order/i })).toBeNull()
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
    expect(lockUi().notice).toBeNull()
    // And an empty cart never priced anything: no checkout, no token.
    expect(calls.some((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('the moment a payment is priced, the cart is locked', () => {
  it('6/7/8 — +, − and remove are all gone once the payment exists', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    expect(quantityControls().increase).toBeNull()
    expect(quantityControls().decrease).toBeNull()
    expect(quantityControls().remove).toBeNull()
    // The quantity is still READABLE — the products stay visible.
    expect(screen.getByText('× 1')).toBeTruthy()
  })

  it('9 — the summary says the amount is fixed, and points at the cart', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    const { notice } = lockUi()
    expect(notice?.textContent).toContain('🔒')
    expect(notice?.textContent).toContain('تعديل المنتجات غير متاح أثناء الدفع')
    expect(notice?.textContent).toContain('العودة لتعديل الطلب')
    // The order summary is a SUMMARY: no cart controls of its own beyond
    // the quantities it displays, and no cart button.
    expect(screen.queryByRole('button', { name: 'العودة لتعديل الطلب' })).toBeNull()
    expect(screen.queryByText(/سلة التسوق \(/)).toBeNull()
  })

  it('9 — publishes the lock, and a release, to the storefront cart', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    // What the header's drawer renders from: the fact, and the way back.
    expect(publishedLock.locked).toBe(true)
    expect(typeof publishedLock.release).toBe('function')
    expect(setCartLock).toHaveBeenCalled()
  })

  it('the amount on screen is the PRICED one, not a derived cart figure', async () => {
    // The lock is a fact about the checkout's state: `cartLocked` is
    // what removes the controls, what refuses the mutators behind them,
    // and what makes the summary read the snapshot instead of the cart.
    // Same state, so one reading proves the amount half of it.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    expect(screen.getByTestId('summary-total').textContent).toContain('100')
    expect(providerConfig(0).amount).toBe(10000)
  })

  it('17 — a refresh onto the locked payment comes back locked', async () => {
    cart = [ITEM]
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    mockApi({ offerings: [EMBEDDED_OFFERING], statuses: [UNCONFIRMED_RETURN] })
    render(<CheckoutPage />)

    await waitFor(() => expect(lockUi().notice).toBeTruthy())
    expect(lockUi().published).toBe(true)
    expect(lockUi().release).toBeTruthy()
    expect(quantityControls().increase).toBeNull()
    expect(quantityControls().decrease).toBeNull()
    expect(quantityControls().remove).toBeNull()
  })

  it('19 — another tab cannot move the amount of a locked payment', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    // The other tab writes the same cart; this one is priced.
    updateCartQty('v1', 5)

    await waitFor(() => expect(screen.getByTestId('cart-diverged')).toBeTruthy())
    expect(screen.getByTestId('summary-total').textContent).toContain('100')
    expect(screen.getByTestId('summary-total').textContent).not.toContain('500')
    expect(providerConfig(0).amount).toBe(10000)
    // Still locked, and still offering the one way out.
    expect(quantityControls().increase).toBeNull()
    expect(lockUi().published).toBe(true)
  })

  it('keeps the locked summary even if another tab EMPTIES the cart', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    removeFromCart('v1')

    // The payment is still for those lines, so they stay on screen with
    // their amount — this is not an empty checkout.
    await waitFor(() => expect(screen.getByTestId('cart-diverged')).toBeTruthy())
    expect(screen.queryByText('Your cart is empty')).toBeNull()
    expect(screen.getByTestId('summary-total').textContent).toContain('100')
    expect(lockUi().notice).toBeTruthy()
  })
})

describe('«العودة لتعديل الطلب» — the explicit release', () => {
  it('10/12 — unlocks the cart, and the summary follows it again', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    await returnToEditOrder()

    await waitFor(() => expect(payButton()).toBeTruthy())
    expect(lockUi().notice).toBeNull()
    expect(screen.queryByTestId('cart-diverged')).toBeNull()
    expect(quantityControls().increase).toBeTruthy()
    expect(quantityControls().decrease).toBeTruthy()
    expect(quantityControls().remove).toBeTruthy()
    // The provider's form went with the attempt it belonged to.
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
    // And the storefront's cart is told, so the drawer unlocks with it.
    expect(publishedLock.locked).toBe(false)

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('200'),
    )
  })

  it('11/13/14/15 — paying again prices the NEW cart, with a new intent', async () => {
    const { calls } = mockApiSequence([
      embeddedCheckoutAt(10000, TOKEN),
      embeddedCheckoutAt(15000, 'bbbb2222cccc3333'),
    ])
    render(<CheckoutPage />)
    await payAndLock()
    expect(providerConfig(0).amount).toBe(10000)

    await returnToEditOrder()
    await waitFor(() => expect(payButton()).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('200'),
    )

    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    // 13 — a second checkout, priced by the server from the new cart.
    expect(created).toHaveLength(2)
    expect(JSON.parse(String(created[1].init?.body)).items).toEqual([
      { variant_id: 'v1', quantity: 2 },
    ])
    // The browser still names no amount; the server prices it.
    expect(JSON.parse(String(created[1].init?.body)).amount).toBeUndefined()

    // 14 — a NEW idempotency scope, so the server creates another
    // checkout and intent instead of replaying the released one.
    const keyOf = (call: (typeof created)[number]) =>
      new Headers(call.init?.headers as HeadersInit).get('Idempotency-Key')
    expect(keyOf(created[0])).toBeTruthy()
    expect(keyOf(created[1])).not.toBe(keyOf(created[0]))

    // 15 — the provider is given the NEW authoritative amount, against
    // the NEW checkout's callback. 11 — never 100 again.
    expect(providerConfig(1).amount).toBe(15000)
    expect(providerConfig(1).callback_url).toContain('bbbb2222cccc3333')
    expect(screen.getByTestId('summary-total').textContent).toContain('200')
    expect(screen.queryByText('100 SAR')).toBeNull()
  })

  it('E — the released attempt leaves nothing behind to be charged again', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    await returnToEditOrder()
    await waitFor(() => expect(payButton()).toBeTruthy())

    // The spent token is out of the URL, so a refresh cannot resume it —
    // taken back out by the same `history.replaceState` that wrote it,
    // because in a real browser the router alone left the query behind.
    expect(replace).toHaveBeenCalledWith('/stores/shop1/checkout', { scroll: false })
    expect(replaceState).toHaveBeenCalledWith(null, '', '/stores/shop1/checkout')
    expect(searchParams.get('token')).toBeNull()
    // And no payment was created by the release itself.
    expect(mountMoyasarForm).toHaveBeenCalledTimes(1)
  })

  it('removing everything after the release lands on the empty-cart page', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    await returnToEditOrder()
    await waitFor(() => expect(payButton()).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Remove item'))

    await waitFor(() => expect(screen.getByText('Your cart is empty')).toBeTruthy())
    expect(screen.queryByTestId('summary-total')).toBeNull()
    expect(screen.queryByTestId('embedded-payment-form')).toBeNull()
  })

  it('is NOT the same action as «تغيير طريقة الدفع»', async () => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    render(<CheckoutPage />)
    await payAndLock()

    // Both are on offer on a locked embedded payment, and they are
    // different things: one is about what is being paid for (published
    // to the cart drawer), the other about how it is paid (on the
    // payment panel, here).
    expect(publishedLock.release).toBeTruthy()
    expect(screen.getByRole('button', { name: 'تغيير طريقة الدفع' })).toBeTruthy()

    await returnToEditOrder()
    await waitFor(() => expect(payButton()).toBeTruthy())
    // Editing the ORDER is where it lands: the cart controls are back.
    expect(quantityControls().increase).toBeTruthy()
  })
})

/* ────────────────────────────────────────────────────────────────────
   FAILED → EDIT → RETRY

   A payment that is over is not a payment. The cart the customer was
   refused with is theirs again, and the retry beside it prices whatever
   they change it to — on the SERVER, into a new checkout, a new intent
   and a new attempt. The declined 300 must never become the 400 they
   are looking at.
   ──────────────────────────────────────────────────────────────────── */

/** The 100 SAR checkout this page priced, declined by the server. */
const DECLINED_AT_100 = {
  payment_status: 'failed',
  attempt_status: 'failed',
  attempt_sequence: 1,
  payment_attempt_started: true,
  currency: 'SAR',
  total: '100',
  order: null,
}

/** A reading that is not terminal, and therefore not an outcome. */
const STILL_PROCESSING = {
  payment_status: 'processing',
  attempt_status: 'processing',
  payment_attempt_started: true,
  order: null,
}

/**
 * Pays, then has the SERVER decline it, exactly as the embedded path
 * does: the provider reports its payment and the authoritative read
 * says failed. Nothing here decides an outcome locally.
 */
async function payThenServerDeclines(statuses: unknown[] = [DECLINED_AT_100]) {
  const api = mockApi({
    offerings: [EMBEDDED_OFFERING],
    checkout: embeddedCheckout,
    statuses,
  })
  render(<CheckoutPage />)
  await fillForm()
  fireEvent.click(payButton())
  await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
  formHandlers().onInitiating?.()
  formHandlers().onCompleted?.()
  fireEvent(window, new Event('focus'))
  await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
  return api
}

/**
 * The same, with a checkout endpoint that answers each POST differently
 * and a status endpoint that stops declining after the first read — so
 * the retry's own payment is a genuinely new one rather than a replay
 * of the reading that failed.
 */
function mockDeclineThenSecondCheckout(checkouts: unknown[], declinedTotal = '600') {
  const remaining = [...checkouts]
  const calls: { url: string; init?: RequestInit }[] = []

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
    if (url.endsWith('/sync') && init?.method === 'POST') return json({})
    if (url.endsWith('/checkout') && init?.method === 'POST') {
      return json(remaining.length > 1 ? remaining.shift() : remaining[0])
    }
    if (url.includes('/checkout/')) {
      // Per TOKEN, not per call: the declined checkout keeps answering
      // "failed" for as long as anything asks about it, and the retry's
      // own checkout answers for itself.
      return json(
        url.includes(TOKEN) ? { ...DECLINED_AT_100, total: declinedTotal } : STILL_PROCESSING,
      )
    }
    return json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

describe('a definitively FAILED payment gives the cart back', () => {
  it('15 — the lock is released, here and in the storefront', async () => {
    await payThenServerDeclines()

    expect(lockUi().notice).toBeNull()
    expect(publishedLock.locked).toBe(false)
    // The failure itself is still on screen: unlocking the cart is not
    // hiding the outcome.
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
  })

  it('16/17/18/19 — +, − and remove work again, and the summary follows', async () => {
    cart = [{ ...ITEM, qty: 6 }]
    await payThenServerDeclines()
    expect(screen.getByTestId('summary-total').textContent).toContain('600')

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('700'),
    )

    fireEvent.click(screen.getByLabelText('Decrease quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('600'),
    )

    // And the declined checkout's own total is no longer quoted as if it
    // were what the customer is about to pay.
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('700'),
    )
    expect(screen.queryByText('600 SAR')).toBeNull()

    fireEvent.click(screen.getByLabelText('Remove item'))
    await waitFor(() => expect(screen.queryByTestId('summary-total')).toBeNull())
    // The payment that failed is still reported — an emptied cart does
    // not erase the fact that a payment was refused.
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()
  })

  it('32 — an empty cart cannot start the next payment', async () => {
    const { calls } = await payThenServerDeclines()
    fireEvent.click(screen.getByLabelText('Remove item'))
    await waitFor(() => expect(screen.queryByTestId('summary-total')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    await waitFor(() => screen.getByText('سلتك فارغة. أضف المنتجات مرة أخرى لبدء عملية دفع جديدة.'))
    expect(calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')).toHaveLength(1)
    expect(mountMoyasarForm).toHaveBeenCalledTimes(1)
  })

  /*
   * 6/7/8 — processing, requires_action, and a status this frontend has
   * never heard of. All three normalise to a NON-terminal phase (see
   * lib/payments/state.ts, where an unrecognised status is PROCESSING
   * and never an outcome), and none of them may hand the cart back: an
   * unresolved payment can still take the money.
   */
  it.each([
    ['PENDING (processing)', STILL_PROCESSING],
    ['REQUIRES_ACTION', UNCONFIRMED_RETURN],
    ['UNKNOWN', { payment_status: 'some_status_from_the_future', order: null }],
  ])('6/7/8 — %s is unresolved, and the cart stays locked', async (_name, status) => {
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout, statuses: [status] })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    // The payer even pressed Pay at the provider — and still nothing
    // terminal has come back.
    formHandlers().onInitiating?.()
    fireEvent(window, new Event('focus'))

    expect(quantityControls().increase).toBeNull()
    expect(quantityControls().decrease).toBeNull()
    expect(quantityControls().remove).toBeNull()
    expect(lockUi().notice).toBeTruthy()
    expect(publishedLock.locked).toBe(true)
  })
})

describe('the retry after an edit is priced from the CURRENT cart', () => {
  it('23/24/25/26/27/28/29 — the server prices the new cart, and the provider gets THAT', async () => {
    cart = [{ ...ITEM, qty: 6 }]
    const { calls } = mockDeclineThenSecondCheckout([
      embeddedCheckoutAt(60000, TOKEN),
      embeddedCheckoutAt(80000, 'bbbb2222cccc3333'),
    ])
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    expect(providerConfig(0).amount).toBe(60000)

    formHandlers().onInitiating?.()
    formHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    // 6 × 50 → 8 × 50, in the customer's own words.
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('800'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    // 25 — a SECOND checkout, not a replay of the declined one.
    expect(created).toHaveLength(2)
    // 23/24 — the current cart is what was sent, and the browser still
    // names no amount at all: the server prices those lines itself.
    const body = JSON.parse(String(created[1].init?.body))
    expect(body.items).toEqual([{ variant_id: 'v1', quantity: 8 }])
    expect(body.amount).toBeUndefined()
    expect(body.total).toBeUndefined()
    expect(body.currency).toBeUndefined()

    // 26/27 — a new idempotency scope, so the server creates another
    // checkout, intent and attempt instead of returning the spent one.
    const keyOf = (call: (typeof created)[number]) =>
      new Headers(call.init?.headers as HeadersInit).get('Idempotency-Key')
    expect(keyOf(created[1])).toBeTruthy()
    expect(keyOf(created[1])).not.toBe(keyOf(created[0]))

    // 28/29 — Moyasar is initialised with the NEW server amount, against
    // the NEW checkout. The declined 600 appears nowhere on the screen
    // that is about to charge 800.
    expect(providerConfig(1).amount).toBe(80000)
    expect(providerConfig(1).callback_url).toContain('bbbb2222cccc3333')
    expect(screen.queryByText('600 SAR')).toBeNull()
    expect(screen.getByTestId('summary-total').textContent).toContain('800')
  })

  it('30 — the failed attempt stays exactly as it was made', async () => {
    cart = [{ ...ITEM, qty: 6 }]
    const { calls } = mockDeclineThenSecondCheckout([
      embeddedCheckoutAt(60000, TOKEN),
      embeddedCheckoutAt(80000, 'bbbb2222cccc3333'),
    ])
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    formHandlers().onInitiating?.()
    formHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('700'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))

    // The first checkout was posted for the cart as it stood then, and
    // nothing since has gone back to change or delete it: a failed
    // payment is history, not a record to be edited.
    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    expect(JSON.parse(String(created[0].init?.body)).items).toEqual([
      { variant_id: 'v1', quantity: 6 },
    ])
    const mutations = calls.filter(
      (c) =>
        ['DELETE', 'PUT', 'PATCH'].includes(String(c.init?.method ?? '').toUpperCase()) ||
        /cancel|void|release/.test(c.url),
    )
    expect(mutations).toEqual([])
  })

  it('a retry of the SAME cart still keeps the server total it was priced at', async () => {
    // The edit is what makes the old record stale — not the retry. An
    // unchanged cart keeps the authoritative amount it already has, so
    // the panel never falls back to a browser-derived figure.
    await payThenServerDeclines()
    expect(screen.getAllByText('100 SAR').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('100 SAR').length).toBeGreaterThan(0)
  })
})

/* ────────────────────────────────────────────────────────────────────
   THE REFUSED ATTEMPT AND THE CURRENT ORDER ARE TWO DIFFERENT NUMBERS.

   They were one — whichever of the server total, the snapshot or the
   cart happened to be available — so editing a declined 300 SAR order up
   to 400 re-labelled the DECLINED payment 400 SAR. The customer was
   never refused for 400. The panel now states both, from two sources
   that cannot move each other.
   ──────────────────────────────────────────────────────────────────── */

/** 6 × 50 = 300 SAR, declined by the server at 300, retryable at 400. */
async function declineAt300() {
  cart = [{ ...ITEM, price: 50, qty: 6 }]
  const api = mockDeclineThenSecondCheckout(
    [embeddedCheckoutAt(30000, TOKEN), embeddedCheckoutAt(40000, 'bbbb2222cccc3333')],
    '300',
  )
  render(<CheckoutPage />)
  await fillForm()
  fireEvent.click(payButton())
  await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
  formHandlers().onInitiating?.()
  formHandlers().onCompleted?.()
  fireEvent(window, new Event('focus'))
  await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
  // The refusal is captured by an effect from the server's own total, so
  // it lands a commit after the headline. Waiting for it here is what the
  // panel itself does; asserting on the same tick was only ever passing
  // because an unrelated re-render happened to pump the queue.
  await waitFor(() => screen.getByTestId('failed-attempt-amount'))
  return api
}

const refusedAmount = () => screen.getByTestId('failed-attempt-amount').textContent ?? ''
const currentOrder = () => screen.getByTestId('current-order-total').textContent ?? ''

describe('the failed attempt amount and the current order total are separate', () => {
  it('A/B — states what was refused, and it equals the cart until the cart moves', async () => {
    await declineAt300()

    expect(refusedAmount()).toContain('قيمة المحاولة المرفوضة')
    expect(refusedAmount()).toContain('300 SAR')
    expect(currentOrder()).toContain('إجمالي الطلب الحالي')
    expect(currentOrder()).toContain('300 SAR')
  })

  it('C/F/G — 6 → 8 moves the current order to 400 and leaves the refusal at 300', async () => {
    await declineAt300()

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() => expect(currentOrder()).toContain('400 SAR'))

    // The whole point: the payment that was refused was 300, and stays
    // 300 however the customer edits what they now want to buy.
    expect(refusedAmount()).toContain('300 SAR')
    expect(refusedAmount()).not.toContain('400')
    // And the order summary agrees with the current-order figure.
    expect(screen.getByTestId('summary-total').textContent).toContain('400')
  })

  it('D — a quantity DECREASE does not rewrite it either', async () => {
    await declineAt300()

    fireEvent.click(screen.getByLabelText('Decrease quantity'))
    await waitFor(() => expect(currentOrder()).toContain('250 SAR'))
    expect(refusedAmount()).toContain('300 SAR')
  })

  it('E — nor does removing the product', async () => {
    await declineAt300()

    fireEvent.click(screen.getByLabelText('Remove item'))
    // An empty cart is not a 0 SAR order and is not an unknown amount:
    // it is an empty cart, and it says so.
    await waitFor(() => expect(currentOrder()).toContain('السلة فارغة'))
    expect(currentOrder()).not.toContain('0 SAR')
    // The refusal is history and survives the cart it was made from.
    expect(refusedAmount()).toContain('300 SAR')
  })

  it('H/I/J/K — the retry is priced from the CURRENT cart, never from the refusal', async () => {
    const { calls } = await declineAt300()
    expect(providerConfig(0).amount).toBe(30000)

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() => expect(currentOrder()).toContain('400 SAR'))
    expect(refusedAmount()).toContain('300 SAR')

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(2))

    const created = calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST')
    // H — the current items, and only those.
    expect(created).toHaveLength(2)
    const body = JSON.parse(String(created[1].init?.body))
    expect(body.items).toEqual([{ variant_id: 'v1', quantity: 8 }])
    expect(body.amount).toBeUndefined()
    expect(body.total).toBeUndefined()
    expect(body.currency).toBeUndefined()

    // I — a new idempotency scope: a new checkout, intent and attempt.
    const keyOf = (call: (typeof created)[number]) =>
      new Headers(call.init?.headers as HeadersInit).get('Idempotency-Key')
    expect(keyOf(created[1])).not.toBe(keyOf(created[0]))

    // J/K — the provider is initialised at the server's new figure, and
    // the refused 300 is nowhere near the payment being created.
    expect(providerConfig(1).amount).toBe(40000)
    expect(providerConfig(1).callback_url).toContain('bbbb2222cccc3333')
    expect(screen.queryByTestId('failed-attempt-amount')).toBeNull()
    expect(screen.queryByText('300 SAR')).toBeNull()
  })

  it('falls back to the PRICED snapshot, never to the cart, when the server sends no total', async () => {
    // The fallback is the other place a cart-derived figure could creep
    // in. It is the array this page SENT to be priced, frozen at the
    // request — so it survives the cart being edited underneath it.
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [{ ...DECLINED_AT_100, total: null }],
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    formHandlers().onInitiating?.()
    formHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))

    await waitFor(() => expect(refusedAmount()).toContain('300 SAR'))

    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() => expect(currentOrder()).toContain('400 SAR'))
    expect(refusedAmount()).toContain('300 SAR')
  })

  it('says nothing about a refusal on a payment that has not settled', async () => {
    // The two-figure block belongs to a SETTLED, unsuccessful payment.
    // A payment still in flight has exactly one amount: its own.
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [STILL_PROCESSING],
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalled())
    formHandlers().onInitiating?.()
    fireEvent(window, new Event('focus'))

    expect(screen.queryByTestId('failed-attempt-amount')).toBeNull()
    expect(screen.queryByTestId('current-order-total')).toBeNull()
  })
})

describe('a submission that never became a payment does not leave the cart locked', () => {
  it('a failed checkout request returns an EDITABLE cart', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/checkout') && init?.method === 'POST') throw new Error('network down')
      return json({}, 404)
    }))
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(quantityControls().increase).toBeTruthy())
    expect(lockUi().notice).toBeNull()
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() =>
      expect(screen.getByTestId('summary-total').textContent).toContain('200'),
    )
  })
})

/* ────────────────────────────────────────────────────────────────────
   EVERY retry takes the same path, however many failures precede it.

   The first retry was already proven to go FAILED → RETRY_PREPARING →
   provider. What was never exercised is the SECOND and THIRD: a
   customer whose card is declined three times, who then edits the cart
   and presses "المحاولة مرة أخرى" again. The concern is accumulated
   state — a spent token, a stale server record, a lock left set — that
   makes a later retry behave differently from the first and drop the
   customer back onto the data-entry screen they never asked for.
   ──────────────────────────────────────────────────────────────────── */

/**
 * A checkout endpoint that issues a NEW checkout per POST, and a status
 * endpoint whose verdict is per TOKEN and driven by the test.
 *
 * `mockDeclineThenSecondCheckout` can only decline the FIRST token — it
 * hard-codes the rest to `processing` — so it cannot express a second or
 * third failure at all. This can: each issued checkout starts
 * `processing` and is declined only when the test says so, which is what
 * lets a chain of failures be driven one attempt at a time.
 */
function mockDeclinableCheckouts(
  specs: { token: string; amountMinor: number; total: string }[],
) {
  const queue = [...specs]
  const failed = new Set<string>()
  const issued: string[] = []
  const calls: { url: string; init?: RequestInit }[] = []

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
    if (url.endsWith('/sync') && init?.method === 'POST') return json({})
    if (url.endsWith('/checkout') && init?.method === 'POST') {
      const spec = queue.length > 1 ? queue.shift()! : queue[0]
      issued.push(spec.token)
      return json(embeddedCheckoutAt(spec.amountMinor, spec.token))
    }
    if (url.includes('/checkout/')) {
      const spec = specs.find((candidate) => url.includes(candidate.token))
      if (spec && failed.has(spec.token)) {
        return json({ ...DECLINED_AT_100, total: spec.total })
      }
      return json(STILL_PROCESSING)
    }
    return json({}, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    issued,
    /** The server's verdict on this checkout turns to `failed`. */
    decline: (token: string) => failed.add(token),
    checkoutPosts: () =>
      calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST'),
  }
}

/** The handlers of the form mounted LAST — a retry mounts another. */
function latestFormHandlers() {
  const last = mountMoyasarForm.mock.calls[mountMoyasarForm.mock.calls.length - 1]
  return last?.[4] as { onInitiating?: () => void; onCompleted?: () => void }
}

/** The provider's own form is up and is the one just created. */
async function waitForProviderForm(mountCount: number) {
  await waitFor(() => expect(mountMoyasarForm).toHaveBeenCalledTimes(mountCount))
}

/**
 * Drives ONE attempt to a server-side decline, exactly as the embedded
 * path does: the provider reports its payment, the authoritative read
 * says failed. Nothing decides an outcome locally.
 */
async function declineCurrentAttempt(
  api: ReturnType<typeof mockDeclinableCheckouts>,
  token: string,
) {
  const handlers = latestFormHandlers()
  handlers.onInitiating?.()
  api.decline(token)
  handlers.onCompleted?.()
  fireEvent(window, new Event('focus'))
  await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
  // Same reason as `declineAt300`: the refusal is captured by an effect
  // and lands a commit after the headline.
  await waitFor(() => screen.getByTestId('failed-attempt-amount'))
}

/**
 * Everything the customer must NOT see between the failure panel and
 * the provider's form, watched CONTINUOUSLY rather than sampled.
 *
 * A forbidden screen that renders for one commit and is replaced on the
 * next is still a forbidden screen — it is exactly the flicker the
 * report describes — and an assertion made after the fact cannot see it.
 */
function watchForbiddenScreens() {
  const seen = new Set<string>()
  // Once the retry has begun, the panel it was pressed on must never come
  // back. Tracked rather than asserted directly because the watch is
  // installed BEFORE the click, when that panel is legitimately on screen.
  let retryBegun = false
  const sample = () => {
    if (document.querySelector('[data-testid="retry-preparing"]')) retryBegun = true
    if (
      retryBegun &&
      (document.querySelector('[data-testid="failed-attempt-amount"]') ||
        Array.from(document.querySelectorAll('button')).some(
          (b) => (b.textContent ?? '').trim() === 'المحاولة مرة أخرى',
        ))
    ) {
      seen.add('failed-panel-after-retry')
    }
    // The data-entry screen: contact, shipping, and the chooser that
    // sits on the same form.
    if (document.querySelector('input[placeholder="Jane Doe"]')) seen.add('contact')
    if (document.querySelector('input[placeholder="123 Main St, Apt 4B"]')) seen.add('shipping')
    if (document.querySelector('form')) seen.add('checkout-form')
    // CREATING_PAYMENT — the submission phase, which keeps that same
    // form mounted underneath it. Never a retry's phase.
    if (
      Array.from(document.querySelectorAll('*')).some(
        (node) => node.textContent === PHASE_HEADLINE.CREATING_PAYMENT,
      )
    ) {
      seen.add('creating-payment')
    }
    /*
     * The provider panel's own chrome, while it has no fields under it.
     *
     * This is the state a real browser sat in for ~1s: the "أدخل بيانات
     * البطاقة" headline, a payment-method row and a "تغيير طريقة الدفع"
     * button around an EMPTY box. It is not the checkout form, so the
     * earlier checks above cannot see it — and to a customer pressing
     * retry it reads as exactly the payment-method screen this flow is
     * supposed to skip.
     */
    const container = document.querySelector('[data-testid="embedded-payment-form"]')
    // Scoped to the PROVIDER panel: the failure panel has a "تغيير طريقة
    // الدفع" button of its own, and that one is not this defect.
    if (container && container.children.length === 0) {
      const chooseAnother = Array.from(document.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('تغيير طريقة الدفع'),
      )
      const enterCard = Array.from(document.querySelectorAll('*')).some(
        (node) => node.textContent === PHASE_HEADLINE.PROVIDER_UI,
      )
      if (chooseAnother || enterCard) seen.add('method-chrome-without-fields')
    }
  }
  const observer = new MutationObserver(sample)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true })
  sample()
  return { seen, stop: () => { observer.disconnect(); return seen } }
}

/** 6 × 50 = 300. Each retry is a new checkout at its own price. */
const RETRY_SPECS = [
  { token: TOKEN, amountMinor: 30000, total: '300' },
  { token: 'bbbb2222cccc3333', amountMinor: 30000, total: '300' },
  { token: 'cccc3333dddd4444', amountMinor: 30000, total: '300' },
  // The fourth is the one made AFTER the cart is edited to 10 × 50.
  { token: 'dddd4444eeee5555', amountMinor: 50000, total: '500' },
]

/** Fails `count` times in a row, retrying between each. */
async function failNTimes(count: number) {
  cart = [{ ...ITEM, price: 50, qty: 6 }]
  const api = mockDeclinableCheckouts(RETRY_SPECS)
  render(<CheckoutPage />)
  await fillForm()
  fireEvent.click(payButton())
  await waitForProviderForm(1)
  await declineCurrentAttempt(api, RETRY_SPECS[0].token)

  for (let attempt = 1; attempt < count; attempt += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitForProviderForm(attempt + 1)
    await declineCurrentAttempt(api, RETRY_SPECS[attempt].token)
  }
  return api
}

describe('every retry follows the same path, however many failures precede it', () => {
  it('1 — FAILED → retry → provider, with no data-entry screen in between', async () => {
    const api = await failNTimes(1)

    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    // 16 — the ONLY intermediate customer-facing state.
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()
    await waitForProviderForm(2)
    expect(Array.from(watch.stop())).toEqual([])

    expect(api.checkoutPosts()).toHaveLength(2)
    expect(screen.getByTestId('embedded-payment-form')).toBeTruthy()
  })

  it.each([
    ['2 — a SECOND retry', 2],
    ['3 — a THIRD retry', 3],
  ])('%s behaves exactly like the first', async (_name, failures) => {
    const api = await failNTimes(failures)

    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()
    await waitForProviderForm(failures + 1)
    expect(Array.from(watch.stop())).toEqual([])

    // 9 — a new checkout each time, never a replay of a spent one.
    expect(api.checkoutPosts()).toHaveLength(failures + 1)
    expect(new Set(api.issued).size).toBe(failures + 1)
  })

  it('4/5/6/7/8 — after N failures AND a cart edit, the retry is the CURRENT cart', async () => {
    const api = await failNTimes(3)

    // 6 → 10, on a cart the third failure handed back.
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() => expect(currentOrder()).toContain('500 SAR'))
    // The refusal is still the attempt that was refused.
    expect(refusedAmount()).toContain('300 SAR')

    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()
    await waitForProviderForm(4)
    expect(Array.from(watch.stop())).toEqual([])

    // 7 — the CURRENT quantity, and no browser-authored amount.
    const posts = api.checkoutPosts()
    expect(posts).toHaveLength(4)
    const body = JSON.parse(String(posts[3].init?.body))
    expect(body.items).toEqual([{ variant_id: 'v1', quantity: 10 }])
    expect(body.amount).toBeUndefined()
    expect(body.total).toBeUndefined()
    expect(body.currency).toBeUndefined()

    // 8 — the old figure never reaches the provider; the server's does.
    expect(providerConfig(3).amount).toBe(50000)
    expect(providerConfig(3).callback_url).toContain('dddd4444eeee5555')
  })

  it('17/18 — a double-click on a later retry still starts ONE payment', async () => {
    const api = await failNTimes(2)

    const retry = screen.getByRole('button', { name: 'المحاولة مرة أخرى' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    await waitForProviderForm(3)

    expect(api.checkoutPosts()).toHaveLength(3)
    expect(mountMoyasarForm).toHaveBeenCalledTimes(3)
    const keys = api
      .checkoutPosts()
      .map((call) => new Headers(call.init?.headers as HeadersInit).get('Idempotency-Key'))
    expect(new Set(keys).size).toBe(3)
  })

  it('19/20/21 — the cart locks again the moment the later retry exists', async () => {
    await failNTimes(3)
    // 20 — the third failure handed it back.
    expect(quantityControls().increase).toBeTruthy()
    expect(publishedLock.locked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    // 19/21 — locked while the retry is still preparing, and it stays
    // locked once the provider's form is up.
    expect(quantityControls().increase).toBeNull()
    expect(publishedLock.locked).toBe(true)
    await waitForProviderForm(4)
    expect(quantityControls().increase).toBeNull()
    expect(publishedLock.locked).toBe(true)
  })
})

/* ────────────────────────────────────────────────────────────────────
   A retry that never BECAME a payment does not rewrite the refusal.

   Found in a real browser, not here: raising 6 to 10 is exactly what
   makes the server answer "not enough stock", so the retry's checkout
   POST is refused and the panel comes straight back — having created no
   checkout, no intent and no attempt. The refusal had been cleared on
   the way out of FAILED, so it was re-captured from the only figure
   left, the edited cart the rejected request had tried to price. The
   panel then reported a refusal of 500 SAR for a payment that was never
   submitted at 500.
   ──────────────────────────────────────────────────────────────────── */
describe('a retry the server refuses leaves the previous refusal alone', () => {
  /** Declines at 300, then rejects the retry's own checkout POST. */
  function mockRefusedRetry() {
    let posts = 0
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        posts += 1
        if (posts === 1) return json(embeddedCheckoutAt(30000, TOKEN))
        // What a raised quantity actually gets back.
        return json({ message: 'Not enough stock for Test product' }, 400)
      }
      if (url.includes('/checkout/')) return json({ ...DECLINED_AT_100, total: '300' })
      return json({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    return {
      calls,
      checkoutPosts: () =>
        calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST'),
    }
  }

  it('keeps the 300 SAR refusal when the retry POST is rejected', async () => {
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    const api = mockRefusedRetry()
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitForProviderForm(1)
    latestFormHandlers().onInitiating?.()
    latestFormHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    await waitFor(() => expect(refusedAmount()).toContain('300 SAR'))

    // 6 → 10, which is what makes the server refuse.
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() => expect(currentOrder()).toContain('500 SAR'))

    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(screen.getByTestId('retry-notice')).toBeTruthy())

    /*
     * The refused retry lands back on the panel it came from — never on
     * the data-entry screen.
     *
     * `failed-panel-after-retry` is EXPECTED here and only here: the
     * server refused the retry, so there is no provider form to reach and
     * returning to the failure panel is the correct outcome, not a flash
     * on the way to somewhere else. Every other forbidden screen still
     * fails this assertion.
     */
    expect(Array.from(watch.stop()).filter((s) => s !== 'failed-panel-after-retry')).toEqual([])
    expect(screen.getByText('لم تتم عملية الدفع')).toBeTruthy()

    // THE REGRESSION: 300 was refused. 500 never became a payment.
    expect(refusedAmount()).toContain('300 SAR')
    expect(refusedAmount()).not.toContain('500')
    expect(currentOrder()).toContain('500 SAR')

    // And nothing was created for it: one checkout, still.
    expect(api.checkoutPosts()).toHaveLength(2)
    expect(mountMoyasarForm).toHaveBeenCalledTimes(1)
  })

  it('a retry that DOES become a payment supersedes the refusal', async () => {
    // The other half of the rule: the reset moved to "a payment now
    // exists", so it must still happen when one does.
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    const api = mockDeclinableCheckouts(RETRY_SPECS)
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitForProviderForm(1)
    await declineCurrentAttempt(api, RETRY_SPECS[0].token)
    expect(refusedAmount()).toContain('300 SAR')


    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitForProviderForm(2)
    // A payment exists again, so there is no refusal on screen at all.
    expect(screen.queryByTestId('failed-attempt-amount')).toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────
   Nothing but the neutral preparing state, until there are card fields.

   Observed in a real browser, at the DOM level: `PROVIDER_UI` is entered
   the moment the backend's next action arrives, but the provider's
   assets are only THEN fetched and mounted — measured at ~1s on a cold
   load. The panel spent that window rendering its full chrome around an
   empty box, which on a retry is a payment-method screen appearing
   exactly where the customer was promised there would be none.
   ──────────────────────────────────────────────────────────────────── */
describe('the retry window shows the provider panel only once it has fields', () => {
  /** Holds the provider's assets, the way a cold CDN fetch does. */
  function holdProviderAssets() {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    loadMoyasarForm.mockImplementation(async () => {
      await held
      return { init: vi.fn() }
    })
    return { release }
  }

  it('holds the neutral panel across a slow provider load, on the FIRST retry', async () => {
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    const api = mockDeclinableCheckouts(RETRY_SPECS)
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitForProviderForm(1)
    await declineCurrentAttempt(api, RETRY_SPECS[0].token)

    const assets = holdProviderAssets()
    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))

    // The checkout has been created and the phase has moved on, but the
    // provider has nothing on screen yet. This is the whole window.
    await waitFor(() => expect(api.checkoutPosts()).toHaveLength(2))
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'تغيير طريقة الدفع' })).toBeNull()
    expect(screen.queryByText(PHASE_HEADLINE.PROVIDER_UI)).toBeNull()

    assets.release()
    await waitForProviderForm(2)
    // Only now does the panel claim to be the card screen.
    await waitFor(() => expect(screen.getByText(PHASE_HEADLINE.PROVIDER_UI)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'تغيير طريقة الدفع' })).toBeTruthy()

    // And not one commit in between exposed a forbidden screen.
    expect(Array.from(watch.stop())).toEqual([])
  })

  it.each([
    ['the SECOND retry', 2],
    ['the THIRD retry', 3],
  ])('holds it identically on %s', async (_name, failures) => {
    const api = await failNTimes(failures)

    const assets = holdProviderAssets()
    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(api.checkoutPosts()).toHaveLength(failures + 1))
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'تغيير طريقة الدفع' })).toBeNull()

    assets.release()
    await waitForProviderForm(failures + 1)
    expect(Array.from(watch.stop())).toEqual([])
  })

  it('holds it after a cart edit, and the provider still gets the new price', async () => {
    const api = await failNTimes(3)
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    await waitFor(() => expect(currentOrder()).toContain('500 SAR'))

    const assets = holdProviderAssets()
    const watch = watchForbiddenScreens()
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitFor(() => expect(api.checkoutPosts()).toHaveLength(4))
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'تغيير طريقة الدفع' })).toBeNull()

    assets.release()
    await waitForProviderForm(4)
    expect(Array.from(watch.stop())).toEqual([])
    expect(providerConfig(3).amount).toBe(50000)
  })

  it('a FIRST payment from the form gets the same treatment', async () => {
    // Not a retry — but the same empty-chrome window existed there, and
    // the panel must not claim card fields it has not got.
    mockApi({ offerings: [EMBEDDED_OFFERING], checkout: embeddedCheckout })
    const assets = holdProviderAssets()
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())

    await waitFor(() => expect(screen.getByTestId('embedded-payment-form')).toBeTruthy())
    expect(screen.queryByText(PHASE_HEADLINE.PROVIDER_UI)).toBeNull()
    expect(screen.queryByRole('button', { name: 'تغيير طريقة الدفع' })).toBeNull()

    assets.release()
    await waitFor(() => expect(screen.getByText(PHASE_HEADLINE.PROVIDER_UI)).toBeTruthy())
  })
})

/* ────────────────────────────────────────────────────────────────────
   A reconcile from the OLD checkout cannot re-render its failure.

   Reproduced in a real browser: `reconcileFromBrowserEvent` is triggered
   by things the BROWSER did — focus, visibilitychange, pageshow, a
   cross-tab ping — and makes TWO round trips before it writes a phase. A
   customer who clicks back into the tab and presses "المحاولة مرة أخرى"
   fires a focus and a retry in the same breath, so that answer — the old
   checkout's FAILED — landed while the new attempt was already in
   RETRY_PREPARING. `applyReconciledState` could not stop it, because
   RETRY_PREPARING is not a settled phase, so the panel the customer had
   just dismissed rendered again until the checkout POST answered.
   ──────────────────────────────────────────────────────────────────── */
describe('a stale reconcile cannot restore the old failure over a retry', () => {
  /**
   * Both round trips held on purpose, so the race is deterministic
   * instead of depending on which promise happens to win.
   */
  function mockReconcileRace() {
    let releaseOldStatus: () => void = () => {}
    const oldStatusGate = new Promise<void>((resolve) => { releaseOldStatus = resolve })
    let releaseRetryPost: () => void = () => {}
    const retryPostGate = new Promise<void>((resolve) => { releaseRetryPost = resolve })
    let holdOldStatus = false
    let posts = 0
    const calls: { url: string; init?: RequestInit }[] = []

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
      if (url.endsWith('/sync') && init?.method === 'POST') return json({})
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        posts += 1
        if (posts === 1) return json(embeddedCheckoutAt(30000, TOKEN))
        await retryPostGate
        return json(embeddedCheckoutAt(30000, 'bbbb2222cccc3333'))
      }
      if (url.includes('/checkout/')) {
        if (url.includes(TOKEN)) {
          if (holdOldStatus) await oldStatusGate
          return json({ ...DECLINED_AT_100, total: '300' })
        }
        return json(STILL_PROCESSING)
      }
      return json({}, 404)
    }))

    return {
      releaseOldStatus,
      releaseRetryPost,
      holdOldStatus: (value: boolean) => { holdOldStatus = value },
      checkoutPosts: () =>
        calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST'),
    }
  }

  it('the FAILED panel never returns between the retry click and the provider', async () => {
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    const api = mockReconcileRace()
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitForProviderForm(1)
    latestFormHandlers().onInitiating?.()
    latestFormHandlers().onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    await waitFor(() => screen.getByTestId('failed-attempt-amount'))

    // From here the old checkout's status read is held open.
    api.holdOldStatus(true)
    const watch = watchForbiddenScreens()

    // The focus a customer generates by clicking back into the tab. It
    // starts a reconcile for the OLD checkout, which is now in flight.
    fireEvent(window, new Event('focus'))
    // ...and the retry lands beside it.
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()

    // The stale answer arrives now, mid-RETRY_PREPARING. This is the
    // exact instant the old panel used to come back.
    await act(async () => { api.releaseOldStatus() })
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByTestId('failed-attempt-amount')).toBeNull()
    expect(screen.queryByText('لم تتم عملية الدفع')).toBeNull()
    expect(screen.getByTestId('retry-preparing')).toBeTruthy()

    await act(async () => { api.releaseRetryPost() })
    await waitForProviderForm(2)

    // Not one commit in between showed the panel, or anything else.
    expect(Array.from(watch.stop())).toEqual([])
    expect(api.checkoutPosts()).toHaveLength(2)
  })

  it('a reconcile for the CURRENT checkout is still applied', async () => {
    // The guard drops stale answers, not real ones: a payment settled in
    // another tab must still take this page to its outcome.
    mockApi({
      offerings: [EMBEDDED_OFFERING],
      checkout: embeddedCheckout,
      statuses: [{ ...DECLINED_AT_100, total: '300' }],
    })
    render(<CheckoutPage />)
    await fillForm()
    fireEvent.click(payButton())
    await waitForProviderForm(1)
    latestFormHandlers().onInitiating?.()

    // No retry, no release — the token is still this page's.
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    await waitFor(() => expect(refusedAmount()).toContain('300 SAR'))
  })
})

/* ────────────────────────────────────────────────────────────────────
   A PAID payment outranks every older FAILED entry in the same tab's
   browser history.

   Reproduced by the merchant in a real browser, and again here against
   the real backend and a real Moyasar 3DS flow
   (payment-browser-evidence/paid-over-stale-history):

       attempt 1 → FAILED · retry → attempt 2 → FAILED · retry →
       attempt 3 → SUCCESS (order PAID, cart emptied)
       then Back, Back, Back …

   Every attempt is its own CHECKOUT with its own token — a retry never
   reopens the one that failed — and a 3DS payment is a full document
   navigation out to the bank and back, so each attempt leaves history
   entries carrying its own token. Pressing Back therefore lands on the
   URL of a checkout that really did fail, the server truthfully says so,
   and the page rendered a decline, an amount and "المحاولة مرة أخرى"
   for a purchase that had already been paid for.

   The historical failure is real and stays in the database. What must
   never happen is it becoming the CURRENT, actionable state.
   ──────────────────────────────────────────────────────────────────── */

/** Three attempts at three prices: 6 × 50, 8 × 50, 10 × 50. */
const CHAIN = [
  { token: 'aaaa1111bbbb2222', amountMinor: 30000, total: '300' },
  { token: 'bbbb2222cccc3333', amountMinor: 40000, total: '400' },
  { token: 'cccc3333dddd4444', amountMinor: 50000, total: '500' },
]
const paidStatus = (spec: (typeof CHAIN)[number]) => ({
  checkout_token: spec.token,
  payment_status: 'captured',
  attempt_status: 'succeeded',
  payment_attempt_started: true,
  total: spec.total,
  order: {
    order_number: 'A-1041',
    status: 'CONFIRMED',
    payment_status: 'PAID',
    total: spec.total,
  },
})

/**
 * The storefront, answering per TOKEN — which is the whole point here:
 * the old checkouts keep saying "failed", because they did, and only
 * the newest one is paid.
 */
function mockChain() {
  const queue = [...CHAIN]
  const failed = new Set<string>()
  let paidToken: string | null = null
  const calls: { url: string; init?: RequestInit }[] = []
  /*
   * THE SERVER's succession record — `Checkout.supersedes_id`.
   *
   * Written by the backend when a `POST /checkout` carries a
   * `supersedes_checkout_token` it accepts, and read back on the status
   * endpoint as `superseded_by_token`, chain resolved. Modelled here so
   * the page is exercised against the shape the real endpoint returns,
   * and so a test can seed the relation WITHOUT this tab ever having
   * created it — which is what a duplicated tab is.
   */
  const supersededBy = new Map<string, string>()
  /** A checkout the server reports as terminal but NOT successful. */
  const settledUnsuccessful = new Map<string, string>()
  const chainHead = (token: string) => {
    let current = token
    for (let hop = 0; hop < 8; hop += 1) {
      const next = supersededBy.get(current)
      if (!next || next === current) break
      current = next
    }
    return current === token ? null : current
  }

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.includes('/payment-methods')) return json([EMBEDDED_OFFERING])
    if (url.endsWith('/sync') && init?.method === 'POST') return json({})
    if (url.endsWith('/checkout') && init?.method === 'POST') {
      const spec = queue.length > 1 ? queue.shift()! : queue[0]
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        supersedes_checkout_token?: string
      }
      // The server records the relation; the browser only declares it.
      if (body.supersedes_checkout_token) {
        supersededBy.set(body.supersedes_checkout_token, spec.token)
      }
      return json(embeddedCheckoutAt(spec.amountMinor, spec.token))
    }
    const spec = CHAIN.find((candidate) => url.includes(candidate.token))
    const superseded_by_token = spec ? chainHead(spec.token) : null
    const unsuccessful = spec ? settledUnsuccessful.get(spec.token) : undefined
    if (spec && unsuccessful) {
      return json({
        checkout_token: spec.token,
        payment_status: unsuccessful,
        attempt_status: unsuccessful,
        payment_attempt_started: true,
        total: spec.total,
        order: null,
        superseded_by_token,
      })
    }
    if (spec && paidToken === spec.token) {
      return json({ ...paidStatus(spec), superseded_by_token })
    }
    if (spec && failed.has(spec.token)) {
      return json({
        ...DECLINED_AT_100,
        checkout_token: spec.token,
        total: spec.total,
        superseded_by_token,
      })
    }
    if (url.includes('/checkout/')) return json({ ...STILL_PROCESSING, superseded_by_token })
    return json({}, 404)
  })

  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    decline: (token: string) => failed.add(token),
    settlePaid: (token: string) => { paidToken = token },
    /** Seeds the server's own relation, as another tab's retry would. */
    supersede: (previous: string, next: string) => supersededBy.set(previous, next),
    /** The server reports this checkout as terminal, but not paid. */
    settleAs: (token: string, status: 'cancelled' | 'expired' | 'failed') =>
      settledUnsuccessful.set(token, status),
    supersessions: () => new Map(supersededBy),
    checkoutPosts: () =>
      calls.filter((c) => c.url.endsWith('/checkout') && c.init?.method === 'POST'),
    confirms: () => calls.filter((c) => /\/confirm$/.test(c.url) && c.init?.method === 'POST'),
  }
}

/** Raises the cart by `by` lines of 50 while the failure panel is up. */
function raiseCart(by: number) {
  for (let i = 0; i < by; i += 1) fireEvent.click(screen.getByLabelText('Increase quantity'))
}

/**
 * Drives the merchant's exact sequence, in ONE mount, so the succession
 * record is written by the page itself rather than by the test.
 *
 * `failures` is how many attempts decline before the last one is paid.
 */
async function payAfterFailures(failures: 1 | 2) {
  cart = [{ ...ITEM, price: 50, qty: 6 }]
  const api = mockChain()
  render(<CheckoutPage />)
  await fillForm()
  fireEvent.click(payButton())
  await waitForProviderForm(1)

  for (let attempt = 0; attempt < failures; attempt += 1) {
    const handlers = latestFormHandlers()
    handlers.onInitiating?.()
    api.decline(CHAIN[attempt].token)
    handlers.onCompleted?.()
    fireEvent(window, new Event('focus'))
    await waitFor(() => screen.getByText('لم تتم عملية الدفع'))
    await waitFor(() => screen.getByTestId('failed-attempt-amount'))
    // 300 → 400 → 500: the customer changes their order between tries,
    // which is exactly what makes the old amounts distinguishable.
    raiseCart(2)
    fireEvent.click(screen.getByRole('button', { name: 'المحاولة مرة أخرى' }))
    await waitForProviderForm(attempt + 2)
  }

  // The last attempt succeeds, and only the SERVER says so.
  const last = latestFormHandlers()
  last.onInitiating?.()
  api.settlePaid(CHAIN[failures].token)
  last.onCompleted?.()
  fireEvent(window, new Event('focus'))
  await waitFor(() => screen.getByText('تم الدفع بنجاح'))
  return api
}

/**
 * Back onto an older entry: a fresh document on that entry's URL, with
 * the cart already emptied by the successful payment.
 *
 * The succession record is `sessionStorage` — the same tab — so it
 * survives this remount exactly as it survives a real Back.
 */
function backTo(
  index: 0 | 1,
  options?: { withProviderId?: boolean; paid?: 1 | 2 },
) {
  cleanup()
  cart = []
  // The restoration must be measured on its own: what the payment that
  // has already happened did is not what Back did.
  mountMoyasarForm.mockClear()
  assign.mockClear()
  openSpy.mockClear()
  const paidIndex = options?.paid ?? 2
  const token = CHAIN[index].token
  const query = options?.withProviderId
    ? `token=${token}&id=pay_declined${index + 1}&status=failed`
    : `token=${token}`
  setSearchParams(new URLSearchParams(query))
  const api = mockChain()
  CHAIN.slice(0, paidIndex).forEach((spec) => api.decline(spec.token))
  api.settlePaid(CHAIN[paidIndex].token)
  /*
   * The relation as the SERVER holds it: each released checkout was
   * replaced by the next one. Seeded here rather than carried over from
   * the run above, because this remount is a new document talking to
   * the same backend — and, in the duplicated-tab test below, a
   * different tab entirely. Nothing is carried in the browser.
   */
  for (let i = 0; i < paidIndex; i += 1) {
    api.supersede(CHAIN[i].token, CHAIN[i + 1].token)
  }
  render(<CheckoutPage />)
  return api
}

/** Everything an old failure panel is made of, watched continuously. */
function watchForStaleFailure(staleAmounts: string[] = ['300 SAR', '400 SAR']) {
  const seen = new Set<string>()
  const sample = () => {
    const text = document.body.textContent ?? ''
    if (text.includes(PHASE_HEADLINE.FAILED)) seen.add('FAILED-headline')
    if (document.querySelector('[data-testid="failed-attempt-amount"]')) seen.add('failed-amount')
    for (const button of Array.from(document.querySelectorAll('button'))) {
      const label = (button.textContent ?? '').trim()
      if (label === 'المحاولة مرة أخرى') seen.add('retry-button')
      if (label.includes('تغيير طريقة الدفع')) seen.add('change-method-button')
    }
    // Only the amounts of the attempts that were REFUSED: the amount of
    // the payment that succeeded is exactly what this page should show.
    for (const amount of staleAmounts) if (text.includes(amount)) seen.add(amount)
  }
  const observer = new MutationObserver(sample)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  sample()
  return { seen, stop: () => { observer.disconnect(); return seen } }
}

describe('a settled PAID checkout outranks an older FAILED history entry', () => {
  it('1 — FAILED → retry → SUCCESS → Back stays PAID', async () => {
    await payAfterFailures(1)

    // Only 300 is stale here: the second attempt is the one that paid.
    const watch = watchForStaleFailure(['300 SAR'])
    backTo(0, { paid: 1 })
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(Array.from(watch.stop())).toEqual([])
  })

  it('2 — FAILED → FAILED → SUCCESS → Back stays PAID', async () => {
    await payAfterFailures(2)

    const watch = watchForStaleFailure()
    backTo(1)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(Array.from(watch.stop())).toEqual([])
  })

  it('3 — Back, then Back again onto the FIRST failure, never shows the old UI', async () => {
    await payAfterFailures(2)

    for (const index of [1, 0] as const) {
      const watch = watchForStaleFailure()
      backTo(index)
      await waitFor(() => screen.getByText('تم الدفع بنجاح'))
      // 7 — the reconciliation happens behind the neutral restoring
      // state, so nothing actionable is ever exposed.
      expect(Array.from(watch.stop())).toEqual([])
    }
  })

  it('4 — Back then Forward onto the return entry stays PAID', async () => {
    await payAfterFailures(2)

    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // Forward: the entry the second attempt returned to, provider id and
    // all — a fresh document, exactly as the browser rebuilds it.
    const watch = watchForStaleFailure()
    const api = backTo(1, { withProviderId: true })
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(Array.from(watch.stop())).toEqual([])
    // 10 — and the spent provider payment is never re-confirmed.
    expect(api.confirms()).toHaveLength(0)
  })

  it('5 — Back then Refresh of that same entry stays PAID', async () => {
    await payAfterFailures(2)

    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // A refresh is another fresh mount of the same stale URL.
    const watch = watchForStaleFailure()
    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(Array.from(watch.stop())).toEqual([])
    expect(reload).not.toHaveBeenCalled()
  })

  it('6 — a bfcache restore of a stale FAILED page reconciles to PAID', async () => {
    // The FAILED panel is genuinely on screen, from before the payment
    // that replaced it — the one case the page cannot pre-empt, because
    // the browser restores the DOM it froze.
    await payAfterFailures(1)
    cleanup()
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
    // The replacement has not settled yet, so this page legitimately
    // shows the decline — the exact DOM a bfcache would freeze.
    const api = mockChain()
    api.decline(CHAIN[0].token)
    api.supersede(CHAIN[0].token, CHAIN[1].token)
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText(PHASE_HEADLINE.FAILED))
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()

    // The payment that replaced it succeeds while this page is frozen.
    api.settlePaid(CHAIN[1].token)
    const restore = new Event('pageshow') as Event & { persisted?: boolean }
    Object.defineProperty(restore, 'persisted', { value: true })
    fireEvent(window, restore)

    /*
     * The browser has already repainted the frozen decline — that
     * cannot be pre-empted from script. What CAN be, and is: the panel
     * stops being actionable in the same task as the event, before the
     * customer can press anything.
     */
    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()
    expect(screen.getByText(RESTORING_HEADLINE)).toBeTruthy()

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()
  })

  it('6b — a bfcache restore of a decline NOTHING replaced gives the panel back', async () => {
    // The other half of the same rule: re-verifying is not a verdict.
    // A decline with no successor comes back exactly as it was, retry
    // and all, after one read.
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
    const api = mockChain()
    api.decline(CHAIN[0].token)
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText(PHASE_HEADLINE.FAILED))

    const restore = new Event('pageshow') as Event & { persisted?: boolean }
    Object.defineProperty(restore, 'persisted', { value: true })
    fireEvent(window, restore)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy(),
    )
    expect(screen.getByText(PHASE_HEADLINE.FAILED)).toBeTruthy()
  })

  it('a FOCUS never suspends a decline the way a restore does', async () => {
    // The regression this guards: arming on focus blinked the failure
    // panel out from under anyone who switched tabs.
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
    const api = mockChain()
    api.decline(CHAIN[0].token)
    render(<CheckoutPage />)
    await waitFor(() => screen.getByText(PHASE_HEADLINE.FAILED))

    fireEvent(window, new Event('focus'))
    fireEvent(document, new Event('visibilitychange'))

    // Same task as the events: still on screen, still actionable.
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    expect(screen.queryByText(RESTORING_HEADLINE)).toBeNull()
  })

  it('8/12 — the old retry button never comes back, and starts nothing', async () => {
    await payAfterFailures(2)

    const api = backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()
    expect(screen.queryByTestId('failed-attempt-amount')).toBeNull()
    // 11/12/13/14 — nothing at all was started by the restoration.
    expect(api.checkoutPosts()).toHaveLength(0)
    expect(api.confirms()).toHaveLength(0)
    expect(mountMoyasarForm).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('9 — the empty cart left by the successful payment does not read as failure', async () => {
    await payAfterFailures(2)

    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // Cart emptiness is not payment state (§6): it must produce neither
    // a failure nor an "your cart is empty" page over a paid order.
    expect(cart).toHaveLength(0)
    expect(screen.queryByText(PHASE_HEADLINE.FAILED)).toBeNull()
    expect(screen.getByText('تم الدفع بنجاح')).toBeTruthy()
  })

  it('15 — the amount is the settled order total, not the stale cart or the old attempt', async () => {
    await payAfterFailures(2)

    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    expect(screen.getByText('500 SAR')).toBeTruthy()
    // The two figures that must NOT survive: what the first attempt was
    // refused at, and a cart that no longer exists.
    expect(screen.queryByText('300 SAR')).toBeNull()
    expect(screen.queryByText(/\b0 SAR\b/)).toBeNull()
    expect(screen.getByText('A-1041')).toBeTruthy()
  })

  it('16/17 — a stale FAILED reading arriving late cannot unpay the restored PAID', async () => {
    await payAfterFailures(2)

    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    // Every browser event that can trigger a reconciliation, fired at a
    // page that has already adopted the paid checkout.
    fireEvent(window, new Event('pageshow'))
    fireEvent(window, new Event('focus'))
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    expect(screen.queryByText(PHASE_HEADLINE.FAILED)).toBeNull()
    expect(screen.queryByRole('button', { name: 'المحاولة مرة أخرى' })).toBeNull()
  })

  it('a decline that nothing has replaced is still a decline', async () => {
    // The guard is narrow on purpose: a checkout with no successor in
    // this tab keeps every part of the failure UI, including the retry.
    cart = [{ ...ITEM, price: 50, qty: 6 }]
    const api = mockChain()
    api.decline(CHAIN[0].token)
    setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText(PHASE_HEADLINE.FAILED))
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByTestId('failed-attempt-amount').textContent).toContain('300 SAR'),
    )
  })

  it('DUPLICATED TAB — a tab that never saw the retries still converges to PAID', async () => {
    /*
     * The case a per-tab record could not serve, and the reason the
     * relation moved to the server.
     *
     * This mount shares nothing with the tab that made the payments: no
     * React state, no refs, and — now — no storage either. All it has is
     * the old URL and the server, which is exactly what a duplicated
     * tab, a restored session, or a link opened on the same machine
     * has.
     */
    sessionStorage.clear()
    localStorage.clear()
    cart = []
    setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
    const api = mockChain()
    api.decline(CHAIN[0].token)
    api.decline(CHAIN[1].token)
    api.settlePaid(CHAIN[2].token)
    api.supersede(CHAIN[0].token, CHAIN[1].token)
    api.supersede(CHAIN[1].token, CHAIN[2].token)

    const watch = watchForStaleFailure()
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText('تم الدفع بنجاح'))
    expect(Array.from(watch.stop())).toEqual([])
    expect(screen.getByText('500 SAR')).toBeTruthy()
    // And it did it by asking, not by being told: no payment was made
    // here, and nothing was started.
    expect(api.checkoutPosts()).toHaveLength(0)
    expect(api.confirms()).toHaveLength(0)
  })

  it('the browser stores NOTHING about the payment, at any point', async () => {
    sessionStorage.clear()
    const before = { session: sessionStorage.length, local: localStorage.length }

    await payAfterFailures(2)
    backTo(0)
    await waitFor(() => screen.getByText('تم الدفع بنجاح'))

    /*
     * No succession mapping, no status, no amount, no order number, no
     * credential. The cart is the storefront's own key and is not
     * payment truth (§6) — it is asserted to be the ONLY thing here.
     */
    const dump = (storage: Storage) =>
      Object.fromEntries(
        Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map(
          (key) => [key, storage.getItem(key) ?? ''],
        ),
      )
    const session = dump(sessionStorage)
    const local = dump(localStorage)

    expect(Object.keys(session)).toHaveLength(before.session)
    expect(Object.keys(local).filter((key) => !key.startsWith('cart:'))).toEqual([])

    const everything = JSON.stringify({ session, local })
    for (const forbidden of [
      ...CHAIN.map((spec) => spec.token),
      'A-1041',
      'captured',
      'succeeded',
      'PAID',
      'superseded',
      '500',
    ]) {
      expect(everything).not.toContain(forbidden)
    }
  })

  it('DECLARES the predecessor on a retry, and never a status', async () => {
    const api = await payAfterFailures(2)

    const posts = api.checkoutPosts()
    expect(posts).toHaveLength(3)
    const bodies = posts.map((call) => JSON.parse(String(call.init?.body)))

    // The first attempt replaces nothing; each retry names the checkout
    // it replaces, and nothing else about it.
    expect(bodies[0].supersedes_checkout_token).toBeUndefined()
    expect(bodies[1].supersedes_checkout_token).toBe(CHAIN[0].token)
    expect(bodies[2].supersedes_checkout_token).toBe(CHAIN[1].token)

    for (const body of bodies) {
      // A claim about identity cannot smuggle a claim about money.
      expect(body.payment_status).toBeUndefined()
      expect(body.amount).toBeUndefined()
      expect(body.total).toBeUndefined()
      expect(body.order).toBeUndefined()
    }
    // And the server's record is what the page will read back.
    expect(api.supersessions().get(CHAIN[0].token)).toBe(CHAIN[1].token)
    expect(api.supersessions().get(CHAIN[1].token)).toBe(CHAIN[2].token)
  })

  it('a successor the server reports as CANCELLED or EXPIRED never becomes PAID', async () => {
    // Only a terminal SUCCESS on the successor's own record may adopt.
    for (const status of ['cancelled', 'expired', 'failed'] as const) {
      cleanup()
      cart = []
      setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
      const api = mockChain()
      api.decline(CHAIN[0].token)
      api.supersede(CHAIN[0].token, CHAIN[1].token)
      // The successor exists and is terminal — but not successful.
      api.settleAs(CHAIN[1].token, status)

      render(<CheckoutPage />)
      await waitFor(() => screen.getByText(PHASE_HEADLINE.FAILED))
      expect(screen.queryByText('تم الدفع بنجاح')).toBeNull()
      expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
      expect(api.checkoutPosts()).toHaveLength(0)
    }
  })

  it('a replacement that ALSO failed leaves the failure panel exactly as it was', async () => {
    // Two declines and no success: the successor is read, it is not a
    // settled success, and the page goes back to being about its own
    // checkout — with the retry still on offer.
    cart = [{ ...ITEM, price: 50, qty: 8 }]
    setSearchParams(new URLSearchParams(`token=${CHAIN[0].token}`))
    const api = mockChain()
    api.decline(CHAIN[0].token)
    api.decline(CHAIN[1].token)
    // The successor exists on the server, and it failed too.
    api.supersede(CHAIN[0].token, CHAIN[1].token)
    render(<CheckoutPage />)

    await waitFor(() => screen.getByText(PHASE_HEADLINE.FAILED))
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
    // And it stays there: a later browser event must not re-arm the
    // restoring state over a panel the customer is reading.
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.getByText(PHASE_HEADLINE.FAILED)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'المحاولة مرة أخرى' })).toBeTruthy()
  })
})

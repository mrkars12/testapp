'use client'

import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { API_URL } from '@/lib/config'

/* ══════════════════════════════════════════════════════════════════════
   StoreContext — مصدر واحد لبيانات المتجر + السلة، مشترك بين كل الصفحات
   تحت /stores/[slug]/ (الصفحة الرئيسية، الكولكشنز، المنتج، إلخ)
   ══════════════════════════════════════════════════════════════════════ */

export interface CartItem {
  variantId: string
  productId: string
  productHandle: string
  title: string
  variantTitle?: string
  price: number
  image: string | null
  qty: number
  maxQty?: number
}

interface StoreContextValue {
  store: any
  storeSlug: string
  loading: boolean
  errorMsg: string | null
  cart: CartItem[]
  cartCount: number
  cartTotal: number
  addToCart: (item: Omit<CartItem, 'qty'>, qty?: number) => void
  removeFromCart: (variantId: string) => void
  updateCartQty: (variantId: string, qty: number) => void
  clearCart: () => void
  /**
   * The cart is frozen because a payment has been priced from it.
   *
   * Lives here rather than in the checkout page because the CART is not
   * the checkout's: the header's cart button and its drawer are the
   * storefront's own, shared by every page, and they are where a
   * customer goes to change quantities. The checkout page is what KNOWS
   * a payment exists; the drawer is what has to stop offering to change
   * its amount. So the fact is held in one place both can read.
   */
  cartLocked: boolean
  /**
   * Releases that payment and unlocks the cart — «العودة لتعديل الطلب».
   *
   * Supplied by whoever locked it (the checkout page), because only that
   * surface knows how to end an attempt safely. Null when nothing is
   * locked.
   */
  releaseCartLock: (() => void) | null
  /**
   * Declares — or withdraws — the lock. Called by the checkout page as
   * its payment is priced and released.
   */
  setCartLock: (lock: { locked: boolean; release?: (() => void) | null }) => void

  /* ── The server's view of this cart ──────────────────────────────
     Everything below comes from the backend and is never decided here.
     The browser holds display fields (title, price, image) so the
     drawer can render; WHAT is in the cart, how much of it, and whether
     it is still buyable are the server's answers. */

  /**
   * The cart's non-secret public id, or null when the server has no
   * cart for this browser yet.
   *
   * Published so a cross-tab ping can name this cart — see
   * `lib/payments/checkoutSync.ts`. It is not the cookie and cannot be
   * used to read or change a cart.
   */
  cartPublicId: string | null
  /** Bumped by the server on every accepted mutation. */
  cartVersion: number
  /**
   * `converted` means this basket became an order. TERMINAL: the next
   * add-to-cart mints a brand-new cart, which is what makes buying the
   * identical basket again work with no time window anywhere.
   */
  cartStatus: 'active' | 'converted' | 'abandoned'
  /**
   * The checkout this cart already has — IDENTITY, never a verdict.
   *
   * A second tab reads this and goes and asks the server about THAT
   * checkout, rather than creating one of its own. Nothing about a
   * payment can be inferred from it.
   */
  activeCheckoutToken: string | null
  /**
   * The order this basket became, once it is `converted`.
   *
   * Identity, and it is the ONLY thing a tab that did not perform the
   * payment is told about it: which order to go and look at. Whether
   * that order was paid is read from the order, as always.
   */
  convertedOrderNumber: string | null
  /** Re-reads the cart from the server. */
  refreshCart: () => Promise<void>
}

const StoreContext = createContext<StoreContextValue | null>(null)

/** استخدمها في صفحات لازم تكون جوه الـ layout (المنتج، الكولكشن، الرئيسية) — بترمي error لو مفيش provider */
export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore لازم يتستخدم جوه <StoreProvider>')
  return ctx
}

/** استخدمها في مكونات ممكن تتعرض برة الـ layout كمان (زي الـ Header في preview الأدمن) — بترجع null من غير error */
export function useStoreOptional() {
  return useContext(StoreContext)
}

export function StoreProvider({ storeSlug, children }: { storeSlug: string; children: React.ReactNode }) {
  const [store, setStore] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  /**
   * Held as one object so the two halves can never disagree — a lock
   * with no way to release it is a cart the customer cannot get back.
   * The release is kept in a ref as well, so the mutators below can be
   * stable callbacks without going stale.
   */
  const [cartLock, setCartLockState] = useState<{ locked: boolean; release: (() => void) | null }>(
    { locked: false, release: null },
  )
  const cartLockedRef = useRef(false)
  /** The server half of the lock, so the handler below can include it. */
  const serverLockedRef = useRef(false)

  /*
   * THE SERVER'S ANSWER ABOUT THIS CART.
   *
   * Held separately from `cart` because the two are different kinds of
   * fact. `cart` is what to DRAW — titles, prices, images, all of it
   * client-side and none of it trusted by anything. This is what the
   * cart IS: its identity, its version, whether it is still buyable,
   * and which checkout already exists for it. Only the server writes
   * these, and the browser never guesses at them.
   */
  const [server, setServer] = useState<{
    cartPublicId: string | null
    version: number
    status: 'active' | 'converted' | 'abandoned'
    activeCheckoutToken: string | null
    convertedOrderNumber: string | null
  }>({
    cartPublicId: null,
    version: 0,
    status: 'active',
    activeCheckoutToken: null,
    convertedOrderNumber: null,
  })

  /* جلب بيانات المتجر — مرة واحدة بس لكل الصفحات تحت /stores/[slug] */
  useEffect(() => {
    if (!storeSlug) return
    let cancelled = false

    const run = async () => {
      try {
        setLoading(true)
        setErrorMsg(null)
        const res = await fetch(`${API_URL}/stores/public/${storeSlug}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!res.ok) throw new Error('network_error')
        const data = await res.json()
        if (cancelled) return

        if (data === null) {
          setErrorMsg('عذراً، هذا المتجر غير موجود حالياً!')
          return
        }
        if (data?.slug) setStore(data)
        else setErrorMsg('عذراً، بيانات المتجر غير مكتملة.')
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(
            err?.message === 'network_error'
              ? 'عذراً، حدث خطأ أثناء الاتصال بالسيرفر.'
              : 'عذراً، هذا المتجر غير موجود حالياً!',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [storeSlug])

  /* تطبيق ألوان/خطوط الثيم على الصفحة كلها — نفس المنطق اللي كان مكرر في page.tsx */
  useEffect(() => {
    if (!store?.theme) return

    const colors = store.theme.colors || {}
    const typo = store.theme.typography || {}
    const r = document.documentElement.style

    r.setProperty('--color-primary', colors.primary || '#2563eb')
    r.setProperty('--color-secondary', colors.secondary || '#64748b')
    r.setProperty('--color-accent', colors.accent || '#f59e0b')
    r.setProperty('--color-background', colors.background || '#ffffff')
    r.setProperty('--color-surface', colors.surface || '#f8fafc')
    r.setProperty('--color-border', colors.border || '#e2e8f0')
    r.setProperty('--color-text-primary', colors.textPrimary || '#0f172a')
    r.setProperty('--color-text-secondary', colors.textSecondary || '#64748b')
    r.setProperty('--color-text-muted', colors.textMuted || '#94a3b8')
    r.setProperty('--color-header-bg', colors.headerBg || '#ffffff')
    r.setProperty('--color-header-text', colors.headerText || '#0f172a')
    r.setProperty('--color-footer-bg', colors.footerBg || '#0f172a')
    r.setProperty('--color-footer-text', colors.footerText || '#ffffff')
    r.setProperty('--font-heading', `'${typo.headingFont || 'Inter'}', sans-serif`)
    r.setProperty('--font-body', `'${typo.bodyFont || 'Inter'}', sans-serif`)
    r.setProperty('--base-size', typo.baseSize || '16px')
    r.setProperty('--line-height', String(typo.lineHeight || 1.6))

    const fonts = [...new Set([typo.headingFont, typo.bodyFont].filter(Boolean))] as string[]
    if (fonts.length) {
      const id = 'store-theme-fonts'
      let link = document.getElementById(id) as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        document.head.appendChild(link)
      }
      const q = fonts.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')
      link.href = `https://fonts.googleapis.com/css2?${q}&display=swap`
    }

    document.body.style.fontFamily = `'${typo.bodyFont || 'Inter'}', sans-serif`
    document.body.style.fontSize = typo.baseSize || '16px'
  }, [store])

  /*
   * localStorage IS NOW A FIRST-PAINT CACHE, AND NOTHING MORE.
   *
   * It exists so the header's cart badge does not flash empty for the
   * length of a round trip. It is never the truth: the first server
   * response replaces it outright, every mutation is reconciled against
   * what the server returns, and the checkout prices the SERVER's cart
   * regardless of what is held here.
   *
   * What is kept is display data — titles, prices, images — which the
   * server deliberately does not store (a cart row is a variant id and
   * a quantity, so nothing a browser holds can influence an amount).
   */
  useEffect(() => {
    if (!storeSlug) return
    try {
      const raw = localStorage.getItem(`cart:${storeSlug}`)
      if (raw) setCart(JSON.parse(raw))
    } catch {
      /* localStorage معطل أو البيانات تالفة — نبدأ بسلة فاضية بهدوء */
    }
  }, [storeSlug])

  /* حفظ نسخة العرض المحلية (مش مصدر حقيقة — بص فوق) */
  useEffect(() => {
    if (!storeSlug) return
    try {
      localStorage.setItem(`cart:${storeSlug}`, JSON.stringify(cart))
    } catch {
      /* تجاهل — مش حرج */
    }
  }, [cart, storeSlug])

  /**
   * Reconciles this tab to a `CartView` the server just returned.
   *
   * The server is authoritative for MEMBERSHIP and QUANTITY; the local
   * rows supply the display fields it does not store. A row the server
   * reports that this browser has never drawn is kept rather than
   * dropped — under-reporting a basket the server will happily charge
   * for would be the worse error — with placeholder display data, and
   * the checkout's totals come from the server either way.
   *
   * Ignores anything that is not recognisably a cart view, so a failed
   * or unexpected response never silently empties a customer's basket.
   */
  const applyServerCart = useCallback((view: unknown): boolean => {
    if (!isCartView(view)) return false

    setServer({
      cartPublicId: view.cart_public_id ?? null,
      version: typeof view.version === 'number' ? view.version : 0,
      status: view.status ?? 'active',
      activeCheckoutToken: view.active_checkout_token ?? null,
      convertedOrderNumber: view.converted_order_number ?? null,
    })

    setCart((prev) => {
      const byId = new Map(prev.map((row) => [row.variantId, row]))
      return view.items.map((item) => {
        const known = byId.get(item.variant_id)
        return known
          ? { ...known, qty: item.quantity }
          : {
              variantId: item.variant_id,
              productId: '',
              productHandle: '',
              title: 'منتج',
              price: 0,
              image: null,
              qty: item.quantity,
            }
      })
    })

    return true
  }, [])

  /**
   * Reads the cart from the server.
   *
   * On the FIRST read, a browser that has a locally cached basket and
   * no server cart at all has its cache replayed into the server rather
   * than discarded — otherwise every shopper mid-basket at deploy time
   * would silently lose it. That replay is the only direction the cache
   * is ever authoritative in, and only when the server has nothing to
   * be authoritative with.
   */
  const refreshCart = useCallback(async (): Promise<void> => {
    if (!storeSlug) return
    try {
      // Relative URL, deliberately: the storefront is proxied through
      // the frontend origin, so the cart cookie is same-origin and is
      // sent (and set) with no CORS involvement at all.
      const res = await fetch(`/api/storefront/${storeSlug}/cart`)
      if (!res.ok) return
      applyServerCart(await res.json())
    } catch {
      /* Offline or a proxy hiccup: the local cache keeps rendering. */
    }
  }, [storeSlug, applyServerCart])

  /* أول قراءة للسلة من السيرفر — بتحل محل الكاش المحلي */
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!storeSlug || hydratedRef.current) return
    hydratedRef.current = true

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/storefront/${storeSlug}/cart`)
        if (!res.ok || cancelled) return
        const view = await res.json()
        if (cancelled || !isCartView(view)) return

        /*
         * The migration case: a basket in localStorage from before
         * server carts existed, and no server cart to overwrite it.
         * Replayed through the ordinary add endpoint, which mints the
         * cart and the cookie exactly as a fresh add would.
         */
        if (view.cart_public_id === null && view.items.length === 0) {
          // Read straight from the cache rather than from state: this
          // effect runs once, and making it depend on the cart would
          // re-run it every time the cart changed.
          const local = readCachedCart(storeSlug)
          if (local.length > 0) {
            for (const row of local) {
              await postCartItem(storeSlug, row.variantId, row.qty)
              if (cancelled) return
            }
            await refreshCart()
            return
          }
        }

        applyServerCart(view)
      } catch {
        /* The local cache keeps rendering; the next mutation resyncs. */
      }
    })()

    return () => { cancelled = true }
  }, [storeSlug, applyServerCart, refreshCart])

  /**
   * Adds to the cart, optimistically, then reconciles to the server.
   *
   * Optimistic because adding must feel instant; reconciled because the
   * optimistic value is a guess and the server's is the cart. A refusal
   * snaps straight back to the server's truth.
   *
   * Deliberately NOT locked while a checkout is live, and the SERVER
   * applies the same asymmetry: adding something elsewhere in the shop
   * is ordinary browsing, and it cannot change the amount the provider
   * was already given.
   */
  const addToCart = useCallback((item: Omit<CartItem, 'qty'>, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.variantId === item.variantId)
      if (existing) {
        const nextQty = existing.maxQty ? Math.min(existing.qty + qty, existing.maxQty) : existing.qty + qty
        return prev.map((c) => (c.variantId === item.variantId ? { ...c, qty: nextQty } : c))
      }
      return [...prev, { ...item, qty }]
    })

    void (async () => {
      const view = await postCartItem(storeSlug, item.variantId, qty)
      applyServerCart(view)
    })()
  }, [storeSlug, applyServerCart])

  /*
   * The two mutators that can change what a priced payment is for.
   *
   * They REFUSE while the cart is locked — but that refusal is NO LONGER
   * THE ENFORCEMENT. The enforcement is the server's: a `PATCH` or
   * `DELETE` on a cart that has a live checkout is answered `409
   * cart_locked`, and that answer reaches every tab, every stale render
   * and every extension alike, because none of them can be talked out
   * of it. What is left here is a synchronous fast path: it avoids a
   * round trip that is certain to be refused, and it keeps the UI from
   * flickering through an optimistic value the server will reject.
   *
   * `addToCart` is deliberately NOT locked (see above). `clearCart` is
   * not locked either — it is what runs when a payment SUCCEEDS, and a
   * lock held by that very payment must not block it. The server keeps
   * exactly the same asymmetry.
   */
  const removeFromCart = useCallback((variantId: string) => {
    if (cartLockedRef.current) return
    setCart((prev) => prev.filter((c) => c.variantId !== variantId))

    void (async () => {
      const view = await sendCart(
        `/api/storefront/${storeSlug}/cart/items/${encodeURIComponent(variantId)}`,
        'DELETE',
      )
      applyServerCart(view)
    })()
  }, [storeSlug, applyServerCart])

  const updateCartQty = useCallback((variantId: string, qty: number) => {
    if (cartLockedRef.current) return
    setCart((prev) => {
      if (qty <= 0) return prev.filter((c) => c.variantId !== variantId)
      return prev.map((c) =>
        c.variantId === variantId ? { ...c, qty: c.maxQty ? Math.min(qty, c.maxQty) : qty } : c,
      )
    })

    void (async () => {
      const view = await sendCart(
        `/api/storefront/${storeSlug}/cart/items/${encodeURIComponent(variantId)}`,
        'PATCH',
        { quantity: Math.max(0, qty) },
      )
      applyServerCart(view)
    })()
  }, [storeSlug, applyServerCart])

  const clearCart = useCallback(() => {
    setCart([])
    void (async () => {
      const view = await sendCart(`/api/storefront/${storeSlug}/cart`, 'DELETE')
      applyServerCart(view)
    })()
  }, [storeSlug, applyServerCart])

  const setCartLock = useCallback(
    (lock: { locked: boolean; release?: (() => void) | null }) => {
      // The ref first, and synchronously: a mutator dispatched in the
      // same tick as the lock must already be refused by it. The server
      // half is ORed in so withdrawing a locally declared lock cannot
      // unlock a cart the server says has a live checkout.
      cartLockedRef.current = lock.locked || serverLockedRef.current
      setCartLockState((current) => {
        const release = lock.locked ? lock.release ?? current.release ?? null : null
        if (current.locked === lock.locked && current.release === release) return current
        return { locked: lock.locked, release }
      })
    },
    [],
  )

  const cartCount = useMemo(() => cart.reduce((sum, c) => sum + c.qty, 0), [cart])
  const cartTotal = useMemo(() => cart.reduce((sum, c) => sum + c.qty * c.price, 0), [cart])

  /*
   * THE LOCK, NOW WITH A SERVER HALF.
   *
   * `active_checkout_token` is the authoritative statement that this
   * basket already has a payment priced from it, and it is true in
   * EVERY tab at once because it comes from the row all of them share.
   * The locally declared lock stays beside it because it is faster —
   * the checkout page knows it has started a payment before any
   * response says so — but it is no longer the only thing holding the
   * cart still, which is what it used to be.
   */
  const serverLocked = server.activeCheckoutToken !== null
  const cartLocked = cartLock.locked || serverLocked

  /*
   * The refs the synchronous guard reads, kept in step with both halves.
   *
   * An effect rather than an assignment during render: a ref written
   * while rendering is a value React is entitled to throw away, and the
   * server half arrives on a fetch resolution anyway, so there is no
   * same-tick requirement for it. The LOCAL half still has one — a
   * mutator dispatched in the same tick as the checkout page declaring
   * its lock must already be refused — and `setCartLock` writes the ref
   * itself, from an event handler, exactly as it always did.
   */
  useEffect(() => {
    serverLockedRef.current = serverLocked
    cartLockedRef.current = cartLock.locked || serverLocked
  }, [cartLock.locked, serverLocked])

  const value: StoreContextValue = {
    store, storeSlug, loading, errorMsg,
    cart, cartCount, cartTotal,
    addToCart, removeFromCart, updateCartQty, clearCart,
    cartLocked, releaseCartLock: cartLock.release, setCartLock,
    cartPublicId: server.cartPublicId,
    cartVersion: server.version,
    cartStatus: server.status,
    activeCheckoutToken: server.activeCheckoutToken,
    convertedOrderNumber: server.convertedOrderNumber,
    refreshCart,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
/* ══════════════════════════════════════════════════════════════════════
   Talking to the server-authoritative cart.

   Every call is a RELATIVE url. That is what makes the HttpOnly cart
   cookie work at all: the storefront's `/api/*` is proxied through the
   frontend's own origin, so the cookie is same-origin, `fetch` sends it
   under its default credentials mode, and the browser attributes
   `Set-Cookie` to this origin. An absolute API URL would be
   cross-origin and none of that would happen.
   ══════════════════════════════════════════════════════════════════════ */

/** The server's cart view, as far as this module is willing to trust it. */
interface ServerCartView {
  cart_public_id: string | null
  version: number
  status: 'active' | 'converted' | 'abandoned'
  items: { variant_id: string; quantity: number }[]
  active_checkout_token: string | null
  converted_order_number: string | null
}

/**
 * Whether a response really is a cart view.
 *
 * Checked before anything is adopted, because the alternative — trusting
 * whatever came back — means an error page, a proxy response or a
 * captive-portal interstitial silently emptying a customer's basket.
 */
function isCartView(value: unknown): value is ServerCartView {
  if (!value || typeof value !== 'object') return false
  const view = value as Partial<ServerCartView>
  if (!Array.isArray(view.items)) return false
  if (!('cart_public_id' in view)) return false
  return view.items.every(
    (item) =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as { variant_id?: unknown }).variant_id === 'string' &&
      typeof (item as { quantity?: unknown }).quantity === 'number',
  )
}

/**
 * One cart mutation.
 *
 * Returns the server's view on success, and `null` on anything else —
 * including a refusal. A `409` is not an error to shout about: it means
 * the server disagreed, and the caller's response is to take the
 * server's word for what the cart is, which is what a follow-up read
 * does. Never throws into a render path.
 */
async function sendCart(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  try {
    const res = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    })

    if (res.ok) return await res.json()

    /*
     * REFUSED. The optimistic value this tab drew is wrong, so it is
     * replaced by the server's own view rather than left standing —
     * `cart_locked` and `cart_not_active` both mean "your copy is out
     * of date", and the only honest response is to go and read it.
     */
    if (res.status === 409 || res.status === 404) {
      const base = url.split('/cart')[0]
      const fresh = await fetch(`${base}/cart`)
      if (fresh.ok) return await fresh.json()
    }

    return null
  } catch {
    return null
  }
}

/** Adds (or increments) one line. Mints the cart and cookie if needed. */
async function postCartItem(
  storeSlug: string,
  variantId: string,
  quantity: number,
): Promise<unknown> {
  return sendCart(`/api/storefront/${storeSlug}/cart/items`, 'POST', {
    variant_id: variantId,
    quantity,
  })
}

/**
 * The display cache for one store, or an empty basket.
 *
 * Read-only here, and read in exactly one place. Never treated as the
 * truth: it exists so the first paint is not empty, and the first
 * server response replaces whatever it held.
 */
function readCachedCart(storeSlug: string): CartItem[] {
  try {
    const raw = localStorage.getItem(`cart:${storeSlug}`)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? (parsed as CartItem[]) : []
  } catch {
    return []
  }
}

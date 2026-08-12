'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { API_URL } from '@/lib/config'

/* ══════════════════════════════════════════════════════════════════════
   StoreContext — مصدر واحد لبيانات المتجر + السلة، مشترك بين كل الصفحات
   تحت /store/[slug]/ (الصفحة الرئيسية، الكولكشنز، المنتج، إلخ)
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

  /* جلب بيانات المتجر — مرة واحدة بس لكل الصفحات تحت /store/[slug] */
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

  /* تحميل السلة المحفوظة لنفس المتجر (بتفضل موجودة بين الصفحات وبعد الريفريش) */
  useEffect(() => {
    if (!storeSlug) return
    try {
      const raw = localStorage.getItem(`cart:${storeSlug}`)
      if (raw) setCart(JSON.parse(raw))
    } catch {
      /* localStorage معطل أو البيانات تالفة — نبدأ بسلة فاضية بهدوء */
    }
  }, [storeSlug])

  /* حفظ أي تغيير في السلة فورًا */
  useEffect(() => {
    if (!storeSlug) return
    try {
      localStorage.setItem(`cart:${storeSlug}`, JSON.stringify(cart))
    } catch {
      /* تجاهل — مش حرج */
    }
  }, [cart, storeSlug])

  const addToCart = useCallback((item: Omit<CartItem, 'qty'>, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.variantId === item.variantId)
      if (existing) {
        const nextQty = existing.maxQty ? Math.min(existing.qty + qty, existing.maxQty) : existing.qty + qty
        return prev.map((c) => (c.variantId === item.variantId ? { ...c, qty: nextQty } : c))
      }
      return [...prev, { ...item, qty }]
    })
  }, [])

  const removeFromCart = useCallback((variantId: string) => {
    setCart((prev) => prev.filter((c) => c.variantId !== variantId))
  }, [])

  const updateCartQty = useCallback((variantId: string, qty: number) => {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((c) => c.variantId !== variantId)
      return prev.map((c) =>
        c.variantId === variantId ? { ...c, qty: c.maxQty ? Math.min(qty, c.maxQty) : qty } : c,
      )
    })
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  const cartCount = useMemo(() => cart.reduce((sum, c) => sum + c.qty, 0), [cart])
  const cartTotal = useMemo(() => cart.reduce((sum, c) => sum + c.qty * c.price, 0), [cart])

  const value: StoreContextValue = {
    store, storeSlug, loading, errorMsg,
    cart, cartCount, cartTotal,
    addToCart, removeFromCart, updateCartQty, clearCart,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
'use client'

import { useState,useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useStore } from '../components/StoreContext'

/* ══════════════════════════════════════════════════════════════════════
   Storefront — Checkout Page
   /store/[slug]/checkout
   POST /api/storefront/{storeSlug}/checkout

   No payment gateway wired in yet — orders are created as PENDING /
   payment_status = UNPAID. When you add payment providers, the only
   place to touch is the submit handler below (insert a payment step
   before or after the order is created).
   ══════════════════════════════════════════════════════════════════════ */
interface PaymentMethod {
  key: string
  name_ar: string
  name_en: string
}


interface FormState {
  name: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
}

const emptyForm: FormState = { name: '', phone: '', email: '', address: '', city: '', notes: '' }

const IconMinus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14" /></svg>
)
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
)
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)
const IconSpinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconBag = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)
const IconLock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)
const IconTruck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="1" y="3" width="15" height="13" rx="1" /><path d="M16 8h4l3 3v5h-7V8Z" />
    <circle cx="5.5" cy="18.5" r="1.8" /><circle cx="18.5" cy="18.5" r="1.8" />
  </svg>
)
const IconUser = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
)

export default function CheckoutPage() {
  const router = useRouter()
  const { store, storeSlug, cart, cartCount, cartTotal, updateCartQty, removeFromCart, clearCart } = useStore()

  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [loadingMethods, setLoadingMethods] = useState(true)
  const [selectedMethod, setSelectedMethod] = useState<string>('')
  const [methodError, setMethodError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeSlug) return
    fetch(`/api/storefront/${storeSlug}/payment-methods`)
      .then((res) => res.json())
      .then((data: PaymentMethod[]) => {
        setPaymentMethods(data)
        if (data.length > 0) setSelectedMethod(data[0].key) // أول بوابة متاحة مختارة افتراضياً
      })
      .catch(() => setPaymentMethods([]))
      .finally(() => setLoadingMethods(false))
  }, [storeSlug])

  const currency = store?.currency || 'EGP'

  const handleChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setErrors((er) => ({ ...er, [field]: undefined }))
  }

  const validate = () => {
    const next: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) next.name = 'Full name is required'
    if (!form.phone.trim()) next.phone = 'Phone number is required'
    else if (!/^[0-9+\s-]{8,}$/.test(form.phone.trim())) next.phone = 'Enter a valid phone number'
    if (!form.address.trim()) next.address = 'Street address is required'
    if (!form.city.trim()) next.city = 'City is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cart.length === 0) return
    if (!validate()) return

    if (!selectedMethod) {
      setMethodError('Please choose a payment method')
      return
    }
    setMethodError(null)

    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/storefront/${storeSlug}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim() || undefined,
            address: form.address.trim(),
            city: form.city.trim(),
            notes: form.notes.trim() || undefined,
          },
          items: cart.map((c) => ({ variantId: c.variantId, qty: c.qty })),
          payment_method: selectedMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Something went wrong while placing your order')

      if (data.payment_redirect_url) {
        // بوابة أونلاين — حوّل العميل فعلياً لصفحة الدفع، متمسحش السلة لحد ما الدفع ينجح
        window.location.href = data.payment_redirect_url
        return
      }

      // COD / تحويل بنكي — الطلب اتسجل خلاص
      clearCart()
      router.push(`/store/${storeSlug}/checkout/success?order=${data.order.order_number}`)
    } catch (err: any) {
      setSubmitError(err?.message || 'Something went wrong while placing your order. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (cart.length === 0) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
        >
          <IconBag />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Your cart is empty
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Add something to your cart before checking out.
          </p>
        </div>
        <Link
          href={`/store/${storeSlug}`}
          className="mt-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          style={{ background: 'var(--color-primary)' }}
        >
          Continue shopping
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      {/* Breadcrumb */}
      <nav className="mb-8 flex items-center gap-2 text-[13px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
        <Link href={`/store/${storeSlug}`} className="transition-colors hover:opacity-70">
          Store
        </Link>
        <span className="opacity-40">/</span>
        <span style={{ color: 'var(--color-text-secondary)' }}>Checkout</span>
      </nav>

      <div className="mb-10 flex items-center justify-between">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[34px]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
          Checkout
        </h1>
        <div
          className="hidden items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-medium sm:flex"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
        >
          <IconLock />
          Secure checkout
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px] lg:gap-10">
        {/* ── Customer & shipping form ─────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="order-2 flex flex-col gap-6 lg:order-1">
          <Section icon={<IconUser />} title="Contact information" subtitle="We'll use this to confirm your order">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Full name" value={form.name} onChange={handleChange('name')} error={errors.name} placeholder="Jane Doe" />
              <Field label="Phone number" value={form.phone} onChange={handleChange('phone')} error={errors.phone} type="tel" placeholder="+1 555 000 0000" />
              <Field label="Email" value={form.email} onChange={handleChange('email')} type="email" placeholder="jane@example.com (optional)" full />
            </div>
          </Section>

          <Section icon={<IconTruck />} title="Shipping address" subtitle="Where should we deliver your order">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Street address" value={form.address} onChange={handleChange('address')} error={errors.address} placeholder="123 Main St, Apt 4B" full />
              <Field label="City" value={form.city} onChange={handleChange('city')} error={errors.city} placeholder="Cairo" />
              <div>
                <label className="mb-2 block text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Order notes <span className="font-normal opacity-60">(optional)</span>
                </label>
                <input
                  value={form.notes}
                  onChange={handleChange('notes')}
                  placeholder="Delivery instructions, gate code..."
                  className="w-full rounded-xl border px-4 py-3 text-[14px] outline-none transition-all focus:ring-2 focus:ring-offset-0"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
            </div>
          </Section>

          <Section icon={<IconLock />} title="Payment method" subtitle="Choose how you'd like to pay">
            {loadingMethods ? (
              <div className="flex items-center justify-center py-6" style={{ color: 'var(--color-text-muted)' }}>
                <IconSpinner />
              </div>
            ) : paymentMethods.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                No payment methods are available for this store right now.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {paymentMethods.map((method) => (
                  <label
                    key={method.key}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors"
                    style={{
                      borderColor: selectedMethod === method.key ? 'var(--color-primary)' : 'var(--color-border)',
                      background: selectedMethod === method.key ? 'var(--color-background)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="payment_method"
                      checked={selectedMethod === method.key}
                      onChange={() => setSelectedMethod(method.key)}
                      className="h-4 w-4"
                    />
                    <span className="text-[13.5px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {method.name_en}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {methodError && <p className="mt-2 text-[12px] font-medium text-red-500">{methodError}</p>}
          </Section>

          {submitError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-[13px] font-medium text-red-600">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || paymentMethods.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
            style={{ background: 'var(--color-primary)' }}
          >
            {submitting && <IconSpinner />}
            {submitting ? 'Placing your order...' : (
              <>
                Place order
                <span className="font-normal opacity-80">
                  &nbsp;· {cartTotal.toLocaleString('en-US')} {currency}
                </span>
              </>
            )}
          </button>

          

          <p className="text-center text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Shipping and taxes are calculated at fulfillment.
          </p>
        </form>

        {/* ── Order summary ────────────────────────────────────────────── */}
        <aside className="order-1 lg:order-2">
          <div
            className="rounded-2xl border shadow-sm lg:sticky lg:top-6"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="flex items-center justify-between px-6 py-5">
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Order summary
              </h2>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'var(--color-background)', color: 'var(--color-text-secondary)' }}
              >
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="flex max-h-[420px] flex-col divide-y overflow-y-auto px-6" style={{ borderColor: 'var(--color-border)' }}>
              {cart.map((item) => (
                <div key={item.variantId} className="flex gap-4 py-5 first:pt-0">
                  <div
                    className="h-20 w-20 shrink-0 overflow-hidden rounded-xl"
                    style={{ background: 'var(--color-border)' }}
                  >
                    {item.image && <img src={item.image} alt={item.title} className="h-full w-full object-cover" />}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div>
                      <p className="truncate text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                        {item.title}
                      </p>
                      {item.variantTitle && (
                        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{item.variantTitle}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div
                        className="flex items-center gap-3 rounded-lg border px-2 py-1.5"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.variantId, item.qty - 1)}
                          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5"
                          style={{ color: 'var(--color-text-secondary)' }}
                          aria-label="Decrease quantity"
                        >
                          <IconMinus />
                        </button>
                        <span
                          className="min-w-[1.25rem] text-center text-[13px] font-semibold tabular-nums"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.variantId, item.qty + 1)}
                          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5"
                          style={{ color: 'var(--color-text-secondary)' }}
                          aria-label="Increase quantity"
                        >
                          <IconPlus />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeFromCart(item.variantId)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-300 transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label="Remove item"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>

                  <span className="shrink-0 self-start pt-0.5 text-[13.5px] font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                    {(item.price * item.qty).toLocaleString('en-US')} {currency}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Subtotal</span>
                <span className="tabular-nums">{cartTotal.toLocaleString('en-US')} {currency}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Shipping</span>
                <span className="italic opacity-70">Calculated at fulfillment</span>
              </div>
              <div
                className="mt-1.5 flex items-center justify-between border-t pt-4 text-[17px] font-bold"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
              >
                <span>Total</span>
                <span className="tabular-nums">{cartTotal.toLocaleString('en-US')} {currency}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Section({
  icon, title, subtitle, children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl border p-6 shadow-sm sm:p-7"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div className="mb-6 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--color-background)', color: 'var(--color-primary)' }}
        >
          {icon}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function Field({
  label, value, onChange, error, type = 'text', full = false, placeholder,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  type?: string
  full?: boolean
  placeholder?: string
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-2 block text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-xl border px-4 py-3 text-[14px] outline-none transition-all placeholder:opacity-50 focus:ring-2 focus:ring-offset-0"
        style={{
          borderColor: error ? '#fca5a5' : 'var(--color-border)',
          background: 'var(--color-background)',
          color: 'var(--color-text-primary)',
        }}
      />
      {error && <p className="mt-1.5 text-[12px] font-medium text-red-500">{error}</p>}
    </div>
  )
}
'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

/* ══════════════════════════════════════════════════════════════════════
   Storefront — Order Confirmation
   /store/[slug]/checkout/success?order=1001
   GET /api/storefront/{storeSlug}/orders/{orderNumber}
   ══════════════════════════════════════════════════════════════════════ */

interface OrderItem {
  id: string
  title: string
  variant_title: string | null
  price: string
  qty: number
  image_url: string | null
}

interface OrderData {
  order_number: string
  status: string
  payment_status: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED'
  payment_method: string | null
  customer_name: string
  city: string
  total: string
  items: OrderItem[]
}

// البوابات اللي مبتاخدش تأكيد أونلاين — payment_status بتاعها بيفضل UNPAID
// وده طبيعي، مش لازم نقلق العميل بشأنها
const MANUAL_PAYMENT_METHODS = ['cod', 'bank_transfer']

const IconCheck = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconSpinner = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconCopy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)
const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
  </svg>
)
const IconAlert = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

export default function CheckoutSuccessPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const storeSlug = (params?.slug as string) || ''
  const orderNumber = searchParams.get('order') || ''

  const [order, setOrder] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)

  const pollAttempts = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/storefront/${storeSlug}/orders/${orderNumber}`)
      if (!res.ok) throw new Error('not found')
      const data: OrderData = await res.json()
      setOrder(data)
      return data
    } catch {
      setNotFound(true)
      return null
    }
  }

  useEffect(() => {
    if (!storeSlug || !orderNumber) { setLoading(false); setNotFound(true); return }
    let cancelled = false

    const run = async () => {
      const data = await fetchOrder()
      if (cancelled) return
      setLoading(false)

      // لو الدفع لسه UNPAID وبوابة أونلاين (مش COD/تحويل بنكي)، نستنى الـ webhook
      // ونحدّث الصفحة لوحدها كل 3 ثواني لحد 40 مرة (دقيقتين تقريباً)
      const isOnlinePending =
        data &&
        data.payment_status === 'UNPAID' &&
        data.payment_method &&
        !MANUAL_PAYMENT_METHODS.includes(data.payment_method)

      if (isOnlinePending && pollAttempts.current < 40) {
        pollTimer.current = setTimeout(async () => {
          pollAttempts.current += 1
          if (!cancelled) await run()
        }, 3000)
      }
    }

    run()
    return () => {
      cancelled = true
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug, orderNumber])

  const copyOrderNumber = () => {
    navigator.clipboard?.writeText(order?.order_number || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" style={{ color: 'var(--color-text-muted)' }}>
        <IconSpinner />
      </div>
    )
  }

  if (notFound || !order) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          We couldn't find that order
        </p>
        <Link
          href={`/store/${storeSlug}`}
          className="rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
          style={{ background: 'var(--color-primary)' }}
        >
          Back to store
        </Link>
      </div>
    )
  }

  const isOnlineMethod = order.payment_method && !MANUAL_PAYMENT_METHODS.includes(order.payment_method)
  const isPendingConfirmation = isOnlineMethod && order.payment_status === 'UNPAID'
  const isFailed = order.payment_status === 'FAILED'
  const isPaid = order.payment_status === 'PAID'

  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="flex flex-col items-center text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-sm"
          style={{ background: isFailed ? '#ef4444' : 'var(--color-primary)' }}
        >
          {isFailed ? <IconAlert /> : isPendingConfirmation ? <IconClock /> : <IconCheck />}
        </span>
        <h1
          className="mt-6 text-[24px] font-bold tracking-tight sm:text-[28px]"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {isFailed ? 'Payment failed' : isPendingConfirmation ? 'Confirming your payment...' : 'Order confirmed'}
        </h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {isFailed ? (
            <>We couldn't confirm your payment for this order. If an amount was deducted, it will be refunded — otherwise please try checking out again.</>
          ) : isPendingConfirmation ? (
            <>We're waiting for your payment provider to confirm the transaction. This usually takes a few seconds.</>
          ) : (
            <>
              Thanks{order.customer_name ? `, ${order.customer_name.split(' ')[0]}` : ''} — we've received your order and
              will reach out shortly to confirm delivery.
            </>
          )}
        </p>

        <button
          onClick={copyOrderNumber}
          className="mt-5 flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', background: 'var(--color-surface)' }}
        >
          Order #{order.order_number}
          <IconCopy />
          {copied && <span className="text-[11px] font-normal opacity-70">Copied</span>}
        </button>

        {isPendingConfirmation && (
          <div
            className="mt-4 flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium"
            style={{ background: '#fef3c7', color: '#92400e' }}
          >
            <IconSpinner />
            Waiting for payment confirmation
          </div>
        )}

        {isPaid && (
          <div
            className="mt-4 flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium"
            style={{ background: '#dcfce7', color: '#166534' }}
          >
            <IconCheck />
            Payment confirmed
          </div>
        )}
      </div>

      <div
        className="mt-10 overflow-hidden rounded-2xl border shadow-sm"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Order details
          </h2>
        </div>

        <div className="flex flex-col divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 px-5 py-3.5 text-[13px]"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="min-w-0">
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{item.title}</span>
                {item.variant_title && (
                  <span style={{ color: 'var(--color-text-muted)' }}> — {item.variant_title}</span>
                )}
                <span style={{ color: 'var(--color-text-muted)' }}> × {item.qty}</span>
              </div>
              <span className="shrink-0 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {(Number(item.price) * item.qty).toLocaleString('en-US')}
              </span>
            </div>
          ))}
        </div>

        <div
          className="flex items-center justify-between border-t px-5 py-4 text-[15px] font-bold"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
        >
          <span>Total</span>
          <span>{Number(order.total).toLocaleString('en-US')}</span>
        </div>
      </div>

      <div className="mt-8 flex justify-center">
        <Link
          href={`/store/${storeSlug}`}
          className="rounded-full px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          style={{ background: 'var(--color-primary)' }}
        >
          Continue shopping
        </Link>
      </div>
    </div>
  )
}
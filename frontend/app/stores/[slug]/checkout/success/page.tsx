'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useStore } from '../../components/StoreContext'

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

const MANUAL_PAYMENT_METHODS = ['cod', 'bank_transfer']
// PaymentIntentStatus values (backend/prisma/schema.prisma) that are
// terminal and mean no Order will ever be created for this attempt.
// 'cancelled' also covers Moyasar's/Stripe's own explicit "the customer
// abandoned this without paying" outcome (attempt_voided / a canceled
// invoice/session) — not just a merchant-cancelled payment.
const TERMINAL_FAILURE_INTENT_STATUSES = ['failed', 'expired', 'cancelled']

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
  const { clearCart } = useStore()
  const storeSlug = (params?.slug as string) || ''
  const orderNumber = searchParams.get('order') || ''
  const checkoutToken = searchParams.get('token') || ''
  // Set on cancel_url when the customer backs out of Stripe's hosted
  // Checkout Session (checkout.service.ts appends it — see
  // stripe.adapter.ts). Purely a UI label for an attempt that is still
  // otherwise pending: it can skip the wait for a poll timeout, but a
  // real terminal backend status (paid/failed) always wins over it, the
  // same invariant the merchant Test Payment result page already uses
  // for its own `cancelled=1` hint.
  const cancelledHint = searchParams.get('stripe_cancelled') === '1'

  const [order, setOrder] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)
  const [bankInstructions, setBankInstructions] = useState<Record<string, unknown> | null>(null)
  // The PaymentIntent's own canonical status (`failed`/`expired`/
  // `cancelled`/...), from GET /checkout/:token's `payment_status` field
  // — present even when `order` is null. No gateway ever creates an
  // Order for a payment that didn't secure funds (PaymentFactApplier
  // only does that for `attempt_authorized`/`attempt_captured`), so a
  // declined/expired/cancelled payment for ANY of the four online
  // gateways would otherwise be indistinguishable from "still pending"
  // and fall through to the poll timeout — even though the backend
  // already knows the real, terminal outcome.
  const [intentStatus, setIntentStatus] = useState<string | null>(null)

  const pollAttempts = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pollTimedOut, setPollTimedOut] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  const POLL_INTERVAL_MS = 3000
  const POLL_MAX_ATTEMPTS = 40 // ~2 minutes

  const fetchOrder = async () => {
    if (!orderNumber) return null
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

  const fetchByToken = async (): Promise<{ order: OrderData | null; intentStatus: string | null }> => {
    if (!checkoutToken) return { order: null, intentStatus: null }
    try {
      const res = await fetch(`/api/storefront/${storeSlug}/checkout/${checkoutToken}`)
      if (!res.ok) throw new Error('not found')
      const data = await res.json()
      const status: string | null = typeof data.payment_status === 'string' ? data.payment_status : null
      setIntentStatus(status)
      if (data.order) {
        setOrder(data.order)
        return { order: data.order as OrderData, intentStatus: status }
      }
      if (data.next_action?.kind === 'bank_instructions') {
        setBankInstructions(data.next_action.fields || data.next_action as Record<string, unknown>)
      } else if (data.next_action && data.next_action.fields) {
        setBankInstructions(data.next_action.fields)
      } else if (data.next_action && typeof data.next_action === 'object') {
        const hasFields = Object.keys(data.next_action).some(k => !['kind','url','method','form_fields','client_secret','sdk_hints'].includes(k))
        if (hasFields) setBankInstructions(data.next_action)
      }
      return { order: null, intentStatus: status }
    } catch {
      return { order: null, intentStatus: null }
    }
  }

  useEffect(() => {
    if (!storeSlug || (!orderNumber && !checkoutToken)) { setLoading(false); setNotFound(true); return }
    let cancelled = false
    pollAttempts.current = 0
    setPollTimedOut(false)

    // One authoritative round-trip per tick: sync (asks the provider via
    // the backend, never trusts anything client-side), then re-read the
    // resulting state. Recurses via a plain self-scheduling function
    // rather than the earlier hardcoded two-level nesting, which silently
    // stopped polling after 6 seconds no matter how the `< 40` check read.
    const tick = async (): Promise<void> => {
      if (checkoutToken) {
        try {
          await fetch(`/api/storefront/${storeSlug}/checkout/${checkoutToken}/sync`, { method: 'POST' })
        } catch { /* non-fatal — the status read below still reflects last-known state */ }
      }
      if (cancelled) return

      let data: OrderData | null = null
      let intentStat: string | null = null
      if (orderNumber) {
        data = await fetchOrder()
      } else if (checkoutToken) {
        const result = await fetchByToken()
        data = result.order
        intentStat = result.intentStatus
      }
      if (cancelled) return

      setLoading(false)

      // No Order exists for a payment that never secured funds — this is
      // the only place that outcome is visible without one: the intent
      // itself reached a real terminal status.
      const isTerminalWithoutOrder =
        !data && !!intentStat && TERMINAL_FAILURE_INTENT_STATUSES.includes(intentStat)

      const isOnlinePending =
        !!data &&
        data.payment_status === 'UNPAID' &&
        !!data.payment_method &&
        !MANUAL_PAYMENT_METHODS.includes(data.payment_method)

      // No order yet at all (online payment may still be finalizing) or a
      // known order still awaiting confirmation — both are genuinely
      // pending, not a final state, so keep polling. Except when the
      // customer told us (via cancel_url) that they backed out, or the
      // intent itself already reached a terminal failure/expiry/
      // cancellation with no Order to show for it — there is no point
      // polling for a confirmation that was just actively declined, or
      // that already definitively didn't happen.
      const stillPending =
        (isOnlinePending || (!data && !!checkoutToken)) && !cancelledHint && !isTerminalWithoutOrder

      if (!stillPending) return

      pollAttempts.current += 1
      if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        if (!cancelled) setPollTimedOut(true)
        return
      }

      pollTimer.current = setTimeout(() => {
        if (!cancelled) tick()
      }, POLL_INTERVAL_MS)
    }

    tick()
    return () => {
      cancelled = true
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug, orderNumber, checkoutToken, retryTick])

  // The cart is cleared here, from the server-confirmed outcome, rather
  // than optimistically at checkout submission — an online payment that
  // turns out to have failed must leave the cart intact for a retry. A
  // manual-settlement order (COD/bank transfer) is a real commitment the
  // moment it exists, independent of payment_status, so it clears
  // immediately rather than waiting for a payment confirmation that isn't
  // coming through this path.
  useEffect(() => {
    if (!order) return
    const isManualMethod = !!order.payment_method && MANUAL_PAYMENT_METHODS.includes(order.payment_method)
    if (order.payment_status === 'PAID' || isManualMethod) {
      clearCart()
    }
  }, [order, clearCart])

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

  if (pollTimedOut) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center" dir="rtl">
        <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
          <IconAlert />
        </span>
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          لم يتم تأكيد العملية بعد
        </p>
        <p className="max-w-sm text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          قد يستغرق مزود الدفع وقتًا أطول من المعتاد للتأكيد. طلبك لم يُفقد — يمكنك التحقق مرة أخرى أو المحاولة بعد قليل.
        </p>
        <button
          onClick={() => { setLoading(true); setPollTimedOut(false); setRetryTick((n) => n + 1) }}
          className="rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
          style={{ background: 'var(--color-primary)' }}
        >
          التحقق مرة أخرى
        </button>
        <Link href={`/stores/${storeSlug}`} className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          العودة للمتجر
        </Link>
      </div>
    )
  }

  if ((notFound && !order && !bankInstructions) || (!order && !bankInstructions && !checkoutToken)) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          We couldn't find that order
        </p>
        <Link
          href={`/stores/${storeSlug}`}
          className="rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
          style={{ background: 'var(--color-primary)' }}
        >
          Back to store
        </Link>
      </div>
    )
  }

  // Token-only view with bank instructions but no order yet
  if (!order && bankInstructions) {
    return (
      <div className="mx-auto max-w-xl px-4 py-14 sm:px-6 sm:py-20 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-white shadow-sm" style={{ background: 'var(--color-primary)' }}>
          <IconCheck />
        </span>
        <h1 className="mt-6 text-[24px] font-bold tracking-tight sm:text-[28px]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
          Order placed
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>Please complete the bank transfer using the details below.</p>
        <div className="mt-8 rounded-2xl border bg-amber-50 px-5 py-4 text-left" style={{ borderColor: '#fde68a' }}>
          <h3 className="text-sm font-semibold text-amber-800">Bank Transfer Instructions</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            {Object.entries(bankInstructions).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="font-medium text-amber-700">{k}</dt>
                <dd className="text-amber-900">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Link href={`/stores/${storeSlug}`} className="mt-8 inline-block rounded-full px-8 py-3 text-sm font-semibold text-white" style={{ background: 'var(--color-primary)' }}>Continue shopping</Link>
      </div>
    )
  }

  // A real PAID/FAILED terminal status always wins over this — it only
  // ever fires while the order is still absent or genuinely UNPAID.
  // Triggered either by Stripe's own cancel_url hint, or by the backend
  // PaymentIntent itself having reached `cancelled`/`expired` with no
  // Order to show for it (Moyasar's own abandoned-invoice status, or a
  // provider-side expiry) — same rendered outcome either way, since both
  // mean "the customer did not complete payment," not "it failed."
  const isAbandoned = intentStatus === 'cancelled' || intentStatus === 'expired'
  if ((cancelledHint || isAbandoned) && (!order || order.payment_status === 'UNPAID')) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center" dir="rtl">
        <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
          <IconAlert />
        </span>
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          تم إلغاء عملية الدفع
        </p>
        <p className="max-w-sm text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          رجعت بدون إتمام الدفع. لم يتم خصم أي مبلغ، وسلة مشترياتك ما زالت محفوظة إذا أردت المحاولة مرة أخرى.
        </p>
        <div className="flex gap-3">
          <Link
            href={`/stores/${storeSlug}/checkout`}
            className="rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
            style={{ background: 'var(--color-primary)' }}
          >
            المحاولة مرة أخرى
          </Link>
          <Link
            href={`/stores/${storeSlug}/checkout`}
            className="rounded-full border px-6 py-2.5 text-sm font-semibold transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            تغيير طريقة الدفع
          </Link>
        </div>
      </div>
    )
  }

  // The PaymentIntent itself reached `failed` and, as always, no Order
  // was ever created for it (PaymentFactApplier only creates one on
  // attempt_authorized/attempt_captured). Without this, a declined
  // payment on ANY of the four online gateways would sit in the bounded
  // poll until it timed out and showed "couldn't verify" — technically
  // not wrong, but strictly worse than the definitive answer the backend
  // already has.
  if (!order && intentStatus === 'failed') {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center" dir="rtl">
        <span className="flex h-16 w-16 items-center justify-center rounded-full text-white shadow-sm" style={{ background: '#ef4444' }}>
          <IconAlert />
        </span>
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          لم تتم عملية الدفع
        </p>
        <p className="max-w-sm text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          لم يتم اعتماد عملية الدفع. يمكنك المحاولة مرة أخرى.
        </p>
        <div className="flex gap-3">
          <Link
            href={`/stores/${storeSlug}/checkout`}
            className="rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
            style={{ background: 'var(--color-primary)' }}
          >
            المحاولة مرة أخرى
          </Link>
          <Link
            href={`/stores/${storeSlug}/checkout`}
            className="rounded-full border px-6 py-2.5 text-sm font-semibold transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            تغيير طريقة الدفع
          </Link>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <IconSpinner />
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Confirming your order...</p>
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
          dir={isFailed ? 'rtl' : undefined}
        >
          {isFailed ? 'لم تتم عملية الدفع' : isPendingConfirmation ? 'Confirming your payment...' : 'Order confirmed'}
        </h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }} dir={isFailed ? 'rtl' : undefined}>
          {isFailed ? (
            <>لم يتم اعتماد عملية الدفع. يمكنك المحاولة مرة أخرى.</>
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

        {bankInstructions && (
          <div className="mt-6 w-full rounded-2xl border bg-amber-50 px-5 py-4 text-left" style={{ borderColor: '#fde68a' }}>
            <h3 className="text-sm font-semibold text-amber-800">Bank Transfer Instructions</h3>
            <dl className="mt-3 space-y-1.5 text-sm">
              {Object.entries(bankInstructions).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="font-medium text-amber-700">{k}</dt>
                  <dd className="text-amber-900">{String(v)}</dd>
                </div>
              ))}
            </dl>
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

      {isFailed ? (
        <div className="mt-8 flex justify-center gap-3" dir="rtl">
          <Link
            href={`/stores/${storeSlug}/checkout`}
            className="rounded-full px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
            style={{ background: 'var(--color-primary)' }}
          >
            المحاولة مرة أخرى
          </Link>
          <Link
            href={`/stores/${storeSlug}/checkout`}
            className="rounded-full border px-8 py-3 text-sm font-semibold transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            تغيير طريقة الدفع
          </Link>
        </div>
      ) : (
        <div className="mt-8 flex justify-center">
          <Link
            href={`/stores/${storeSlug}`}
            className="rounded-full px-8 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
            style={{ background: 'var(--color-primary)' }}
          >
            Continue shopping
          </Link>
        </div>
      )}
    </div>
  )
}

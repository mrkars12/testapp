'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useParams } from 'next/navigation'
import api from '@/lib/api'

/* ══════════════════════════════════════════════════════════════════════
   Merchant-only Test Payment — the ONE canonical result page
   /store/settings/payments/test/result?token=...&cancelled=1

   There used to be two separate routes here (/test/success,
   /test/failure) — two competing implementations of the same concern.
   This is the single destination the trigger page (`../page.tsx`)
   always lands on via `router.replace`, for every outcome.

   `token` only selects which attempt to look up. The actual outcome
   shown is always re-derived from `GET /stores/payments/test/:token`
   (session + store authorized, server-side) — never trusted from the
   URL. The optional `cancelled=1` hint is the one exception, and even
   that only ever *labels* a still-pending attempt as abandoned by the
   merchant; it can never turn a real backend result into a fake
   success — a terminal backend status (captured/authorized/failed)
   always wins over it.
   ══════════════════════════════════════════════════════════════════════ */

interface TestPaymentStatus {
  token: string
  gateway: string | null
  status: string
  attempt_status: string | null
  provider_reference: string | null
  amount: string
  currency: string
  error_code: string | null
  failure_message: string | null
  created_at: string
}

type Outcome = 'success' | 'failure' | 'cancelled' | 'pending' | 'unresolved'

const SUCCEEDED_STATUSES = ['captured', 'partially_captured', 'authorized']
const FAILED_STATUSES = ['failed', 'expired']
const CANCELLED_STATUSES = ['cancelled']
const TERMINAL_STATUSES = [...SUCCEEDED_STATUSES, ...FAILED_STATUSES, ...CANCELLED_STATUSES]

function outcomeOf(status: string, cancelledHint: boolean): Outcome {
  if (SUCCEEDED_STATUSES.includes(status)) return 'success'
  if (FAILED_STATUSES.includes(status)) return 'failure'
  if (CANCELLED_STATUSES.includes(status)) return 'cancelled'
  if (cancelledHint) return 'cancelled'
  return 'pending'
}

/* Bounded polling for a genuinely in-flight TEST payment: the browser
   never decides the outcome, it only decides when to ask again. Every
   poll re-asks the backend, which re-asks the provider — see
   TestPaymentService.sync. Stops the moment a terminal status comes
   back, and gives up after POLL_MAX_ATTEMPTS with a retryable error
   state rather than spinning forever. */
const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20 // ~1 minute of polling

export default function TestPaymentResultPage() {
  const params = useSearchParams()
  // Retry and "change method" have to stay inside the store the merchant
  // is testing — a slug-free link would bounce through the legacy
  // redirect and could land on a different store's settings entirely.
  const routeParams = useParams()
  const storeSlug = typeof routeParams?.storeSlug === 'string' ? routeParams.storeSlug : null
  const base = storeSlug ? `/store/${storeSlug}` : '/store'
  const token = params.get('token')
  // `cancelled=1` is this page's own documented hint; `stripe_cancelled=1`
  // is what the Stripe adapter's cancel_url actually carries (the same
  // param the public checkout success page already reads — see
  // stripe.adapter.ts's `withQueryParam(context.returnUrl, 'stripe_cancelled', '1')`).
  // Either just labels a still-pending attempt — a terminal backend status
  // always overrides both (see outcomeOf below).
  const cancelledHint =
    params.get('cancelled') === '1' || params.get('stripe_cancelled') === '1'

  const [data, setData] = useState<TestPaymentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [gaveUp, setGaveUp] = useState(false)

  // The single source of truth for the outcome: always a fresh
  // server-side sync (backend asks the provider directly), never the
  // plain GET, and never anything read from the URL. Bumping `attempts`
  // re-runs this effect, which is what drives the bounded poll below.
  useEffect(() => {
    if (!token) {
      setError('الرابط غير مكتمل.')
      return
    }
    let cancelled = false
    setSyncing(true)
    api
      .post(`/stores/payments/test/${token}/sync`, {})
      .then((res) => {
        if (cancelled) return
        setData(res.data)
      })
      .catch(() => {
        if (cancelled) return
        setError('الدفعة التجريبية دي مش موجودة أو مش تابعة لمتجرك.')
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempts])

  // Bounded auto-poll while genuinely pending. Stops immediately on any
  // terminal status, and stops for good after POLL_MAX_ATTEMPTS rather
  // than polling forever — the UI then shows a retryable "couldn't
  // verify" state instead of an endless spinner.
  useEffect(() => {
    if (!data) return
    if (TERMINAL_STATUSES.includes(data.status) || cancelledHint) return
    if (attempts >= POLL_MAX_ATTEMPTS) {
      setGaveUp(true)
      return
    }
    const timer = setTimeout(() => setAttempts((n) => n + 1), POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [data, attempts, cancelledHint])

  const recheck = () => {
    setGaveUp(false)
    setAttempts(0)
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="font-semibold text-gray-700">{error}</p>
        <Link href={`${base}/settings/payments/test`} className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          العودة إلى اختبار بوابة الدفع
        </Link>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="h-40 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
      </div>
    )
  }

  const rawOutcome = outcomeOf(data.status, cancelledHint)
  // Terminal statuses always win, even if the poll had already given up
  // by the time this last response landed. Only a still-pending result
  // is ever downgraded to "couldn't verify".
  const outcome: Outcome = rawOutcome === 'pending' && gaveUp ? 'unresolved' : rawOutcome

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <ResultBanner outcome={outcome} syncing={syncing && outcome === 'pending'} />

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-gray-200 bg-white p-5 text-sm">
        <Field label="البوابة" value={data.gateway ?? '—'} />
        <Field label="الوضع" value="Test" />
        <Field label="الحالة" value={data.status} />
        {outcome === 'success' && data.provider_reference && (
          <Field label="مرجع البوابة" value={data.provider_reference} mono />
        )}
        {outcome === 'success' && (
          <Field label="المبلغ" value={`${(Number(data.amount) / 100).toFixed(2)} ${data.currency}`} />
        )}
        {outcome === 'failure' && (
          <Field label="سبب الفشل" value={data.failure_message ?? 'تعذر إكمال عملية الدفع التجريبية.'} />
        )}
        {/* `error_code: 'unknown'` is a real, meaningful value on the wire
            (the provider genuinely gave us nothing more specific to
            classify) — but showing the literal word "unknown" to a
            merchant reads as a bug, not a safe generic reason. Only a
            real, classified code is worth a technical reference row. */}
        {outcome === 'failure' && data.error_code && data.error_code !== 'unknown' && (
          <Field label="كود المرجع" value={data.error_code} mono />
        )}
        <Field label="الوقت" value={new Date(data.created_at).toLocaleString('ar-EG')} />
      </dl>

      {(outcome === 'pending' || outcome === 'unresolved') && (
        <button
          onClick={recheck}
          disabled={syncing}
          className="mt-6 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {syncing ? 'جاري التحقق...' : 'التحقق مرة أخرى'}
        </button>
      )}

      {(outcome === 'failure' || outcome === 'cancelled') && data.gateway && (
        <Link
          href={`${base}/settings/payments/test?gateway=${encodeURIComponent(data.gateway)}`}
          className="mt-6 block w-full rounded-xl bg-gray-900 py-3 text-center text-sm font-semibold text-white"
        >
          المحاولة مرة أخرى
        </Link>
      )}

      <div className="mt-4 flex gap-3">
        <Link
          href={`${base}/settings/payments/test`}
          className="flex-1 rounded-xl border border-gray-300 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          تغيير طريقة الدفع
        </Link>
        <Link
          href={`${base}/settings/payments`}
          className="flex-1 rounded-xl bg-gray-900 py-3 text-center text-sm font-semibold text-white"
        >
          العودة لإعدادات الدفع
        </Link>
      </div>
    </div>
  )
}

function ResultBanner({ outcome, syncing }: { outcome: Outcome; syncing: boolean }) {
  const theme = {
    success: { border: 'border-green-200', bg: 'bg-green-50', iconBg: 'bg-green-100', iconColor: 'text-green-600', titleColor: 'text-green-800', textColor: 'text-green-700' },
    failure: { border: 'border-red-200', bg: 'bg-red-50', iconBg: 'bg-red-100', iconColor: 'text-red-600', titleColor: 'text-red-800', textColor: 'text-red-700' },
    cancelled: { border: 'border-gray-200', bg: 'bg-gray-50', iconBg: 'bg-gray-100', iconColor: 'text-gray-500', titleColor: 'text-gray-700', textColor: 'text-gray-600' },
    pending: { border: 'border-amber-200', bg: 'bg-amber-50', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', titleColor: 'text-amber-800', textColor: 'text-amber-700' },
    unresolved: { border: 'border-amber-200', bg: 'bg-amber-50', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', titleColor: 'text-amber-800', textColor: 'text-amber-700' },
  }[outcome]

  const title = {
    success: 'نجحت عملية الدفع التجريبية',
    failure: 'فشلت عملية الدفع التجريبية',
    cancelled: 'تم إلغاء عملية الدفع التجريبية',
    pending: 'جاري التحقق من نتيجة المعاملة التجريبية...',
    unresolved: 'لم يتم تأكيد العملية بعد',
  }[outcome]

  return (
    <div className={`rounded-2xl border ${theme.border} ${theme.bg} p-6 text-center`}>
      <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full ${theme.iconBg} ${theme.iconColor}`}>
        <OutcomeIcon outcome={outcome} spinning={outcome === 'pending' || syncing} />
      </div>
      <h1 className={`text-lg font-bold ${theme.titleColor}`}>{title}</h1>
      <p className={`mt-2 text-[13px] leading-relaxed ${theme.textColor}`}>
        هذه معاملة اختبارية — لم يتم خصم أي مبلغ حقيقي ولم يتم إنشاء طلب.
      </p>
    </div>
  )
}

function OutcomeIcon({ outcome, spinning }: { outcome: Outcome; spinning: boolean }) {
  if (outcome === 'success') {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
  }
  if (outcome === 'failure') {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    )
  }
  if (outcome === 'cancelled') {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M6 6l12 12M6 18 18 6" />
      </svg>
    )
  }
  if (outcome === 'unresolved') {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z" />
      </svg>
    )
  }
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={spinning ? 'animate-spin' : ''}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-[13px] font-medium text-gray-800 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

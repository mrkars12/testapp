'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { useActiveStoreReady } from '@/lib/useActiveStoreReady'
import { normalizePaymentStatus, isTerminalState } from '@/lib/payments/state'
import { navigateSameTab } from '@/lib/payments/sameTabNavigation'

/* ══════════════════════════════════════════════════════════════════════
   Merchant-only Test Payment — trigger page
   /store/settings/payments/test

   Runs a REAL transaction against the store's own TEST-mode gateway
   account (POST /api/stores/payments/test), never the public storefront
   checkout, and never creates an Order — see backend
   TestPaymentService for why that's structural, not a convention.

   Every exit from this page goes to the ONE canonical result route,
   `./result?token=...`, via `router.replace` (never `push`, so the
   half-finished attempt never sits in browser history for the back
   button to return to) — there used to be two separate destinations
   (`/test/success`, `/test/failure`) that could each render while the
   other's state, or this page's own card-collection UI, was still
   mounted underneath. There is now exactly one place this page can end
   up, and it always fully replaces this page's tree first.

   Every gateway that needs the customer to do anything (Stripe's
   Checkout Session included — see stripe.adapter.ts's final Checkout
   Sessions architecture) returns `next_action.kind: 'redirect'`: a real
   top-level redirect away from this page to the provider's own TEST
   flow, and back. This page mounts no provider SDK of its own, and it
   no longer merely *assumes* no adapter will ask it to: the initiate
   call declares what this surface can host
   (`hostableNextActionKinds` — backend TestPaymentService), so an
   adapter that can do both hands this page its hosted flow and the
   in-page form only to the storefront checkout. An action kind that
   still arrives unhandled is refused out loud below, never forwarded to
   the result route as though it were an outcome. When the browser
   returns here carrying `?token=`, this page shows nothing but a
   blocking "checking result" state until the real backend status is
   known, then replaces straight to the result route — it never
   re-renders the gateway picker in that window.

   ONE TAB. This page used to open the gateway in a window of its own and
   wait here, polling, behind a screen that told the merchant their
   payment had been opened elsewhere. That is gone, module and all:
   there is no payment window anywhere in this project any more, on this
   surface or on the storefront checkout. The gateway gets the tab the
   merchant is already in (`navigateSameTab`, the same helper the
   storefront uses) and hands it back to the result route, which is where
   the outcome has always been decided — by the backend, never here.

   The phases this page owns:

     IDLE        the gateway picker
     CREATING    POST /stores/payments/test in flight
     REDIRECTING this tab is being handed to the provider
     VERIFYING   this page was loaded carrying ?token= — a Back from the
                 provider, or a refresh mid-payment — so the attempt is
                 re-synced and resolved

   SUCCESS / FAILED / CANCELLED / PENDING are rendered by `./result`,
   which the provider returns to directly and which this page replaces
   into for every other exit. Same tab throughout; the merchant never
   sees a second window.
   ══════════════════════════════════════════════════════════════════════ */

interface TestableGateway {
  key: string
  name_ar: string
  name_en: string
  supports_test_mode: boolean
  accounts: { mode: 'test' | 'live'; status: string }[]
}

interface TestPaymentStatus {
  token: string
  status: string
  next_action: { kind: string; url?: string } | null
}

// Terminal detection is delegated to the shared normalizer
// (`lib/payments/state.ts`) so this page and the storefront checkout
// cannot drift apart on what counts as settled — they previously did,
// and an expired/cancelled test payment polled here forever because this
// file's own list was missing those two values.

function returnUrl(storeSlug: string): string {
  if (typeof window === 'undefined') return ''
  // Sent to the backend as `return_url`, which embeds the authoritative
  // checkout token into it (`?token=...`, see TestPaymentService.initiate)
  // before handing it to the provider — this page never appends the token
  // itself. Points straight at the canonical result route: the provider
  // must send the merchant back to the final result surface, not back to
  // this picker (see result/page.tsx's header comment for why there is
  // exactly one destination).
  //
  // The store slug has to be in this URL: the provider redirects the
  // merchant here from its own domain, and a slug-free path would resolve
  // whichever store the legacy redirect picks — which for a merchant with
  // several stores is not necessarily the one they were testing.
  return `${window.location.origin}/store/${storeSlug}/settings/payments/test/result`
}

type Stage = 'loading' | 'IDLE' | 'CREATING' | 'REDIRECTING' | 'VERIFYING'

/**
 * Puts the attempt's token in this tab's address bar before the tab
 * leaves for the provider.
 *
 * The same trick the storefront checkout uses, for the same reason: a
 * Back from the provider, or a refresh at any point after this, then
 * lands on a page that knows which attempt to resolve instead of on a
 * blank picker. `replaceState` rather than the router, because it has to
 * apply synchronously and survive the document navigation that starts on
 * the next line.
 */
function rememberAttemptInUrl(storeSlug: string, token: string): void {
  if (typeof window === 'undefined') return
  window.history.replaceState(
    null,
    '',
    `/store/${encodeURIComponent(storeSlug)}/settings/payments/test?token=${encodeURIComponent(token)}`,
  )
}

export default function TestPaymentPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { storeSlug, ready } = useActiveStoreReady()

  const [gateways, setGateways] = useState<TestableGateway[]>([])
  // A page loaded carrying `?token=` IS a return from the provider (or a
  // Back, or a refresh mid-payment), so it starts in VERIFYING and never
  // flashes the picker for an attempt that already exists. Derived at
  // first render rather than assigned from an effect — the effect ran
  // after a paint that had already shown the wrong thing.
  const [stage, setStage] = useState<Stage>(() =>
    params.get('token') ? 'VERIFYING' : 'loading',
  )
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Guards against a double-click starting two real test charges against
  // the merchant's gateway; see `start()`. A ref, not state: React
  // batches, so a second click in the same tick would sail straight past
  // a state-based guard.
  const startLockRef = useRef(false)

  const goToResult = (token: string, cancelled = false) => {
    router.replace(
      `/store/${storeSlug}/settings/payments/test/result?token=${token}${cancelled ? '&cancelled=1' : ''}`,
    )
  }

  // Loads the merchant's available TEST gateways — skipped entirely
  // while resuming from a redirect, so the picker never flashes.
  useEffect(() => {
    if (!ready || !storeSlug) return
    if (params.get('token')) return // resuming — handled below instead
    api
      .get('/stores/payment-settings')
      .then((res) => {
        const testable = (res.data as TestableGateway[]).filter(
          (g) =>
            g.supports_test_mode &&
            g.accounts.some((a) => a.mode === 'test' && (a.status === 'active' || a.status === 'verifying')),
        )
        setGateways(testable)
        const preselected = params.get('gateway')
        const match = preselected && testable.some((g) => g.key === preselected) ? preselected : testable[0]?.key
        if (match) setSelected(match)
        setStage('IDLE')
      })
      .catch(() => {
        setGateways([])
        setStage('IDLE')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, storeSlug])

  // Returning from the provider's own TEST flow (Stripe Checkout Session,
  // Paymob/Moyasar/Tap redirect). The token only selects which attempt to
  // ask about — the result always comes from the backend, which asks the
  // provider directly, never from anything in the URL.
  useEffect(() => {
    if (!ready) return
    const token = params.get('token')
    if (!token) return
    api
      .post(`/stores/payments/test/${token}/sync`, {})
      .then((res) => {
        const data: TestPaymentStatus = res.data
        // Still not concluded — land on the result page anyway; it has
        // its own bounded auto-poll and "check again" control and will
        // not fabricate an outcome. Never re-show the picker for an
        // attempt that already exists.
        goToResult(data.token)
      })
      .catch(() => goToResult(token))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const start = async () => {
    if (!selected) return
    // Set synchronously, before any state update or `await`: React batches
    // `setStage`, so a double-click would sail past a state-based guard
    // and start a second test payment against the merchant's real gateway.
    if (startLockRef.current) return
    startLockRef.current = true
    setStage('CREATING')
    setError(null)

    try {
      const res = await api.post('/stores/payments/test', {
        gateway: selected,
        return_url: returnUrl(storeSlug ?? ''),
      })
      const data: TestPaymentStatus = res.data

      if (isTerminalState(normalizePaymentStatus(data.status))) {
        // Settled without the merchant having to do anything.
        goToResult(data.token)
        return
      }

      if (data.next_action?.kind === 'redirect' && data.next_action.url) {
        // This tab goes to the provider. No window is opened, so there is
        // no popup to be blocked and no fallback path to maintain — the
        // popup-blocked branch that used to live here existed only
        // because a window was being opened in the first place.
        rememberAttemptInUrl(storeSlug ?? '', data.token)
        setStage('REDIRECTING')

        if (!navigateSameTab(data.next_action.url, 'GET')) {
          // The normalized action carried something that is not an
          // http(s) URL. Never navigate to it.
          setError('تعذّر فتح صفحة الدفع الخاصة بالبوابة.')
          setStage('IDLE')
          startLockRef.current = false
        }
        return
      }

      if (data.next_action && data.next_action.kind !== 'none') {
        // The provider asked for something this page cannot do.
        //
        // Falling through to the result route here is the bug this
        // branch replaces: an unhandled action was reported as a
        // *result*, so the merchant saw "requires_action" on a result
        // page for a payment that had never reached the provider at
        // all. A pending state was being manufactured out of an action
        // nobody had performed.
        //
        // The backend now tells adapters what this surface can host
        // (hostableNextActionKinds), so reaching here means a genuinely
        // new action kind — which must be said out loud, not rendered as
        // an outcome.
        setError(
          `لا يمكن تنفيذ هذا الإجراء من صفحة الاختبار (${data.next_action.kind}). ` +
            'جرّب من صفحة الدفع، أو راجع إعدادات البوابة.',
        )
        setStage('IDLE')
        startLockRef.current = false
        return
      }

      goToResult(data.token)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(message || 'تعذّر بدء الدفع التجريبي.')
      setStage('IDLE')
      // Only a failed start releases the lock; a started attempt has
      // either left this tab or resolved, and must stay locked.
      startLockRef.current = false
    }
  }

  if (stage === 'loading' || stage === 'VERIFYING' || !ready) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="h-24 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
        <p className="mt-3 text-center text-[13px] text-gray-400">جاري التحقق من نتيجة الدفع التجريبي...</p>
      </div>
    )
  }

  if (stage === 'REDIRECTING') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="h-24 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
        <p className="mt-3 text-center text-[13px] text-gray-400">
          جارٍ تحويلك إلى صفحة الدفع الخاصة بالبوابة في هذه الصفحة...
        </p>
      </div>
    )
  }

  if (!storeSlug) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="font-semibold text-gray-700">لا يوجد متجر نشط</p>
        <Link href="/store" className="text-sm text-blue-600 hover:underline">اختيار متجر</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">اختبار بوابة الدفع</h1>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            Test
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          دفعة تجريبية حقيقية على حساب اختبار البوابة — بدون إنشاء طلب أو خصم مبلغ حقيقي.
        </p>
      </div>

      {gateways.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
          مفيش بوابة عندها حساب Test شغّال دلوقتي. فعّل حساب Test لبوابة (زي Stripe)
          في{' '}
          <Link href={`/store/${storeSlug}/settings/payments`} className="underline">
            إعدادات الدفع
          </Link>{' '}
          الأول.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <label className="mb-2 block text-[13px] font-medium text-gray-700">اختر البوابة</label>
          <div className="flex flex-col gap-2">
            {gateways.map((g) => (
              <label
                key={g.key}
                className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5"
                style={{ borderColor: selected === g.key ? '#111827' : '#e5e7eb' }}
              >
                <input
                  type="radio"
                  name="gateway"
                  checked={selected === g.key}
                  onChange={() => setSelected(g.key)}
                />
                <span className="text-sm font-medium text-gray-800">{g.name_ar || g.name_en}</span>
              </label>
            ))}
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-gray-500">
            هذه معاملة اختبارية — لن يتم خصم أموال حقيقية ولن يتم إنشاء طلب. هتتحوّل في نفس
            الصفحة دي لصفحة الدفع الحقيقية بتاعة البوابة في وضع الاختبار، وترجع هنا تلقائيًا
            بعد ما تخلّص.
          </p>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-[13px] text-red-600">{error}</p>
          )}

          <button
            onClick={start}
            disabled={stage === 'CREATING' || !selected}
            className="mt-5 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {stage === 'CREATING' ? 'جاري تنفيذ الدفعة التجريبية...' : 'ابدأ الدفعة التجريبية'}
          </button>
        </div>
      )}
    </div>
  )
}

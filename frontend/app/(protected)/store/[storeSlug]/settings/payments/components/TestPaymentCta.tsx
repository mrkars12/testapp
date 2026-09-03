import { useParams } from 'next/navigation'
import type { Gateway } from '@/lib/payments/types'
import { IconPlay } from './icons'

/**
 * Rendered only when `gateway.test_payment_supported` and a Test-mode
 * account is at least `verifying`/`active` — matches the precondition
 * `TestPaymentService.initiate` enforces server-side, so the button is
 * never shown in a state where starting a test payment would fail.
 */
export default function TestPaymentCta({ gateway }: { gateway: Gateway }) {
  // Read straight from the `[storeSlug]` segment rather than prop-drilling
  // through GatewayCard. The href was previously slug-free, which 404s —
  // the legacy stub tree has no `settings/payments/test` child — and would
  // have lost the active store even if it had resolved.
  const params = useParams()
  const storeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : ''

  const testAccount = gateway.accounts.find((a) => a.mode === 'test')
  const ready = testAccount && (testAccount.status === 'active' || testAccount.status === 'verifying')

  if (!gateway.test_payment_supported) return null

  if (!ready) {
    return (
      <p className="mt-3 text-[11.5px] text-gray-400">
        فعّل حساب Test أولاً عشان تقدر تجرّب دفعة تجريبية حقيقية على هذه البوابة.
      </p>
    )
  }

  return (
    <a
      href={`/store/${encodeURIComponent(storeSlug)}/settings/payments/test?gateway=${encodeURIComponent(gateway.key)}`}
      className="mt-3 flex w-fit items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
    >
      <IconPlay /> تشغيل دفعة تجريبية
    </a>
  )
}

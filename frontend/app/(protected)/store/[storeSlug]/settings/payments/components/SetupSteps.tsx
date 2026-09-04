import type { Gateway, PublicAccount } from '@/lib/payments/types'
import { IconCheck } from './icons'

interface Step {
  label: string
  done: boolean
}

/**
 * Purely capability-driven: which steps exist is computed from
 * `requires_credentials` / `supports_test_mode` / `webhook_events` /
 * `test_payment_supported`, never from the gateway's key or name. This
 * is what lets COD and Bank Transfer render fewer steps than Stripe
 * without a single gateway-name conditional anywhere in this file.
 */
function buildSteps(gateway: Gateway, account: PublicAccount | null): Step[] {
  const steps: Step[] = []

  if (gateway.supports_test_mode) {
    steps.push({ label: 'اختيار الوضع (Test/Live)', done: true })
  }
  if (gateway.requires_credentials) {
    steps.push({ label: 'إدخال بيانات الاعتماد', done: Boolean(account?.is_configured) })
    steps.push({
      label: 'التحقق من البيانات',
      done: Boolean(account && account.status !== 'draft' && account.status !== 'errored'),
    })
  }
  steps.push({ label: 'حالة الإعداد', done: Boolean(account) })
  if (gateway.webhook_events.length > 0) {
    steps.push({ label: 'إعداد الويبهوك', done: account?.webhook?.status === 'verified' })
  }
  steps.push({ label: 'تفعيل البوابة', done: account?.status === 'active' })
  if (gateway.test_payment_supported) {
    steps.push({
      label: 'تجربة دفعة تجريبية',
      done: false,
    })
  }

  return steps
}

export default function SetupSteps({
  gateway,
  account,
}: {
  gateway: Gateway
  account: PublicAccount | null
}) {
  const steps = buildSteps(gateway, account)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-1.5">
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
              step.done ? 'bg-green-500 text-white' : 'border border-gray-300 text-gray-400'
            }`}
          >
            {step.done ? <IconCheck /> : i + 1}
          </span>
          <span className={`text-[11.5px] ${step.done ? 'text-gray-500' : 'text-gray-400'}`}>{step.label}</span>
        </div>
      ))}
    </div>
  )
}

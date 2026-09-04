import type { Mode } from '@/lib/payments/types'

export default function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (mode: Mode) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-gray-700">الوضع</span>
      <div className="inline-flex w-fit rounded-lg border border-gray-300 bg-white p-0.5 text-[13px]">
        <button
          type="button"
          onClick={() => onChange('test')}
          className={`rounded-md px-3 py-1.5 font-semibold uppercase tracking-wide transition-colors ${
            mode === 'test' ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          Test
        </button>
        <button
          type="button"
          onClick={() => onChange('live')}
          className={`rounded-md px-3 py-1.5 font-semibold uppercase tracking-wide transition-colors ${
            mode === 'live' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          Live
        </button>
      </div>
      {mode === 'test' && (
        // Storefront checkout only ever reads live-mode offerings
        // (backend/src/stores/checkout/checkout.service.ts hardcodes
        // mode: Mode = 'live') — a Test account can look "Active" here
        // and still never reach a real customer without this notice.
        <p className="text-[12px] text-amber-600">
          حساب Test مش هيظهر في صفحة الدفع الحقيقية للعملاء — للاختبار الداخلي بس. فعّل حساب Live
          عشان يظهر في الـ Checkout.
        </p>
      )}
    </div>
  )
}

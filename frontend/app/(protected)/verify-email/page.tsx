import { Suspense } from 'react'
import VerifyEmailClient from './VerifyEmailClient'

// إخبار Next.js أن هذه الصفحة ديناميكية بالكامل لمنع خطأ useSearchParams
export const dynamic = 'force-dynamic'

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 font-bold text-gray-500">
        جاري التحقق من الحساب...
      </div>
    }>
      <VerifyEmailClient />
    </Suspense>
  )
}

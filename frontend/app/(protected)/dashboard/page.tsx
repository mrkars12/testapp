import { Suspense } from 'react'
import DashboardClient from './DashboardClient'

// إخبار Next.js أن هذه الصفحة ديناميكية بالكامل لمنع خطأ useSearchParams
export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 font-bold text-gray-500">
        جاري تحميل لوحة التحكم...
      </div>
    }>
      <DashboardClient />
    </Suspense>
  )
}
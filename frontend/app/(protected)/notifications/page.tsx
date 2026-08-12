import { Suspense } from 'react'
import NotificationsClient from './NotificationsClient'

export default function NotificationsPage() {
  return (
    <div className="container mx-auto">
      {/* 🚩 Suspense هنا هو مفتاح الحل لخطأ Prerender */}
      <Suspense fallback={
        <div className="max-w-3xl mx-auto py-20 text-center">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mb-4"></div>
          <p className="text-gray-500 font-medium">جاري تحميل الإشعارات...</p>
        </div>
      }>
        <NotificationsClient />
      </Suspense>
    </div>
  )
}
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import RootEntry from './RootEntry'

/**
 * Root `/`.
 *
 *  - No session cookie visible on THIS origin -> render the marketing
 *    landing, wrapped in `RootEntry` (a thin client gate that hands an
 *    authenticated visitor to `/store` — the one slug-agnostic resolver —
 *    and shows the landing only for a confirmed guest). The gate is
 *    needed because the `access_token` cookie is issued by the API origin
 *    and is not readable by the frontend server here.
 *  - Session cookie visible (same-origin deploy) -> skip all of that and
 *    server-`redirect('/store')` immediately.
 *
 * Either way: `/` is never a *rendered authenticated page*, it never
 * bootstraps stores or picks a slug, and it can never land on
 * `/select-store`.
 */
export default async function RootPage() {
  const jar = await cookies()
  if (jar.get('access_token')?.value) {
    redirect('/store')
  }

  return (
    <RootEntry
      landing={
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
          <div className="max-w-7xl mx-auto px-4 py-20">
            <div className="text-center">
              <h1 className="text-5xl font-bold text-gray-900 mb-6">مرحباً بك في منصتنا</h1>
              <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">منصة متكاملة لإدارة أعمالك بكل سهولة وأمان</p>
              <div className="flex justify-center gap-4">
                <Link href="/register" className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium">إنشاء حساب مجاني</Link>
                <Link href="/login" className="px-8 py-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-medium">تسجيل دخول</Link>
              </div>
            </div>
          </div>
        </div>
      }
    />
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'

/**
 * There is no personal/business choice in signup anymore — this step used
 * to ask the visitor to pick an account type before continuing. Now it just
 * silently starts the (still HMAC-signed) registration flow as
 * 'individual' and moves straight to the single unified signup form.
 *
 * ROOT CAUSE OF "/register redirects to /login" (see
 * FINAL_SIGNUP_ROUTE_REDIRECT_FIX_REPORT.md): this used to call
 * `router.replace('/login')` whenever `POST /auth/register/start` failed
 * for ANY reason — a network error, CORS, a misconfigured API URL, or the
 * backend being briefly unreachable. That made the public registration
 * route's mere reachability depend on a live network call succeeding,
 * which it must never do. On failure this now stays on `/register` and
 * offers a retry instead of silently sending the visitor to login.
 */
export default function RegisterStep1() {
  const router = useRouter()
  const startedRef = useRef(false)
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const start = async () => {
      setFailed(false)
      try {
        const res = await api.post('/auth/register/start', {
          accounttype: 'individual',
        })

        const { flow_id, flow_signature } = res.data

        if (!flow_id || !flow_signature) {
          setFailed(true)
          return
        }

        router.replace(
          `/register/account-information?flow=${flow_id}&sig=${flow_signature}`,
        )
      } catch {
        setFailed(true)
      } finally {
        startedRef.current = false
      }
    }

    start()
  }, [router, retryKey])

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            تعذر بدء عملية إنشاء الحساب. يرجى المحاولة مرة أخرى.
          </p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

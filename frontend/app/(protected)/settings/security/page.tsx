'use client'

import {
  useEffect,
  useState,
  Suspense
} from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import DisableModal from '@/components/DisableModal'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { useAuthState } from '@/lib/authState'

function SecurityContent() {
  const router = useRouter()

  const {
    isAuthenticated,
    isSessionReady,
    refreshUser
  } = useAuth()

  const authStatus = useAuthState(s => s.status)

  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [data, setData] = useState({
    two_factor_enabled: false,
    email_verified: false
  })
  const [showDisable, setShowDisable] = useState(false)

  // ✅ 1. تعريف الدالة هنا
  const fetchSecurity = async () => {
    const authState = useAuthState.getState()
    if (
      authState.status === 'logging_out' ||
      authState.status === 'unauthenticated' ||
      authState.status === 'refreshing_session'
    ) {
      return
    }

    try {
      if (useAuthState.getState().status !== 'authenticated') {
        return
      }
      setLoading(true)
      const res = await api.get('/auth/2fa/status')
      setData(res.data)
    } catch (e: any) {
      if (e?.response?.status === 401) {
        return
      }
    } finally {
      setLoading(false)
    }
  }

  // ✅ 2. نقل الـ useEffect ليكون هنا في الأعلى (قبل أي return)
  useEffect(() => {
    const authState = useAuthState.getState()
    if (
      !isSessionReady ||
      !isAuthenticated ||
      authState.status !== 'authenticated'
    ) {
      return
    }

    const t = setTimeout(() => {
      fetchSecurity()
    }, 3000)

    return () => clearTimeout(t)
  }, [isSessionReady, isAuthenticated]) // ملاحظة: يفضل عدم إضافة fetchSecurity للمصفوفة لتجنب اللوب إلا لو استخدمت useCallback


  // ✅ 3. الآن يمكنك وضع شرط الـ return المبكر بأمان تام
  if (
    authStatus === 'logging_out' ||
    authStatus === 'refreshing_session' ||
    !isAuthenticated ||
    !isSessionReady
  ) {
    return null
  }

  const securityLevel =
    1 +
    (data.email_verified ? 1 : 0) +
    (data.two_factor_enabled ? 1 : 0)

  const securityProgress = (securityLevel / 3) * 100

  const levelColor =
    securityLevel === 3
      ? 'bg-green-500'
      : securityLevel === 2
      ? 'bg-yellow-500'
      : 'bg-red-500'

  return (
    <div className="w-full space-y-6">
      <h1 className="text-lg font-bold text-[#09527e]">
        Security
      </h1>

      <div className="bg-white shadow rounded-xl p-6">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-40"></div>
            <div className="h-2 bg-gray-200 rounded-full"></div>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-800">
              Security level: {securityLevel}/3
            </p>
            <div className="w-full h-2 bg-gray-200 rounded-full mt-2 mb-3 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${levelColor}`}
                style={{ width: securityProgress + '%' }}
              />
            </div>
            <p className="text-xs text-gray-500">
              {securityLevel === 3
                ? 'Your account is fully protected.'
                : 'Improve your account security.'}
            </p>
          </>
        )}
      </div>

      <div className="bg-white shadow rounded-xl p-6 flex justify-between items-center">
        {loading ? (
          <div className="w-full animate-pulse flex justify-between items-center">
            <div className="space-y-3">
              <div className="h-4 bg-gray-200 rounded w-48"></div>
              <div className="h-3 bg-gray-200 rounded w-64"></div>
            </div>
            <div className="h-6 bg-gray-200 rounded w-20"></div>
          </div>
        ) : (
          <>
            <div>
              <p className="font-bold text-gray-800 mb-1">
                Two-Factor Authentication
              </p>
              <p className="text-sm text-gray-500">
                Protect your account with Google Authenticator.
              </p>
            </div>

            {!data.two_factor_enabled ? (
              <button
                onClick={() => router.replace('/settings/security/2fa/setup')}
                disabled={actionLoading}
                className="text-[#0b5c9e] font-bold hover:underline flex items-center gap-2"
              >
                Enable
              </button>
            ) : (
              <button
                onClick={() => setShowDisable(true)}
                disabled={actionLoading}
                className="text-red-600 font-bold hover:underline"
              >
                Disable
              </button>
            )}
          </>
        )}
      </div>

      <div className="bg-white shadow rounded-xl p-6 flex justify-between items-center">
        <div>
          <p className="font-bold text-gray-800 mb-1">Manage Devices</p>
          <p className="text-sm text-gray-500">Manage your used devices.</p>
        </div>
        <Link
          href="/settings/security/devices"
          className="text-[#0b5c9e] font-bold text-[14px] underline"
        >
          Device Management
        </Link>
      </div>

      {showDisable && (
        <DisableModal
          onClose={() => setShowDisable(false)}
          onDisabled={async () => {
            setActionLoading(true)
            await refreshUser()
            await fetchSecurity()
            setShowDisable(false)
            setActionLoading(false)
          }}
        />
      )}
    </div>
  )
}

export default function SecurityPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-gray-400 font-bold animate-pulse">
          Loading Security Settings...
        </div>
      }
    >
      <SecurityContent />
    </Suspense>
  )
}
'use client'

import { useState, useRef } from 'react'
import OTPInput from '@/components/OTPInput'
import api from '@/lib/api'

export default function DisableModal({ onClose, onDisabled }: any) {

  const [otp, setOtp] = useState<string[]>(Array(6).fill(''))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isComplete = otp.length === 6 && otp.every(v => v !== '')

const disable2FA = async () => {

  if (!isComplete) return

  try {

    setLoading(true)

    setError('')

    /**
     * ✅ pause heartbeat
     */
    window.dispatchEvent(
      new Event(
        'auth:pause_heartbeat'
      )
    )

    const res =
      await api.post(

        '/auth/2fa/disable',

        {
          code:
            otp.join('')
        }
      )

    /**
     * ❌ failed
     */
    if (!res.data.success) {

      window.dispatchEvent(
        new Event(
          'auth:resume_heartbeat'
        )
      )

      setError(

        res.data.message ||

        'Invalid authentication code'
      )

      return
    }

    /**
     * ✅ wait session sync
     */
    await new Promise(resolve => setTimeout(resolve, 500))


    /**
     * ✅ refresh security page ONLY
     */
    await onDisabled()

    /**
     * ✅ resume heartbeat
     */
    window.dispatchEvent(
      new Event(
        'auth:resume_heartbeat'
      )
    )

    /**
     * ✅ close modal
     */
    onClose()

  } catch (err: any) {

    window.dispatchEvent(
      new Event(
        'auth:resume_heartbeat'
      )
    )

    setError(

      err?.response?.data?.message ||

      'Invalid authentication code'
    )

  } finally {

    setLoading(false)
  }
}

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-4 text-red-600">
          Disable Two-Factor Authentication
        </h3>

        <p className="text-sm text-gray-600 mb-6">
          Enter your current 2FA code to confirm disabling.
        </p>

        <OTPInput
          value={otp}
          onChange={(val: string[]) => {
            setOtp(val)
            setError('')
          }}
          hasError={!!error}
          disabled={loading}
        />

        {error && (
          <p className="text-red-600 text-sm text-center mt-4 font-medium">
            {error}
          </p>
        )}

        <div className="flex gap-3 mt-8">

          {/* Cancel */}
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 bg-gray-200 rounded-lg font-medium hover:bg-gray-300 disabled:opacity-50 transition"
          >
            Cancel
          </button>

          {/* Disable */}
          <button
            onClick={disable2FA}
            disabled={!isComplete || loading}
            className="flex-1 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
            )}

            {loading ? 'Disabling...' : 'Disable 2FA'}
          </button>

        </div>
      </div>
    </div>
  )
}
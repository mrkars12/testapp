'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import OTPInput, { OTPInputRef } from '@/components/OTPInput'
import type { Route } from 'next'
import toast from 'react-hot-toast'
import { useAuth } from '@/components/AuthProvider'
import { useAuthState } from '@/lib/authState'
import { getHardwareFingerprint } from '@/lib/fingerprint'

export default function Setup2FA() {

  const router = useRouter()

  const [currentStep, setCurrentStep] = useState(0)
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''))
  const [verifyError, setVerifyError] = useState('')
  const [showCopySuccess, setShowCopySuccess] = useState(false)

  const [loading, setLoading] = useState({
    generateSecret: false,
    enable2FA: false,
    copySecret: false,
  })

  const { user } = useAuth()

  const otpRef = useRef<OTPInputRef>(null)

  const steps = [
    'Download App',
    'Scan QR Code',
    'Verify Code',
    'Complete'
  ]

  /**
   * ✅ redirect only if enabled AND not on final step
   */

  // ==============================
  // STEP 1 → Generate Secret
  // ==============================
  const generateSecretAndNext = async () => {


    if (user?.two_factor_enabled) {
      toast.error('تم تفعيل المصادقة الثنائية بالفعل')
      return
    }

    setLoading(prev => ({ ...prev, generateSecret: true }))
  
    setLoading(prev => ({
      ...prev,
      generateSecret: true
    }))

    try {

      const res =
        await api.get(
          '/auth/2fa/generate'
        )

      setSecret(res.data.secret)
      setQr(res.data.qrCode)
      setCurrentStep(1)

    } catch (error: any) {

      if (error.response?.status === 403) {
        toast.error('تم تفعيل المصادقة الثنائية بالفعل')
        return
      }
      toast.error('حدث خطأ، حاول مرة أخرى')
      console.error(error)

      console.error(error)

    } finally {

      setLoading(prev => ({
        ...prev,
        generateSecret: false
      }))
    }
  }

  // ==============================
  // STEP 3 → Verify and Confirm
  // ==============================
  const verifyAndEnable = async () => {

    if (loading.enable2FA) return

    const code = otp.join('').trim()

    if (code.length !== 6) {
      setVerifyError('أدخل الكود بالكامل')
      return
    }

    setLoading(prev => ({ ...prev, enable2FA: true }))
    setVerifyError('')

    try {

      const fingerprint = await getHardwareFingerprint()

      const res = await api.post(
        '/auth/2fa/confirm',
        { code },
        { headers: { 'x-device-fingerprint': fingerprint } }
      )

      if (!res.data.success) {
        setVerifyError(res.data.message || 'الكود غير صحيح')
        return
      }

      /**
       * ✅ success — show final step first
       */
      toast.success('تم تفعيل المصادقة الثنائية بنجاح')
      setCurrentStep(3)

      /**
       * ✅ hard navigation بعد ثانية
       * عشان الكوكي الجديد يتسيت صح
       */

      // router.replace('/settings/security')

      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (err: any) {

      setVerifyError(
        err?.response?.data?.message || 'فشل التحقق'
      )

    } finally {

      setLoading(prev => ({ ...prev, enable2FA: false }))
    }
  }

  // ==============================
  // Copy Secret
  // ==============================
  const copySecret = async () => {

    setLoading(prev => ({ ...prev, copySecret: true }))
    await navigator.clipboard.writeText(secret)
    setShowCopySuccess(true)

    setTimeout(() => {
      setShowCopySuccess(false)
      setLoading(prev => ({ ...prev, copySecret: false }))
    }, 1500)
  }

  const next = () =>
    currentStep < 3 && setCurrentStep(currentStep + 1)

  const prev = () =>
    currentStep > 0 && setCurrentStep(currentStep - 1)

  return (
    <div className="w-full">

      {/* PROGRESS BAR */}
      <ul className="table table-fixed w-full text-[13px] font-[500] mb-2 p-0">

        {steps.map((title, i) => (

          <li key={i} className="table-cell text-center relative">

            <div
              className={`
                rounded-full border-[2px] font-bold text-[11px]
                leading-[24px] w-[28px] h-[28px] m-[0_auto_4px]
                flex items-center justify-center relative z-10
                ${i < currentStep
                  ? 'bg-black border-black text-white'
                  : i === currentStep
                  ? 'bg-white border-black text-black'
                  : 'bg-[#e1e1e1] border-[#e1e1e1] text-[#808080]'}
              `}
            >
              {i + 1}
            </div>

            <span className="leading-[25px]">{title}</span>

            {i < steps.length - 1 && (
              <div className="w-full bg-gray-200 rounded-full h-[2px] absolute top-[14px] left-[50%]">
                <div
                  className="bg-black h-[2px] rounded-full transition-all duration-[700ms] ease-out"
                  style={{ width: i < currentStep ? '100%' : '0%' }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="max-w-[400px] m-auto px-0 py-[30px]">

        {/* STEP 1 */}
        {currentStep === 0 && (
          <>
            <h2 className="font-bold m-[40px_0_24px] text-[18px] text-center">
              Download and install the Authenticator app
            </h2>

            <div className="flex items-center justify-between p-[0px_38px]">

              <div className="m-[30px_0] text-center">
                <div className="text-[#707a8a] text-[14px] mt-2">Download from</div>
                <div className="text-[16px] font-[500]">Google Play</div>
              </div>

              <div className="m-[30px_0] text-center">
                <div className="text-[#707a8a] text-[14px] mt-2">Download from</div>
                <div className="text-[16px] font-[500]">App Store</div>
              </div>

            </div>

            <button
              onClick={generateSecretAndNext}
              disabled={loading.generateSecret}
              className="w-full mt-12 px-10 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-900 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading.generateSecret && (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              )}
              {loading.generateSecret ? 'Generating...' : 'Next'}
            </button>
          </>
        )}

        {/* STEP 2 */}
        {currentStep === 1 && (
          <>
            <h2 className="font-bold m-[20px_0_24px] text-[18px] text-center">
              Scan this QR code in the Authenticator app
            </h2>

            <div className="flex justify-center mb-5">
              <div className="shadow rounded-[4px] w-[160px] h-[160px] p-[12px] bg-white flex items-center justify-center">
                {qr && <img src={qr} width="150" height="150" alt="2FA QR Code" />}
              </div>
            </div>

            <div className="mb-2 font-bold text-[13px]">Secret Code</div>

            <div className="relative">
              <div className="w-full h-[48px] border border-[#9eaab9] bg-[#2d2d2d] text-white rounded-[4px] flex items-center pl-[10px] font-[600] text-[13px]">
                {secret}
              </div>
              <button
                onClick={copySecret}
                disabled={loading.copySecret}
                className="absolute right-[10px] top-0 bottom-0 flex items-center disabled:opacity-50 font-bold text-[13px]"
              >
                {loading.copySecret
                  ? <span className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></span>
                  : showCopySuccess ? '✓' : 'Copy'}
              </button>
            </div>

            {showCopySuccess && (
              <div className="text-green-600 text-sm text-center mt-2">✓ Copied to clipboard!</div>
            )}

            <div className="text-[#707a8a] text-[14px] text-center mt-4 leading-[20px]">
              Open Google Authenticator app and click on "+"
              and scan or enter this code, then click next.
            </div>

            <div className="flex gap-4 mt-5">
              <button onClick={prev} className="flex-1 py-3 bg-gray-200 rounded font-bold text-[13px]">
                Previous
              </button>
              <button onClick={next} className="flex-1 py-3 bg-black text-white rounded font-bold text-[13px]">
                Next
              </button>
            </div>
          </>
        )}

        {/* STEP 3 */}
        {currentStep === 2 && (
          <>
            <h2 className="font-bold text-[22px] text-center mb-5">
              Two-factor authentication
            </h2>

            <p className="text-center text-[15px] font-bold mb-8">
              Enable Authenticator by input your code
            </p>

            <OTPInput
              ref={otpRef}
              value={otp}
              onChange={setOtp}
              hasError={!!verifyError}
              onClearError={() => setVerifyError('')}
              onSubmit={verifyAndEnable}
            />

            {verifyError && (
              <p className="text-red-600 text-sm text-center mt-4 font-medium">{verifyError}</p>
            )}

            <div className="flex gap-4 mt-10">
              <button
                onClick={prev}
                disabled={loading.enable2FA}
                className="flex-1 py-3 bg-gray-200 rounded font-bold disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={verifyAndEnable}
                disabled={!otp.every(d => d !== '') || loading.enable2FA}
                className={`flex-1 py-3 rounded font-bold text-white flex items-center justify-center gap-2 transition disabled:opacity-50 ${
                  otp.every(d => d !== '') && !loading.enable2FA
                    ? 'bg-black hover:bg-gray-900'
                    : 'bg-gray-500'
                }`}
              >
                {loading.enable2FA && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                )}
                {loading.enable2FA ? 'Enabling...' : 'Validate and enable'}
              </button>
            </div>
          </>
        )}

        {/* STEP 4 */}
        {currentStep === 3 && (
          <div className="text-center py-10">

            <div className="w-24 h-24 bg-green-100 rounded-full border-4 border-green-500 mx-auto mb-6 flex items-center justify-center font-bold text-green-600 text-2xl">
              ✓
            </div>

            <h1 className="text-2xl font-bold mb-4">
              Two-Factor Authentication Enabled!
            </h1>

            <p className="text-gray-600 mb-8">
              Your account is now protected with an extra layer of security.
            </p>

            <button
              onClick={() => { router.replace('/settings/security') }}
              className="block w-full py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-900"
            >
              Back to Settings
            </button>

          </div>
        )}
      </div>
    </div>
  )
}
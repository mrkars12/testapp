'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'

interface OTPInputProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  hasError?: boolean
  onClearError?: () => void
  onSubmit?: (code: string) => void
}

export interface OTPInputRef {
  focus: () => void
  isComplete: boolean
}

const OTPInput = forwardRef<OTPInputRef, OTPInputProps>(({
  value,
  onChange,
  disabled = false,
  hasError = false,
  onClearError,
  onSubmit
}, ref) => {
  const [internalOtp, setInternalOtp] = useState<string[]>(value)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // مزامنة القيم لمنع الـ Loop
  const externalValueStr = JSON.stringify(value)
  useEffect(() => {
    setInternalOtp(JSON.parse(externalValueStr))
  }, [externalValueStr])

  const updateOtp = (newOtp: string[]) => {
    setInternalOtp(newOtp)
    onChange(newOtp)
    if (onClearError && hasError) onClearError()
  }

  // 🚩 1. اللاقط العالمي للكيبورد (بيكتب تلقائي بدون تحديد حقل)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (disabled) return

      // أ) لو المستخدم ضغط رقم (0-9)
      if (/^\d$/.test(e.key)) {
        e.preventDefault()
        const firstEmptyIdx = internalOtp.findIndex(d => d === '')
        if (firstEmptyIdx !== -1) {
          const newOtp = [...internalOtp]
          newOtp[firstEmptyIdx] = e.key
          updateOtp(newOtp)
          // فوكس على الحقل اللي اتكتب فيه أو اللي بعده
          inputRefs.current[Math.min(firstEmptyIdx + 1, 5)]?.focus()
        }
      }

      // ب) لو المستخدم ضغط Backspace (مسح تسلسلي من اليمين لليسار)
      if (e.key === 'Backspace') {
        const lastFilledIdx = internalOtp.findLastIndex(d => d !== '')
        if (lastFilledIdx !== -1) {
          e.preventDefault()
          const newOtp = [...internalOtp]
          newOtp[lastFilledIdx] = ''
          updateOtp(newOtp)
          inputRefs.current[lastFilledIdx]?.focus()
        }
      }

      // ج) لو ضغط Enter والكود كامل
      if (e.key === 'Enter' && internalOtp.every(d => d !== '')) {
        onSubmit?.(internalOtp.join(''))
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [internalOtp, disabled, updateOtp])

  // 🚩 2. معالجة اللصق (Paste) من أي مكان
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (disabled) return
      const text = e.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6)
      if (text) {
        e.preventDefault()
        const newOtp = Array(6).fill('')
        for (let i = 0; i < text.length; i++) newOtp[i] = text[i]
        updateOtp(newOtp)
        inputRefs.current[Math.min(text.length, 5)]?.focus()
      }
    }
    window.addEventListener('paste', handleGlobalPaste)
    return () => window.removeEventListener('paste', handleGlobalPaste)
  }, [disabled, updateOtp])

  useImperativeHandle(ref, () => ({
    focus: () => {
      const firstEmpty = internalOtp.findIndex(d => d === '')
      inputRefs.current[firstEmpty === -1 ? 0 : firstEmpty]?.focus()
    },
    isComplete: internalOtp.every(d => d !== '')
  }))

  return (
    <div className="flex justify-center gap-[.7rem] relative outline-none" onClick={() => inputRefs.current[internalOtp.findIndex(d => d === '') === -1 ? 5 : internalOtp.findIndex(d => d === '')]?.focus()}>
      {internalOtp.map((digit, i) => (
        <input
          key={i}
          ref={el => { inputRefs.current[i] = el }}
          value={digit}
          type="text"
          readOnly // 🚩 منع الكتابة اليدوية المباشرة لفرض المنطق العالمي
          className={`w-14 h-[3.5rem] text-2xl font-bold text-center border-2 rounded-xl focus:outline-none transition-all duration-200 cursor-default
            ${hasError ? 'border-red-500 bg-red-50' : digit ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
        />
      ))}
      <div className="otp-dash">-</div>

      <style jsx>{`
        .otp-dash {
          font-size: 32px;
          font-weight: bold;
          color: #999;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
        }
        input:nth-child(3) { margin-right: 20px; }
        input:nth-child(4) { margin-left: 20px; }
        input { caret-color: transparent !important; }
      `}</style>
    </div>
  )
})

OTPInput.displayName = 'OTPInput'
export default OTPInput
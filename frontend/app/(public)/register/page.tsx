'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, } from 'react'
import api from '@/lib/api'
import AuthNavigationLinks from '@/components/AuthNavigationLinks'

type AccountType = 'individual' | 'business'

export default function RegisterStep1() {
  const router = useRouter()

  const [type, setType] = useState<AccountType>('individual')
  const [hydrated, setHydrated] = useState(false)
  const [loading, setLoading] = useState(false)

  /* =========================
     🧠 Hydration-safe init
  ========================= */
  useEffect(() => {
  try {
    const stored =
      (sessionStorage.getItem('register_accounttype') as AccountType) ||
      'individual'

    setType(stored)
  } catch {
    setType('individual')
  } finally {
    setHydrated(true)
  }
}, [])

  /* =========================
     ⚡ تغيير فوري
  ========================= */
  const handleTypeChange = (val: AccountType) => {
    setType(val)
    sessionStorage.setItem('register_accounttype', val)
  }

  /* =========================
     ▶️ Next step
  ========================= */
  const handleNext = async () => {
    if (loading) return
    setLoading(true)

    try {
      const res = await api.post('/auth/register/start', {
        accounttype: type,
      })

      const { flow_id, flow_signature } = res.data

      if (!flow_id || !flow_signature) {
        alert('Flow initialization failed')
        return
      }

      router.push(
  `/register/account-information?flow=${flow_id}&sig=${flow_signature}&type=${type}`
)


    } catch {
      alert('فشل بدء التسجيل')
    } finally {
      setLoading(false)
    }
  }

  if (!hydrated) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}


  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex flex-col justify-center py-12 px-4">
      <div className="max-w-md mx-auto w-full">
        <div className="bg-white p-8 rounded-2xl shadow-lg border borFder-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
            اختر نوع حسابك
          </h2>

          <div className="mb-8 space-y-4">
            <AccountRadio
              label="حساب فردي"
              subtitle="Personal"
              desc="مثالي للأفراد والاستخدام الشخصي"
              checked={type === 'individual'}
              onClick={() => handleTypeChange('individual')}
            />

            <AccountRadio
              label="حساب تجاري"
              subtitle="Small Business"
              desc="مصمم للشركات والأعمال"
              checked={type === 'business'}
              onClick={() => handleTypeChange('business')}
            />
          </div>

          <button
            onClick={handleNext}
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-70"
          >
            {loading ? 'جاري التحميل...' : 'التالي'}
          </button>

        <AuthNavigationLinks />
          
        </div>
      </div>
    </div>
  )
}

/* =========================
   ♻️ Component
========================= */
function AccountRadio({
  label,
  subtitle,
  desc,
  checked,
  onClick,
}: any) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer p-6 border-2 rounded-xl transition ${
        checked
          ? 'border-blue-600 bg-blue-50'
          : 'border-gray-200 hover:border-blue-300'
      }`}
    >
      <div className="flex gap-4 items-start">
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            checked ? 'border-blue-600' : 'border-gray-300'
          }`}
        >
          {checked && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
        </div>

        <div>
          <div className="font-bold">{label}</div>
          <div className="text-sm text-blue-600 font-semibold">{subtitle}</div>
          <p className="text-sm text-gray-500 mt-1">{desc}</p>
        </div>
      </div>
    </div>
  )
}

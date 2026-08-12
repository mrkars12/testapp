'use client'

import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) {
      if (user.email_verified_at) {
        router.replace('/dashboard')
      } else {
        router.replace('/verify-email')
      }
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  if (user) {
    return null
  }

  return (
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
  )
}
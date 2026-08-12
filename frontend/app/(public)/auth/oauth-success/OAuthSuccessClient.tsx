// app/(public)/auth/oauth-success/OAuthSuccessClient.tsx
'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuthState } from '@/lib/authState'
import { useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

export default function OAuthSuccessClient() {
  const params = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  
  const sessionId = params.get('session_id')
  const intendedPath = params.get('intended') || '/dashboard'

  // 🍏 1. لقط بارامترات فحص الجهاز الجديد المشفرة القادمة من الباك إند
  const isDeviceCheck = params.get('device_check')
  const payload = params.get('payload')
  const emailParam = params.get('email')

  useEffect(() => {
    // 🍏 2. السحر الأمن هنا: لو الإشارة جهاز جديد، احقن الداتا في الميموري فوراً واقذف على اللوجين
    // app/(public)/auth/oauth-success/OAuthSuccessClient.tsx

    if (isDeviceCheck && payload) {
      // 🍏 الحقن المضمون في ذاكرة الـ Window المؤقتة (Memory Only)
      if (typeof window !== 'undefined') {
        (window as any).__OAUTH_SECURE_DATA__ = {
          step: 'device',
          token: payload,
          email: emailParam ? decodeURIComponent(emailParam) : ''
        }
      }
      
      // طيران فوري على اللوجين والـ Window شايل الداتا في الـ RAM
      router.replace('/login')
      return
    }

    // لو مفيش جهاز جديد ومفيش جلسة، يبقى الـ Flow باظ
    if (!sessionId) { 
      router.replace('/login?error=oauth_failed')
      return 
    }

    ;(async () => {
      try {
        // 3. تثبيت الجلسة والحالة محلياً فوراً حتى يمر طلب الـ /me بنجاح
        useAuthState.getState().setSession(sessionId)
        useAuthState.getState().setStatus('authenticated')

        const res = await api.get('/auth/me')

        if (!res.data?.authenticated) {
          throw new Error('not authenticated')
        }

        // 4. حقن بيانات المستخدم الموثقة داخل كاش الـ React Query اللحظي
        queryClient.setQueryData(['auth-user'], {
          authenticated: true,
          user: res.data.user,
          session_id: sessionId,
        })

        // 5. تطهير شامل لمنع تعليق زر الـ Back Button
        await queryClient.invalidateQueries({ queryKey: ['auth-user'] })

        /**
         * 📡 6. [مزامنة التابات المفتوحة]: إرسال الـ intendedPath الحقيقي للتابات الأخرى
         */
        try {
          const bc = new BroadcastChannel('auth_sync_channel')
          bc.postMessage({
            type: 'AUTH_LOGIN_SYNC',
            userPayload: {
              authenticated: true,
              user: res.data.user,
              session_id: sessionId,
            },
            intendedPath: intendedPath,
          })
          bc.close()
        } catch {}

        // 7. طيران فوري على الصفحة اللي كان عايزها المستخدم بنعومة وبدون ريفريش
        router.replace(intendedPath)
      } catch (err) {
        // تصفير وتنظيف في حالة الفشل وتوجيه للوجين
        useAuthState.getState().setStatus('unauthenticated')
        useAuthState.getState().setSession(null)
        queryClient.clear()
        router.replace('/login?error=oauth_failed')
      }
    })()
  }, [sessionId, isDeviceCheck, payload, emailParam, intendedPath, router, queryClient])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="text-center space-y-4 animate-in fade-in duration-300">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"/>
        <p className="text-gray-600 dark:text-gray-400 font-medium text-sm tracking-tight">جاري تجهيز حسابك بأمان...</p>
      </div>
    </div>
  )
}
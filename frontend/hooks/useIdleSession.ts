'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useIdleTimer } from 'react-idle-timer'
import { useQueryClient } from '@tanstack/react-query'

import api from '@/lib/api'
import { useAuthState } from '@/lib/authState'
import { forceCloseSocket } from '@/components/Go'

const IDLE_TIMEOUT = 1000 * 60 * 1 // 15 دقيقة

export function useSessionGuardian() {

  const router = useRouter()

  const queryClient = useQueryClient()

  const logoutRef = useRef(false)

  const { status } = useAuthState()

  /*
  |--------------------------------------------------------------------------
  | LOGOUT
  |--------------------------------------------------------------------------
  */

  const handleLogout = useCallback(async () => {

    const authState = useAuthState.getState()

    // منع التكرار
    if (
      logoutRef.current ||
      authState.status === 'logging_out'
    ) {
      return
    }

    logoutRef.current = true

    authState.setStatus('logging_out')

    // الصفحة الحالية
    const currentPath =
      window.location.pathname +
      window.location.search

    const loginUrl =
      `/login?reason=idle_expired&intended=${encodeURIComponent(currentPath)}`

    try {

      // قفل websocket
      forceCloseSocket()

      // logout من السيرفر
      await api.post(
        '/api/auth/logout',
        {},
        {
          headers: {
            'X-Skip-Interceptor': 'true'
          }
        }
      )

    } catch {}

    // sync باقي التابات
    const bc =
      new BroadcastChannel('auth_sync_channel')

    bc.postMessage({
      type: 'AUTH_LOGOUT_EVENT',
      intendedPath: currentPath
    })

    bc.close()

    // تنظيف الكاش
    queryClient.clear()

    // redirect
    router.replace(loginUrl)

  }, [router, queryClient])

  /*
  |--------------------------------------------------------------------------
  | SESSION VALIDATION
  |--------------------------------------------------------------------------
  */

  const validateSession = useCallback(async () => {

    if (
      document.visibilityState !== 'visible'
    ) {
      return
    }

    try {

      await api.get(
        '/api/auth/ping',
        {
          headers: {
            'X-Skip-Interceptor': 'true'
          }
        }
      )

    } catch {

      await handleLogout()
    }

  }, [handleLogout])

  /*
  |--------------------------------------------------------------------------
  | REAL USER ACTIVITY
  |--------------------------------------------------------------------------
  */

  const reportActivity = useCallback(async () => {

    try {

      await api.post(
        '/api/auth/activity',
        {},
        {
          headers: {
            'X-Skip-Interceptor': 'true'
          }
        }
      )

    } catch {}

  }, [])

  /*
  |--------------------------------------------------------------------------
  | IDLE TIMER
  |--------------------------------------------------------------------------
  */

  useIdleTimer({

    timeout: IDLE_TIMEOUT,

    onIdle: async () => {

      await validateSession()

      await handleLogout()
    },

    onAction: () => {

      reportActivity()
    },

    debounce: 1000,

    crossTab: true,

    syncTimers: 200
  })

  /*
  |--------------------------------------------------------------------------
  | SLEEP / WAKE VALIDATION
  |--------------------------------------------------------------------------
  */

  useEffect(() => {

    if (status !== 'authenticated')
      return

    const wakeCheck = async () => {

      await validateSession()
    }

    window.addEventListener(
      'focus',
      wakeCheck
    )

    document.addEventListener(
      'visibilitychange',
      wakeCheck
    )

    return () => {

      window.removeEventListener(
        'focus',
        wakeCheck
      )

      document.removeEventListener(
        'visibilitychange',
        wakeCheck
      )
    }

  }, [status, validateSession])

}
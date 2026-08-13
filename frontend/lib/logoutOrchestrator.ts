import { useAuthState } from '@/lib/authState'
import { socket } from '@/lib/socket'
import Cookies from 'js-cookie'
import { getHardwareFingerprint } from '@/lib/fingerprint'

function clearClientCookies() {
  Cookies.remove('access_token', { path: '/', domain: window.location.hostname })
  Cookies.remove('access_token', { path: '/' })
  document.cookie = 'access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
}

export async function logoutOrchestrator(opts: {
  reason?: string
  intendedPath?: string
  skipApiCall?: boolean
  router: { replace: (url: string) => void }
  queryClient: {
    setQueryData: (key: any, data: any) => void
    cancelQueries: (opts: any) => void
    clear?: () => void
  }
}) {
  const authState = useAuthState.getState()

  // ✅ نمنع التكرار فقط لو logging_out — مش unauthenticated
  if (authState.status === 'logging_out') return

  // 1. قفل الواجهة فوراً
  authState.setStatus('logging_out')

  // 2. حساب المسار المقصود
  const rawPath =
    opts.intendedPath ||
    (typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '/dashboard')

  const intendedPath =
    rawPath.startsWith('/login') || rawPath === '/'
      ? '/dashboard'
      : rawPath.replace(/([?&])intended=[^&]+/g, '').replace(/\?$/, '')

  // 3. تنظيف الـ Query Cache
  opts.queryClient.cancelQueries({ queryKey: ['auth-user'] })
  opts.queryClient.setQueryData(['auth-user'], { authenticated: false, user: null })

  // 4. تنظيف السوكت عبر authState.logout() عشان يستخدم forceCloseSocket
  authState.logout()

  // 5. استدعاء الـ API مع الـ fingerprint
  if (!opts.skipApiCall) {
    try {
      const fp = await getHardwareFingerprint()
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/auth/logout`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-device-fingerprint': fp,
          },
        }
      )
    } catch {}
  }

  // 6. مسح الكوكيز
  clearClientCookies()

  // 7. إبلاغ التابات الأخرى
  try {
    const bc = new BroadcastChannel('auth_sync_channel')
    bc.postMessage({ type: 'AUTH_LOGOUT_EVENT', intendedPath })
    bc.close()
  } catch {}

  // 8. التوجيه + reset الـ status بعده عشان login يشتغل صح
  const isTimeout = opts.reason === 'idle_timeout'
  const reasonParam = isTimeout ? '&reason=timeout' : ''
  const url = `/login?intended=${encodeURIComponent(intendedPath)}${reasonParam}`

  setTimeout(() => {
    opts.router.replace(url)
    // ✅ reset بعد التوجيه — يخلي الـ query يشتغل عند login جديد
    setTimeout(() => {
      useAuthState.getState().setStatus('unauthenticated')
    }, 300)
  }, 50)
}

export function renewAbortController() {}
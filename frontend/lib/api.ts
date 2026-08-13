import axios from 'axios'
import { useAuthState } from '@/lib/authState'
import { API_URL } from '@/lib/config'


const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

console.log('✅ API baseURL:', API_URL)

let sessionExpiredTriggered = false

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (axios.isCancel(error) || error?.code === 'ERR_CANCELED') {
      return Promise.reject({ ...error, silent: true })
    }

    if (!error.response) {
      return Promise.reject(error)
    }

    const authState = useAuthState.getState()
    const requestUrl = error.config?.url || ''

    if (authState.status === 'refreshing_session') {
      return Promise.reject({ ...error, silent: true })
    }

    if (authState.status === 'logging_out' || authState.status === 'unauthenticated') {
      return Promise.reject({ ...error, silent: true })
    }

    if (requestUrl.includes('/auth/logout') || requestUrl.includes('/auth/heartbeat')) {
      return Promise.reject({ ...error, silent: true })
    }

    const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
    const isAuthPage = currentPath.startsWith('/login') || currentPath.startsWith('/register')

    const ignoredRoutes = [
      '/auth/login', '/auth/check-pending-verification', '/auth/2fa/confirm',
      '/auth/device/verify-code', '/auth/verify-otp', '/auth/resend-otp',
      '/auth/me', '/devices/current',
    ]

    if (ignoredRoutes.some(route => requestUrl.includes(route)) || isAuthPage) {
      return Promise.reject({ ...error, silent: true })
    }

    const message = String(error.response?.data?.message || '').toLowerCase()
    if (message.includes('otp')) {
      return Promise.reject({ ...error, silent: true })
    }

    if (error.response?.status !== 401) {
      return Promise.reject(error)
    }

    if (sessionExpiredTriggered) {
      return Promise.reject({ ...error, silent: true })
    }

    sessionExpiredTriggered = true
    window.dispatchEvent(new Event('auth:stop_idle'))
    window.dispatchEvent(new Event('auth:clear_cache'))
    window.dispatchEvent(new CustomEvent('auth:session_expired', {
      detail: { reason: 'session_expired' }
    }))

    setTimeout(() => { sessionExpiredTriggered = false }, 5000)
    return Promise.reject({ ...error, silent: true })
  }
)

export default api

export function dispatchSessionExpired(reason = 'idle_timeout') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('auth:session_expired', { detail: { reason } }))
}
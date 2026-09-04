import axios from 'axios'
import { useAuthState } from '@/lib/authState'
import { API_URL } from '@/lib/config'
import { readStoreSlugFromLocation } from '@/lib/storeSlug'


const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

console.log('✅ API baseURL:', API_URL)

let sessionExpiredTriggered = false

/** Routes that must NOT receive X-Store-Slug */
const STORE_HEADER_EXCLUDED = [
  '/stores', // GET /stores itself — user-scoped, lists all stores
  '/auth/',
  '/notifications',
  '/wallet',
  '/devices',
]

function shouldAttachStoreHeader(url: string): boolean {
  if (!url) return false
  // Exclude exact /stores and /stores?... (the store listing)
  if (url === '/stores' || url.startsWith('/stores?') || url === `${API_URL}/stores` || url.startsWith(`${API_URL}/stores?`)) return false
  for (const excluded of STORE_HEADER_EXCLUDED) {
    // Allow /stores/xxx (store-scoped) but block /stores alone is handled above
    if (excluded === '/stores') continue
    if (url.includes(excluded)) return false
  }
  // Store-scoped paths
  if (url.includes('/stores/')) return true
  if (url.includes('/uploads')) return true
  return false
}

function resolveStoreSlugForHeader(): string | null {
  // THE URL. Not "the URL first" — the URL only.
  //
  // Store-scoped dashboard routes are `/store/[storeSlug]/…`, so
  // the active store is already in the path: synchronous, correct on the
  // first render, and correct again after a reload with nothing remembered.
  //
  // There used to be an in-memory Zustand mirror consulted ahead of (and
  // later behind) this. It was a second authority for the same fact, and it
  // could disagree — a request issued before it caught up carried the
  // PREVIOUS store's slug. It is gone, so that class of leak cannot occur.
  //
  // When the path names no store this returns null and NO `X-Store-Slug` is
  // sent. That is deliberate: a store-agnostic route has no active store,
  // and inventing one here (a remembered slug, `stores[0]`, the default
  // store) is exactly how a request gets attributed to the wrong tenant.
  // Routes that genuinely need a store go through the explicit entry
  // redirect, which puts a slug in the URL first.
  return readStoreSlugFromLocation()
}

api.interceptors.request.use((config) => {
  const url = config.url || ''
  if (shouldAttachStoreHeader(url)) {
    const slug = resolveStoreSlugForHeader()
    if (slug) {
      config.headers = config.headers || {}
      ;(config.headers as Record<string, string>)['X-Store-Slug'] = slug
    }
  }
  return config
})

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

/** Headers for bare fetch() store-scoped requests */
export function getStoreHeaders(): Record<string, string> {
  const slug = resolveStoreSlugForHeader()
  if (!slug) return {}
  return { 'X-Store-Slug': slug }
}

/** Wrapper around fetch that attaches X-Store-Slug when appropriate */
export async function storeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
  const headers = getStoreHeaders()
  if (Object.keys(headers).length === 0) return fetch(input, init)
  // Only attach if this looks like a store-scoped call
  if (!shouldAttachStoreHeader(url) && !url.includes(API_URL)) return fetch(input, init)
  // shouldAttachStoreHeader checks for /stores/ pattern; for API_URL-prefixed URLs we check as well
  const isStoreListing = url === `${API_URL}/stores` || url.startsWith(`${API_URL}/stores?`) || url === '/stores' || url.startsWith('/stores?')
  if (isStoreListing) return fetch(input, init)
  const mergedHeaders = { ...(init?.headers as Record<string, string> || {}), ...headers }
  return fetch(input, { ...init, headers: mergedHeaders })
}
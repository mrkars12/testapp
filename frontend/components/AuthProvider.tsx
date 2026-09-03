'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  startTransition
} from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { dispatchSessionExpired  } from '@/lib/api'
import { useDevicesStore } from '@/lib/device'
import Cookies from 'js-cookie'
import { getHardwareFingerprint } from '@/lib/fingerprint'
import { useAuthState } from '@/lib/authState'
import { AUTH_TAB_ID } from '@/lib/auth-tab-id'
import { authedHome, resetStoreBootstrap } from '@/lib/storeBootstrap'
import { socket } from '@/lib/socket'
import { useIdleLogout } from '@/lib/useIdleLogout'  // ← أضف
import { flushSync }
from 'react-dom'
// --- Interfaces ---
interface User {
  id: string; // 🚩 يفضل جعله string دائماً لأن NestJS يرسله كـ String للتعامل مع BigInt
  fullname: string | null;
  email: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  two_factor_enabled?: boolean;
  email_verified_at: string | null;
  accounttype: 'individual' | 'business';
  /** false for a social-login account that never set a password (Part 10) — used by the
   *  first-store/onboarding form to decide whether to also collect a password. */
  has_password?: boolean;
}

interface AuthData {
  authenticated: boolean;
  user: User | null;
  otp_state?: any;
  session_id?: string;
  device_id?: string;
  access_token?: string; // أضفنا التوكن هنا
}

interface AuthContextType {
  user: User | null;
  otpState: any;
  isLoading: boolean;
  authData?: AuthData;
  isAuthenticated: boolean;
  isSessionReady: boolean;
  login: (email: string, password: string, captchaToken?: string | null, timezone?: string, fingerprint?: string, hardwareFingerprint?: string) => Promise<any>;
  /** The ONE logout. No args — an explicit logout always lands on a clean
   *  `/login` (no `intended`) and resets per-user client state. */
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
  register: (formData: any, flowToken?: string | null, flowSignature?: string | null) => Promise<any>;
}

// --- Helpers ---
function clearClientCookies() {
  const cookiesToRemove = ['access_token'];
  cookiesToRemove.forEach(name => {
    Cookies.remove(name, { path: '/', domain: window.location.hostname });
    Cookies.remove(name, { path: '/' });
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  });
}

function hasAuthCookie() {
  if (typeof window === 'undefined') return false;
  // التحقق من وجود التوكن أو الكوكي الأساسي لنيست
  return document.cookie.includes('access_token');
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname();
  const queryClient = useQueryClient()
  const isLoggingOutRef = useRef(false)
  const [isSessionReady, setIsSessionReady] = useState(false)
  const { status } = useAuthState()
  const isLoggingOut =

  status ===
  'logging_out'
  const lastActivityRef =
  useRef(Date.now())
// AuthProvider.tsx



// The PUBLIC customer storefront lives at `/stores/[slug]` (plural) — a
// distinct, unauthenticated route tree from the merchant admin at
// `/store/[storeSlug]` (singular), which is fully protected. This used to
// check the `/store` prefix, from when the bare `/store/[slug]` WAS the
// public storefront; since the route-split it silently matched the entire
// protected merchant dashboard instead, disabling idle-timeout logout for
// every merchant page — the opposite of what it was meant to do.
const isPublicStorePage = pathname?.startsWith('/stores/');

// 2. تفعيل خطاف الخمول فقط إذا كان مسجل الدخول، ولم يكن في صفحة المتجر العامة
useIdleLogout(status === 'authenticated' && !isPublicStorePage);


// ✅ إضافة isFetching
const { data: authData, isLoading } =
  useQuery<AuthData>({
  queryKey: ['auth-user'],
  queryFn: async () => {

  try {

    const res =
      await api.get('/auth/me')

    return res.data

  } catch (err: any) {

    // ✅ المستخدم Guest
    if (
    err?.response?.status === 401
  ) {

    return {

      authenticated: false,

      user: null
    }
  }

    throw err
  }
},
  enabled: true,
  
  staleTime: 1000 * 60,

  refetchOnWindowFocus: false,

  refetchOnMount: true,

  retry: false,

  refetchOnReconnect: false
});

// مزامنة حالة Zustand مع نتائج React Query فوراً
useEffect(() => {

  const authState =
    useAuthState.getState()

  if (
    authState.status ===
    'logging_out'
  ) {
    return
  }

  if (
    !isLoading &&
    authData
  ) {

    if (
      authData.authenticated
    ) {

      authState.setStatus(
        'authenticated'
      )

      authState.setSession(
        authData.session_id ||
        'active'
      )

      queryClient.cancelQueries()

    } else {

      authState.setStatus(
        'unauthenticated'
      )
    }

    setIsSessionReady(
      true
    )
  }

}, [isLoading, authData])

useEffect(() => {

  const clear = () => {

    queryClient.cancelQueries()

    queryClient.removeQueries({
  queryKey: ['auth-user']
})
  }

  window.addEventListener(
    'auth:clear_cache',
    clear
  )

  return () => {

    window.removeEventListener(
      'auth:clear_cache',
      clear
    )
  }

}, [queryClient])

  const isAuthenticated = authData?.authenticated ?? false;
  const user = authData?.user
  ? {
      ...authData.user,
      email_verified_at:
        authData.user.email_verified_at ?? null
    }
  : null

  useEffect(() => {
    if (!isLoading && authData) {
      setIsSessionReady(true);
    }
  }, [isLoading, authData]);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      if (res.data) {
        queryClient.setQueryData(['auth-user'], res.data);
        return res.data.user;
      }
      return null;
    } catch (error) {
      queryClient.setQueryData(['auth-user'], { authenticated: false, user: null });
      return null;
    }
  }, [queryClient]);

  // src/components/AuthProvider.tsx

// داخل دالة logout في AuthProvider.tsx



const logout = useCallback(async () => {
  /**
   * =================================
   * ✅ منع تكرار الخروج
   * =================================
   */
  if (isLoggingOutRef.current) {
    return
  }

  isLoggingOutRef.current = true

  const authState = useAuthState.getState()

  /**
   * An explicit logout is an ACCOUNT BOUNDARY. We do NOT carry the current
   * path forward as `intended` — the next person to log in here may be a
   * different user, and "resume where User A was" must never leak into
   * User B's session (a foreign `/store/<A>` deep link, a stale
   * `originalStore`, etc). Post-logout state is deliberately clean:
   * `/login`, no query, and the shared store bootstrap wiped.
   */

  flushSync(() => {
    authState.setSession(null)
  })

  /**
   * =================================
   * ✅ تنظيف React Query + store context
   * =================================
   */
  try {
    await queryClient.cancelQueries()

    queryClient.setQueryData(
      ['auth-user'],
      {
        authenticated: false,
        user: null
      }
    )

  } catch {}

  // Wipe the previous user's store list / original-store so it can never
  // resolve a destination for whoever logs in next.
  resetStoreBootstrap()

  /**
   * =================================
   * ✅ تنظيف السوكت
   * =================================
   */
  try {
    socket.off('force_logout')
    socket.off('device_logged_in')
    socket.off('device_logged_out')
    socket.off('devices_updated')

    socket.disconnect()

    socket.roomsJoined = false
  } catch {}

  /**
   * =================================
   * ✅ تنظيف الذاكرة المؤقتة فقط
   * =================================
   */
  try {
    delete (window as any).__OAUTH_SECURE_DATA__

    sessionStorage.removeItem('oauth_msg')
  } catch {}

  /**
   * =================================
   * ✅ حذف الكوكيز المحلية
   * =================================
   */
  try {
    clearClientCookies()
  } catch {}


  /**
    * =================================
    * ✅ بث الخروج للتابات الأخرى
    * =================================
    */
  try {
    const bc = new BroadcastChannel(
      'auth_sync_channel'
    )

    bc.postMessage({
      type: 'AUTH_LOGOUT_EVENT'
    })

    bc.close()
  } catch {}

  /**
    * =================================
    * ✅ طلب logout من السيرفر
    * =================================
    */
  try {
    await fetch(
      `${
        process.env.NEXT_PUBLIC_API_URL ||
        'http://localhost:7777/api'
      }/auth/logout`,
      {
        method: 'POST',
        credentials: 'include',
        // The backend's cookie-CSRF guard (common/csrf-protection.middleware.ts)
        // 403s any authenticated POST whose Content-Type isn't
        // application/json. A bodyless fetch sends no Content-Type, so this
        // request was being rejected and the server session cookie never
        // cleared — logout was cosmetic (client state only).
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    )
  } catch {}

  /**
   * =================================
   * ✅ Redirect ناعم بدون تجميد
   * =================================
   */
  startTransition(() => {
    router.replace('/login')
  })

  /**
   * =================================
   * ✅ فتح إمكانية logout مرة أخرى
   * =================================
   */
  setTimeout(() => {
    isLoggingOutRef.current = false
  }, 1500)

}, [queryClient, router])


const loginMutation = useMutation({

  mutationFn: async (vars: any) => {

    /**
     * ✅ remove auth cache
     */


    /**
     * ✅ login request
     */
    const { data } =
      await api.post(

        '/auth/login',

        vars
      )

    return data
  }
})


const login = async (
  email: string,
  password: string,
  captchaToken?: string | null,
  fingerprint?: string
) => {

  const result = await loginMutation.mutateAsync({
    email,
    password,
    cf_turnstile_token: captchaToken,
    fingerprint
  })

  // إذا تم تسجيل الدخول فعلاً
  if (
    result?.authenticated ||
    result?.success
  ) {

    // اسحب المستخدم الحقيقي بعد حفظ الكوكي
    const { data } = await api.get('/auth/me')

    // ACCOUNT BOUNDARY: if this login is a DIFFERENT user than whatever
    // was last cached in this tab (a re-login without an intervening
    // logout, e.g. session expiry then straight back in as someone else),
    // drop the previous user's store list before anything routes off it.
    const prevUserId =
      queryClient.getQueryData<AuthData>(['auth-user'])?.user?.id ?? null
    if (prevUserId && String(prevUserId) !== String(data?.user?.id ?? '')) {
      resetStoreBootstrap()
    }

    queryClient.setQueryData(
      ['auth-user'],
      data
    )

    useAuthState.getState().setStatus(
      'authenticated'
    )

    useAuthState.getState().setSession(
      data.session_id
    )

    // Navigation is the CALLER's job (LoginClient's `handleAuthSuccess`,
    // which resolves zero/one/multi-store via `resolvePostAuthTarget()`)
    // — this used to `router.replace('/dashboard')` right here, which fired
    // before that resolution even started, so every login flashed
    // `/dashboard` and then hopped again once the real target resolved.
  }

  return result
}

  // AuthProvider.tsx
const register = async (formData: any, flowToken?: string | null, flowSignature?: string | null) => {
  const res = await api.post('/auth/register/complete', formData, {
    headers: { 'X-Register-Flow': flowToken, 'X-Register-Signature': flowSignature }
  });
  
  // تأكد من إرجاع البيانات لكي يراها الـ onSubmit
  return res.data; 
}

  /**
   * =================================
   * ✅ Sync Listeners
   * =================================
   */
/**
   * =================================
   * 📡 مستمع الـ BroadcastChannel الموحد (مزامنة التابات المنسوخة)
   * =================================
   */
  useEffect(() => {
    const authChannel = new BroadcastChannel('auth_sync_channel')

    authChannel.onmessage = async (event) => {
      const data = event.data
      const authState = useAuthState.getState()


      if (data?.type === 'AUTH_LOGIN_SYNC') {

        // BroadcastChannel delivers to other channel objects in the SAME
        // tab too. The tab that just logged in already navigated itself
        // (LoginClient.handleAuthSuccess / RegisterStep2Client /
        // OAuthSuccessClient); if this handler also runs here it fires a
        // second, delayed `router.replace` that lands after the user has
        // moved on to the chooser or a store and bounces them back to
        // `/select-store`. Ignore our own broadcast; real cross-tab sync
        // carries a different `senderId`.
        if (data.senderId && data.senderId === AUTH_TAB_ID) return

        /**
         * =================================
         * ✅ تنظيف flows القديمة
         * =================================
         */
        if (data.clearAuthFlows) {

          delete (window as any).__OAUTH_SECURE_DATA__

          sessionStorage.removeItem(
            'oauth_msg'
          )
        }

        // ACCOUNT BOUNDARY: another tab logged in. If it is a DIFFERENT
        // user than this tab currently has cached, wipe this tab's
        // per-user routing state (store list / original store) so the
        // destination is resolved purely from the new identity.
        const prevAuth = queryClient.getQueryData<AuthData>(['auth-user'])
        const prevUserId = prevAuth?.user?.id ?? null
        const nextUserId = data.userPayload?.user?.id ?? null
        if (prevUserId && nextUserId && String(prevUserId) !== String(nextUserId)) {
          resetStoreBootstrap()
        }

        /**
         * =================================
         * ✅ تحديث auth state أولاً
         * =================================
         */
        authState.setSession(
          data.userPayload?.session_id || null
        )

        authState.setStatus(
          'authenticated'
        )

        /**
         * =================================
         * ✅ حقن أولي سريع
         * =================================
         *
         * Non-downgrading merge: the cross-tab payload can be the thin
         * login-response `user`. Never let a known `email_verified_at`
         * (from an earlier `/auth/me` in this tab) regress to null, or
         * this tab briefly treats a verified account as unverified.
         */
        queryClient.setQueryData<AuthData>(
          ['auth-user'],
          (prev) => {
            const prevUser = prev?.user ?? null
            const incoming = data.userPayload?.user ?? null
            const nextUser = { ...(prevUser ?? {}), ...(incoming ?? {}) } as User
            if (nextUser.email_verified_at == null && prevUser?.email_verified_at != null) {
              nextUser.email_verified_at = prevUser.email_verified_at
            }
            return {
              authenticated: true,
              user: nextUser,
              session_id: data.userPayload?.session_id ?? prev?.session_id ?? undefined,
            }
          }
        )

        /**
         * =================================
         * ✅ الأهم: اسحب user الحقيقي من السيرفر
         * =================================
         */
        try {

          const freshMe =
            await api.get('/auth/me')

          if (freshMe.data?.authenticated) {

            queryClient.setQueryData(
              ['auth-user'],
              freshMe.data
            )
          }

        } catch (err) {

          console.log(
            'AUTH SYNC REFRESH FAILED',
            err
          )
        }

        /**
         * =================================
         * ✅ target
         * =================================
         */
        // Cross-tab: another tab just logged in. `authedHome` is the ONE
        // resolver — it validates the intended path (safe, not an auth
        // route, owned store) and otherwise runs account-switch resolution
        // (chooser allowed). No local re-checking of the path here.
        const target = await authedHome('account-switch', data.intendedPath)

        /**
         * =================================
         * ✅ redirect فقط من الصفحات العامة
         * =================================
         *
         * Read the LIVE pathname, not the `pathname` captured when this
         * effect last ran: this handler is async (`await /auth/me`), so a
         * stale closure could still say "/login" after the user has
         * already navigated into the app — and then this would drag them
         * back out to the chooser.
         */
        const livePath =
          typeof window !== 'undefined' ? window.location.pathname : pathname
        const isPublicPage =
          livePath === '/' ||
          livePath.startsWith('/login') ||
          livePath.startsWith('/register')

        if (isPublicPage && livePath + window.location.search !== target) {

          startTransition(() => {

            router.replace(target)

          })
        }
      }

      
      if (data?.type === 'AUTH_LOGOUT_EVENT') {

        /**
         * =================================
         * ✅ منع OTP/Login sync القديم
         * =================================
         */
        sessionStorage.removeItem(
          'AUTH_LOGIN_SYNCING'
        )

        /**
         * =================================
         * ✅ تنظيف auth state بدون freeze
         * =================================
         */
        authState.setSession(null)

        authState.setStatus(
          'unauthenticated'
        )

        /**
         * =================================
         * ✅ تنظيف React Query بدون removeQueries
         * =================================
         */
        await queryClient.cancelQueries({
          queryKey: ['auth-user']
        })

        queryClient.setQueryData(
          ['auth-user'],
          {
            authenticated: false,
            user: null,
            session_id: null
          }
        )

        /**
          * =================================
          * ✅ تنظيف listeners فقط
          * =================================
          */
        socket.off('force_logout')
        socket.off('device_logged_in')
        socket.off('device_logged_out')
        socket.off('devices_updated')

        /**
         * =================================
         * ✅ disconnect ناعم
         * =================================
         */
        if (socket.connected) {
          socket.disconnect()
        }

        socket.roomsJoined = false

        /**
         * =================================
         * ✅ تنظيف flows المؤقتة
         * =================================
         */
        delete (window as any).__OAUTH_SECURE_DATA__

        sessionStorage.removeItem(
          'oauth_msg'
        )

        // ACCOUNT BOUNDARY (see `logout` above): wipe this tab's per-user
        // store state and go to a clean `/login` with no `intended`.
        resetStoreBootstrap()

        requestAnimationFrame(() => {
          startTransition(() => {
            router.replace('/login')
          })
        })
      }

      if (data?.type === 'AUTH_FORCE_LOGOUT_SYNC') {

        flushSync(() => {
          authState.setSession(null)
        })

        socket.off('force_logout')
        socket.off('device_logged_out')
        socket.off('device_logged_in')
        socket.off('devices_updated')
        socket.disconnect()
        socket.roomsJoined = false

        resetStoreBootstrap()

        if (typeof window !== 'undefined') {
          router.replace('/login')
        }
      }
    }

    return () => {
      authChannel.close()
    }
  }, [pathname, router, queryClient])


 useEffect(() => {

    const handleDeviceLogout = (
  data: any
    ) => {

      console.log(
        'REALTIME EVENT:',
        data
      )

      if (!data?.deviceId)
        return

      const store =
        useDevicesStore.getState()

      store.markDeviceLoggedOut(
        String(data.deviceId)
      )

      /**
       * ✅ sync server state
       */
      store.fetchDevices()
    }

    socket.on(

      'device_logged_out',

      handleDeviceLogout
    )

    return () => {

      socket.off(

        'device_logged_out',

        handleDeviceLogout
      )
    }

  }, [])

  /**
   * =================================
   * ✅ auth socket
   * =================================
   */

 /**
   * =================================
   * ✅ المستمع الموحد للـ BroadcastChannel (استقبال الطرد في التابات المنسوخة)
   * =================================
   */


  /**
   * =================================
   * 🚨 مستمع الطرد الرئيسي (التقاط موجة السوكت في التابة النشطة)
   * =================================
   */
  useEffect(() => {
    const authState = useAuthState.getState();
    if (status !== 'authenticated' || !user?.id) {
      if (socket.connected) {
  socket.off('force_logout')
  socket.off('device_logged_in')
  socket.off('device_logged_out')
  socket.off('devices_updated')

  socket.disconnect()

  socket.roomsJoined = false
}
      return;
    }

    let isCancelled = false;
    let localDeviceId: string | null = null; 

    const connectSocket = async () => {
      try {
        const fp = await getHardwareFingerprint();
        if (isCancelled) return;

        const { data } = await api.get('/devices/current', {
          headers: { 'X-Device-Fingerprint': fp, 'x-device-fingerprint': fp }
        });

        if (isCancelled) return;
        if (!data?.device?.id) return;

        localDeviceId = String(data.device.id).trim();
        if (socket.roomsJoined && socket.connected) return;

        if (!socket.connected) {
          socket.connect();
        }

        const authenticate = () => {
          socket.off('socket_authenticated');
          socket.once('socket_authenticated', () => {
            socket.roomsJoined = true;
            socket.emit('device_ready', {
              userId: String(user.id),
              deviceId: String(localDeviceId)
            });
          });

          socket.emit('auth', {
            userId: String(user.id),
            deviceId: String(localDeviceId)
          });
        };

        if (socket.connected) {
          authenticate();
        } else {
          socket.once('connect', authenticate);
        }

      } catch (err) {
        console.log('SOCKET CONNECT ERROR:', err);
      }
    };

    connectSocket();

    const handleForceLogout = async (eventData: any) => {
      console.log('📢 [REALTIME] force_logout packet received:', eventData);
     

      const myDeviceId = String(localDeviceId || authData?.device_id || '').trim();
      const targetDeviceId = String(eventData?.deviceId || '').trim();

      if (targetDeviceId && myDeviceId && targetDeviceId !== myDeviceId) {
        return; 
      }

      // 1. تثبيت وتطهير المسار المقصود فوراً في متغير معزول
      let rawIntendedPath =

        window.location.pathname +

        window.location.search

      if (

        !rawIntendedPath ||

        rawIntendedPath.startsWith('/login') ||

        rawIntendedPath.startsWith('/register')
      ) {

        rawIntendedPath = '/verify-email'
      }
   
      // تجهيز الرابط النهائي الموحد للتابتين
      const finalTarget = `/login?intended=${encodeURIComponent(rawIntendedPath)}`;

      // 2. قفل واجهة التابة الحالية فوراً بغطاء الـ Loading لمنع الـ Re-renders
      flushSync(() => {
        authState.setSession(null)
      });

      // 3. 🚀 بث المسار المطهر فوراً للتابات المنسوخة عبر الـ BroadcastChannel
      const bc = new BroadcastChannel('auth_sync_channel');
      bc.postMessage({
        type: 'AUTH_FORCE_LOGOUT_SYNC',
        intendedPath: rawIntendedPath 
      });
      bc.close();

      // 4. تدمير كوكيز السيرفر صامتاً
      try {
        await api.post('/auth/force-clear-cookie', {}, { withCredentials: true });
      } catch (err) {
        console.error('❌ Failed to clear cookie:', err);
      }

      // 5. تنظيف السوكتس والمستمعات
      socket.off('force_logout');
      socket.off('device_logged_in');
      socket.off('device_logged_out');
      socket.off('devices_updated');
      socket.disconnect();
      socket.roomsJoined = false;

      // 6. 🔥 [الضربة القاضية]: القذف الفوري بالمتصفح للتابة الأصلية باستخدام الرابط المحفوظ المعزول
      // قبل ما نلمس كاش الـ React Query لتجنب تدمير الـ useEffect وموت المتغيرات
      if (typeof window !== 'undefined') {
        // نغير الحالة بصمت تام ثانية قبل الريفرش لضمان قفل جدار الحماية
        
        // قذف صلب وفوري
        router.replace(finalTarget);
      }
    };

    const lastFetchTimeRef = { current: 0 };
    const handleRefreshDevices = async () => {
      const now = Date.now();
      if (now - lastFetchTimeRef.current < 3000) return;
      lastFetchTimeRef.current = now;
      const store = useDevicesStore.getState();
      await store.fetchDevices();
    };

    const handleDeviceLogin = async (loginData: any) => {
      await handleRefreshDevices();
    };

    socket.off('force_logout');
    socket.on('force_logout', handleForceLogout);

    socket.off('device_logged_in');
    socket.on('device_logged_in', handleDeviceLogin);

    socket.off('devices_updated');
    socket.on('devices_updated', handleRefreshDevices);

    return () => {
      isCancelled = true;
      socket.off('force_logout', handleForceLogout);
      socket.off('device_logged_in', handleDeviceLogin);
      socket.off('devices_updated', handleRefreshDevices);
    };
  }, [user?.id, status, authData?.device_id, queryClient]);



useEffect(() => {

  const handleSPALogout = (
  event: any
  ) => {

    const authState =
      useAuthState.getState()

    const intendedPath =
      event.detail?.intendedPath ||
      '/verify-email'

    const targetUrl =
      event.detail?.url ||
      '/login'

    let finalRedirectUrl =
      `${targetUrl}?intended=${encodeURIComponent(intendedPath)}`

    if (event.detail?.isTimeout) {

      finalRedirectUrl +=
        '&reason=timeout'
    }

    /**
     * ✅ lock ui
     */
    flushSync(() => {

      authState.setSession(null)

    })

    /**
     * ✅ clear auth cache only
     */
    queryClient.setQueryData(

      ['auth-user'],

      {

        authenticated: false,

        user: null
      }
    )

    /**
     * ✅ cleanup socket
     */
    socket.removeAllListeners()

    socket.disconnect()

    socket.roomsJoined = false

    /**
     * ✅ IMPORTANT
     * SPA redirect safely
     */
    requestAnimationFrame(() => {

      setTimeout(() => {

        router.replace(
          finalRedirectUrl
        )

      }, 80)

    })
  }

  window.addEventListener(
    'spa_logout',
    handleSPALogout
  )

  return () => {

    window.removeEventListener(
      'spa_logout',
      handleSPALogout
    )
  }

}, [queryClient, router])


useEffect(() => {

  const refreshDevices =
    async () => {

      const store =
        useDevicesStore.getState()

      await store.fetchDevices()
    }

  socket.on(
    'devices_updated',
    refreshDevices
  )

  return () => {

    socket.off(
      'devices_updated',
      refreshDevices
    )
  }

}, [])

useEffect(() => {
  const handleSessionExpired = async (e: Event) => {

    const authState = useAuthState.getState()
    if (
      authState.status === 'logging_out' ||
      authState.status === 'unauthenticated'
    ) return

    const reason = (e as CustomEvent).detail?.reason || 'session_expired'
    const isTimeout = reason === 'idle_timeout'

    // A LONE 401 from a background API call (notifications / balance /
    // devices / an /auth/me race) is not proof the session died. Re-verify
    // against /auth/me before tearing anything down; if it still says
    // authenticated, the 401 was transient — do nothing. An explicit idle
    // timeout is trusted and skips this check.
    if (!isTimeout) {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/auth/me`,
          { credentials: 'include' },
        )
        if (res.ok) {
          const d = await res.json().catch(() => null)
          if (d?.authenticated) {
            queryClient.setQueryData(['auth-user'], d)
            return
          }
        }
      } catch {
        // network error re-verifying — fall through to logout (safer).
      }
    }

    const intendedPath = window.location.pathname + window.location.search

    // ✅ قفل فوري
    flushSync(() => {
  authState.setStatus('logging_out')
  authState.setSession(null)
})

    // ✅ مسح الكاش والسوكت
    queryClient.setQueryData(['auth-user'], { authenticated: false, user: null })
    socket.off('force_logout')
socket.off('device_logged_in')
socket.off('device_logged_out')
socket.off('devices_updated')
    socket.disconnect()
    socket.roomsJoined = false

    try {
  await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/auth/logout`,
    {
      method: 'POST',
      credentials: 'include',
      // Must send application/json or the backend cookie-CSRF guard 403s
      // this authenticated POST and the session cookie is never cleared.
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }
  )
} catch {}

    await queryClient.cancelQueries()

queryClient.clear()

// Confirmed-dead session is an identity boundary too — clear per-user
// store state so a different user logging in here resolves from scratch.
resetStoreBootstrap()

clearClientCookies()

    // ✅ إبلاغ التابات
    try {
      const bc = new BroadcastChannel('auth_sync_channel')
      bc.postMessage({ type: 'AUTH_LOGOUT_EVENT', intendedPath })
      bc.close()
    } catch {}

    // Soft navigation via the app router (not `window.location.replace`):
    // the cache/socket/cookies were already torn down above, so a hard
    // page reload buys nothing and only makes the transition janky. Keep
    // `reason=timeout` so `middleware.ts` / `PublicAuthGuard` don't bounce
    // the fresh `/login` back.
    startTransition(() => {
      router.replace(
        `/login?reason=timeout&intended=${encodeURIComponent(intendedPath)}`,
      )
    })
  }

  window.addEventListener('auth:session_expired', handleSessionExpired)
  return () => window.removeEventListener('auth:session_expired', handleSessionExpired)
}, [queryClient, router])

  return (
    <AuthContext.Provider value={{
      user,
      otpState: authData?.otp_state,
      isLoading,
      isAuthenticated,
      isSessionReady,
      login,
      logout,
      refreshUser,
      register,
      authData
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
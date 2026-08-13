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
import { socket } from '@/lib/socket'
import { authChannel }
from '@/lib/auth-channel'
import { useIdleLogout } from '@/lib/useIdleLogout'  // ← أضف
import { flushSync }
from 'react-dom'
// --- Interfaces ---
interface User {
  id: string; // 🚩 يفضل جعله string دائماً لأن NestJS يرسله كـ String للتعامل مع BigInt
  fullname: string | null;
  email: string;
  username: string;
  two_factor_enabled?: boolean;
  email_verified_at: string | null;
  accounttype: 'individual' | 'business';
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
  logout: (isForce?: boolean, intendedPath?: string) => Promise<void>;
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



const isPublicStorePage = pathname?.startsWith('/store');

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
   * =================================
   * ✅ حفظ المسار الحالي
   * =================================
   */
  let intended =
    window.location.pathname +
    window.location.search

  if (
    intended.startsWith('/login') ||
    intended.startsWith('/register')
  ) {
    intended = '/dashboard'
  }

  /**
   * =================================
   * ✅ تحويل الحالة فوراً لزائر
   * =================================
   */
  flushSync(() => {
    authState.setSession(null)
  })

  /**
   * =================================
   * ✅ تنظيف React Query
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
      type: 'AUTH_LOGOUT_EVENT',
      intendedPath: intended
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
        credentials: 'include'
      }
    )
  } catch {}

  /**
   * =================================
   * ✅ Redirect ناعم بدون تجميد
   * =================================
   */
  startTransition(() => {
    router.replace(
      `/login?intended=${encodeURIComponent(
        intended
      )}`
    )
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

    router.replace('/dashboard')
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
         */
        queryClient.setQueryData(
          ['auth-user'],
          {
            authenticated: true,
            user: data.userPayload.user,
            session_id: data.userPayload.session_id
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
        let target =
          data.intendedPath ||
          '/dashboard'

        if (
          target === '/' ||
          target.includes('/login')
        ) {
          target = '/dashboard'
        }

        /**
         * =================================
         * ✅ redirect فقط من الصفحات العامة
         * =================================
         */
        const isPublicPage =
          pathname === '/' ||
          pathname.startsWith('/login') ||
          pathname.startsWith('/register')

        if (isPublicPage) {

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

        /**
         * =================================
         * ✅ intended path
         * =================================
         */
        let cleanPath =
          data.intendedPath || '/dashboard'

        if (
          cleanPath.startsWith('/login') ||
          cleanPath.startsWith('/register')
        ) {
          cleanPath = '/dashboard'
        }

        const finalRedirectTarget =
          `/login?intended=${encodeURIComponent(
            cleanPath
          )}`

        /**
         * =================================
         * ✅ منع تجمد التابة
         * =================================
         */
        requestAnimationFrame(() => {

          startTransition(() => {

            router.replace(
              finalRedirectTarget
            )

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

        const currentPath =

          window.location.pathname +

          window.location.search

        let cleanPath =

          currentPath ||

          '/dashboard'

        if (

          cleanPath.startsWith('/login') ||

          cleanPath.startsWith('/register') ||

          cleanPath.includes('redirect') ||

          cleanPath === '/'
        ) {

          cleanPath = '/dashboard'
        }

        const finalRedirectTarget =

          `/login?intended=${encodeURIComponent(cleanPath)}`

        if (typeof window !== 'undefined') {
          // 🔥 [الضربة القاضية]: تحويل صلب لتطهير الميموري والتابات الميتة
          router.replace(finalRedirectTarget);

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

        rawIntendedPath = '/dashboard'
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
      '/dashboard'

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
      credentials: 'include'
    }
  )
} catch {}

    await queryClient.cancelQueries()

queryClient.clear()

clearClientCookies()

    // ✅ إبلاغ التابات
    try {
      const bc = new BroadcastChannel('auth_sync_channel')
      bc.postMessage({ type: 'AUTH_LOGOUT_EVENT', intendedPath })
      bc.close()
    } catch {}

    // ✅ redirect فوري بدون requestAnimationFrame
    const reasonParam = isTimeout ? '&reason=timeout' : ''
    // router.replace(
    //   `/login?intended=${encodeURIComponent(intendedPath)}${reasonParam}`
    // )

    window.location.replace(
      `/login?reason=timeout&intended=${encodeURIComponent(intendedPath)}`
    )
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
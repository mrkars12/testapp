'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { useDevicesStore } from "@/lib/device"
import { useBalanceStore } from '@/components/balanceStore'
import { useNotificationStore } from '@/components/notificationStore'
import { toast } from 'react-hot-toast'
import api from '@/lib/api'
import { getHardwareFingerprint } from '@/lib/fingerprint'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthState } from '@/lib/authState'

// 🔌 global closer
let globalSocketCloser: (() => void) | null = null

export function forceCloseSocket() {
  if (globalSocketCloser) {
    globalSocketCloser();
    console.log("✅ Socket closed via global closer");
  }
}

export default function Go() {
  const { user, logout, isAuthenticated, isSessionReady } = useAuth()
  const socketRef = useRef<WebSocket | null>(null)
  const isForceLogoutRef = useRef(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    globalSocketCloser = () => {
      if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.close()
        socketRef.current = null
      }
    }

    const { status } = useAuthState.getState()

    // 🛑 شروط إيقاف
    if (
      !user?.id ||
      !isAuthenticated ||
      !isSessionReady ||
      status === 'logging_out'
    ) {
      globalSocketCloser()
      return
    }

    // 🔐 لازم الإيميل يكون متفعل
    if (!user?.email_verified_at) {
      globalSocketCloser()
      return
    }

    const init = async () => {
      try {
        await getHardwareFingerprint()

        const res = await api.get('/api/auth/socket-ticket', {
          headers: { 'X-Skip-Interceptor': 'true' }
        })

        if (!res?.data?.ticket) return

        const socket = new WebSocket(`ws://localhost:8080/ws?ticket=${res.data.ticket}`)
        socketRef.current = socket

        // 🔌 on close
        socket.onclose = () => {
          if (isForceLogoutRef.current) return
          console.log('socket closed (ignored)')
        }

        // 📩 on message
        socket.onmessage = (e) => {
          const { status } = useAuthState.getState()
          if (status === 'logging_out') return

          try {
            const msg = JSON.parse(e.data)
            const eventType = msg.event
            const isVisible = document.visibilityState === 'visible'

            switch (eventType) {

              // 💰 تحديث الرصيد
              case 'balance.updated': {
  const balance = msg.data.balance
  const currency = msg.data.currency

  // ✅ تحديث التاب الحالية
  useBalanceStore.getState().updateBalance(balance, currency)

  // 🔥🔥🔥 أهم إضافة: broadcast لكل التابات
  const bc = new BroadcastChannel('balance_channel')

  bc.postMessage({
    type: 'BALANCE_SYNC',
    balance,
    currency
  })

  bc.close()

  break
}

              // 🔔 إشعار جديد
              case 'notification.new': {
  const notification = msg.data?.notification || msg.data
  if (!notification) break

  useNotificationStore.getState().addNotification(notification)

  const bc = new BroadcastChannel('notifications_channel')
  bc.postMessage({ type: 'NOTIFICATION_SOUND' })
  bc.close()

  break
}

              // 📱 تحديث الأجهزة
              case 'device.updated':
              case 'device.verified':
              case 'device.added':
                useDevicesStore.getState().fetchDevices()
                break

              case 'device.logout': {
                const deviceId = msg.data?.device_id
                const targetSession = msg.data?.target_session_id

                // ⚡ تحديث فوري (Optimistic) لكي يشعر المستخدم بالسرعة
                if (deviceId) {
                  useDevicesStore.setState((state: any) => ({
                    devices: state.devices.map((d: any) =>
                      d.id == deviceId
                        ? { ...d, logged_out_at: new Date().toISOString(), is_current: false }
                        : d
                    )
                  }))
                }

                // التحقق مما إذا كان هذا المتصفح هو المقصود بالخروج
                const userData: any = queryClient.getQueryData(['auth-user'])
                const currentSess = userData?.session_id

                if (targetSession && currentSess && targetSession === currentSess) {
                  const currentPath = window.location.pathname + window.location.search
                  const bc = new BroadcastChannel('auth_sync_channel')
                  bc.postMessage({ type: 'AUTH_LOGOUT_EVENT', intendedPath: currentPath })
                  bc.close()
                  
                  isForceLogoutRef.current = true
                  logout(true, currentPath)
                }

                // إعادة الجلب من السيرفر للتأكيد بعد فترة قصيرة
                setTimeout(() => {
                  useDevicesStore.getState().fetchDevices()
                }, 500)
                break
              }

              case 'force.logout': {
                const userData: any = queryClient.getQueryData(['auth-user'])
                const currentSess = userData?.session_id

                if (msg.data?.target_session_id === currentSess) {
                  const currentPath = window.location.pathname + window.location.search
                  const bc = new BroadcastChannel('auth_sync_channel')
                  bc.postMessage({ type: 'AUTH_LOGOUT_EVENT', intendedPath: currentPath })
                  bc.close()
                  isForceLogoutRef.current = true
                  logout(true, currentPath)
                }
                break
              }
            }

          } catch (err) {
            console.error("❌ Error parsing socket message:", err)
          }
        }

      } catch (e: any) {
        if (e?.response?.status === 403) return
        if (e?.response?.status === 401) return

        console.error('Socket init error', e)
      }
    }

    init()

    return () => globalSocketCloser?.()
  }, [user?.id, user?.email_verified_at, isAuthenticated, isSessionReady])

  return null
}
import { create } from 'zustand'
import api from '@/lib/api'
import { useAuthState } from '@/lib/authState'

const bc =
  typeof window !== 'undefined'
    ? new BroadcastChannel('notifications_channel')
    : null

let marking = false

interface Notification {
  id: number
  title: string
  message: string
  read_at: string | null
  created_at: string
  __from_bc?: boolean
}

interface Pagination {
  current_page: number
  last_page: number
  total: number
}

interface State {
  latest: Notification[]
  all: Notification[]
  unreadCount: number
  loading: boolean
  pagination: Pagination | null

  fetchPage: (page?: number) => Promise<void>
  fetchLatest: () => Promise<void>

  addNotification: (n: Notification) => void

  markAsRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
}

export const useNotificationStore = create<State>((set, get) => ({
  latest: [],
  all: [],
  unreadCount: 0,
  loading: false,
  pagination: null,

  // 🔹 fetch صفحة الإشعارات (pagination)
  fetchPage: async (page = 1) => {
    set({ loading: true })

    try {

      const authState =
        useAuthState.getState()

      if (
        authState.status !==
        'authenticated'
      ) {
        return
      }

      const { data } = await api.get(`/api/notifications?page=${page}`)

      set({
        all: data.notifications.data || [],
        pagination: {
          current_page: data.notifications.current_page,
          last_page: data.notifications.last_page,
          total: data.notifications.total
        },
        unreadCount: data.unread_count
      })

    } catch (e) {
      console.error('fetchPage error:', e)
    } finally {
      set({ loading: false })
    }
  },

  fetchLatest: async () => {

  const authState =

    useAuthState.getState()

  if (

    authState.status !==
    'authenticated'
  ) {

    return
  }

  try {

    const res =
      await api.get(

        '/notifications?limit=5'
      )

    if (!res?.data)
      return

    set({

      latest:
        res.data.notifications || [],

      unreadCount:
        res.data.unread_count || 0
    })

  } catch (e: any) {

    if (
      e?.response?.status !== 401
    ) {

      console.error(
        'fetchLatest error:',
        e
      )
    }
  }
},

  // 🔥 إضافة إشعار (مع منع التكرار)
  addNotification: (notification) => {
    const exists = get().latest.some(n => n.id === notification.id)
    if (exists) return

    set(state => ({
      latest: [notification, ...state.latest].slice(0, 5),
      all: [notification, ...state.all],
      unreadCount: state.unreadCount + 1
    }))

    // 🔥 broadcast لباقي التابات (مرة واحدة فقط)
    if (!notification.__from_bc) {
      bc?.postMessage({
        type: 'NOTIFICATION_SYNC_NEW',
        notification
      })
    }
  },

  // 🔹 قراءة إشعار واحد
  markAsRead: async (id) => {
    try {
      await api.post(`/notifications/${id}/read`)

      set(state => ({
        latest: state.latest.map(n =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n
        ),
        all: state.all.map(n =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n
        ),
        unreadCount: Math.max(state.unreadCount - 1, 0)
      }))

      bc?.postMessage({ type: 'NOTIFICATION_READ', id })

    } catch (e) {
      console.error('markAsRead error:', e)
    }
  },

  // 🔹 قراءة الكل (مع lock لمنع التكرار)
  markAllRead: async () => {
    if (marking) return
    marking = true

    try {
      await api.post('/notifications/mark-all-read')

      set(state => ({
        latest: state.latest.map(n => ({
          ...n,
          read_at: new Date().toISOString()
        })),
        all: state.all.map(n => ({
          ...n,
          read_at: new Date().toISOString()
        })),
        unreadCount: 0
      }))

      bc?.postMessage({ type: 'NOTIFICATIONS_MARK_ALL' })

    } catch (e) {
      console.error('markAllRead error:', e)
    }

    setTimeout(() => {
      marking = false
    }, 1000)
  }
}))
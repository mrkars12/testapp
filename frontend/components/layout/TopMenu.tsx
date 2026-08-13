'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { useBalanceStore } from '@/components/balanceStore'
import { useNotificationStore } from '@/components/notificationStore'

export default function TopMenu() {

  const { user } = useAuth()

  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationWrapper = useRef<HTMLDivElement>(null)
  
  const { balance, currency } =
  useBalanceStore()

  const latestRaw =
    useNotificationStore(
      state => state.latest
    )

  const latest =
    Array.isArray(latestRaw)

      ? latestRaw

      : []

  const unreadCount =
    useNotificationStore(
      state => state.unreadCount
    )

  const fetchLatest =
    useNotificationStore(
      state => state.fetchLatest
    )

  const markAsRead =
    useNotificationStore(
      state => state.markAsRead
    )

  const markAllRead =
    useNotificationStore(
      state => state.markAllRead
    )

  useEffect(() => {
    if (!user?.email_verified_at) return
    if (!user?.id) return

    fetchLatest()
  }, [user?.email_verified_at,user?.id])

  /* =========================
     Close dropdown on outside click
  ========================= */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        notificationWrapper.current &&
        !notificationWrapper.current.contains(e.target as Node)
      ) {
        setNotificationsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () =>
      document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  /* =========================
     Fetch latest when opened
  ========================= */
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-2 flex items-center justify-between">

      {/* ================= BALANCE ================= */}
      <div>
        <button className="relative flex items-center gap-3 pl-12 pr-4 py-2 hover:bg-gray-50 rounded-lg transition">
          <i className="fa-solid fa-wallet absolute left-3 text-xl text-[#4F95D3]"></i>

          <div className="text-left">
            {balance ? (
              <>
                <div className="text-[14px] font-medium text-[#171717]">
                  MY BALANCE
                </div>
                <div className="text-[14px] font-bold text-[#171717]">
                  {balance} {currency}
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <div className="h-3 w-16 bg-gray-200 animate-pulse rounded"></div>
                <div className="h-4 w-24 bg-gray-200 animate-pulse rounded"></div>
              </div>
            )}
          </div>
        </button>
      </div>

      {/* ================= NOTIFICATIONS ================= */}
      <div className="relative" ref={notificationWrapper}>

        {/* Bell Button */}
        <button
          onClick={() => setNotificationsOpen(prev => !prev)}
          className="relative p-2 hover:bg-gray-100 rounded-lg transition"
        >
          <i className="fa-solid fa-bell text-[23px] text-[#858585]"></i>

          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px]
              flex items-center justify-center
              bg-[#fa3163] text-white text-[11px] rounded-full px-1">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {notificationsOpen && (
          <div
            className="absolute right-0 top-full mt-3 w-96 rounded-2xl border border-gray-200 bg-white z-50
            shadow-lg"
          >

            {/* HEADER */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <span className="text-base font-semibold text-gray-900">
                Notifications
              </span>

              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 transition"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* BODY */}
            <div className="max-h-80 overflow-y-auto">

              {Array.isArray(latest) && latest.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-lg font-medium text-gray-900">
                    No notifications 🙂
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    You're all caught up!
                  </p>
                </div>
              ) : (
                Array.isArray(latest) && latest.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markAsRead(n.id)}
                    className={`px-6 py-4 border-b cursor-pointer transition
                      ${!n.read_at
                        ? 'bg-blue-50 hover:bg-blue-100'
                        : 'hover:bg-gray-50'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">
                        {n.title}
                      </p>

                      {!n.read_at && (
                        <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full">
                          New
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                      {n.message}
                    </p>

                    <span className="text-[10px] text-gray-400 mt-2 block">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                ))
              )}

            </div>

            {/* FOOTER */}
            <div className="px-6 py-4 border-t border-gray-100 text-center bg-gray-50 rounded-b-2xl">
              <Link
                href="/notifications"
                onClick={() => setNotificationsOpen(false)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition"
              >
                View all notifications
              </Link>
            </div>

          </div>
        )}
      </div>
    </header>
  )
}
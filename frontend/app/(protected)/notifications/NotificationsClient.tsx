'use client'

import { useNotificationStore } from '@/components/notificationStore'

export default function NotificationsClient() {
  const all = useNotificationStore(state => state.all)
  const markAllRead = useNotificationStore(state => state.markAllRead)

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-8">

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">All Notifications</h1>

        <button
          onClick={markAllRead}
          className="text-blue-600 hover:underline"
        >
          Mark all as read
        </button>
      </div>

      {all.length === 0 && (
        <p className="text-gray-500">No notifications found.</p>
      )}

      {all.map(n => (
        <div
          key={n.id}
          className={`p-5 border rounded-xl
            ${!n.read_at ? 'bg-blue-50' : ''}
          `}
        >
          <h3>{n.title}</h3>
          <p>{n.message}</p>
        </div>
      ))}

    </div>
  )
}
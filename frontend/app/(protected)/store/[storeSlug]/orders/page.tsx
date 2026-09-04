'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useActiveStoreReady } from '@/lib/useActiveStoreReady'
import { useStorePath } from '@/lib/storePath'

/* ══════════════════════════════════════════════════════════════════════
   Merchant — Orders list
   /store/orders — the active store comes from global state, not
   the URL (see lib/activeStore.ts).
   GET /api/stores/orders?status=&search=&page=&limit=
   ══════════════════════════════════════════════════════════════════════ */

interface Order {
  id: string
  order_number: string
  status: string
  payment_status: string
  currency: string
  total: string
  customer_name: string
  customer_phone: string
  created_at: string
}

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'PENDING', label: 'قيد الانتظار' },
  { value: 'AWAITING_PAYMENT', label: 'بانتظار الدفع' },
  { value: 'CONFIRMED', label: 'مؤكد' },
  { value: 'PROCESSING', label: 'قيد التجهيز' },
  { value: 'SHIPPED', label: 'تم الشحن' },
  { value: 'DELIVERED', label: 'تم التوصيل' },
  { value: 'CANCELLED', label: 'ملغي' },
]

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  AWAITING_PAYMENT: 'bg-amber-50 text-amber-700',
  CONFIRMED: 'bg-blue-50 text-blue-700',
  PROCESSING: 'bg-indigo-50 text-indigo-700',
  SHIPPED: 'bg-purple-50 text-purple-700',
  DELIVERED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-red-50 text-red-700',
}

const PAYMENT_BADGE: Record<string, string> = {
  PAID: 'bg-green-50 text-green-700',
  UNPAID: 'bg-gray-100 text-gray-600',
  PARTIALLY_REFUNDED: 'bg-amber-50 text-amber-700',
  REFUNDED: 'bg-red-50 text-red-700',
}

const IconSpinner = ({ className = '' }: { className?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`animate-spin ${className}`}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

export default function OrdersPage() {
  const storePath = useStorePath()
  const router = useRouter()
  const { storeSlug: activeStoreSlug, ready: activeStoreReady } = useActiveStoreReady()
  const storeSlug = activeStoreSlug || ''

  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (!activeStoreReady) return
    if (!storeSlug) { setLoading(false); return }
    setOrders([])
    setError('')
    const controller = new AbortController()
    const fetchOrders = async () => {
      setLoading(true)
      try {
        const qp = new URLSearchParams({ page: String(page), limit: '20' })
        if (status) qp.set('status', status)
        if (search) qp.set('search', search)
        const res = await api.get(`/stores/orders?${qp}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setOrders(res.data.orders || [])
        setTotal(res.data.total || 0)
        setPages(res.data.pages || 1)
      } catch (err: any) {
        if (err?.silent || err?.code === 'ERR_CANCELED') return
        if (err?.response?.status === 404) { router.replace('/store'); return }
        setError('تعذر تحميل الطلبات')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    fetchOrders()
    return () => controller.abort()
  }, [storeSlug, activeStoreReady, status, search, page, router])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">الطلبات</h1>
          <p className="mt-1 text-sm text-gray-500">كل الطلبات اللي جاتلك من متجرك</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="بحث برقم الطلب أو اسم العميل أو رقم الهاتف"
          className="w-72 max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        <select
          value={status}
          onChange={(e) => { setPage(1); setStatus(e.target.value) }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {activeStoreReady && !storeSlug ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-gray-700 font-semibold">لا يوجد متجر نشط</p>
          <a href="/store" className="mt-2 inline-block text-sm text-blue-600 hover:underline">اختيار متجر</a>
        </div>
      ) : loading && orders.length === 0 ? (
        <div className="flex min-h-[30vh] items-center justify-center text-gray-400">
          <IconSpinner />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-gray-500 font-medium">لا يوجد طلبات {status || search ? 'مطابقة' : 'لسه'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-right text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="p-3">رقم الطلب</th>
                <th className="p-3">العميل</th>
                <th className="p-3">الإجمالي</th>
                <th className="p-3">حالة الطلب</th>
                <th className="p-3">حالة الدفع</th>
                <th className="p-3">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => router.push(storePath(`orders/${o.id}`))}
                  className="cursor-pointer border-b border-gray-50 transition-colors last:border-0 hover:bg-gray-50"
                >
                  <td className="p-3 font-semibold text-gray-900">#{o.order_number}</td>
                  <td className="p-3">
                    <div className="text-gray-900">{o.customer_name}</div>
                    <div className="text-xs text-gray-400" dir="ltr">{o.customer_phone}</div>
                  </td>
                  <td className="p-3 text-gray-900" dir="ltr">{o.total} {o.currency}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_BADGE[o.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_OPTIONS.find((s) => s.value === o.status)?.label || o.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${PAYMENT_BADGE[o.payment_status] || 'bg-gray-100 text-gray-600'}`}>
                      {o.payment_status}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500">{new Date(o.created_at).toLocaleDateString('ar-EG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            السابق
          </button>
          <span className="text-sm text-gray-500">{page} / {pages} ({total})</span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { useStorePath } from '@/lib/storePath'

/* ══════════════════════════════════════════════════════════════════════
   Merchant — Order detail
   /store/orders/[id] — the active store comes from global state.
   GET /api/stores/orders/:id
   PUT /api/stores/orders/:id/status   { status }
   ══════════════════════════════════════════════════════════════════════ */

interface OrderItem {
  id: string
  title: string
  variant_title: string | null
  price: string
  qty: number
  image_url: string | null
}

interface OrderDetail {
  id: string
  order_number: string
  status: string
  payment_status: string
  payment_method: string | null
  currency: string
  subtotal: string
  total: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
  address_line: string
  city: string
  notes: string | null
  created_at: string
  items: OrderItem[]
}

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'قيد الانتظار' },
  { value: 'AWAITING_PAYMENT', label: 'بانتظار الدفع' },
  { value: 'CONFIRMED', label: 'مؤكد' },
  { value: 'PROCESSING', label: 'قيد التجهيز' },
  { value: 'SHIPPED', label: 'تم الشحن' },
  { value: 'DELIVERED', label: 'تم التوصيل' },
  { value: 'CANCELLED', label: 'ملغي' },
]

const IconSpinner = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

export default function OrderDetailPage() {
  const storePath = useStorePath()
  const params = useParams()
  const router = useRouter()
  // Straight from the `[storeSlug]` URL segment, not the in-memory mirror —
  // correct on the first render, so the fetch effect below can never fire
  // with the previously-active store.
  const storeSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : ''
  const orderId = (params?.id as string) || ''

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    if (!storeSlug || !orderId) return
    setOrder(null)
    setError('')
    const controller = new AbortController()
    const fetchOrder = async () => {
      setLoading(true)
      try {
        const res = await api.get(`/stores/orders/${orderId}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setOrder(res.data)
      } catch (err: any) {
        if (err?.silent || err?.code === 'ERR_CANCELED') return
        if (err?.response?.status === 404) { router.replace(storePath('orders')); return }
        setError('تعذر تحميل الطلب')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    fetchOrder()
    return () => controller.abort()
  }, [storeSlug, orderId, router])

  const handleStatusChange = async (nextStatus: string) => {
    if (!order || nextStatus === order.status) return
    setUpdatingStatus(true)
    setStatusError('')
    try {
      const res = await api.put(`/stores/orders/${orderId}/status`, { status: nextStatus })
      setOrder((prev) => (prev ? { ...prev, status: res.data.status } : prev))
    } catch (err: any) {
      if (err?.silent) return
      setStatusError(err?.response?.data?.message || 'تعذر تحديث حالة الطلب')
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-400">
        <IconSpinner />
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm text-red-500">{error || 'تعذر إيجاد الطلب'}</p>
        <Link href={storePath('orders')} className="mt-3 inline-block text-sm text-blue-600 hover:underline">
          الرجوع للطلبات
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href={storePath('orders')} className="text-sm text-gray-500 hover:underline">← الطلبات</Link>
          <h1 className="mt-1 text-xl font-bold text-gray-900">طلب #{order.order_number}</h1>
        </div>
        <div className="text-left">
          <label className="mb-1 block text-[11px] font-medium text-gray-500">حالة الطلب</label>
          <select
            value={order.status}
            disabled={updatingStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400 disabled:opacity-50"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {statusError && <p className="mt-1 text-[11px] text-red-500">{statusError}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">بيانات العميل</h2>
          <p className="text-sm text-gray-700">{order.customer_name}</p>
          <p className="text-sm text-gray-500" dir="ltr">{order.customer_phone}</p>
          {order.customer_email && <p className="text-sm text-gray-500">{order.customer_email}</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">عنوان التوصيل</h2>
          <p className="text-sm text-gray-700">{order.address_line}</p>
          <p className="text-sm text-gray-500">{order.city}</p>
          {order.notes && <p className="mt-1 text-xs text-gray-400">ملاحظات: {order.notes}</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">الدفع</h2>
          <p className="text-sm text-gray-700">الحالة: {order.payment_status}</p>
          {order.payment_method && <p className="text-sm text-gray-500">الوسيلة: {order.payment_method}</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">التاريخ</h2>
          <p className="text-sm text-gray-700">{new Date(order.created_at).toLocaleString('ar-EG')}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">المنتجات</h2>
        <div className="flex flex-col gap-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-3">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt={item.title} className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-gray-100" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.title}</p>
                  {item.variant_title && <p className="text-xs text-gray-400">{item.variant_title}</p>}
                  <p className="text-xs text-gray-400">الكمية: {item.qty}</p>
                </div>
              </div>
              <p className="text-sm text-gray-700" dir="ltr">{item.price} {order.currency}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-1 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>الإجمالي الفرعي</span>
            <span dir="ltr">{order.subtotal} {order.currency}</span>
          </div>
          <div className="flex justify-between text-base font-semibold text-gray-900">
            <span>الإجمالي</span>
            <span dir="ltr">{order.total} {order.currency}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

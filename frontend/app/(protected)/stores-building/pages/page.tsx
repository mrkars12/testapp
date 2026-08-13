'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { DndContext, closestCenter, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface StorePage {
  id: string
  title: string
  slug: string
  type: string
  is_active: boolean
}

// مكون الصف القابل للسحب
function SortableRow({ page }: { page: StorePage }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: page.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <tr ref={setNodeRef} style={style} className="bg-white hover:bg-gray-50 transition-colors border-b border-gray-100">
      <td className="p-4 cursor-grab text-gray-400 hover:text-gray-600" {...attributes} {...listeners}>
        <i className="fas fa-grip-vertical"></i>
      </td>
      <td className="p-4">
        <p className="font-bold text-gray-900">{page.title}</p>
        <p className="text-xs text-gray-400 dir-ltr text-right">/store/{page.slug}</p>
      </td>
      <td className="p-4">
        <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
          {page.type.replace('_', ' ')}
        </span>
      </td>
      <td className="p-4">
        <span className={`text-[11px] font-bold ${page.is_active ? 'text-green-600' : 'text-gray-400'}`}>
          {page.is_active ? '● نشطة' : '○ معطلة'}
        </span>
      </td>
      <td className="p-4 text-right">
        <button className="text-gray-400 hover:text-black transition p-2">
          <i className="fas fa-pen text-[13px]"></i>
        </button>
      </td>
    </tr>
  )
}

export default function PagesManager() {
  const [pages, setPages] = useState<StorePage[]>([])
  const [loading, setLoading] = useState(true)
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  useEffect(() => { fetchPages() }, [])

  const fetchPages = async () => {
    try {
      const res = await api.get('/stores/pages')
      setPages(res.data)
    } catch (error) { console.error(error) } finally { setLoading(false) }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
  const { active, over } = event
  if (over && active.id !== over.id) {
    const oldIndex = pages.findIndex(p => p.id === active.id)
    const newIndex = pages.findIndex(p => p.id === over.id)
    const newPages = arrayMove(pages, oldIndex, newIndex)
    
    setPages(newPages)
    
    // أضف هذا السطر لترى ماذا نرسل للسيرفر
    console.log("Sending reorder request:", newPages.map((p, i) => ({ id: p.id, sort_order: i })));

    try {
      await api.put('/stores/pages/reorder', {
        pages: newPages.map((p, i) => ({ id: p.id, sort_order: i }))
      })
      console.log("Reorder successful");
    } catch (error) {
      console.error('فشل تحديث الترتيب', error)
    }
  }
}

  return (
    <div className="p-8 max-w-5xl mx-auto w-full font-sans">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">إدارة الصفحات</h1>
          <p className="text-sm text-gray-500 mt-1">رتب صفحات متجرك بالسحب والإفلات</p>
        </div>
        <Link href="/stores-building/pages/create" className="bg-black text-white px-6 py-2.5 rounded-lg font-bold hover:bg-gray-800 transition shadow-sm text-sm flex items-center gap-2">
          <i className="fas fa-plus text-[10px]"></i> صفحة جديدة
        </Link>
      </div>

      {/* DndContext يحيط بالجدول بالكامل هنا لضمان سلامة الـ HTML */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="p-4 w-12"></th>
                <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-widest">العنوان</th>
                <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-widest">النوع</th>
                <th className="p-4 text-[11px] font-bold text-gray-500 uppercase tracking-widest">الحالة</th>
                <th className="p-4 text-right text-[11px] font-bold text-gray-500 uppercase tracking-widest">تحكم</th>
              </tr>
            </thead>
            <SortableContext items={pages} strategy={verticalListSortingStrategy}>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={5} className="p-10 text-center text-gray-400">جاري التحميل...</td></tr>
                ) : (
                  pages.map(page => <SortableRow key={page.id} page={page} />)
                )}
              </tbody>
            </SortableContext>
          </table>
        </div>
      </DndContext>
    </div>
  )
}
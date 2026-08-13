'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api' // تأكد من مسار الـ API الخاص بك
import Link from 'next/link'

export default function CreateStorePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    slug: '',
    type: 'STANDARD',
    content: '',
  })

  // توليد الرابط (Slug) تلقائياً من العنوان
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const title = e.target.value
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-') // يدعم عربي وإنجليزي
      .replace(/(^-|-$)+/g, '')
    setFormData({ ...formData, title, slug })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // ✅ تعديل المسار ليتوافق مع الكنترولر الحالي
      await api.post('/stores/pages', formData) 
      router.push('/stores-building/pages')
    } catch (error: any) {
      alert(error?.response?.data?.message || 'حدث خطأ أثناء إنشاء الصفحة')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">إنشاء صفحة جديدة</h1>
        <Link href="/stores-building/pages" className="text-gray-500 hover:text-black transition">
          عودة للصفحات <i className="fas fa-arrow-left ml-1"></i>
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
        
        {/* العنوان والرابط */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">عنوان الصفحة</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={handleTitleChange}
              className="w-full p-3 border border-gray-200 rounded-lg focus:border-[#0097c7] outline-none transition-colors"
              placeholder="مثال: Homewear"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">رابط الصفحة (Slug)</label>
            <div className="flex items-center">
              <span className="bg-gray-50 border border-l-0 border-gray-200 p-3 rounded-l-lg text-gray-400 text-sm dir-ltr">
                /store/
              </span>
              <input
                type="text"
                required
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full p-3 border border-gray-200 rounded-r-lg focus:border-[#0097c7] outline-none transition-colors"
                dir="ltr"
              />
            </div>
          </div>
        </div>

        {/* نوع الصفحة */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">تخطيط الصفحة (Layout)</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* خيار 1 */}
            <div 
              onClick={() => setFormData({ ...formData, type: 'STANDARD' })}
              className={`cursor-pointer border-2 rounded-lg p-4 text-center transition-all ${formData.type === 'STANDARD' ? 'border-[#0097c7] bg-blue-50/50' : 'border-gray-100 hover:border-gray-200'}`}
            >
              <i className="fas fa-align-left text-2xl mb-2 text-gray-500"></i>
              <p className="font-bold text-sm text-gray-800">صفحة عادية</p>
              <p className="text-xs text-gray-500 mt-1">نصوص وشروحات فقط</p>
            </div>
            {/* خيار 2 */}
            <div 
              onClick={() => setFormData({ ...formData, type: 'PRODUCT_WITHOUT_HERO' })}
              className={`cursor-pointer border-2 rounded-lg p-4 text-center transition-all ${formData.type === 'PRODUCT_WITHOUT_HERO' ? 'border-[#0097c7] bg-blue-50/50' : 'border-gray-100 hover:border-gray-200'}`}
            >
              <i className="fas fa-th-large text-2xl mb-2 text-gray-500"></i>
              <p className="font-bold text-sm text-gray-800">منتجات (بدون صورة)</p>
              <p className="text-xs text-gray-500 mt-1">شبكة منتجات كلاسيكية</p>
            </div>
            {/* خيار 3 */}
            <div 
              onClick={() => setFormData({ ...formData, type: 'PRODUCT_WITH_HERO' })}
              className={`cursor-pointer border-2 rounded-lg p-4 text-center transition-all ${formData.type === 'PRODUCT_WITH_HERO' ? 'border-[#0097c7] bg-blue-50/50' : 'border-gray-100 hover:border-gray-200'}`}
            >
              <i className="fas fa-image text-2xl mb-2 text-gray-500"></i>
              <p className="font-bold text-sm text-gray-800">منتجات (مع صورة غلاف)</p>
              <p className="text-xs text-gray-500 mt-1">منتجات أسفل بانر كبير</p>
            </div>
          </div>
        </div>

        {/* محتوى ديناميكي */}
        {formData.type === 'STANDARD' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">محتوى الصفحة</label>
            <textarea
              rows={6}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full p-3 border border-gray-200 rounded-lg outline-none focus:border-[#0097c7]"
              placeholder="اكتب تفاصيل وشرح الصفحة هنا..."
            />
          </div>
        )}

        {(formData.type === 'PRODUCT_WITH_HERO' || formData.type === 'PRODUCT_WITHOUT_HERO') && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-600 flex items-center gap-2">
            <i className="fas fa-info-circle text-[#0097c7]"></i>
            بعد حفظ الصفحة، سيتم توجيهك لاختيار المنتجات المراد عرضها هنا (أو رفع صورة الغلاف).
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0097c7] text-white font-bold py-3.5 rounded-lg hover:bg-[#007ba3] transition-colors disabled:opacity-50"
        >
          {loading ? (
            <span><i className="fas fa-spinner fa-spin mr-2"></i> جاري الإنشاء...</span>
          ) : 'حفظ الصفحة'}
        </button>

      </form>
    </div>
  )
}
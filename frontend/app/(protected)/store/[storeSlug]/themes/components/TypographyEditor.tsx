'use client'

import { useState, useEffect } from 'react'
import { ThemeTypography } from '../page'
import { Minus, Plus } from 'lucide-react'

const GOOGLE_FONTS = [
  'Inter',
  'Cairo',
  'Tajawal',
  'Noto Sans Arabic',
  'Poppins',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Playfair Display',
  'Amiri',
  'Almarai',
]

const BASE_SIZES = ['14px', '16px', '18px', '20px']

const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  headingFont: 'Inter',
  bodyFont: 'Inter',
  baseSize: '16px',
  scale: 1.25,
  h1Size: '2.5rem',
  h2Size: '2rem',
  h3Size: '1.5rem',
  lineHeight: 1.6,
  letterSpacing: 'normal',
}

export default function TypographyEditor({
  typography,
  onChange,
}: {
  typography: ThemeTypography
  onChange: (typography: ThemeTypography) => void
}) {
  // دمج القيم القادمة مع القيم الافتراضية
  const merged = { ...DEFAULT_TYPOGRAPHY, ...typography }
  const [local, setLocal] = useState<ThemeTypography>(merged)

  // تحديث الـ local state لما الـ prop يتغير
  useEffect(() => {
    setLocal({ ...DEFAULT_TYPOGRAPHY, ...typography })
  }, [typography])

  const update = (key: keyof ThemeTypography, value: any) => {
    const updated = { ...local, [key]: value }
    setLocal(updated)
    onChange(updated)
  }

  // تأمين القيم الرقمية
  const safeScale = typeof local.scale === 'number' ? local.scale : DEFAULT_TYPOGRAPHY.scale
  const safeLineHeight = typeof local.lineHeight === 'number' ? local.lineHeight : DEFAULT_TYPOGRAPHY.lineHeight

  return (
    <div className="space-y-6">
      {/* Heading Font */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">خط العناوين</label>
        <select
          value={local.headingFont || DEFAULT_TYPOGRAPHY.headingFont}
          onChange={(e) => update('headingFont', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        >
          {GOOGLE_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </div>

      {/* Body Font */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">خط النصوص</label>
        <select
          value={local.bodyFont || DEFAULT_TYPOGRAPHY.bodyFont}
          onChange={(e) => update('bodyFont', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        >
          {GOOGLE_FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </div>

      <hr className="border-gray-100" />

      {/* Base Size */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">حجم الخط الأساسي</label>
        <div className="flex gap-2">
          {BASE_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => update('baseSize', size)}
              className={`flex-1 py-2 border rounded-lg text-sm font-medium transition-colors ${
                local.baseSize === size
                  ? 'border-blue-500 bg-blue-50 text-blue-600'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Line Height */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          ارتفاع السطر ({safeLineHeight})
        </label>
        <input
          type="range"
          min="1"
          max="2.5"
          step="0.1"
          value={safeLineHeight}
          onChange={(e) => update('lineHeight', parseFloat(e.target.value))}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>1.0</span>
          <span>2.5</span>
        </div>
      </div>

      {/* Scale */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          نسبة التدرج ({safeScale.toFixed(2)})
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => update('scale', Math.max(1, safeScale - 0.05))}
            className="w-8 h-8 border rounded-lg flex items-center justify-center hover:bg-gray-50"
          >
            <Minus size={14} />
          </button>
          <div className="flex-1 text-center text-sm font-mono">{safeScale.toFixed(2)}</div>
          <button
            onClick={() => update('scale', Math.min(2, safeScale + 0.05))}
            className="w-8 h-8 border rounded-lg flex items-center justify-center hover:bg-gray-50"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Preview */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">معاينة</label>
        <div className="bg-gray-50 border rounded-lg p-4 space-y-3">
          <h1
            className="font-bold"
            style={{
              fontFamily: local.headingFont || DEFAULT_TYPOGRAPHY.headingFont,
              fontSize: local.h1Size || DEFAULT_TYPOGRAPHY.h1Size,
              lineHeight: safeLineHeight,
            }}
          >
            عنوان رئيسي
          </h1>
          <h2
            className="font-semibold"
            style={{
              fontFamily: local.headingFont || DEFAULT_TYPOGRAPHY.headingFont,
              fontSize: local.h2Size || DEFAULT_TYPOGRAPHY.h2Size,
              lineHeight: safeLineHeight,
            }}
          >
            عنوان فرعي
          </h2>
          <p
            style={{
              fontFamily: local.bodyFont || DEFAULT_TYPOGRAPHY.bodyFont,
              fontSize: local.baseSize || DEFAULT_TYPOGRAPHY.baseSize,
              lineHeight: safeLineHeight,
            }}
          >
            هذا نص تجريبي لمعاينة الخطوط والتنسيقات في المتجر الخاص بك.
          </p>
        </div>
      </div>
    </div>
  )
}
'use client'

import { useState } from 'react'
import { ThemeColors } from '../page'
import { Paintbrush, Check } from 'lucide-react'

interface ColorGroup {
  label: string
  colors: { key: keyof ThemeColors; label: string }[]
}

const COLOR_GROUPS: ColorGroup[] = [
  {
    label: 'الألوان الأساسية',
    colors: [
      { key: 'primary', label: 'اللون الرئيسي' },
      { key: 'secondary', label: 'اللون الثانوي' },
      { key: 'accent', label: 'لون التمييز' },
    ],
  },
  {
    label: 'خلفيات',
    colors: [
      { key: 'background', label: 'خلفية الصفحة' },
      { key: 'surface', label: 'خلفية البطاقات' },
    ],
  },
  {
    label: 'النصوص',
    colors: [
      { key: 'textPrimary', label: 'النص الأساسي' },
      { key: 'textSecondary', label: 'النص الثانوي' },
      { key: 'textMuted', label: 'النص الخافت' },
    ],
  },
  {
    label: 'الهيدر والفوتر',
    colors: [
      { key: 'headerBg', label: 'خلفية الهيدر' },
      { key: 'headerText', label: 'نص الهيدر' },
      { key: 'footerBg', label: 'خلفية الفوتر' },
      { key: 'footerText', label: 'نص الفوتر' },
    ],
  },
]

const PRESETS = [
  {
    name: 'كلاسيك',
    colors: {
      primary: '#2563eb',
      secondary: '#64748b',
      accent: '#f59e0b',
      background: '#ffffff',
      surface: '#f8fafc',
      textPrimary: '#0f172a',
      textSecondary: '#64748b',
      textMuted: '#94a3b8',
      border: '#e2e8f0',
      headerBg: '#ffffff',
      headerText: '#0f172a',
      footerBg: '#0f172a',
      footerText: '#ffffff',
    } as ThemeColors,
  },
  {
    name: 'داكن',
    colors: {
      primary: '#3b82f6',
      secondary: '#60a5fa',
      accent: '#f59e0b',
      background: '#0f172a',
      surface: '#1e293b',
      textPrimary: '#f8fafc',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
      border: '#334155',
      headerBg: '#1e293b',
      headerText: '#f8fafc',
      footerBg: '#020617',
      footerText: '#f8fafc',
    } as ThemeColors,
  },
  {
    name: 'دافئ',
    colors: {
      primary: '#ea580c',
      secondary: '#f97316',
      accent: '#dc2626',
      background: '#fff7ed',
      surface: '#ffedd5',
      textPrimary: '#431407',
      textSecondary: '#9a3412',
      textMuted: '#c2410c',
      border: '#fed7aa',
      headerBg: '#ffffff',
      headerText: '#431407',
      footerBg: '#431407',
      footerText: '#ffedd5',
    } as ThemeColors,
  },
  {
    name: 'طبيعي',
    colors: {
      primary: '#059669',
      secondary: '#10b981',
      accent: '#84cc16',
      background: '#f0fdf4',
      surface: '#dcfce7',
      textPrimary: '#064e3b',
      textSecondary: '#065f46',
      textMuted: '#047857',
      border: '#bbf7d0',
      headerBg: '#ffffff',
      headerText: '#064e3b',
      footerBg: '#064e3b',
      footerText: '#f0fdf4',
    } as ThemeColors,
  },
]

export default function ColorPicker({
  colors,
  onChange,
}: {
  colors: ThemeColors
  onChange: (colors: ThemeColors) => void
}) {
  const [localColors, setLocalColors] = useState<ThemeColors>(colors)
  const [copiedColor, setCopiedColor] = useState<string | null>(null)

  const updateColor = (key: keyof ThemeColors, value: string) => {
    const updated = { ...localColors, [key]: value }
    setLocalColors(updated)
    onChange(updated)
  }

  const applyPreset = (presetColors: ThemeColors) => {
    setLocalColors(presetColors)
    onChange(presetColors)
  }

  const copyColor = (color: string) => {
    navigator.clipboard.writeText(color)
    setCopiedColor(color)
    setTimeout(() => setCopiedColor(null), 1500)
  }

  return (
    <div className="space-y-6">
      {/* Presets */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">قوالب جاهزة</h4>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => applyPreset(preset.colors)}
              className="p-3 border rounded-lg hover:border-blue-500 transition-all text-center group"
            >
              <div className="flex gap-1 justify-center mb-2">
                <div className="w-6 h-6 rounded-full" style={{ backgroundColor: preset.colors.primary }} />
                <div className="w-6 h-6 rounded-full" style={{ backgroundColor: preset.colors.secondary }} />
                <div className="w-6 h-6 rounded-full" style={{ backgroundColor: preset.colors.accent }} />
              </div>
              <span className="text-xs font-medium text-gray-700 group-hover:text-blue-600">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Color Groups */}
      {COLOR_GROUPS.map((group) => (
        <div key={group.label}>
          <h4 className="text-sm font-semibold text-gray-900 mb-3">{group.label}</h4>
          <div className="space-y-3">
            {group.colors.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between group">
                <span className="text-sm text-gray-600">{label}</span>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="color"
                      value={localColors[key] || '#000000'}
                      onChange={(e) => updateColor(key, e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0 overflow-hidden"
                      style={{ padding: 0, border: 'none' }}
                    />
                  </div>
                  <button
                    onClick={() => copyColor(localColors[key])}
                    className="text-xs font-mono text-gray-500 hover:text-gray-900 bg-gray-50 px-2 py-1 rounded border hover:border-gray-300 transition-colors min-w-[70px] text-center"
                  >
                    {copiedColor === localColors[key] ? (
                      <span className="text-green-600 flex items-center gap-1">
                        <Check size={12} /> نسخ
                      </span>
                    ) : (
                      localColors[key]?.toUpperCase()
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

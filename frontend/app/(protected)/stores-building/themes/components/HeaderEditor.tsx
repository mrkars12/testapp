'use client'

import { useState, useEffect } from 'react'
import { ThemeHeader } from '../page'
import { Eye, EyeOff, AlignLeft, AlignCenter, AlignRight, Pin, PinOff } from 'lucide-react'
export default function HeaderEditor({
  header,
  menus,
  onChange,
}: {
  header: ThemeHeader
  menus: any[]
  onChange: (header: ThemeHeader) => void
}) {
  const [local, setLocal] = useState<ThemeHeader>(header)
  useEffect(() => {
  setLocal(header)
}, [header])
  const update = (key: keyof ThemeHeader, value: any) => {
    const updated = { ...local, [key]: value }
    setLocal(updated)
    onChange(updated)
  }

  return (
    <div className="space-y-6">
      {/* Toggle Options */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-900">عناصر الهيدر</h4>

        {[
          { key: 'showSearch' as const, label: 'أيقونة البحث', icon: Eye },
          { key: 'showAccount' as const, label: 'أيقونة الحساب', icon: Eye },
          { key: 'showCart' as const, label: 'أيقونة السلة', icon: Eye },
          { key: 'sticky' as const, label: 'هيدر ثابت (Sticky)', icon: Pin },
        ].map(({ key, label, icon: Icon }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{label}</span>
            <button
              onClick={() => update(key, !local[key])}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                local[key] ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  local[key] ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <hr className="border-gray-100" />

      {/* Logo Position */}

      <div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">
    القائمة الرئيسية
  </h4>

  <select
    value={local.menuId || ''}
    onChange={(e) =>
      update(
        'menuId',
        e.target.value
      )
    }
    className="
      w-full
      border
      rounded-lg
      px-3
      py-2
    "
  >
    <option value="">
      اختر قائمة
    </option>

    {menus.map((menu) => (
      <option
        key={menu.id}
        value={menu.id}
      >
        {menu.name}
      </option>
    ))}
  </select>
</div>
<div>
  <h4 className="text-sm font-semibold mb-3">
    Layout
  </h4>

  {/*<div className="grid grid-cols-1 gap-2">

    <button
      onClick={() =>
        update(
          'layout',
          'classic'
        )
      }
      className={
        local.layout === 'classic'
          ? 'border-blue-500 bg-blue-50 border rounded-lg p-3'
          : 'border rounded-lg p-3'
      }
    >
      Logo | Menu | Icons
    </button>

    <button
      onClick={() =>
        update(
          'layout',
          'centered'
        )
      }
      className={
        local.layout === 'centered'
          ? 'border-blue-500 bg-blue-50 border rounded-lg p-3'
          : 'border rounded-lg p-3'
      }
    >
      Logo Center
    </button>

    <button
      onClick={() =>
        update(
          'layout',
          'stacked'
        )
      }
      className={
        local.layout === 'stacked'
          ? 'border-blue-500 bg-blue-50 border rounded-lg p-3'
          : 'border rounded-lg p-3'
      }
    >
      Logo Top + Menu Bottom
    </button>

  </div>*/}
</div>

      <div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">
    موقع الشعار
  </h4>

  <div className="flex gap-2">

    {[
      {
        value: 'left' as const,
        label: 'يسار',
        icon: AlignLeft,
      },

      {
        value: 'center' as const,
        label: 'وسط',
        icon: AlignCenter,
      },

      {
        value: 'right' as const,
        label: 'يمين',
        icon: AlignRight,
      },

    ].map(({ value, label, icon: Icon }) => (

      <button
        key={value}
        onClick={() =>
          update(
            'logoPosition',
            value
          )
        }
        className={`
          flex-1
          py-2.5
          border
          rounded-lg
          text-sm
          font-medium
          transition-colors
          flex
          items-center
          justify-center
          gap-2
          ${
            local.logoPosition === value
              ? 'border-blue-500 bg-blue-50 text-blue-600'
              : 'border-gray-200 hover:border-gray-300 text-gray-600'
          }
        `}
      >
        <Icon size={16} />
        {label}
      </button>

    ))}

  </div>
</div>

      {/* Menu Position */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">موقع القائمة</h4>
        <div className="flex gap-2">
          {[
            { value: 'left' as const, label: 'يسار', icon: AlignLeft },
            { value: 'center' as const, label: 'وسط', icon: AlignCenter },
            { value: 'right' as const, label: 'يمين', icon: AlignRight },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => update('menuPosition', value)}
              className={`flex-1 py-2.5 border rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                local.menuPosition === value
                  ? 'border-blue-500 bg-blue-50 text-blue-600'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

<div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">Logo Width</h4>

  <input
    type="range"
    min="80"
    max="400"
    className="w-full accent-blue-600"
    value={local.logoWidth}
    onChange={(e) =>
      update(
        'logoWidth',
        Number(e.target.value)
      )
    }
  />
</div>
{local.showSearch && (
  <div className="mt-3">
    <label className="text-sm">
      Search Position
    </label>

    <div className="flex gap-2 mt-2">

      <button
        onClick={() =>
          update('searchPosition', 'left')
        }
        className={
          local.searchPosition === 'left'
            ? 'flex-1 border-blue-500 bg-blue-50 border rounded-lg py-2'
            : 'flex-1 border rounded-lg py-2'
        }
      >
        Left
      </button>

      <button
        onClick={() =>
          update('searchPosition', 'right')
        }
        className={
          local.searchPosition === 'right'
            ? 'flex-1 border-blue-500 bg-blue-50 border rounded-lg py-2'
            : 'flex-1 border rounded-lg py-2'
        }
      >
        Right
      </button>

    </div>
  </div>
)}
<div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">
    Row
  </h4>

  <div className="flex gap-2">

    <button
      onClick={() =>
        update(
          'menuRow',
          'top'
        )
      }
      className={`flex-1 py-2 border rounded-lg ${
        local.menuRow === 'top'
          ? 'bg-blue-600 text-white border-blue-600'
          : 'border-gray-200'
      }`}
    >
      Top
    </button>

    <button
      onClick={() =>
        update(
          'menuRow',
          'bottom'
        )
      }
      className={`flex-1 py-2 border rounded-lg ${
        local.menuRow === 'bottom'
          ? 'bg-blue-600 text-white border-blue-600'
          : 'border-gray-200'
      }`}
    >
      Bottom
    </button>

  </div>
</div>

<div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">Divider Thickness</h4>

  <input
    type="range"
    min="0"
    max="5"
    className="w-full accent-blue-600"
    value={local.dividerThickness || 0}
    onChange={(e) =>
      update(
        'dividerThickness',
        Math.min(5, Number(e.target.value))
      )
    }
  />
</div>

{(local.dividerThickness || 0) > 0 && (

  <div>

    <label>Divider width</label>

    <div className="flex gap-2 mt-2">

      <button
        onClick={() =>
          update(
            'dividerWidth',
            'page'
          )
        }
        className={
          local.dividerWidth === 'page'
            ? 'flex-1 border-blue-500 bg-blue-50 border rounded-lg py-2'
            : 'flex-1 border rounded-lg py-2'
        }
      >
        Page
      </button>

      <button
        onClick={() =>
          update(
            'dividerWidth',
            'full'
          )
        }
        className={
          local.dividerWidth === 'full'
            ? 'flex-1 border-blue-500 bg-blue-50 border rounded-lg py-2'
            : 'flex-1 border rounded-lg py-2'
        }
      >
        Full
      </button>

    </div>

  </div>

)}

<div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">Border Thickness</h4>

  <input
    type="range"
    min="0"
    max="5"
    className="w-full accent-blue-600"
    value={local.borderThickness || 0}
    onChange={(e) =>
      update(
        'borderThickness',
        Math.min(5, Number(e.target.value))
      )
    }
  />
</div>

<div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">Header Height</h4>
  <input
    type="range"
    min="50"
    max="150"
    className="w-full accent-blue-600"
    value={local.desktopHeight}
    onChange={(e) =>
      update(
        'desktopHeight',
        Number(e.target.value)
      )
    }
  />
</div>
<div>
  <h4 className="text-sm font-semibold text-gray-900 mb-3">Width</h4>

  <select
    value={local.width}
    className="w-full border rounded-lg px-3 py-2 text-sm"
    onChange={(e) =>
      update(
        'borderWidth',
        e.target.value
      )
    }
  >
    <option value="page">
      Page
    </option>

    <option value="full">
      Full
    </option>
  </select>
</div>
      <hr className="border-gray-100" />

      {/* Colors */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-3">ألوان الهيدر</h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">خلفية الهيدر</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={local.background}
                onChange={(e) => update('background', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 p-0"
              />
              <span className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded border">
                {local.background?.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">لون النص</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={local.textColor}
                onChange={(e) => update('textColor', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 p-0"
              />
              <span className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded border">
                {local.textColor?.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

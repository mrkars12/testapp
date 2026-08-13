'use client'

import { EditorTab } from '../page'
import { Layout, Palette, Type, Settings, PanelLeft } from 'lucide-react'

interface ThemeSidebarProps {
  activeTab: EditorTab
  onTabChange: (tab: EditorTab) => void
}

const tabs: { id: EditorTab; label: string; icon: React.ElementType }[] = [
  { id: 'sections', label: 'الأقسام', icon: Layout },
  { id: 'colors', label: 'الألوان', icon: Palette },
  { id: 'typography', label: 'الخطوط', icon: Type },
  { id: 'header', label: 'الهيدر', icon: PanelLeft },
]

export default function ThemeSidebar({ activeTab, onTabChange }: ThemeSidebarProps) {
  return (
    <div className="flex border-b">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 text-xs font-medium transition-colors border-b-2 ${
              isActive
                ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon size={18} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

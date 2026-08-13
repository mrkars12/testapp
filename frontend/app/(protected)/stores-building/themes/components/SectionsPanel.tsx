'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  GripVertical,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Image,
  Star,
  Grid3X3,
  Type,
  Layout,
  Mail,
  GalleryHorizontal,
} from 'lucide-react'
import { ThemeSection } from '../page'

const SECTION_TYPES = [
  { type: 'hero',                label: 'بانر رئيسي',     icon: Image },
  { type: 'slideshow',           label: 'سليدر صور',       icon: GalleryHorizontal },
  { type: 'featured_collection', label: 'مجموعة مميزة',   icon: Star },
  { type: 'product_grid',        label: 'شبكة منتجات',    icon: Grid3X3 },
  { type: 'text_banner',         label: 'بانر نصي',       icon: Type },
  { type: 'rich_text',           label: 'نص منسق',        icon: Layout },
  { type: 'newsletter',          label: 'نشرة بريدية',    icon: Mail },
]

function SortableSectionItem({
  section,
  isSelected,
  onSelect,
  onToggle,
  onDelete,
}: {
  section: ThemeSection
  isSelected: boolean
  onSelect: (section: ThemeSection) => void
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border rounded-lg mb-2 overflow-hidden transition-all ${
        isSelected
          ? 'border-blue-500 ring-1 ring-blue-500 shadow-sm'
          : 'border-gray-200'
      } ${isDragging ? 'opacity-50 shadow-lg' : ''}`}
    >
      <div className="flex items-center p-3 bg-white">
        <button
          {...attributes}
          {...listeners}
          className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing mr-2 shrink-0"
        >
          <GripVertical size={16} />
        </button>

        <div
          className="flex-1 cursor-pointer min-w-0"
          onClick={() => onSelect(section)}
        >
          <div className="font-medium text-sm truncate">{section.name}</div>
          <div className="text-xs text-gray-400">{getSectionTypeLabel(section.type)}</div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle(section.id, !section.isActive)
            }}
            className={`p-1.5 rounded transition-colors ${
              section.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
            }`}
            title={section.isActive ? 'إخفاء' : 'إظهار'}
          >
            {section.isActive ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(section.id)
            }}
            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="حذف"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SectionsPanel({
  sections,
  selectedSection,
  onSelect,
  onAdd,
  onDelete,
  onToggle,
  onDragEnd,
  sensors,
}: {
  sections: ThemeSection[]
  selectedSection: ThemeSection | null
  onSelect: (section: ThemeSection) => void
  onAdd: (type: string) => void
  onDelete: (id: string) => void
  onToggle: (id: string, active: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
  sensors: any
}) {
  const [showAddMenu, setShowAddMenu] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">الأقسام</h3>
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
        >
          <Plus size={16} />
          إضافة
        </button>
      </div>

      {/* Add Section Menu */}
      {showAddMenu && (
        <div className="bg-gray-50 border rounded-lg p-3 mb-4">
          <div className="grid grid-cols-2 gap-2">
            {SECTION_TYPES.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => {
                  onAdd(type)
                  setShowAddMenu(false)
                }}
                className="flex flex-col items-center gap-2 p-3 bg-white border rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
              >
                <Icon size={20} className="text-gray-600" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sections List */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div>
            {sections.map((section) => (
              <SortableSectionItem
                key={section.id}
                section={section}
                isSelected={selectedSection?.id === section.id}
                onSelect={onSelect}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {sections.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
          لا توجد أقسام. أضف قسمًا للبدء.
        </div>
      )}
    </div>
  )
}

function getSectionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    hero: 'Hero Banner',
    slideshow: 'Slideshow',
    featured_collection: 'Featured Collection',
    product_grid: 'Product Grid',
    text_banner: 'Text Banner',
    image_banner: 'Image Banner',
    newsletter: 'Newsletter',
    rich_text: 'Rich Text',
    video: 'Video',
  }
  return labels[type] || type
}

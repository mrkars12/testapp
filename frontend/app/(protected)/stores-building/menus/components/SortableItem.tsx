'use client'

import {
  useSortable
} from '@dnd-kit/sortable'

import {
  CSS
} from '@dnd-kit/utilities'

import {
  GripVertical,
  ChevronRight,
  ChevronDown,
  Plus
} from 'lucide-react'

export default function SortableItem({
  item,
  active,
  onClick,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  onAddChild
}: any) {

  if (!item) {
    return null
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: String(item.id)
  })

  const style = {
    transform:
      CSS.Transform.toString(
        transform
      ),
    transition
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, marginLeft: depth * 28 }}
      onClick={onClick}
      className={`
        border
        rounded-xl
        bg-white
        cursor-pointer
        transition
        ${
          active
            ? 'border-black'
            : 'border-gray-200'
        }
      `}
    >
      {/* لما العنصر بيتسحب، بنسيب مكانه شبح شفاف بس (المحتوى الحقيقي
          بيطفو في الـ DragOverlay فوق كل حاجة) — كده مفيش تكسير في
          الليستة أثناء السحب */}
      <div
        className="flex items-center p-4"
        style={{ opacity: isDragging ? 0.35 : 1 }}
      >

        <button
          type="button"
          {...attributes}
          {...listeners}
          className="
            mr-3
            text-gray-400
            cursor-grab
            active:cursor-grabbing
          "
        >
          <GripVertical size={18} />
        </button>

        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand?.()
            }}
            className="mr-2 text-gray-500 flex-shrink-0"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="mr-2 w-4 flex-shrink-0" />
        )}

        <div className="flex-1">
          <div className="font-medium">
            {item.title}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {item.url}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAddChild?.()
          }}
          title="Add menu item here"
          className="
            ml-2
            flex-shrink-0
            text-gray-400
            hover:text-black
            hover:bg-gray-100
            rounded-md
            p-1.5
            transition
          "
        >
          <Plus size={16} />
        </button>

      </div>
    </div>
  )
}

/** الشكل اللي بيطفو مع الماوس أثناء السحب — منفصل عن الـ layout
    الأساسي عشان يفضل نظيف ومش متأثر بحركة باقي العناصر */
export function DragOverlayItem({ item }: { item: any }) {
  if (!item) return null
  return (
    <div
      className="border-2 border-black rounded-xl bg-white shadow-2xl"
      style={{ width: 480, cursor: 'grabbing' }}
    >
      <div className="flex items-center p-4">
        <span className="mr-3 text-gray-400">
          <GripVertical size={18} />
        </span>
        <div className="flex-1">
          <div className="font-medium">{item.title}</div>
          <div className="text-xs text-gray-500 mt-1">{item.url}</div>
        </div>
      </div>
    </div>
  )
}

/** خط المؤشر — بيوريك هيتحط فين بالظبط وعلى أي مستوى تداخل */
export function DropIndicator({ depth }: { depth: number }) {
  return (
    <div
      style={{ marginLeft: depth * 28 }}
      className="flex items-center gap-2 py-1"
    >
      <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
      <span className="h-[2px] flex-1 bg-blue-500 rounded-full" />
    </div>
  )
}
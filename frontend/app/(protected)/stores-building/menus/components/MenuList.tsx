'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'

import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'

import SortableItem, { DragOverlayItem, DropIndicator } from './SortableItem'

const INDENT = 28 // بكسل لكل مستوى تداخل — لازم يتطابق مع اللي في SortableItem

interface FlatNode {
  id: string
  parentId: string | null
  depth: number
  item: any
  hasChildren: boolean
}

/** بيبني شجرة من الـ flat array بالاعتماد على parent_id */
function buildTree(flat: any[]) {
  const map = new Map<string, any>()
  flat.forEach((item) => map.set(String(item.id), { ...item, children: [] }))

  const roots: any[] = []
  flat.forEach((item) => {
    const node = map.get(String(item.id))
    const parentId = item.parent_id ? String(item.parent_id) : null
    if (parentId && map.has(parentId)) {
      map.get(parentId).children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortRec = (nodes: any[]) => {
    nodes.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

/** بيحول الشجرة للستة فلات بترتيب العرض (DFS) — أي عنصر مقفول
    (collapsed) بنستبعد أبناءه من الليستة دي مؤقتًا */
function flatten(
  tree: any[],
  expandedIds: Set<string>,
  depth = 0,
  parentId: string | null = null,
): FlatNode[] {
  let out: FlatNode[] = []
  for (const node of tree) {
    out.push({
      id: String(node.id),
      parentId,
      depth,
      item: node,
      hasChildren: node.children.length > 0,
    })
    if (node.children.length > 0 && expandedIds.has(String(node.id))) {
      out = out.concat(flatten(node.children, expandedIds, depth + 1, String(node.id)))
    }
  }
  return out
}

function collectAllParentIds(nodes: any[], acc: Set<string> = new Set()) {
  nodes.forEach((n) => {
    if (n.children.length > 0) {
      acc.add(String(n.id))
      collectAllParentIds(n.children, acc)
    }
  })
  return acc
}

/**
 * بيحسب العمق (depth) والأب الجديد المسموح بيهم للعنصر المسحوب،
 * بناءً على مكانه الجديد بين العنصر اللي قبله واللي بعده + مقدار
 * سحبه الأفقي (يمين = أعمق/nested، شمال = يطلع لبره).
 */
function getProjection(
  flatItems: FlatNode[],
  activeId: string,
  overId: string,
  dragOffsetX: number,
) {
  const activeIndex = flatItems.findIndex((i) => i.id === activeId)
  const overIndex = flatItems.findIndex((i) => i.id === overId)
  if (activeIndex === -1 || overIndex === -1) return null

  const newItems = arrayMove(flatItems, activeIndex, overIndex)
  const previousItem = newItems[overIndex - 1]
  const nextItem = newItems[overIndex + 1]

  const dragDepthDelta = Math.round(dragOffsetX / INDENT)
  const projectedDepth = flatItems[activeIndex].depth + dragDepthDelta

  const maxDepth = previousItem ? previousItem.depth + 1 : 0
  const minDepth = nextItem ? nextItem.depth : 0

  let depth = projectedDepth
  if (depth > maxDepth) depth = maxDepth
  if (depth < minDepth) depth = minDepth

  let parentId: string | null = null
  if (depth > 0 && previousItem) {
    if (depth === previousItem.depth) {
      parentId = previousItem.parentId
    } else if (depth > previousItem.depth) {
      parentId = previousItem.id
    } else {
      parentId =
        newItems
          .slice(0, overIndex)
          .reverse()
          .find((i) => i.depth === depth)?.parentId ?? null
    }
  }

  return { depth, parentId, overIndex }
}

export default function MenuList({
  menu,
  items,
  selectedItem,
  onSelectItem,
  onAddItem,
  setSelectedMenu,
  setDirty,
}: any) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [offsetX, setOffsetX] = useState(0)

  const tree = useMemo(() => buildTree(items), [items])

  /* أي أب عنده أبناء يتفتح تلقائيًا */
  useEffect(() => {
    const parentIds = collectAllParentIds(tree)
    setExpandedIds((prev) => new Set([...prev, ...parentIds]))
  }, [tree])

  const flatItems = useMemo(() => flatten(tree, expandedIds), [tree, expandedIds])

  const projected =
    activeId && overId ? getProjection(flatItems, activeId, overId, offsetX) : null

  const activeItem = activeId ? flatItems.find((f) => f.id === activeId)?.item : null

  function toggleExpand(id: any) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      const key = String(id)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleDragStart(event: any) {
    setActiveId(String(event.active.id))
  }

  function handleDragMove(event: any) {
    setOverId(event.over ? String(event.over.id) : null)
    setOffsetX(event.delta.x)
  }

  function handleDragCancel() {
    setActiveId(null)
    setOverId(null)
    setOffsetX(0)
  }

  function handleDragEnd(event: any) {
    const { active, over } = event
    const finalProjection = projected
    setActiveId(null)
    setOverId(null)
    setOffsetX(0)

    if (!over || !finalProjection) return

    const activeIndexFlat = flatItems.findIndex((i) => i.id === String(active.id))
    const overIndexFlat = flatItems.findIndex((i) => i.id === String(over.id))
    if (activeIndexFlat === -1 || overIndexFlat === -1) return

    const newFlat = arrayMove(flatItems, activeIndexFlat, overIndexFlat)
    const activeFlatIndexInNew = newFlat.findIndex((i) => i.id === String(active.id))
    newFlat[activeFlatIndexInNew] = {
      ...newFlat[activeFlatIndexInNew],
      parentId: finalProjection.parentId,
      depth: finalProjection.depth,
    }

    /* نحسب sort_order الجديد لكل مجموعة (نفس الأب) حسب ترتيبها الجديد */
    const groups: Record<string, FlatNode[]> = {}
    newFlat.forEach((f) => {
      const key = f.parentId ?? 'root'
      if (!groups[key]) groups[key] = []
      groups[key].push(f)
    })

    const idToNewParent = new Map<string, string | null>()
    const idToNewSortOrder = new Map<string, number>()
    Object.values(groups).forEach((group) => {
      group.forEach((f, idx) => {
        idToNewParent.set(f.id, f.parentId)
        idToNewSortOrder.set(f.id, idx)
      })
    })

    const newItems = items.map((i: any) => {
      const key = String(i.id)
      if (!idToNewParent.has(key)) return i
      return {
        ...i,
        parent_id: idToNewParent.get(key),
        sort_order: idToNewSortOrder.get(key),
      }
    })

    setSelectedMenu({ ...menu, items: newItems })
    setDirty(true)

    if (finalProjection.parentId) {
      setExpandedIds((prev) => new Set([...prev, finalProjection.parentId as string]))
    }
  }

  return (
    <div className="bg-white border rounded-2xl">
      <div className="p-5 border-b">
        <h2 className="font-semibold text-lg">Menu items</h2>
        <p className="text-xs text-gray-400 mt-1">
          اسحب العنصر لليمين وأنت بتحركه فوق عنصر تاني عشان يتحط جواه (nested).
        </p>
      </div>

      <div className="p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={flatItems.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {flatItems.map((f, idx) => (
                <div key={f.id}>
                  {/* خط المؤشر يظهر فوق العنصر اللي هيتحط قبله، على العمق المتوقع */}
                  {activeId && overId === f.id && projected && f.id !== activeId && (
                    <DropIndicator depth={projected.depth} />
                  )}

                  <SortableItem
                    item={f.item}
                    active={selectedItem?.id === f.item.id}
                    onClick={() => onSelectItem(f.item)}
                    depth={f.depth}
                    hasChildren={f.hasChildren}
                    expanded={expandedIds.has(f.id)}
                    onToggleExpand={() => toggleExpand(f.id)}
                    onAddChild={() => onAddItem(f.item.id)}
                  />
                </div>
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeItem ? <DragOverlayItem item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>

        <button
          onClick={() => onAddItem()}
          className="
          mt-4
          w-full
          border
          border-dashed
          rounded-xl
          py-3
          hover:bg-gray-50
        "
        >
          + Add menu item
        </button>
      </div>
    </div>
  )
}
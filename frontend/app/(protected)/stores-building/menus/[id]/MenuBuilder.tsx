'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'

import EmptyState from '../components/EmptyState'
import MenuList from '../components/MenuList'
import MenuItemEditor from '../components/MenuItemEditor'
import LinkPicker from '../components/LinkPicker'
import SaveBar from '../components/SaveBar'

export default function MenuBuilder({
  menuId
}: {
  menuId: string
}) {
    const [menus, setMenus] = useState<any[]>([])
    const [selectedMenu, setSelectedMenu] =
      useState<any>(null)

    const [selectedItem, setSelectedItem] =
      useState<any>(null)

    const [editingItem, setEditingItem] =
      useState<any>(null)

    const [pickerOpen, setPickerOpen] =
      useState(false)

    const [addParentId, setAddParentId] = 
      useState<string | null>(null)

    const [dirty, setDirty] =
      useState(false)

    const [saving, setSaving] =
      useState(false)

    const [loading, setLoading] =
      useState(true)

    const [selectedMenuId, setSelectedMenuId] =
      useState<string | null>(null)

    const [menuName, setMenuName] =
    useState('')



  async function loadMenu() {
  try {

    const res =
      await api.get(
        `/stores/menus/${menuId}`
      )

    const menu = res.data

    setSelectedMenu(menu)

    if (selectedItem) {

      const freshItem =
        menu.items?.find(
          (x: any) =>
            String(x.id) ===
            String(selectedItem.id)
        )

      if (freshItem) {
        setSelectedItem(freshItem)
      }
    }

  } finally {
    setLoading(false)
  }
  }

  useEffect(() => {
    loadMenu()
  }, [menuId])

  useEffect(() => {
    if (selectedMenu) {
      setMenuName(selectedMenu.name)
    }
  }, [selectedMenu])


  useEffect(() => {

    function handler(event: any) {

      const id = event.detail.id

      const found =
        selectedMenu?.items?.find(
          (x: any) =>
            String(x.id) === String(id)
        )

      if (found) {
        setSelectedItem(found)
      }
    }

    window.addEventListener(
      'menu-item-updated',
      handler
    )

    return () =>
      window.removeEventListener(
        'menu-item-updated',
        handler
      )

  }, [selectedMenu])

    async function createMainMenu() {
      await api.post('/stores/menus', {
        name: 'Main menu'
      })

      await loadMenu()
    }

    function handleSelectItem(item: any) {
      setSelectedItem(item)
    }

    function updateLocalItem(
      itemId: string,
      changes: any
    ) {
      const updatedItems =
        selectedMenu.items.map(
          (item: any) =>
            String(item.id) ===
            String(itemId)
              ? {
                  ...item,
                  ...changes
                }
              : item
        )

      setSelectedMenu({
        ...selectedMenu,
        items: updatedItems
      })

      const item =
        updatedItems.find(
          (x: any) =>
            String(x.id) ===
            String(itemId)
        )

      setSelectedItem(item)

      setDirty(true)
    }

    // stores-building/menus/[id]/MenuBuilder.tsx

async function saveChanges() {
  if (!selectedMenu) return

  try {
    setSaving(true)

    await api.put(
      `/stores/menus/${selectedMenu.id}`,
      {
        name: menuName,
      }
    )

    for (const item of selectedMenu.items) {
      await api.put(
        `/stores/menus/items/${item.id}`,
        {
          title: item.title,
          url: item.url,
          type: item.type,
        }
      )
    }

    const groups: Record<string, any[]> = {}
    for (const item of selectedMenu.items) {
      const key = item.parent_id ? String(item.parent_id) : 'root'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
    const reorderPayload: { id: any; sortOrder: number; parentId: any }[] = []
    Object.values(groups).forEach((group) => {
      group.forEach((item, idx) => {
        reorderPayload.push({
          id: item.id,
          sortOrder: idx,
          parentId: item.parent_id || null,
        })
      })
    })

    await api.post(
      '/stores/menus/reorder',
      { items: reorderPayload }
    )
    await api.post('/stores/theme/publish')

      await loadMenu()

        setDirty(false)
      } finally {
        setSaving(false)
      }
    }

    async function deleteItem(id: string) {
      await api.delete(`/stores/menus/items/${id}`)  // ✅ DELETE
      setSelectedItem(null)
      await loadMenu()
    }

    async function deleteItem(id: string) {
      await api.delete(
        `/stores/menus/items/${id}`
      )

      setSelectedItem(null)

      await loadMenu()
    }

    const items = useMemo(
      () => selectedMenu?.items || [],
      [selectedMenu]
    )

    if (loading) {
      return (
        <div className="p-10">
          Loading...
        </div>
      )
    }

    if (!selectedMenu) {
      return (
        <EmptyState
          onCreate={createMainMenu}
        />
      )
    }

    return (
      <div className="max-w-7xl mx-auto p-8">

        <div className="mb-6">

          <div className="flex items-center justify-between">

            <div>

              <button
                onClick={() =>
                  window.location.href =
                  '/stores-building/menus'
                }
                className="
                  text-sm
                  text-gray-500
                  mb-2
                "
              >
                ← Menus
              </button>

              <h1 className="text-2xl font-semibold">
                {selectedMenu.name}
              </h1>

            </div>

            <button
              onClick={async () => {

                await api.post(
                  `/stores/menus/${selectedMenu.id}/duplicate`
                )

                location.href =
                  '/stores-building/menus'
              }}
              className="
                px-4 py-2
                border
                rounded-lg
              "
            >
              Duplicate
            </button>

          </div>

        </div>

        <div className="grid grid-cols-12 gap-6">

          <div className="col-span-7">

            <div className="bg-white border rounded-xl p-5 mb-6">

              <label className="block text-sm mb-2">
                Name
              </label>

              <input
                value={menuName}
                onChange={(e) => {
                  setMenuName(e.target.value)
                  setDirty(true)
                }}
                className="w-full border rounded-lg px-3 py-2"
              />

              <p className="mt-3 text-sm text-gray-500">

                Handle:

                {' '}

                {selectedMenu.handle}

              </p>

            </div>

            <MenuList
              menu={selectedMenu}
              items={items}
              onSelectItem={
                handleSelectItem
              }
              selectedItem={
                selectedItem
              }
              onAddItem={(parentId?: string) => {
                setEditingItem(null)
                setAddParentId(parentId || null)
                setPickerOpen(true)
              }}
              setSelectedMenu={
                setSelectedMenu
              }
              setDirty={setDirty}
            />

          </div>

        <div className="col-span-5">

            <MenuItemEditor
              item={selectedItem}
              onDelete={deleteItem}
              onChange={updateLocalItem}
              onOpenLinkPicker={(item: any) => {
                setSelectedItem(item)
                setPickerOpen(true)
              }}
            />

          </div>

        </div>

        {pickerOpen && (
          <LinkPicker
            menuId={selectedMenu.id}
            editingItem={selectedItem}
            parentId={addParentId}
            onClose={() =>
              setPickerOpen(false)
            }
            onAdded={async (itemId: any) => {
              await loadMenu()
              if (itemId) {

                const menuRes =
                  await api.get('/stores/menus')

                const menu =
                  menuRes.data?.find(
                    (m: any) =>
                      String(m.id) ===
                      String(selectedMenu.id)
                  )

                const freshItem =
                  menu?.items?.find(
                    (i: any) =>
                      String(i.id) ===
                      String(itemId)
                  )

                if (freshItem) {
                  setSelectedItem(freshItem)
                }
              }
            }}
          />
        )}

        {dirty && (
          <SaveBar
            saving={saving}
            onSave={saveChanges}
          />
        )}
      </div>
    )
}
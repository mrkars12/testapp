'use client'

import { Link2, Trash2 } from 'lucide-react'

export default function MenuItemEditor({
  item,
  onDelete,
  onChange,
  onOpenLinkPicker
}: any) {
  if (!item) {
    return (
      <div className="bg-white border rounded-xl p-6">
        <h3 className="font-semibold text-lg">
          Menu item
        </h3>

        <p className="mt-2 text-sm text-gray-500">
          Select a menu item
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border rounded-xl overflow-hidden">

      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold text-lg">
          Menu item
        </h3>
      </div>

      <div className="p-5 space-y-5">

        <div>
          <label className="block text-sm font-medium mb-2">
            Label
          </label>

          <input
            value={item.title || ''}
            onChange={(e) =>
              onChange(item.id, {
                title: e.target.value
              })
            }
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Link
          </label>

          <button
            onClick={() =>
              onOpenLinkPicker(item)
            }
            className="
              w-full
              border
              rounded-lg
              px-3
              py-2
              flex
              items-center
              gap-2
              text-left
              hover:bg-gray-50
            "
          >
            <Link2 size={16} />

            <span className="truncate">
  {item.type === 'HOME'
    ? 'Home page'
    : item.type === 'SEARCH'
    ? 'Search'
    : item.type === 'ORDERS'
    ? 'Orders'
    : item.type === 'PROFILE'
    ? 'Profile'
    : item.url}
</span>
          </button>
        </div>

        <div className="pt-4 border-t">

          <button
            onClick={() =>
              onDelete(
                String(item.id)
              )
            }
            className="
              flex
              items-center
              gap-2
              text-red-600
            "
          >
            <Trash2 size={16} />

            Delete menu item
          </button>

        </div>

      </div>

    </div>
  )
}
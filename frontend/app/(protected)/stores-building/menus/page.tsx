'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRouter } from 'next/navigation'

export default function Page() {
  const [menus, setMenus] = useState<any[]>([])
  const router = useRouter()

  async function load() {
    const res = await api.get('/stores/menus')
    setMenus(res.data || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function createMenu() {
    const res = await api.post(
      '/stores/menus',
      {
        name: 'New menu'
      }
    )

    router.push(
      `/stores-building/menus/${res.data.id}`
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-8">

      <div className="bg-white border rounded-xl overflow-hidden">

        <div className="flex items-center justify-between p-4 border-b">

          <h1 className="font-semibold text-xl">
            Menus
          </h1>

          <button
            onClick={createMenu}
            className="
              px-4 py-2
              bg-black
              text-white
              rounded-lg
            "
          >
            Create menu
          </button>

        </div>

        <table className="w-full">

          <thead>

            <tr className="border-b">

              <th className="text-left p-4">
                Menu
              </th>

              <th className="text-left p-4">
                Menu items
              </th>

            </tr>

          </thead>

          <tbody>

            {menus.map((menu) => (

              <tr
                key={menu.id}
                className="
                  border-b
                  hover:bg-gray-50
                  cursor-pointer
                "
                onClick={() =>
                  router.push(
                    `/stores-building/menus/${menu.id}`
                  )
                }
              >

                <td className="p-4">
                  {menu.name}
                </td>

                <td className="p-4 text-gray-500">

                  {menu.items
                    ?.slice(0, 10)
                    ?.map((x: any) => x.title)
                    ?.join(', ')}

                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </div>
  )
}
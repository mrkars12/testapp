'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useRouter } from 'next/navigation'
import { useActiveStoreReady } from '@/lib/useActiveStoreReady'
import { useStorePath } from '@/lib/storePath'

export default function Page() {
  const storePath = useStorePath()
  const { storeSlug: activeStoreSlug, ready: activeStoreReady } = useActiveStoreReady()
  const storeSlug = activeStoreSlug || ''
  const [menus, setMenus] = useState<any[]>([])
  const router = useRouter()

  async function load(signal?: AbortSignal) {
    try {
      const res = await api.get('/stores/menus', { signal })
      if (signal?.aborted) return
      setMenus(res.data || [])
    } catch (err: any) {
      if (err?.silent || err?.code === 'ERR_CANCELED') return
      if (err?.response?.status === 404) router.replace('/store')
    }
  }

  useEffect(() => {
    if (!activeStoreReady || !storeSlug) return
    setMenus([])
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [storeSlug, activeStoreReady])

  async function createMenu() {
    const res = await api.post('/stores/menus', { name: 'New menu' })
    router.push(storePath(`menus/${res.data.id}`))
  }

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h1 className="font-semibold text-xl">Menus</h1>
          <button onClick={createMenu} className="px-4 py-2 bg-black text-white rounded-lg">Create menu</button>
        </div>
        {activeStoreReady && !storeSlug && (
          <div className="p-8 text-center">
            <p className="font-semibold text-gray-700">لا يوجد متجر نشط</p>
            <a href="/store" className="text-sm text-blue-600 hover:underline">اختيار متجر</a>
          </div>
        )}
        <table className="w-full">
          <thead><tr className="border-b"><th className="text-left p-4">Menu</th><th className="text-left p-4">Menu items</th></tr></thead>
          <tbody>
            {menus.map((menu) => (
              <tr key={menu.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => router.push(storePath(`menus/${menu.id}`))}>
                <td className="p-4">{menu.name}</td>
                <td className="p-4 text-gray-500">{menu.items?.slice(0, 10)?.map((x: any) => x.title)?.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

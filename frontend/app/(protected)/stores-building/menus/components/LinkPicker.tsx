'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'

import {
  Home,
  Search,
  ChevronRight,
  FileText,
  Shield,
  Package,
  User,
  ArrowLeft,
  X
} from 'lucide-react'

export default function LinkPicker({
  menuId,
  editingItem,
  parentId,
  onClose,
  onAdded
}: any) {
  const [data, setData] = useState<any>(null)
  const [view, setView] = useState('root')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const res = await api.get('/stores/link-picker')
    setData(res.data)
  }

// stores-building/menus/components/LinkPicker.tsx

async function createItem(title: string, url: string, type: string) {
  if (editingItem) {
    // Update existing - PUT
    const res = await api.put(`/stores/menus/items/${editingItem.id}`, {
      title,
      url,
      type,
    })
    await onAdded(res.data)
  } else {
    // Create new - POST (لو parentId موجود، العنصر بيتحط جوه الأب ده)
    await api.post(`/stores/menus/${menuId}/items`, {
      title,
      url,
      type,
      parent_id: parentId || null,
    })
    await onAdded()
  }
  onClose()
}

  if (!data) return null

  function BackButton() {
    return (
      <button
        onClick={() => setView('root')}
        className="flex items-center gap-2 text-sm mb-3"
      >
        <ArrowLeft size={16} />
        Back
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">

      <div className="bg-white w-[520px] rounded-2xl overflow-hidden shadow-2xl">

        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="font-semibold">
            Online store
          </h3>

          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[600px] overflow-y-auto">

          {view === 'root' && (
            <>
              <button
                onClick={() =>
                  createItem(
                    'Home page',
                    '/',
                    'HOME'
                  )
                }
                className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50"
              >
                <Home size={18} />
                Home page
              </button>

              <button
                onClick={() =>
                  createItem(
                    'Search',
                    '/search',
                    'SEARCH'
                  )
                }
                className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50"
              >
                <Search size={18} />
                Search
              </button>

              <button
                onClick={() =>
                  setView('collections')
                }
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-50"
              >
                <span>Collections</span>
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() =>
                  setView('products')
                }
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-50"
              >
                <span>Products</span>
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() =>
                  setView('pages')
                }
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-50"
              >
                <span>Pages</span>
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() =>
                  setView('blogs')
                }
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-50"
              >
                <span>Blogs</span>
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() =>
                  setView('blogPosts')
                }
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-50"
              >
                <span>Blog posts</span>
                <ChevronRight size={16} />
              </button>

              <button
                onClick={() =>
                  setView('policies')
                }
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-gray-50"
              >
                <span>Policies</span>
                <ChevronRight size={16} />
              </button>

              <div className="px-4 py-2 text-xs text-gray-500 uppercase">
                Customer accounts
              </div>

              <button
                onClick={() =>
                  createItem(
                    'Orders',
                    '/account/orders',
                    'ORDERS'
                  )
                }
                className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50"
              >
                <Package size={18} />
                Orders
              </button>

              <button
                onClick={() =>
                  createItem(
                    'Profile',
                    '/account/profile',
                    'PROFILE'
                  )
                }
                className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50"
              >
                <User size={18} />
                Profile
              </button>
            </>
          )}

          {view === 'pages' && (
            <div className="p-4">
              <BackButton />

              {data.pages?.map((page: any) => (
                <button
                  key={page.id}
                  onClick={() =>
                    createItem(
                      page.title,
                      '/' + page.slug,
                      'PAGE'
                    )
                  }
                  className="flex items-center gap-2 w-full p-3 rounded-lg hover:bg-gray-50"
                >
                  <FileText size={16} />
                  {page.title}
                </button>
              ))}
            </div>
          )}

          {view === 'collections' && (
            <div className="p-4">

              <BackButton />

              {data.collections?.length > 0 ? (

                data.collections.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      createItem(
                        item.title,
                        item.url,
                        'COLLECTION'
                      )
                    }
                    className="w-full text-left p-3 rounded-lg hover:bg-gray-50"
                  >
                    {item.title}
                  </button>
                ))

              ) : (

                <button
                  onClick={() => {
                    window.location.href =
                      '/stores-building/collections/new'
                  }}
                  className="
                    w-full
                    border
                    border-dashed
                    rounded-xl
                    py-4
                    text-sm
                    font-medium
                    hover:bg-gray-50
                  "
                >
                  + Create collection
                </button>

              )}

            </div>
          )}

          {view === 'products' && (
            <div className="p-4">

              <BackButton />

              {data.products?.length > 0 ? (

                data.products.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      createItem(
                        item.title,
                        item.url,
                        'PRODUCT'
                      )
                    }
                    className="w-full text-left p-3 rounded-lg hover:bg-gray-50"
                  >
                    {item.title}
                  </button>
                ))

              ) : (

                <button
                  onClick={() => {
                    window.location.href =
                      '/stores-building/products/new'
                  }}
                  className="
                    w-full
                    border
                    border-dashed
                    rounded-xl
                    py-4
                    text-sm
                    font-medium
                    hover:bg-gray-50
                  "
                >
                  + Create product
                </button>

              )}

            </div>
          )}

          {view === 'blogs' && (
            <div className="p-4">

              <BackButton />

              {data.blogs?.length > 0 ? (

                data.blogs.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      createItem(
                        item.title,
                        item.url,
                        'BLOG'
                      )
                    }
                    className="w-full text-left p-3 rounded-lg hover:bg-gray-50"
                  >
                    {item.title}
                  </button>
                ))

              ) : (

                <button
                  onClick={() => {
                    window.location.href =
                      '/stores-building/blogs/new'
                  }}
                  className="
                    w-full
                    border
                    border-dashed
                    rounded-xl
                    py-4
                    text-sm
                    font-medium
                    hover:bg-gray-50
                  "
                >
                  + Create blog
                </button>

              )}

            </div>
          )}

          {view === 'blogPosts' && (
            <div className="p-4">

              <BackButton />

              {data.blogPosts?.length > 0 ? (

                data.blogPosts.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      createItem(
                        item.title,
                        item.url,
                        'BLOG'
                      )
                    }
                    className="w-full text-left p-3 rounded-lg hover:bg-gray-50"
                  >
                    {item.title}
                  </button>
                ))

              ) : (

                <button
                  onClick={() => {
                    window.location.href =
                      '/stores-building/blog-posts/new'
                  }}
                  className="
                    w-full
                    border
                    border-dashed
                    rounded-xl
                    py-4
                    text-sm
                    font-medium
                    hover:bg-gray-50
                  "
                >
                  + Create blog post
                </button>

              )}

            </div>
          )}

          {view === 'policies' && (
            <div className="p-4">
              <BackButton />

              {data.policies?.map((item: any) => (
                <button
                  key={item.url}
                  onClick={() =>
                    createItem(
                      item.title,
                      item.url,
                      'POLICY'
                    )
                  }
                  className="flex items-center gap-2 w-full p-3 rounded-lg hover:bg-gray-50"
                >
                  <Shield size={16} />
                  {item.title}
                </button>
              ))}
            </div>
          )}

        </div>

      </div>

    </div>
  )
}
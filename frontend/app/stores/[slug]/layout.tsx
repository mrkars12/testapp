'use client'

import { useParams } from 'next/navigation'
import { StoreProvider, useStore } from './components/StoreContext'
import Header from './components/Header'

function StoreShell({ children }: { children: React.ReactNode }) {
  const { store, loading, errorMsg } = useStore()

  if (loading) {
    return (
      <div className="text-center mt-20 text-gray-500 font-sans animate-pulse">
        جاري فتح المتجر...
      </div>
    )
  }

  if (errorMsg || !store) {
    return (
      <div className="text-center mt-20 text-red-500 font-sans p-4 bg-red-50 rounded-xl max-w-md mx-auto border border-red-100">
        {errorMsg || 'عذراً، هذا المتجر غير موجود حالياً!'}
      </div>
    )
  }

  const theme = store.theme || {}

  return (
    <div className="min-h-screen" style={{ backgroundColor: theme.colors?.background || '#ffffff' }}>
      <Header store={store} />

      {children}

      <footer
        className="py-12 px-6"
        style={{
          backgroundColor: theme.colors?.footerBg || '#0f172a',
          color: theme.colors?.footerText || '#ffffff',
        }}
      >
        <div className="max-w-7xl mx-auto text-center">
          <h3 className="text-lg font-bold mb-2">{store.name}</h3>
          <p className="opacity-70 text-sm">© 2026 جميع الحقوق محفوظة</p>
        </div>
      </footer>
    </div>
  )
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const storeSlug = (params?.slug as string) || ''

  return (
    <StoreProvider storeSlug={storeSlug}>
      <StoreShell>{children}</StoreShell>
    </StoreProvider>
  )
}
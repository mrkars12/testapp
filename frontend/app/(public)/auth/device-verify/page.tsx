// page.tsx
import { Suspense } from 'react'
import OAuthDeviceVerifyClient from './OAuthDeviceVerifyClient'

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>}>
      <OAuthDeviceVerifyClient />
    </Suspense>
  )
}
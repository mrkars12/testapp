// app/(public)/auth/oauth-success/page.tsx
import { Suspense } from 'react'
import OAuthSuccessClient from './OAuthSuccessClient'

export default function OAuthSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <OAuthSuccessClient />
    </Suspense>
  )
}
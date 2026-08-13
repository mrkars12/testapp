import { Suspense } from 'react'
import OAuthMessageClient from './OAuthMessageClient'
export default function Page() {
  return <Suspense fallback={null}><OAuthMessageClient /></Suspense>
}
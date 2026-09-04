import { Suspense } from 'react'
import SelectStoreClient from './SelectStoreClient'

export const dynamic = 'force-dynamic'

export default function SelectStorePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-white z-[999999]" />}>
      <SelectStoreClient />
    </Suspense>
  )
}

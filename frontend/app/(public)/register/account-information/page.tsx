// app/(public)/register/account-information/page.tsx

import { Suspense } from 'react'
import RegisterStep2Client from './RegisterStep2Client'
import NeutralAuthShell from '@/components/NeutralAuthShell'

export default function RegisterAccountInformation() {
  return (
    <Suspense fallback={<NeutralAuthShell />}>
      <RegisterStep2Client />
    </Suspense>
  )
}

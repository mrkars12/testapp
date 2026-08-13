'use client'

import { useAuthState }
from '@/lib/authState'

export default function AuthGuard({

  children

}: {

  children: React.ReactNode

}) {

  const { status } =
    useAuthState()

  if (
    status === 'logging_out'
  ) {

    return <div className="fixed inset-0 bg-white z-[999999]" />
  }

  return children
}
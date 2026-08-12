'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function OAuthMessageClient() {
  const params = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const t = params.get('t')
    if (t) {
      try {
        // فك التشفير
        const msg = Buffer.from(t, 'base64').toString('utf-8')
        sessionStorage.setItem('oauth_msg', msg)
      } catch {}
    }
    router.replace('/login')
  }, [])

  return null
}
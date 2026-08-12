'use client'
import { useEffect, useRef } from 'react'

export default function Turnstile({ onVerify }: any) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!window.turnstile) {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }

    const t = setTimeout(() => {
      if (window.turnstile && ref.current) {
        window.turnstile.render(ref.current, {
          sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
          callback: onVerify,
        })
      }
    }, 500)

    return () => clearTimeout(t)
  }, [])

  return <div ref={ref} className="flex justify-center my-4" />
}

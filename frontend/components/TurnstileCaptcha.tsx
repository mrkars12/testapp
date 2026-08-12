'use client'

import { useEffect, useRef } from 'react'
import { loadTurnstile } from '@/lib/turnstile-loader'

type Props = {
  onVerify: (token: string) => void
  onError?: () => void
  onExpired?: () => void
}

export default function TurnstileCaptcha(props: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const callbacks = useRef(props)

  // 👈 خزّن callbacks بدون ما تعمل re-render
  callbacks.current = props

  useEffect(() => {
    loadTurnstile().then(() => {
      if (!ref.current || widgetId.current) return

      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
        callback: (t) => callbacks.current.onVerify(t),
        'error-callback': () => callbacks.current.onError?.(),
        'expired-callback': () => callbacks.current.onExpired?.(),
      })
    })

    return () => {
      if (widgetId.current) {
        window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [])

  return <div ref={ref} />
}

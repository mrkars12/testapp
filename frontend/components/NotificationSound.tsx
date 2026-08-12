'use client'

import { useEffect, useRef } from 'react'

export default function NotificationSound() {
  const lastSoundRef = useRef(0)

  const playSound = () => {
    const now = Date.now()
    if (now - lastSoundRef.current < 800) return
    lastSoundRef.current = now

    if (!window.__AUDIO_UNLOCKED__) return

    const audio = new Audio('/assets/notification.mp3')
    audio.volume = 0.6
    audio.play().catch(() => {})
  }

  useEffect(() => {
    const unlock = () => {
      const audio = new Audio('/assets/notification.mp3')
      audio.volume = 0

      audio.play().then(() => {
        audio.pause()
        window.__AUDIO_UNLOCKED__ = true
      }).catch(() => {})

      window.removeEventListener('click', unlock)
    }

    window.addEventListener('click', unlock)
    return () => window.removeEventListener('click', unlock)
  }, [])

  useEffect(() => {
    const bc = new BroadcastChannel('notifications_channel')

    bc.onmessage = (event) => {
      if (event.data?.type === 'NOTIFICATION_SOUND') {
        playSound()
      }
    }

    return () => bc.close()
  }, [])

  return null
}
'use client'

import { useEffect, useState } from 'react'

interface Props {
  until: number | null
}

export default function Countdown({ until }: Props) {

  const [, force] = useState(0)

  useEffect(() => {
    if (!until) return

    const interval = setInterval(() => {
      force(v => v + 1)
    }, 500)

    return () => clearInterval(interval)
  }, [until])

  if (!until) return null

  const remaining = Math.max(
    0,
    Math.floor(until - Date.now() / 1000)
  )

  if (remaining <= 0) return <>الآن</>

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60

  return (
    <>
      {minutes > 0 && `${minutes} دقيقة `}
      {seconds} ثانية
    </>
  )
}
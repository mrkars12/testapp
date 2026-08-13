'use client'

import { useEffect } from 'react'
import api from '@/lib/api'

export default function CsrfInit() {
  useEffect(() => {
    const hasToken = document.cookie
      .split('; ')
      .some(row => row.startsWith('XSRF-TOKEN='))

    if (!hasToken) {
      api.get('/sanctum/csrf-cookie')
    }
  }, [])

  return null
}

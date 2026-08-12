let loadingPromise: Promise<void> | null = null

export function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()

  // لو اتحمّل خلاص
  if ((window as any).turnstile) {
    return Promise.resolve()
  }

  // لو في تحميل شغال
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    document.head.appendChild(script)
  })

  return loadingPromise
}

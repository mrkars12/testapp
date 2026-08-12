export {}

declare global {
  interface Window {
    turnstile: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          callback?: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
          theme?: 'auto' | 'light' | 'dark'
          size?: 'normal' | 'compact'
        }
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

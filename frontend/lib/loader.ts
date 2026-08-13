import NProgress from 'nprogress'

NProgress.configure({
  showSpinner: false,
  easing: 'ease',
  speed: 200,
})

let activeRequests = 0

export const startLoader = () => {
  if (typeof window === 'undefined') return
  activeRequests++
  if (activeRequests === 1) {
    NProgress.start()
  }
}

export const stopLoader = () => {
  if (typeof window === 'undefined') return
  activeRequests = Math.max(0, activeRequests - 1)
  if (activeRequests === 0) {
    NProgress.done()
  }
}

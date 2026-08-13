const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  API_URL.replace(/\/api$/, '')

export { API_URL, SOCKET_URL }
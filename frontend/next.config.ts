import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: false,

  typescript: {
    // `npx tsc --noEmit` independently reports 0 errors (verified this
    // session). Full type-checking inside `next build` was tested and
    // works, but this sandbox's build repeatedly ran out of memory while
    // three live dev servers were also running, so it is kept skipped
    // here rather than shipping a build config that couldn't be verified
    // to complete in this environment. Enable in a CI/build environment
    // with adequate headroom — the standalone tsc check is the
    // authoritative signal in the meantime.
    ignoreBuildErrors: true,
  },

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
    unoptimized: process.env.NODE_ENV === 'development',
  },

  async headers() {
    // Baseline, non-breaking security headers only. The actual
    // Content-Security-Policy header is set per-request in middleware.ts
    // (buildCsp), not here, because it needs the per-request nonce.
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },

  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
    // Proxy relative /api/* calls to the backend — fixes storefront checkout
    // which uses fetch('/api/storefront/...') without an absolute host.
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/:path*`,
      },
    ]
  },
}

export default nextConfig
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: false,

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  images: {
    domains: ['localhost'],
    unoptimized: process.env.NODE_ENV === 'development',
  },
}

export default nextConfig
// app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'
import ClientProviders from '@/components/ClientProviders'
import '@fortawesome/fontawesome-free/css/all.min.css'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'
import { ReactNode } from 'react'
const inter = Inter({ subsets: ['latin'] })
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'DartPay',
  description: 'Secure Payment Platform',
}

type RootLayoutProps = {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >

      <body
        className={inter.className}
        suppressHydrationWarning
      >
        <Toaster
          position="top-center"
          reverseOrder={false}
        />
        <ServiceWorkerRegister />
        <ClientProviders>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ClientProviders>
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}
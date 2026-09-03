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
      // The visible UI text throughout this app (payment settings, stores,
      // products, etc.) is predominantly Arabic while this was declared
      // "en" — that mismatch is exactly what triggers Chrome's built-in
      // "Translate this page?" prompt, which then injects the
      // gstatic.com/_/translate_http/... stylesheet our CSP (correctly)
      // blocks. There is no Google Translate integration anywhere in this
      // app's own code (confirmed by search) — this is the browser
      // reacting to the wrong declared language, not a resource we load.
      // Fixing the actual `lang` mismatch removes the trigger; loosening
      // the CSP to permit an uninvited browser feature would not.
      lang="ar"
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
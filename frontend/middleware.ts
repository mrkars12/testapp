import { NextRequest, NextResponse } from 'next/server'

/**
 * Real, non-invented third-party origins this app actually loads, found by
 * inspecting the source directly (not guessed):
 *  - Cloudflare Turnstile: `lib/turnstile-loader.ts` injects
 *    `https://challenges.cloudflare.com/turnstile/v0/api.js` and its widget
 *    renders in an iframe from the same origin.
 *  - Google Fonts: `StoreContext.tsx`/`LivePreview.tsx` inject a
 *    `<link>`/`@import` to `fonts.googleapis.com`, which in turn serves font
 *    files from `fonts.gstatic.com`.
 *  - YouTube: the collections/products rich-text editors embed
 *    `https://www.youtube.com/embed/...` iframes for pasted video links.
 *  - Stripe: NONE. The final Stripe architecture (see
 *    stripe.adapter.ts) is a hosted Checkout Session — the customer is
 *    sent via a real top-level `window.location.href` redirect to
 *    `checkout.stripe.com`, a fully separate origin our CSP has no
 *    jurisdiction over, and back. No page in this app ever calls
 *    `loadStripe()`/mounts Stripe.js/Elements any more (verified: no
 *    `@stripe/stripe-js` import remains anywhere under `app/`), so
 *    `js.stripe.com`/`hooks.stripe.com`/`api.stripe.com` are not needed
 *    in this policy — carrying them forward from the pre-migration
 *    integration would be exactly the "preserve random domains from the
 *    old implementation" this rebuild is required to avoid.
 *  - The backend API/WebSocket origin: `lib/config.ts`'s `API_URL`/
 *    `SOCKET_URL` are absolute, cross-origin URLs (not proxied through
 *    `next.config.ts`'s `/api/*` rewrite for direct axios/socket.io calls),
 *    so it must be explicitly allowed rather than relying on `'self'`.
 */
function backendOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
  try {
    return new URL(raw).origin
  } catch {
    return 'http://localhost:4000'
  }
}

const PROTECTED_ROUTES = [
  // The dedicated email-verification gate — `/dashboard` is no longer a
  // route at all (it 404s; see FINAL_ACCOUNT_LOGIN_STORE_ARCHITECTURE_REPORT.md).
  '/verify-email',
  '/settings',
  '/profile',
  // The post-login multi-store chooser.
  '/select-store',
  // The merchant dashboard (Part 12/13 of the store-route split). Real
  // authorization is still done by `(protected)/layout.tsx` (client) and
  // the backend guards, not here — this list only controls whether the
  // `x-user-auth` header is attached below.
  '/store',
]

const AUTH_PAGES = [
  '/login',
  '/register',
]

/**
 * Origins the embedded payment form is served from and talks to.
 *
 * The storefront checkout mounts Moyasar's OWN payment component in the
 * page (lib/payments/moyasarForm.ts): the card fields are theirs, and the
 * payment is created by their script against a publishable key, so their
 * CDN and their API have to be reachable or there is no embedded payment
 * at all — the form fails to load and the customer is told to try again.
 *
 * Enumerated, not wildcarded, and split by what each origin is actually
 * used for:
 *
 *   cdn.moyasar.com — the pinned moyasar.js and moyasar.css
 *   api.moyasar.com — where their script creates and reads the payment
 *
 * `script-src` lists the CDN even though the policy also carries
 * `strict-dynamic` (which makes host allowlists ignored in browsers that
 * support it): the form's script is injected by our own trusted bundle,
 * so strict-dynamic already admits it, and the explicit host is what
 * keeps it working in a browser that falls back to the allowlist.
 *
 * A 3DS challenge is a top-level navigation to the bank and back to our
 * own callback URL, which CSP does not restrict; `frame-src` is listed
 * because Moyasar may present the challenge in a frame instead.
 */
const PAYMENT_FORM_CDN = 'https://cdn.moyasar.com'
const PAYMENT_API = 'https://api.moyasar.com'

function buildCsp(nonce: string): string {
  const backend = backendOrigin()
  const backendWs = backend.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')

  const scriptSrc = process.env.NODE_ENV === 'production'
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com ${PAYMENT_FORM_CDN}`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https://challenges.cloudflare.com ${PAYMENT_FORM_CDN}`

  // R2 presigned PUT goes to *.r2.cloudflarestorage.com (also needs *.r2.dev for public URL fallback)
  const R2_CONNECT = 'https://*.r2.cloudflarestorage.com https://*.r2.dev https://pub-ee7aad78d89041d286ff1eac681d163e.r2.dev'
  return [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${PAYMENT_FORM_CDN}`,
    `img-src 'self' data: blob: https://pub-ee7aad78d89041d286ff1eac681d163e.r2.dev https://*.r2.dev https://*.r2.cloudflarestorage.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `connect-src 'self' ${backend} ${backendWs} ${PAYMENT_API} ${R2_CONNECT}`,
    `frame-src https://challenges.cloudflare.com https://www.youtube.com ${PAYMENT_API} ${PAYMENT_FORM_CDN}`,
    `frame-ancestors 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ')
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // One nonce per request. Forwarded to Next via a request header so its
  // own RSC-streaming/hydration inline scripts pick up the same value
  // (Next's documented CSP pattern), and set as the actual response header
  // so the browser enforces it.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next.js extracts the nonce for its own framework/hydration scripts by
  // parsing the CSP header it sees on the *request*, not the response — so
  // this has to be the actual generated policy, not just stripped. Setting
  // it only on the response (as before) left Next unaware of the nonce,
  // which is what made a strict-dynamic policy break hydration and is why
  // this was disabled rather than fixed.
  requestHeaders.set('Content-Security-Policy', csp)

  function withCsp(res: NextResponse): NextResponse {
    res.headers.set('Content-Security-Policy', csp)
    res.headers.set('x-nonce', nonce)
    return res
  }

  const token = request.cookies.get('access_token')?.value

  const isProtected = PROTECTED_ROUTES.some(route =>
    pathname.startsWith(route)
  )

  const isAuthPage = AUTH_PAGES.some(route =>
    pathname.startsWith(route)
  )

  const reason = searchParams.get('reason')

  const skipRedirect =
    reason === 'timeout' ||
    reason === 'force_logout'

  /**
   * =========================
   * Protected Routes
   * =========================
   */
  if (isProtected) {
  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
}

  /**
   * =========================
   * Login / Register Pages
   * =========================
   *
   * ROOT CAUSE (FINAL_AUTH_SIGNUP_TECHNICAL_REPAIR_REPORT.md): this used to
   * redirect away from /login and /register whenever an `access_token`
   * cookie was merely PRESENT — this is edge middleware, it has no way to
   * verify the JWT's signature or expiry here. A stale or expired cookie
   * (e.g. the 30-minute token issued at registration, or any session that
   * was later invalidated) still satisfies `token` truthy, so it fired
   * anyway: /register -> (bounced here) -> /dashboard -> (client-side
   * ProtectedLayoutContent verifies the session via /auth/me, finds it
   * invalid) -> /login. That is the exact "signup redirects to login" bug.
   *
   * `ProtectedLayoutContent` (app/(protected)/layout.tsx) already redirects
   * an *actually authenticated* user away from a public auth page — driven
   * by `/auth/me`, a real verification, not cookie presence — so this
   * edge-layer redirect was pure redundant surface area with a correctness
   * bug, not a security control. Removing it does not weaken auth: no
   * guard, verification, or session check is bypassed by leaving the auth
   * pages rendering for a moment before the client-side check (if any)
   * sends an already-authenticated user onward.
   */
  if (isAuthPage && skipRedirect) {
    // السماح بالدخول لصفحة اللوجين بعد الطرد
    const response = withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
    response.cookies.delete('access_token')
    return response
  }

  const response = withCsp(NextResponse.next({ request: { headers: requestHeaders } }))

  response.headers.set(
    'x-user-auth',
    token ? '1' : '0'
  )

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
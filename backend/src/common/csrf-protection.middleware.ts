const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Provider webhooks are unauthenticated by design (HMAC-verified, no
// session cookie), so they're outside this cookie-CSRF check entirely —
// excluded explicitly rather than relying on "no cookie present" alone.
const EXEMPT_PATH_PREFIX = '/payments/webhooks'

/**
 * Closes the "simple request" CSRF gap left by `SameSite=Lax` alone: a
 * cross-site HTML form can still send a same-site cookie on a top-level
 * POST navigation, but browsers restrict such forms to
 * `application/x-www-form-urlencoded`, `multipart/form-data`, or
 * `text/plain` bodies. This app's real frontend always sends
 * `Content-Type: application/json` for state-changing requests, and a
 * cross-origin page cannot get the browser to send that content type
 * (non-"simple" per the Fetch spec) without a CORS preflight — which our
 * origin allowlist in `main.ts` already rejects for any origin that isn't
 * explicitly configured.
 *
 * Only engages when the request actually carries our session cookie, so
 * unauthenticated/public traffic (including webhook callbacks, which are
 * exempted by path above regardless) is never affected.
 */
export function csrfProtection(req: any, res: any, next: any): void {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }

  if (typeof req.path === 'string' && req.path.startsWith(EXEMPT_PATH_PREFIX)) {
    next()
    return
  }

  const hasSessionCookie = Boolean(req.cookies?.['access_token'])
  if (!hasSessionCookie) {
    next()
    return
  }

  // A plain cross-site HTML <form> can only submit GET or POST — PUT,
  // PATCH, and DELETE are not valid form methods, and per the Fetch spec
  // they are never "CORS-safelisted methods" regardless of Content-Type,
  // so a cross-origin fetch/XHR using any of them already requires a
  // preflight that our origin allowlist (main.ts) rejects. The
  // Content-Type check below exists specifically to close the "simple
  // form" gap for POST; enforcing it on PUT/PATCH/DELETE added no real
  // protection and broke legitimate bodyless requests (e.g. a DELETE with
  // no payload never sends a Content-Type header at all).
  if (req.method !== 'POST') {
    next()
    return
  }

  const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
  if (contentType.startsWith('application/json')) {
    next()
    return
  }

  res.status(403).json({
    statusCode: 403,
    message: 'Unsupported Content-Type for an authenticated state-changing request.',
  })
}

/**
 * Baseline, non-breaking security headers (nosniff / referrer-policy /
 * frame-options / permissions-policy, plus HSTS in production).
 *
 * Content-Security-Policy is intentionally limited to the three directives
 * that cannot break an existing page regardless of its script/style
 * authoring style: `object-src`/`base-uri`/`frame-ancestors` say nothing
 * about which scripts or styles may load, so widespread inline
 * scripts/styles and third-party embeds keep working unchanged. A full
 * `script-src`/`style-src` policy needs dedicated per-page testing before
 * rollout and is tracked as a separate stage.
 */
export function applySecurityHeaders(req: any, res: any, next: any): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'Content-Security-Policy',
    "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  )
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  }
  next()
}

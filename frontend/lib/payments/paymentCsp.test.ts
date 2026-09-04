import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* ══════════════════════════════════════════════════════════════════════
   The Content-Security-Policy must admit the embedded payment form.

   This is a regression test with a real history: the storefront's CSP
   blocked `cdn.moyasar.com`, so the provider's stylesheet never loaded,
   the form never initialised, and the checkout showed "تعذّر تحميل نموذج
   الدفع الآمن" instead of card fields. Nothing in the payment code was
   wrong — the policy was — which is exactly the kind of failure a unit
   test of the payment modules cannot see.

   The policy is asserted by reading middleware.ts rather than by
   executing it, because it is assembled from a per-request nonce inside
   Next's middleware runtime. What matters here is that the origins stay
   listed in the directives that need them.
   ══════════════════════════════════════════════════════════════════════ */

const middleware = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8')

/** The one directive block, as written. */
function directive(name: string): string {
  const line = middleware
    .split('\n')
    .find((l) => l.includes(`${name} 'self'`) || l.includes(`${name} https://`))
  return line ?? ''
}

describe('CSP admits the embedded payment provider', () => {
  it('names the provider origins once, as constants', () => {
    expect(middleware).toContain("const PAYMENT_FORM_CDN = 'https://cdn.moyasar.com'")
    expect(middleware).toContain("const PAYMENT_API = 'https://api.moyasar.com'")
  })

  it('allows the form stylesheet — the directive that actually broke', () => {
    // style-src, not script-src, is what blocked it: the script was
    // admitted by 'strict-dynamic' because our own trusted bundle injects
    // it, while the stylesheet had no such route through the policy.
    expect(directive('style-src')).toContain('${PAYMENT_FORM_CDN}')
  })

  it('allows the form script in both production and development policies', () => {
    // Only the actual policy lines, not the comment above them.
    const scriptLines = middleware
      .split('\n')
      .filter((l) => l.includes("script-src 'self'"))
    expect(scriptLines.length).toBeGreaterThanOrEqual(2)
    for (const line of scriptLines) {
      expect(line).toContain('${PAYMENT_FORM_CDN}')
    }
  })

  it('allows the form to reach the provider API it creates the payment on', () => {
    expect(directive('connect-src')).toContain('${PAYMENT_API}')
  })

  it('keeps the restrictive directives restrictive', () => {
    // Widening for a payment form must not have widened anything else.
    expect(middleware).toContain("`object-src 'none'`")
    expect(middleware).toContain("`base-uri 'self'`")
    expect(middleware).toContain("`form-action 'self'`")
    expect(middleware).toContain("`frame-ancestors 'self'`")
    expect(middleware).toContain("`default-src 'self'`")
  })

  it('does not wildcard the provider', () => {
    // Enumerated hosts only: a wildcard would admit any subdomain
    // anyone can register under the provider's domain.
    expect(middleware).not.toContain('https://*.moyasar.com')
  })
})

/* ══════════════════════════════════════════════════════════════════════
   The provider's SOURCE MAPS are deliberately not admitted.

   A real browser console on the checkout reports two `connect-src`
   violations:

     https://cdn.moyasar.com/mpf/1.19.0/moyasar.js.map
     https://cdn.moyasar.com/mpf/1.19.0/moyasar.css.map

   They look like the payment form being blocked. They are not. Neither
   URL is requested by the payment form, by `moyasarForm.ts`, or by
   anything else that runs on the page: both assets ship with a trailing
   `sourceMappingURL` comment (verified against the pinned 1.19.0 files
   the loader actually fetches), and a source map named in such a comment
   is fetched by a DEBUGGER — DevTools with JavaScript source maps
   enabled — not by the document. Close DevTools and neither request is
   made, on any build, by any customer.

   So the fix is not a CSP change. Adding the CDN to `connect-src` would
   admit arbitrary fetch/XHR/WebSocket traffic from the payment page to
   that origin — a genuine widening of what a compromised or substituted
   form could exfiltrate to — in exchange for silencing a warning only a
   developer with DevTools open ever sees. A developer who does not want
   to see it turns off "Enable JavaScript source maps" in DevTools.

   `style-src` and `script-src` still list the CDN, because the .js and
   .css themselves ARE loaded by the page. Only the map fetches are not,
   and only `connect-src` governs them.
   ══════════════════════════════════════════════════════════════════════ */

describe('the provider CDN is admitted for assets, not for connections', () => {
  it('does not add the asset CDN to connect-src for the sake of source maps', () => {
    expect(directive('connect-src')).not.toContain('PAYMENT_FORM_CDN')
    expect(directive('connect-src')).not.toContain('cdn.moyasar.com')
  })

  it('still admits the assets the page really does load', () => {
    // The distinction the decision rests on: the .js and the .css are
    // fetched by the document, the .map files are not.
    expect(directive('script-src')).toContain('${PAYMENT_FORM_CDN}')
    expect(directive('style-src')).toContain('${PAYMENT_FORM_CDN}')
  })

  it('keeps the payment API reachable, exactly as it was', () => {
    // Nothing about the source-map decision touches the origin the form
    // actually creates and reads the payment on.
    expect(directive('connect-src')).toContain('${PAYMENT_API}')
  })
})

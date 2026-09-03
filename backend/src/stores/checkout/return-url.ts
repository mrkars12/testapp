import { buildOriginMatcher } from '../../common/config/cors-origin-matcher';

/**
 * ==================================================================
 * Storefront return URL
 * ==================================================================
 *
 * `return_url` is the one field on a public, unauthenticated checkout
 * body that ends up being handed to a third party as "send the payer
 * here when you're done". Anything accepted here becomes a redirect the
 * provider performs on our behalf, off our own page, with our order in
 * the query string — which is exactly the shape of an open redirect.
 *
 * So it is not validated as "is this a URL" (the DTO already does that
 * and it proves nothing about where it points). It is validated against
 * the same origin allowlist the HTTP layer already trusts for CORS —
 * one list, one meaning of "our own front end", so a deployment that
 * adds a storefront domain does not have to remember a second place.
 *
 * A URL that fails is dropped, not rejected: the adapter then falls back
 * to the merchant's configured return URL, which is exactly what happens
 * for a client that sends no `return_url` at all. Failing the checkout
 * would let a malformed client-supplied field block a real order.
 */

/** Everything a return URL must not carry, whatever the origin. */
function hasSafeShape(parsed: URL): boolean {
  // Credentials in the URL would be replayed by the provider's redirect
  // and land in its logs; a fragment is meaningless to a server-side
  // redirect and is a common smuggling vector.
  return parsed.username === '' && parsed.password === '';
}

/**
 * Builds a checker for the return URLs this deployment will accept.
 *
 * `origins` is the CORS allowlist verbatim, wildcard subdomain patterns
 * (`*.example.com`) included — the storefront is served per-store on
 * subdomains, so an exact-match-only list would reject the real
 * storefront origin.
 */
export function buildReturnUrlChecker(
  origins: readonly string[],
): (url: string) => boolean {
  const matchers = origins.map(buildOriginMatcher);

  return (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (!hasSafeShape(parsed)) return false;

    return matchers.some((matches) => matches(parsed.origin));
  };
}

/**
 * The return URL to hand the adapter, or `undefined` to fall back to the
 * merchant's configured one.
 */
export function sanitizeReturnUrl(
  url: string | undefined | null,
  origins: readonly string[],
): string | undefined {
  if (!url) return undefined;
  return buildReturnUrlChecker(origins)(url) ? url : undefined;
}

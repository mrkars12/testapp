import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';

/* ══════════════════════════════════════════════════════════════════════
   The cart cookie — one place, so it cannot drift.

   Every property below is a security decision, and the whole point of
   keeping them here is that a second call site cannot quietly weaken
   one. The cookie is the ONLY thing that identifies a shopper's cart,
   so its scope is the scope of the cart itself.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Short and meaningless.
 *
 * Deliberately NOT `__Host-`: that prefix mandates `Path=/`, which
 * would send one store's cart cookie to every other store's endpoints
 * on the same host and defeat the per-store scoping below.
 */
export const CART_COOKIE_NAME = 'dc';

/** Decision 3: a cart lives 30 days, refreshed on each mutation. */
export const CART_TTL_DAYS = 30;

const CART_TTL_MS = CART_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * The lease held across the provider call, in seconds.
 *
 * Long enough for the slowest realistic gateway round trip, short
 * enough that a crashed process frees the shopper's basket in under two
 * minutes rather than wedging it for the cart's whole lifetime.
 */
export const CART_CLAIM_LEASE_SECONDS = 90;

/**
 * A new cart secret.
 *
 * 32 bytes from the CSPRNG, base64url-encoded (43 characters, no
 * padding). Unguessable, and URL-safe so nothing downstream has to
 * escape it — though it is never allowed into a URL in the first place.
 */
export function mintCartToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The cart's PUBLIC identifier.
 *
 * A different value from the token on purpose: this one is published to
 * the browser (and shows up in logs and cross-tab pings), and it can
 * neither read nor modify a cart. Deriving it from the token would make
 * the secret and the public name the same fact.
 */
export function mintCartPublicId(): string {
  return randomBytes(12).toString('base64url');
}

/** When a cart minted now should expire. */
export function cartExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + CART_TTL_MS);
}

/**
 * THE COOKIE'S SCOPE — and therefore the cart's.
 *
 * `Path` is `/api/storefront/<slug>`, which is what stops store A's
 * cart ever being offered to store B: the browser will not send it, so
 * there is no server-side check that could be forgotten. The
 * mount-prefix is included because that is the path the browser sees
 * (the API is served under `/api`), and a cookie path that does not
 * match the request path is simply never sent.
 *
 * `SameSite=Lax` rather than `Strict` because the cart must survive the
 * gateway's top-level redirect back to the return URL — `Strict` would
 * drop the cookie on exactly the request that resumes a payment.
 *
 * `Secure` in production only: development runs on http://localhost,
 * where a Secure cookie is discarded and the cart would silently never
 * work.
 */
export function cartCookieOptions(input: {
  slug: string;
  isProduction: boolean;
  globalPrefix?: string;
}): CookieOptions {
  const prefix = input.globalPrefix ?? 'api';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: input.isProduction,
    path: `/${prefix}/storefront/${encodeURIComponent(input.slug)}`,
    maxAge: CART_TTL_MS,
  };
}

/**
 * Writes (or refreshes) the cart cookie on a response.
 *
 * Called on every mutation so an active shopper's cart keeps its full
 * 30 days rather than expiring 30 days after it was created.
 */
export function setCartCookie(
  res: Response,
  token: string,
  input: { slug: string; isProduction: boolean; globalPrefix?: string },
): void {
  res.cookie(CART_COOKIE_NAME, token, cartCookieOptions(input));
}

/**
 * Removes the cart cookie.
 *
 * Used when the token in the cookie resolves to nothing at all — a cart
 * deleted with its store, or a cookie carried over from another
 * deployment. Leaving a dead token in the browser costs a pointless
 * lookup on every request for the next 30 days.
 */
export function clearCartCookie(
  res: Response,
  input: { slug: string; isProduction: boolean; globalPrefix?: string },
): void {
  // Everything except `maxAge`: `clearCookie` sets its own expiry, and
  // the rest must match exactly or the browser keeps the original.
  const options = cartCookieOptions(input);
  delete options.maxAge;
  res.clearCookie(CART_COOKIE_NAME, options);
}

/**
 * The cart token on an incoming request, if it carries one.
 *
 * Shape-checked before it is used as a lookup key: the value is
 * attacker-controlled, and a token that could not have been minted here
 * is not worth a database round trip. Anything unrecognised reads as
 * "no cookie", which is the stateless fallback path.
 */
export function readCartToken(cookies: unknown): string | null {
  if (!cookies || typeof cookies !== 'object') return null;
  const raw = (cookies as Record<string, unknown>)[CART_COOKIE_NAME];
  if (typeof raw !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(raw)) return null;
  return raw;
}

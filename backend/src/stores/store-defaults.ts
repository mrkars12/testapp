import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

// The set of store currencies the product actually offers today (matches the
// dropdown already shown in the store-creation UI). Currency is store-scoped
// (Part 3) — this list is deliberately small and explicit rather than
// accepting an arbitrary ISO code, since nothing downstream (payment
// gateways, settlement) has been verified to support anything beyond these.
export const SUPPORTED_STORE_CURRENCIES = ['SAR', 'USD', 'EGP'] as const;
export type SupportedStoreCurrency =
  (typeof SUPPORTED_STORE_CURRENCIES)[number];

export function assertSupportedCurrency(
  currency: unknown,
): SupportedStoreCurrency {
  const value = typeof currency === 'string' ? currency.toUpperCase() : '';
  if (!(SUPPORTED_STORE_CURRENCIES as readonly string[]).includes(value)) {
    throw new BadRequestException('عملة غير مدعومة');
  }
  return value as SupportedStoreCurrency;
}

/**
 * Literal words the merchant route tree treats specially, not as a store
 * slug — see the frontend's `app/(protected)/store/` directory and
 * `NON_STORE_SEGMENTS` in `lib/storeSlug.ts`.
 *
 * `new` is a real static route (`/store/new`, the store-creation page) that
 * sits alongside `[storeSlug]` and always wins over it — a store slugged
 * `new` would be permanently unreachable at `/store/new`.
 *
 * `all` has no page of its own any more (the old `/store/all` store-list
 * page was removed), but stays reserved regardless: `NON_STORE_SEGMENTS`
 * treats it as a non-slug for `X-Store-Slug` derivation, so a store
 * literally named `all` would silently fail to scope its own requests.
 */
export const RESERVED_STORE_SLUGS = new Set(['new', 'all']);

/**
 * Normalizes user-supplied store name/slug input into a URL-safe slug.
 *
 * Strictly ASCII (`a-z0-9-`) rather than the broader `\p{L}` set used for
 * product handles: a store slug is a top-level path segment
 * (`/stores-building/<slug>`) and is also used to build an external
 * storefront URL, so it must stay safe as a path/subdomain segment across
 * every consumer, not just as a display handle.
 */
export function normalizeStoreSlug(input: string | undefined | null): string {
  const base = (input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (base.length >= 3) return base;

  // Empty or too-short input (e.g. an all-Arabic/emoji store name with no
  // ASCII characters) still needs a valid, unique-ish slug — fall back to a
  // random suffix rather than rejecting the whole signup over a cosmetic
  // field.
  return `store-${crypto.randomBytes(3).toString('hex')}`;
}

/** Throws if `slug` collides with a reserved merchant-route segment. Call
 *  after `normalizeStoreSlug`, before the uniqueness check — a slug that's
 *  reserved is rejected the same way a taken one is: ask for a different
 *  one, don't guess a replacement. */
export function assertNotReservedSlug(slug: string): void {
  if (RESERVED_STORE_SLUGS.has(slug)) {
    throw new BadRequestException('هذا المعرّف محجوز، يرجى اختيار معرّف آخر لمتجرك');
  }
}

/** Default theme payload for a brand-new store — shared so the fused
 *  signup+first-store flow (`AuthService.processRegistration`) creates the
 *  exact same theme a store made via `POST /stores` gets, instead of a
 *  second, silently-drifting copy of this literal. */
export function defaultStoreThemeData(storeId: bigint) {
  return {
    store_id: storeId,
    colors: {
      primary: '#2563eb',
      secondary: '#64748b',
      accent: '#f59e0b',
      background: '#ffffff',
      surface: '#f8fafc',
      textPrimary: '#0f172a',
      textSecondary: '#64748b',
      textMuted: '#94a3b8',
      border: '#e2e8f0',
      headerBg: '#ffffff',
      headerText: '#0f172a',
      footerBg: '#0f172a',
      footerText: '#ffffff',
    },
    typography: {
      headingFont: 'Inter',
      bodyFont: 'Inter',
      baseSize: '16px',
      scale: 1.25,
      h1Size: '2.5rem',
      h2Size: '2rem',
      h3Size: '1.5rem',
      lineHeight: 1.6,
      letterSpacing: 'normal',
    },
    header: {
      showSearch: true,
      showAccount: true,
      showCart: true,
      sticky: false,
      background: '#ffffff',
      textColor: '#0f172a',
      logoPosition: 'left',
      menuPosition: 'center',
    },
    footer: {
      showNewsletter: true,
      showSocialLinks: true,
      columns: 4,
      background: '#0f172a',
      textColor: '#ffffff',
    },
  };
}

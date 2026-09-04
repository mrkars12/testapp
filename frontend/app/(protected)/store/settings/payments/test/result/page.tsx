import LegacyStoreRedirect from '@/components/LegacyStoreRedirect'

/** Slug-free legacy URL — resolves a landing store and redirects to
 *  /store/[storeSlug]/settings/payments/test/result.
 *
 *  Gateways return the buyer to this page after a test payment. A returning
 *  redirect that lands slug-free must not dead-end on a 404, so the stub
 *  exists even though the app itself always builds the slug-scoped URL
 *  (see the test page's `returnUrl`). See LegacyStoreRedirect. */
export default function Page() {
  return <LegacyStoreRedirect subPath="settings/payments/test/result" />
}

import LegacyStoreRedirect from '@/components/LegacyStoreRedirect'

/** Slug-free legacy URL — resolves a landing store and redirects to
 *  /store/[storeSlug]/settings/payments/test.
 *
 *  This stub was missing while its parent (`settings/payments`) existed, so
 *  `/store/settings/payments/test` matched no route and 404'd.
 *  See LegacyStoreRedirect. */
export default function Page() {
  return <LegacyStoreRedirect subPath="settings/payments/test" />
}

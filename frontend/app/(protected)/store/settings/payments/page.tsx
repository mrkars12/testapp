import LegacyStoreRedirect from '@/components/LegacyStoreRedirect'

/** Slug-free legacy URL — resolves a landing store and redirects to
 *  /store/[storeSlug]/settings/payments. */
export default function Page() {
  return <LegacyStoreRedirect subPath="settings/payments" />
}

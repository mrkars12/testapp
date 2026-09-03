import LegacyStoreRedirect from '@/components/LegacyStoreRedirect'

/** Slug-free legacy URL — resolves a landing store and redirects to
 *  /store/[storeSlug]/settings. See LegacyStoreRedirect. */
export default function Page() {
  return <LegacyStoreRedirect subPath="settings" />
}

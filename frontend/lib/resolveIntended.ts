export function resolveIntended(
  intendedProp?: string,
  searchParams?: URLSearchParams
): string {

  if (intendedProp && intendedProp.startsWith('/')) {
    return intendedProp;
  }

  const fromSearch = searchParams?.get('intended');
  if (fromSearch && fromSearch.startsWith('/')) {
    return fromSearch;
  }

  // 🔥 الجديد
  if (typeof window !== 'undefined') {
    const fromStorage = sessionStorage.getItem('intended');
    if (fromStorage && fromStorage.startsWith('/')) {
      return fromStorage;
    }
  }

  // fallback أخير
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('intended');
      if (fromUrl && fromUrl.startsWith('/')) {
        return fromUrl;
      }
    } catch {}
  }

  return '/dashboard';
}
/**
 * يحوّل عنصر من قائمة CORS_ORIGINS لدالة مطابقة.
 * العنصر اللي بيبدأ بـ "*." معناه أي subdomain تحت الدومين ده.
 *
 * Shared between the HTTP CORS setup (main.ts) and the WebSocket gateway
 * (realtime.gateway.ts) so both enforce the exact same origin allowlist —
 * a gateway with its own hardcoded/divergent origin silently rejects the
 * real deployed frontend origin even when HTTP CORS is configured correctly.
 */
export function buildOriginMatcher(pattern: string): (origin: string) => boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`^https?://([a-zA-Z0-9-]+\\.)+${escaped}$`)
    return (origin) => regex.test(origin)
  }

  return (origin) => origin === pattern
}

export function buildCorsOriginChecker(
  corsOrigins: string[],
): (origin: string | undefined) => boolean {
  const matchers = corsOrigins.map(buildOriginMatcher)
  return (origin) => !origin || matchers.some((matches) => matches(origin))
}

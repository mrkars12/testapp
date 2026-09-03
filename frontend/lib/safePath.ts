/**
 * Only a same-origin, relative path may ever be honored as a post-auth
 * redirect target. `intended`/`redirect` query params are attacker-supplied,
 * so an absolute or protocol-relative value (`https://evil.com`, `//evil.com`)
 * must never be passed to `router.replace()` — that would be an open
 * redirect straight out of a successful login/registration/OTP flow.
 */
export function isSafeRelativePath(path: string | null | undefined): path is string {
  return (
    !!path &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\')
  )
}

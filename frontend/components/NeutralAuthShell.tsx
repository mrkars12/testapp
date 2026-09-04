/**
 * The neutral "auth state not yet known" shell.
 *
 * Rendered on `/login` / `/register` / `/register/account-information`
 * while it is still undetermined whether the visitor is a guest or an
 * already-authenticated session, and while an authenticated visitor is
 * being forwarded off the auth route. It must NOT look like an error or a
 * broken page — just a quiet centred spinner on the normal background — so
 * that the eventual outcome (the real form for a guest, or a redirect for
 * an authed user) is the first meaningful thing the user sees.
 */
export default function NeutralAuthShell() {
  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-white dark:bg-gray-950"
      role="status"
      aria-live="polite"
      aria-label="جارٍ التحميل"
    >
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-500 dark:border-gray-800 dark:border-t-gray-400" />
    </div>
  )
}

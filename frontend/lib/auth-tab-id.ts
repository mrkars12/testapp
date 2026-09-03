/**
 * A stable per-tab id.
 *
 * `BroadcastChannel` delivers a message to every *other* channel object
 * subscribed to the same name — INCLUDING other channel objects in the
 * same window/tab. So the tab that does a login also receives its own
 * `AUTH_LOGIN_SYNC` on `AuthProvider`'s channel, and (after that handler's
 * `await /auth/me`) fires a second, mistimed `router.replace` — which,
 * landing after the user has already left `/login` for the store chooser
 * or a store, bounces them back to `/select-store`.
 *
 * Stamp every auth broadcast with `AUTH_TAB_ID` and let the receiver skip
 * messages it sent itself; genuine cross-tab sync (a different tab, a
 * different id) is unaffected.
 */
export const AUTH_TAB_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`

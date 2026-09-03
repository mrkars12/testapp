/* ══════════════════════════════════════════════════════════════════════
   Cross-tab checkout synchronisation.

   A customer can have the same checkout open in more than one tab —
   they middle-clicked the cart, they reopened the order from history,
   they were sent the link twice. When the payment finishes in one of
   them, the others are still sitting on a payment form for a payment
   that has already happened, and the first thing an unlucky payer does
   is pay again.

   What travels between tabs is a PING, never an outcome.

   That distinction is the whole design. A BroadcastChannel message is
   just another piece of browser-side state: it is written by a page, it
   can be replayed, and it can arrive out of order. Treating one as
   "the payment succeeded" would be exactly the fake success the payment
   core refuses everywhere else. So a message carries a checkout token
   and nothing else, and the only thing a receiving tab does with it is
   ask the server — the same authoritative round trip it would have made
   on its own, just sooner.

   For the same reason there is no localStorage and no sessionStorage
   here, and nothing about a payment is persisted browser-side at all —
   not an outcome, and not an identity either. The server is asked every
   time.

   That includes the fact that one checkout replaced another. A retry
   creates a new checkout and the old token lives on in this tab's
   history, so a restored entry has to find out that it is looking at a
   spent checkout; for one round of this work that fact was remembered
   HERE, in sessionStorage. It is now recorded by the server
   (`Checkout.supersedes_id`) and published on the status endpoint as
   `superseded_by_token`, which is better in three ways: it survives a
   duplicated tab, it cannot be edited from the console, and it is one
   less thing in a storage a cross-site script can read.

   The other half is reconciliation on `focus` and `visibilitychange`: a
   tab that was in the background while the payment finished elsewhere
   may never receive a message at all (it can be discarded, or the
   channel can be closed by a bfcache eviction), and the moment the
   payer looks at it again is exactly the moment it must not be showing
   a stale payable form.
   ══════════════════════════════════════════════════════════════════════ */

/** One channel per deployment; the token inside the message scopes it. */
const CHANNEL_NAME = 'checkout_payment_sync'

/**
 * The only message shape on the channel.
 *
 * Deliberately carries no status, amount, order number or payment id.
 * A receiver that cannot learn an outcome from a message cannot be
 * lied to by one.
 */
interface CheckoutPing {
  readonly type: 'checkout_changed'
  readonly token: string | null
  /**
   * The CART this tab's checkout was priced from — identity, and only
   * identity, exactly like the token beside it.
   *
   * It exists because of the one tab a token cannot reach: a second tab
   * that is still on the cart or the contact form has no checkout token
   * of its own, so a ping keyed on a token is not addressed to it, and
   * it finds out nothing until it is focused. Its cart is the same cart,
   * though — that is the whole point of a server-side cart — so a ping
   * naming the cart reaches it.
   *
   * It carries no more information than the token does: the receiver's
   * only action is still to ask the server. A tab that learns "your cart
   * moved" has learned nothing about a payment, and could not be lied to
   * about one by a message.
   *
   * Optional, so a tab running an older build still handles every
   * message it always did.
   */
  readonly cartPublicId?: string
}

function isPing(value: unknown): value is CheckoutPing {
  if (!value || typeof value !== 'object') return false
  const ping = value as Partial<CheckoutPing>
  if (ping.type !== 'checkout_changed') return false
  if (typeof ping.token !== 'string' && ping.token !== null) return false
  if (ping.cartPublicId !== undefined && typeof ping.cartPublicId !== 'string') {
    return false
  }
  return true
}

/** SSR, and the odd browser without it, simply get no cross-tab sync. */
function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

/**
 * Tells every other tab that this checkout's server state has moved.
 *
 * Called when a payment settles here. Fire-and-forget: a tab that misses
 * it still reconciles on focus, so this is a latency improvement rather
 * than a correctness dependency.
 */
export function announceCheckoutChanged(
  token: string | null,
  cartPublicId?: string | null,
): void {
  // Nothing to address the message to. A ping that names neither a
  // checkout nor a cart could only be interpreted as "something,
  // somewhere, changed", and no tab should act on that.
  if (!token && !cartPublicId) return
  const channel = openChannel()
  if (!channel) return

  try {
    const message: CheckoutPing = {
      type: 'checkout_changed',
      token: token ?? null,
      ...(cartPublicId ? { cartPublicId } : {}),
    }
    channel.postMessage(message)
  } catch {
    /* A tab that cannot broadcast still works; the others poll. */
  } finally {
    // Opened per announcement rather than held: a long-lived channel in
    // a page that may be bfcached is a listener leak, and posting is
    // rare enough that the handle is not worth keeping.
    channel.close()
  }
}

/**
 * What made this tab ask again.
 *
 * Passed to the subscriber because ONE of these is different in kind.
 * `focus` and `visible` mean "the customer looked at a page that has
 * been here all along"; `restore` means "this document was FROZEN, an
 * unknown amount of time passed, and the browser has just put its old
 * pixels back on screen". Only the last of those is a reason to stop
 * treating what is currently rendered as actionable while the server is
 * asked — and telling them apart is what keeps a decline from blinking
 * every time the customer switches tabs.
 */
export type CheckoutChangeTrigger = 'ping' | 'focus' | 'visible' | 'restore' | 'load'

/**
 * Runs `onChanged` when another tab reports this checkout has moved, or
 * when this tab comes back to the foreground.
 *
 * Returns an unsubscribe function. `onChanged` must be the caller's
 * authoritative re-read — this module never decides an outcome.
 */
export function subscribeCheckoutChanges(
  token: string | null,
  onChanged: (trigger: CheckoutChangeTrigger) => void,
  /**
   * This tab's cart, when it has one.
   *
   * Makes a tab that has no checkout yet reachable by a ping — see
   * `CheckoutPing.cartPublicId`. Optional, so every existing call site
   * behaves exactly as it did.
   */
  cartPublicId?: string | null,
): () => void {
  // Subscribing with neither identity would mean reacting to every
  // ping on the channel, including other purchases'.
  if ((!token && !cartPublicId) || typeof window === 'undefined') {
    return () => {}
  }

  const channel = openChannel()

  const onMessage = (event: MessageEvent) => {
    if (!isPing(event.data)) return
    // Ours if it names this tab's checkout OR this tab's cart. Another
    // purchase's ping is still not ours to act on.
    const mine =
      (!!token && event.data.token === token) ||
      (!!cartPublicId && event.data.cartPublicId === cartPublicId)
    if (mine) onChanged('ping')
  }

  const onFocus = () => onChanged('focus')
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onChanged('visible')
  }

  channel?.addEventListener('message', onMessage)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  // A tab restored from the back/forward cache did not run any of its
  // effects again and its channel may have been severed while it was
  // frozen — so the restore itself is a reconciliation trigger. This is
  // also what makes "pay, then press Back" safe: the restored page
  // re-reads the server instead of trusting the DOM it was frozen with.
  //
  // `persisted` separates that from an ordinary load, which is not a
  // restoration of anything: it ran all of its own effects and has
  // resolved its token from the server already.
  const onPageShow = (event: PageTransitionEvent) => {
    onChanged(event.persisted ? 'restore' : 'load')
  }
  window.addEventListener('pageshow', onPageShow)

  return () => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
  }
}

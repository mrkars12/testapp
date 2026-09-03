import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  announceCheckoutChanged,
  subscribeCheckoutChanges,
} from './checkoutSync'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Cross-tab checkout synchronisation
 *
 * The property under test is narrow and it is the one that matters: a
 * message from another tab must be able to make this tab ASK, and must
 * never be able to tell it an answer. Everything else here — focus,
 * visibility, bfcache restore — is about the tab that never received a
 * message at all.
 * ══════════════════════════════════════════════════════════════════════
 */

/** A minimal in-process BroadcastChannel: real fan-out, no browser. */
class FakeChannel {
  static open: FakeChannel[] = []
  static closed = 0

  private listeners = new Set<(event: MessageEvent) => void>()
  closedFlag = false

  constructor(readonly name: string) {
    FakeChannel.open.push(this)
  }

  addEventListener(_type: 'message', fn: (event: MessageEvent) => void) {
    this.listeners.add(fn)
  }

  removeEventListener(_type: 'message', fn: (event: MessageEvent) => void) {
    this.listeners.delete(fn)
  }

  postMessage(data: unknown) {
    // A real BroadcastChannel delivers to every OTHER channel object,
    // never to itself. Getting that wrong would make these tests pass on
    // a self-delivery that does not happen in a browser.
    for (const channel of FakeChannel.open) {
      if (channel === this || channel.closedFlag) continue
      for (const fn of channel.listeners) {
        fn({ data } as MessageEvent)
      }
    }
  }

  close() {
    this.closedFlag = true
    FakeChannel.closed += 1
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this)
  }
}

beforeEach(() => {
  FakeChannel.open = []
  FakeChannel.closed = 0
  vi.stubGlobal('BroadcastChannel', FakeChannel)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subscribeCheckoutChanges', () => {
  it('reconciles when another tab reports the same checkout moved', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    announceCheckoutChanged('tok_a')

    expect(onChanged).toHaveBeenCalledTimes(1)
    stop()
  })

  it('ignores a ping for a different checkout', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    announceCheckoutChanged('tok_b')

    expect(onChanged).not.toHaveBeenCalled()
    stop()
  })

  it('carries no outcome — only the token', () => {
    // The guarantee that keeps this from becoming a fake-success channel:
    // there is nothing in the message a receiver could mistake for a
    // payment status, an amount or an order.
    let seen: unknown = null
    const spy = new FakeChannel('checkout_payment_sync')
    spy.addEventListener('message', (event) => {
      seen = event.data
    })

    announceCheckoutChanged('tok_a')

    expect(seen).toEqual({ type: 'checkout_changed', token: 'tok_a' })
    spy.close()
  })

  it('reconciles when the tab is focused again', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    window.dispatchEvent(new Event('focus'))

    expect(onChanged).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reconciles when the tab becomes visible, not when it hides', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onChanged).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onChanged).toHaveBeenCalledTimes(1)

    stop()
  })

  it('reconciles a page restored from the back/forward cache', () => {
    // "Pay, then press Back" lands here: the restored page ran no
    // effects and its DOM is whatever it was frozen with.
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    window.dispatchEvent(new Event('pageshow'))

    expect(onChanged).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops listening once unsubscribed', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)
    stop()

    announceCheckoutChanged('tok_a')
    window.dispatchEvent(new Event('focus'))

    expect(onChanged).not.toHaveBeenCalled()
  })

  it('does nothing without a checkout token', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges(null, onChanged)

    window.dispatchEvent(new Event('focus'))

    expect(onChanged).not.toHaveBeenCalled()
    stop()
  })

  it('degrades to no cross-tab sync where BroadcastChannel is absent', () => {
    // Not a hypothetical: this module also runs during SSR, where the
    // constructor does not exist at all. Focus must still reconcile.
    vi.stubGlobal('BroadcastChannel', undefined)

    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    expect(() => announceCheckoutChanged('tok_a')).not.toThrow()
    window.dispatchEvent(new Event('focus'))
    expect(onChanged).toHaveBeenCalledTimes(1)

    stop()
  })

  it('leaves no channel open behind it', () => {
    // A page that may be bfcached must not leak a live listener.
    const stop = subscribeCheckoutChanges('tok_a', vi.fn())
    announceCheckoutChanged('tok_a')
    stop()

    expect(FakeChannel.open).toHaveLength(0)
  })
})

/* ────────────────────────────────────────────────────────────────────
   WHY this tab was asked to reconcile.

   Four of the five triggers mean the same thing — "ask the server" —
   and one does not. A `pageshow` with `persisted` is a document coming
   back out of the back/forward cache: it was FROZEN, an unknown amount
   of time passed, and the browser has just put its old pixels back on
   screen without running a line of script. For a page frozen on a
   decline those pixels are a retry button for a checkout that may have
   been replaced and paid since.

   Telling that apart from a focus is what lets the page suspend the
   one and ignore the other. A focus that behaved like a restore blinked
   the failure panel out from under anyone who switched tabs.
   ──────────────────────────────────────────────────────────────────── */
describe('the reconciliation trigger', () => {
  it('reports a bfcache restore as a RESTORE', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    const restore = new Event('pageshow') as Event & { persisted?: boolean }
    Object.defineProperty(restore, 'persisted', { value: true })
    window.dispatchEvent(restore)

    expect(onChanged).toHaveBeenCalledWith('restore')
    stop()
  })

  it('reports an ordinary pageshow as a LOAD, not a restore', () => {
    // A normal load ran all of its own effects and resolved its token
    // from the server already; there is nothing frozen about it.
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    window.dispatchEvent(new Event('pageshow'))

    expect(onChanged).toHaveBeenCalledWith('load')
    expect(onChanged).not.toHaveBeenCalledWith('restore')
    stop()
  })

  it('reports focus, visibility and a cross-tab ping as themselves', () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged)

    window.dispatchEvent(new Event('focus'))
    expect(onChanged).toHaveBeenLastCalledWith('focus')

    document.dispatchEvent(new Event('visibilitychange'))
    expect(onChanged).toHaveBeenLastCalledWith('visible')

    announceCheckoutChanged('tok_a')
    expect(onChanged).toHaveBeenLastCalledWith('ping')

    // None of them is a restore.
    expect(onChanged).not.toHaveBeenCalledWith('restore')
    stop()
  })
})

/* ────────────────────────────────────────────────────────────────────
   NOTHING about a payment is persisted browser-side.

   Checkout succession — which checkout replaced which — was briefly
   kept here in `sessionStorage`. It is now the server's own record
   (`Checkout.supersedes_id`, published as `superseded_by_token`), and
   this module writes no storage at all.
   ──────────────────────────────────────────────────────────────────── */
describe('browser storage', () => {
  it('is never written by announcing or subscribing', () => {
    sessionStorage.clear()
    localStorage.clear()

    const stop = subscribeCheckoutChanges('tok_a', vi.fn())
    announceCheckoutChanged('tok_a')
    window.dispatchEvent(new Event('focus'))
    stop()

    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })
})

/* ────────────────────────────────────────────────────────────────────
   ADDRESSING A TAB THAT HAS NO CHECKOUT YET.

   With a server-side cart, the tab most able to start a SECOND payment
   is the one that has not pressed Place Order — it holds no checkout
   token, so a ping keyed on a token is not addressed to it at all. Its
   cart is the same cart, so the cart's public id reaches it.

   The message still carries no outcome, no amount and no order number.
   Adding a second identity does not add a second kind of information:
   the receiver's only permitted action is still "ask the server".
   ──────────────────────────────────────────────────────────────────── */
describe('cart-addressed pings', () => {
  it('wakes a tab that has only a cart, and no checkout', async () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges(null, onChanged, 'cart_1')

    const channel = new BroadcastChannel('checkout_payment_sync')
    channel.postMessage({
      type: 'checkout_changed',
      token: 'tok_other',
      cartPublicId: 'cart_1',
    })

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith('ping'))

    channel.close()
    stop()
  })

  it('ignores a ping for ANOTHER cart and another checkout', async () => {
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges('tok_a', onChanged, 'cart_1')

    const channel = new BroadcastChannel('checkout_payment_sync')
    channel.postMessage({
      type: 'checkout_changed',
      token: 'tok_b',
      cartPublicId: 'cart_2',
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onChanged).not.toHaveBeenCalledWith('ping')

    channel.close()
    stop()
  })

  it('still carries no outcome, amount or order number', () => {
    const seen: unknown[] = []
    const channel = new BroadcastChannel('checkout_payment_sync')
    channel.addEventListener('message', (event) => seen.push(event.data))

    announceCheckoutChanged('tok_a', 'cart_1')

    return vi
      .waitFor(() => expect(seen).toHaveLength(1))
      .then(() => {
        expect(Object.keys(seen[0] as object).sort()).toEqual([
          'cartPublicId',
          'token',
          'type',
        ])
        channel.close()
      })
  })

  it('refuses to address a message to nothing at all', () => {
    // A ping naming neither a checkout nor a cart could only mean
    // "something, somewhere, changed", and no tab should act on that.
    const onChanged = vi.fn()
    const stop = subscribeCheckoutChanges(null, onChanged, null)
    announceCheckoutChanged(null, null)
    expect(onChanged).not.toHaveBeenCalled()
    stop()
  })
})

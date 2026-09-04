/* ══════════════════════════════════════════════════════════════════════
   Authoritative status polling.

   The backend is the only thing that decides a payment's outcome. This
   module decides *when to ask it again* — nothing more. No elapsed time
   ever concludes anything: a provider's own redirect and the wall clock
   are both irrelevant to what a payment did.

   Polling is nevertheless bounded. An unbounded poll is a tab that
   generates a request every eight seconds for as long as it stays open —
   through a laptop lid, a backgrounded phone, a forgotten window — for a
   payment the server will settle on its own via the webhook whether or
   not anyone is watching. When the budget runs out the poll stops and
   says so (`onExhausted`); it never invents an outcome, and the caller
   is expected to offer an explicit "check again" that restarts it.
   ══════════════════════════════════════════════════════════════════════ */

import { isTerminalState, type PaymentState } from './state'

/**
 * Fast at the start, where the state genuinely changes second-to-second
 * (the customer is finishing 3DS and the webhook is landing), then easing
 * off so a customer who wandered away isn't generating a request per
 * second forever. Values are the *delay before the next* attempt.
 */
export const POLL_SCHEDULE_MS = [
  1000, 1000, 1000, 1000, 1000, // first ~5s — the window a fast decline lands in
  2000, 2000, 2000,             // ~11s
  3000, 3000, 3000,             // ~20s
  5000, 5000,                   // ~30s
]

/** Steady-state interval once the schedule above is exhausted. */
export const POLL_MAX_INTERVAL_MS = 8000

/**
 * How long one uninterrupted poll runs before it gives up and hands the
 * decision back to the customer.
 *
 * Five minutes comfortably outlasts a 3DS challenge plus a webhook, which
 * is the longest legitimate wait on this path. Past that, the customer is
 * no longer at the keyboard and the server will finish without us.
 */
export const POLL_BUDGET_MS = 5 * 60_000

export function pollDelayForAttempt(attempt: number): number {
  return POLL_SCHEDULE_MS[attempt] ?? POLL_MAX_INTERVAL_MS
}

export interface PaymentPollOptions {
  /**
   * One authoritative round trip. Resolves to the normalized state, or
   * null when the state could not be read this tick (network blip) — a
   * null keeps the poll alive rather than concluding anything.
   */
  fetchState: () => Promise<PaymentState | null>
  /** Called after every tick that produced a state, terminal or not. */
  onState?: (state: PaymentState) => void
  /** Called once, with the terminal state, immediately before stopping. */
  onTerminal?: (state: PaymentState) => void
  /** Fires on every tick, terminal or not. */
  onTick?: () => void
  /**
   * Called once when the time budget runs out with no terminal state.
   * The payment is NOT resolved — this says only "we stopped asking".
   */
  onExhausted?: () => void
  /** Override for the time budget. Tests use it; nothing else should. */
  budgetMs?: number
  /** Injectable clock, for tests. */
  now?: () => number
}

export interface PaymentPollHandle {
  /** Idempotent; safe to call from an effect cleanup. */
  stop: () => void
  /** Ask again right now (realtime hint, or an explicit "check again"). */
  refreshNow: () => void
}

/**
 * Starts polling. Returns a handle whose `stop()` MUST be wired to the
 * caller's teardown — an orphaned poll outlives its component and keeps
 * writing state into an unmounted tree.
 */
export function startPaymentPoll(options: PaymentPollOptions): PaymentPollHandle {
  let stopped = false
  // Set only by stop(), and never cleared: an unmounted caller's poll must
  // stay dead even if something still holds the handle and calls
  // refreshNow(). `stopped` alone cannot express that — exhaustion also
  // sets it, and exhaustion IS meant to be resumable.
  let disposed = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false

  const now = options.now ?? (() => Date.now())
  const budgetMs = options.budgetMs ?? POLL_BUDGET_MS
  let startedAt = now()

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = () => {
    if (stopped) return
    clearTimer()
    timer = setTimeout(run, pollDelayForAttempt(attempt))
  }

  const run = async () => {
    if (stopped) return
    // A `refreshNow()` landing on top of an in-flight tick would double
    // the request rate for no new information; the tick already running
    // will reschedule.
    if (inFlight) return
    inFlight = true

    let state: PaymentState | null = null
    try {
      state = await options.fetchState()
    } catch {
      state = null
    } finally {
      inFlight = false
    }

    if (stopped) return

    options.onTick?.()

    if (state) {
      options.onState?.(state)
      if (isTerminalState(state)) {
        stopped = true
        clearTimer()
        options.onTerminal?.(state)
        return
      }
    }

    // Checked only after a non-terminal tick, so a result that arrived
    // right on the boundary is still honoured rather than discarded.
    if (now() - startedAt >= budgetMs) {
      stopped = true
      clearTimer()
      options.onExhausted?.()
      return
    }

    attempt += 1
    schedule()
  }

  // First check immediately — the outcome may already be known (a
  // provider that resolved synchronously, or a page reloaded after the
  // fact), and making the customer wait a full interval to find that out
  // is latency with nothing behind it.
  void run()

  return {
    stop: () => {
      stopped = true
      disposed = true
      clearTimer()
    },
    refreshNow: () => {
      if (disposed) return
      // Deliberately works after exhaustion too: this is the customer
      // pressing "check again", which is exactly the signal that someone
      // is still watching and the budget should start over.
      stopped = false
      attempt = 0
      startedAt = now()
      clearTimer()
      void run()
    },
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startPaymentPoll, pollDelayForAttempt, POLL_MAX_INTERVAL_MS } from './poll'
import type { PaymentState } from './state'

describe('poll pacing starts fast and backs off', () => {
  it('checks every second through the window a fast decline lands in', () => {
    expect(pollDelayForAttempt(0)).toBe(1000)
    expect(pollDelayForAttempt(4)).toBe(1000)
  })

  it('widens the interval as the payment keeps not changing', () => {
    expect(pollDelayForAttempt(6)).toBeGreaterThan(pollDelayForAttempt(1))
    expect(pollDelayForAttempt(12)).toBeGreaterThan(pollDelayForAttempt(6))
  })

  it('settles on a bounded steady-state interval rather than growing forever', () => {
    // An unbounded backoff would eventually make a late webhook take
    // minutes to surface; a customer who wandered off still gets a prompt
    // answer when they come back.
    expect(pollDelayForAttempt(500)).toBe(POLL_MAX_INTERVAL_MS)
  })
})

describe('startPaymentPoll asks the backend until it settles', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('checks immediately rather than waiting out the first interval', async () => {
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'PROCESSING')
    const handle = startPaymentPoll({ fetchState })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchState).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it('stops the instant the backend reports a terminal state', async () => {
    const fetchState = vi
      .fn<() => Promise<PaymentState>>()
      .mockResolvedValueOnce('REQUIRES_ACTION')
      .mockResolvedValueOnce('FAILED')
    const onTerminal = vi.fn()

    startPaymentPoll({ fetchState, onTerminal })
    await vi.advanceTimersByTimeAsync(5000)

    expect(onTerminal).toHaveBeenCalledWith('FAILED')
    const callsAtTerminal = fetchState.mock.calls.length

    // No further requests after the outcome is known.
    await vi.advanceTimersByTimeAsync(30000)
    expect(fetchState).toHaveBeenCalledTimes(callsAtTerminal)
  })

  it('never concludes anything from elapsed time alone', async () => {
    // The one guarantee that matters: a payment that stays pending for
    // minutes stays pending. No timeout may turn it into a failure.
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'REQUIRES_ACTION')
    const onTerminal = vi.fn()

    const handle = startPaymentPoll({ fetchState, onTerminal })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(onTerminal).not.toHaveBeenCalled()
    expect(fetchState.mock.calls.length).toBeGreaterThan(5)
    handle.stop()
  })

  it('keeps polling through a failed read instead of concluding', async () => {
    const fetchState = vi
      .fn<() => Promise<PaymentState | null>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(null)
      .mockResolvedValue('SUCCESS')
    const onTerminal = vi.fn()

    startPaymentPoll({ fetchState, onTerminal })
    await vi.advanceTimersByTimeAsync(6000)

    // A network blip is not evidence about the payment.
    expect(onTerminal).toHaveBeenCalledWith('SUCCESS')
  })

  it('stops for good once stopped, even with a tick in flight', async () => {
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'PROCESSING')
    const handle = startPaymentPoll({ fetchState })
    await vi.advanceTimersByTimeAsync(0)

    handle.stop()
    const callsAtStop = fetchState.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)

    expect(fetchState).toHaveBeenCalledTimes(callsAtStop)
  })

  it('refreshNow checks straight away and resets the backoff', async () => {
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'PROCESSING')
    const handle = startPaymentPoll({ fetchState })
    await vi.advanceTimersByTimeAsync(60000)
    const before = fetchState.mock.calls.length

    handle.refreshNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchState.mock.calls.length).toBe(before + 1)

    // Backoff reset: the next check is a fast one again.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchState.mock.calls.length).toBe(before + 2)
    handle.stop()
  })

  it('reports every observed state, not only the terminal one', async () => {
    const onState = vi.fn()
    const fetchState = vi
      .fn<() => Promise<PaymentState>>()
      .mockResolvedValueOnce('PROCESSING')
      .mockResolvedValueOnce('REQUIRES_ACTION')
      .mockResolvedValue('SUCCESS')

    startPaymentPoll({ fetchState, onState })
    await vi.advanceTimersByTimeAsync(5000)

    expect(onState.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['PROCESSING', 'REQUIRES_ACTION', 'SUCCESS']),
    )
  })
})

describe('polling is bounded, and stopping is never an outcome', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('gives up asking once the budget runs out', async () => {
    let clock = 0
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'PROCESSING')
    const onExhausted = vi.fn()
    const onTerminal = vi.fn()

    startPaymentPoll({
      fetchState,
      onExhausted,
      onTerminal,
      budgetMs: 10_000,
      now: () => clock,
    })

    await vi.advanceTimersByTimeAsync(0)
    clock = 10_001
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onExhausted).toHaveBeenCalledTimes(1)
    // Running out of time says only "we stopped asking". It must never
    // be turned into a payment outcome.
    expect(onTerminal).not.toHaveBeenCalled()

    const callsAtGiveUp = fetchState.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchState).toHaveBeenCalledTimes(callsAtGiveUp)
  })

  it('honours a terminal state that lands exactly on the boundary', async () => {
    let clock = 0
    const onTerminal = vi.fn()
    const onExhausted = vi.fn()

    startPaymentPoll({
      fetchState: async () => {
        clock = 10_000
        return 'SUCCESS'
      },
      onTerminal,
      onExhausted,
      budgetMs: 10_000,
      now: () => clock,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(onTerminal).toHaveBeenCalledWith('SUCCESS')
    expect(onExhausted).not.toHaveBeenCalled()
  })

  it('restarts the budget when the customer asks to check again', async () => {
    let clock = 0
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'PROCESSING')
    const handle = startPaymentPoll({ fetchState, budgetMs: 10_000, now: () => clock })

    await vi.advanceTimersByTimeAsync(0)
    clock = 10_001
    await vi.advanceTimersByTimeAsync(5_000)
    const callsAtGiveUp = fetchState.mock.calls.length

    handle.refreshNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchState.mock.calls.length).toBeGreaterThan(callsAtGiveUp)
  })

  it('stays dead after stop(), even if something still calls refreshNow', async () => {
    // An unmounted checkout must not keep polling because a stale handle
    // was held somewhere.
    const fetchState = vi.fn(async (): Promise<PaymentState> => 'PROCESSING')
    const handle = startPaymentPoll({ fetchState })
    await vi.advanceTimersByTimeAsync(0)
    handle.stop()
    const calls = fetchState.mock.calls.length

    handle.refreshNow()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchState).toHaveBeenCalledTimes(calls)
  })
})

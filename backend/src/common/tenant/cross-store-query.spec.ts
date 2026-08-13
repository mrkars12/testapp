import {
  crossStoreQuery,
  currentCrossStoreReason,
  isCrossStoreQuery,
} from './cross-store-query'

describe('the cross-store escape hatch', () => {
  it('is closed by default', () => {
    expect(isCrossStoreQuery()).toBe(false)
    expect(currentCrossStoreReason()).toBeNull()
  })

  it('opens only for the enclosed call', async () => {
    let insideValue = false

    await crossStoreQuery('provider_lookup', 'resolve attempt', async () => {
      insideValue = isCrossStoreQuery()
    })

    expect(insideValue).toBe(true)
    expect(isCrossStoreQuery()).toBe(false)
  })

  it('records why, for the audit log', async () => {
    let reason: string | null = null

    await crossStoreQuery('platform_sweep', 'nightly reconcile', async () => {
      reason = currentCrossStoreReason()
    })

    expect(reason).toBe('platform_sweep: nightly reconcile')
  })

  it('closes even when the query throws', async () => {
    // A leaked-open scope would silently disable the guard for every
    // later query on this worker — far worse than the original problem.
    await expect(
      crossStoreQuery('provider_lookup', 'boom', async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')

    expect(isCrossStoreQuery()).toBe(false)
  })

  it('refuses to nest', async () => {
    await expect(
      crossStoreQuery('provider_lookup', 'outer', () =>
        crossStoreQuery('platform_sweep', 'inner', async () => undefined),
      ),
    ).rejects.toThrow(/Nested crossStoreQuery/)

    expect(isCrossStoreQuery()).toBe(false)
  })

  it('returns the enclosed value', async () => {
    const result = await crossStoreQuery('health_check', 'count', async () => 7)
    expect(result).toBe(7)
  })
})

describe('concurrent operations do not see each other', () => {
  /** Yields to the event loop so the two calls genuinely interleave. */
  const tick = () => new Promise((resolve) => setImmediate(resolve))

  it('lets two independent scopes run at the same time', async () => {
    // The bug this replaced: module-level state meant one operation
    // opening a scope made an unrelated concurrent operation believe it
    // was nested, and it threw.
    const results = await Promise.all([
      crossStoreQuery('provider_lookup', 'first', async () => {
        await tick()
        return currentCrossStoreReason()
      }),
      crossStoreQuery('platform_sweep', 'second', async () => {
        await tick()
        return currentCrossStoreReason()
      }),
    ])

    expect(results).toEqual([
      'provider_lookup: first',
      'platform_sweep: second',
    ])
  })

  it('does not leak one scope into an unrelated concurrent call', async () => {
    // The dangerous direction: an open scope suppressing the tenant
    // guard for queries belonging to somebody else's request.
    let observedOutside: boolean | null = null

    await Promise.all([
      crossStoreQuery('provider_lookup', 'inside', async () => {
        await tick()
        await tick()
      }),
      (async () => {
        await tick()
        observedOutside = isCrossStoreQuery()
      })(),
    ])

    expect(observedOutside).toBe(false)
  })

  it('still refuses a genuine nest within one operation', async () => {
    await expect(
      crossStoreQuery('provider_lookup', 'outer', async () => {
        await tick()
        return crossStoreQuery('platform_sweep', 'inner', async () => undefined)
      }),
    ).rejects.toThrow(/Nested crossStoreQuery/)
  })

  it('clears the scope after a concurrent batch', async () => {
    await Promise.all([
      crossStoreQuery('provider_lookup', 'a', async () => tick()),
      crossStoreQuery('health_check', 'b', async () => tick()),
    ])

    expect(isCrossStoreQuery()).toBe(false)
  })
})
import {
  crossModeQuery,
  currentCrossModeReason,
  isCrossModeQuery,
} from './cross-mode-query'

describe('the cross-mode escape hatch', () => {
  it('is closed by default', () => {
    expect(isCrossModeQuery()).toBe(false)
    expect(currentCrossModeReason()).toBeNull()
  })

  it('opens only for the enclosed call', async () => {
    let insideValue = false

    await crossModeQuery('merchant_dual_mode_view', 'settings screen', async () => {
      insideValue = isCrossModeQuery()
    })

    expect(insideValue).toBe(true)
    expect(isCrossModeQuery()).toBe(false)
  })

  it('records why, for the audit log', async () => {
    let reason: string | null = null

    await crossModeQuery('merchant_dual_mode_view', 'list all accounts', async () => {
      reason = currentCrossModeReason()
    })

    expect(reason).toBe('merchant_dual_mode_view: list all accounts')
  })

  it('closes even when the query throws', async () => {
    await expect(
      crossModeQuery('merchant_dual_mode_view', 'boom', async () => {
        throw new Error('query failed')
      }),
    ).rejects.toThrow('query failed')

    expect(isCrossModeQuery()).toBe(false)
  })

  it('refuses to nest', async () => {
    await expect(
      crossModeQuery('merchant_dual_mode_view', 'outer', () =>
        crossModeQuery('merchant_dual_mode_view', 'inner', async () => undefined),
      ),
    ).rejects.toThrow(/Nested crossModeQuery/)

    expect(isCrossModeQuery()).toBe(false)
  })

  it('returns the enclosed value', async () => {
    const result = await crossModeQuery(
      'merchant_dual_mode_view',
      'count',
      async () => 7,
    )
    expect(result).toBe(7)
  })

  it('keeps the scope open until a lazily-executed query runs', async () => {
    // Mirrors the applier's real usage shape: a Prisma promise is lazy,
    // so the scope must still be open when the deferred .then() runs.
    let insideScope: boolean | null = null

    function lazyQuery(onExecute: () => void) {
      return {
        then(resolve: (value: unknown) => void) {
          onExecute()
          resolve(null)
        },
      }
    }

    await crossModeQuery('merchant_dual_mode_view', 'lazy', () =>
      lazyQuery(() => {
        insideScope = isCrossModeQuery()
      }) as unknown as Promise<unknown>,
    )

    expect(insideScope).toBe(true)
  })
})

describe('cross-mode and cross-store contexts do not bleed into each other', () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve))

  it('lets two independent operations run concurrently without interference', async () => {
    const results = await Promise.all([
      crossModeQuery('merchant_dual_mode_view', 'first', async () => {
        await tick()
        return currentCrossModeReason()
      }),
      (async () => {
        await tick()
        // Runs outside any scope; must never observe the concurrent one.
        return isCrossModeQuery()
      })(),
    ])

    expect(results).toEqual(['merchant_dual_mode_view: first', false])
  })

  it('does not leak into an unrelated concurrent call', async () => {
    let observedOutside: boolean | null = null

    await Promise.all([
      crossModeQuery('merchant_dual_mode_view', 'inside', async () => {
        await tick()
        await tick()
      }),
      (async () => {
        await tick()
        observedOutside = isCrossModeQuery()
      })(),
    ])

    expect(observedOutside).toBe(false)
  })

  it('clears the scope after a concurrent batch', async () => {
    await Promise.all([
      crossModeQuery('merchant_dual_mode_view', 'a', async () => tick()),
      crossModeQuery('merchant_dual_mode_view', 'b', async () => tick()),
    ])

    expect(isCrossModeQuery()).toBe(false)
  })
})
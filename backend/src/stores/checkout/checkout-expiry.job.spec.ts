import { Logger } from '@nestjs/common'
import { CheckoutExpiryJob } from './checkout-expiry.job'

/**
 * ══════════════════════════════════════════════════════════════════
 * The expiry job's TWO error boundaries.
 * ══════════════════════════════════════════════════════════════════
 *
 * `run()` drives two sweeps that use two different database
 * connections: `releaseExpired()` on the application role, and
 * `sweepExpiredCarts()` on the platform role. They fail for different
 * reasons and mean different things.
 *
 * They used to share one try/catch, and that actively misled an
 * operator: a missing platform grant made the cart half throw `42501`
 * on every tick, and the only log line said "Checkout expiry sweep
 * failed" — which reads as "stock is not being released". It was being
 * released; the first half had already committed. The wrong diagnosis
 * survived a whole report.
 *
 * These tests hold the fix in place. They are unit tests on purpose:
 * the behaviour is error isolation, not database behaviour, and forcing
 * a real `42501` would mean provisioning a broken database. The sweeps
 * themselves are covered against a real database in
 * `funds-secured.integration.spec.ts` and
 * `checkout.service.integration.spec.ts`.
 */
describe('CheckoutExpiryJob error isolation', () => {
  let job: CheckoutExpiryJob
  let errors: string[]
  let logs: string[]

  beforeEach(() => {
    errors = []
    logs = []
    // The job only needs `prisma` for the real sweeps, which every test
    // here replaces.
    job = new CheckoutExpiryJob({} as never)
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((message: unknown) => {
        errors.push(String(message))
      })
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message))
    })
  })

  afterEach(() => jest.restoreAllMocks())

  it('runs the cart sweep even when the reservation release throws', async () => {
    const sweep = jest.spyOn(job, 'sweepExpiredCarts').mockResolvedValue(3)
    jest
      .spyOn(job, 'releaseExpired')
      .mockRejectedValue(new Error('connection reset'))

    await job.run()

    // The half that still works still runs, and still reports.
    expect(sweep).toHaveBeenCalledTimes(1)
    expect(logs).toContainEqual(expect.stringContaining('Abandoned 3'))

    // And the failure names itself rather than hiding behind a generic
    // "sweep failed".
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('[checkout-expiry]')
    expect(errors[0]).toContain('connection reset')
    expect(errors[0]).not.toContain('[cart-expiry]')
  })

  it('still releases reservations when the cart sweep throws, and says which half broke', async () => {
    jest.spyOn(job, 'releaseExpired').mockResolvedValue(2)
    jest
      .spyOn(job, 'sweepExpiredCarts')
      .mockRejectedValue(new Error('permission denied for table carts'))

    await job.run()

    // THE REGRESSION. The reservation release completed and said so;
    // the old single catch let the cart failure be the only thing in
    // the log, which read as though this had not happened.
    expect(logs).toContainEqual(expect.stringContaining('Released 2'))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('[cart-expiry]')
    expect(errors[0]).toContain('permission denied for table carts')
    // The message has to be actionable: the cause is almost always a
    // missing grant on a connection whose identity is not in the
    // PostgreSQL error text.
    expect(errors[0]).toContain('DATABASE_URL_PLATFORM')
    expect(errors[0]).toContain('dartstore_platform')
    // And it must say the other half is fine, which is the fact the
    // original single catch destroyed.
    expect(errors[0]).toMatch(/reservations are unaffected/i)
  })

  it('reports both failures separately when both halves throw', async () => {
    jest.spyOn(job, 'releaseExpired').mockRejectedValue(new Error('boom A'))
    jest.spyOn(job, 'sweepExpiredCarts').mockRejectedValue(new Error('boom B'))

    await job.run()

    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('[checkout-expiry]')
    expect(errors[0]).toContain('boom A')
    expect(errors[1]).toContain('[cart-expiry]')
    expect(errors[1]).toContain('boom B')
  })

  it('never rethrows, so a failing tick cannot kill the scheduler', async () => {
    jest.spyOn(job, 'releaseExpired').mockRejectedValue(new Error('boom'))
    jest.spyOn(job, 'sweepExpiredCarts').mockRejectedValue(new Error('boom'))

    await expect(job.run()).resolves.toBeUndefined()

    // And the re-entry guard is released, or the job would run once and
    // never again.
    jest.spyOn(job, 'releaseExpired').mockResolvedValue(1)
    jest.spyOn(job, 'sweepExpiredCarts').mockResolvedValue(0)
    await job.run()
    expect(logs).toContainEqual(expect.stringContaining('Released 1'))
  })

  it('logs nothing when both sweeps find no work', async () => {
    jest.spyOn(job, 'releaseExpired').mockResolvedValue(0)
    jest.spyOn(job, 'sweepExpiredCarts').mockResolvedValue(0)

    await job.run()

    // The quiet steady state. A job that logs every idle minute trains
    // people to ignore it.
    expect(logs).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })
})

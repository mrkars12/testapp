import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ActiveStoreGuard } from './active-store.guard'
import { TenantContextService } from '../common/tenant/tenant-context.service'

/**
 * ══════════════════════════════════════════════════════════════════
 * ActiveStoreGuard — the store-switch entry point
 * ══════════════════════════════════════════════════════════════════
 *
 * The guard is the single place a client-supplied store identifier is
 * turned into an authoritative active store. Everything downstream —
 * `@ActiveStore()`, `store.id` in every service, `app.store_id` in RLS,
 * the idempotency interceptor — reads what this guard decided.
 *
 * Two properties matter and are asserted here rather than assumed:
 *
 *   1. Precedence is fixed and documented: X-Store-Id, then
 *      X-Store-Slug, then the :storeSlug route param.
 *   2. The tenant context is populated *after* ownership is proven and
 *      never when it is not. If the order were reversed, a request
 *      naming somebody else's store would install that store in the
 *      RLS context, and the guard meant to prevent the leak would be
 *      the thing causing it.
 */

function makeContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never
}

function makeRequest(
  overrides: {
    user?: Record<string, unknown> | undefined
    headers?: Record<string, string>
    params?: Record<string, string>
  } = {},
) {
  return {
    user: 'user' in overrides ? overrides.user : { id: '7' },
    headers: overrides.headers ?? {},
    params: overrides.params ?? {},
  } as Record<string, unknown>
}

describe('ActiveStoreGuard', () => {
  const storeA = { id: 1n, slug: 'store-a', ownerId: 7n }
  const storeB = { id: 2n, slug: 'store-b', ownerId: 7n }

  let resolve: jest.Mock
  let tenantContext: TenantContextService
  let guard: ActiveStoreGuard

  beforeEach(() => {
    resolve = jest.fn().mockResolvedValue(storeB)
    tenantContext = new TenantContextService()
    guard = new ActiveStoreGuard(
      { resolveActiveStore: resolve } as never,
      tenantContext,
    )
  })

  /** Runs the guard inside a tenant context, as the middleware does. */
  async function run(request: Record<string, unknown>) {
    return tenantContext.run(
      { storeId: null, mode: 'live', actor: null, requestId: 'req-test' },
      async () => {
        const allowed = await guard.canActivate(makeContext(request))
        return { allowed, storeId: tenantContext.getStoreId() }
      },
    )
  }

  describe('identifier precedence', () => {
    it('prefers X-Store-Id over every other source', async () => {
      await run(
        makeRequest({
          headers: { 'x-store-id': '2', 'x-store-slug': 'store-a' },
          params: { storeSlug: 'store-a' },
        }),
      )

      expect(resolve).toHaveBeenCalledWith('7', '2')
    })

    it('falls back to X-Store-Slug when no id header is sent', async () => {
      await run(
        makeRequest({
          headers: { 'x-store-slug': 'store-b' },
          params: { storeSlug: 'store-a' },
        }),
      )

      expect(resolve).toHaveBeenCalledWith('7', 'store-b')
    })

    it('falls back to the :storeSlug route param when no header is sent', async () => {
      await run(makeRequest({ params: { storeSlug: 'store-b' } }))

      expect(resolve).toHaveBeenCalledWith('7', 'store-b')
    })

    it('passes null when the client names no store at all', async () => {
      // The documented default: the service picks the user's oldest
      // store. A frontend that never sends a header therefore always
      // gets that same store, whatever it displays.
      await run(makeRequest())

      expect(resolve).toHaveBeenCalledWith('7', null)
    })
  })

  describe('switching A → B', () => {
    it('publishes the resolved store on the request and in the tenant context', async () => {
      const request = makeRequest({ headers: { 'x-store-id': '2' } })

      const { allowed, storeId } = await run(request)

      expect(allowed).toBe(true)
      expect(request.activeStore).toBe(storeB)
      expect(request.activeStoreId).toBe(2n)
      expect(storeId).toBe('2')
    })

    it('replaces a previously active store rather than merging with it', async () => {
      resolve.mockResolvedValueOnce(storeA).mockResolvedValueOnce(storeB)

      const first = makeRequest({ headers: { 'x-store-id': '1' } })
      const second = makeRequest({ headers: { 'x-store-id': '2' } })

      expect((await run(first)).storeId).toBe('1')
      expect((await run(second)).storeId).toBe('2')

      // Each request opens its own context; nothing from A survives
      // into B's request.
      expect(first.activeStoreId).toBe(1n)
      expect(second.activeStoreId).toBe(2n)
    })
  })

  describe('unauthorized store selection', () => {
    it('propagates the rejection and leaves the tenant context empty', async () => {
      resolve.mockRejectedValue(new NotFoundException('Store not found'))

      let observed: string | null = 'not-run'

      await expect(
        tenantContext.run(
          { storeId: null, mode: 'live', actor: null, requestId: 'req-test' },
          async () => {
            try {
              await guard.canActivate(
                makeContext(makeRequest({ headers: { 'x-store-id': '99' } })),
              )
            } finally {
              observed = tenantContext.getStoreId()
            }
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException)

      // The critical assertion: a refused store never reaches the RLS
      // context. `app.store_id` would otherwise be set to a store the
      // caller has no claim to.
      expect(observed).toBeNull()
    })

    it('does not set the request store when resolution is forbidden', async () => {
      resolve.mockRejectedValue(new ForbiddenException())
      const request = makeRequest({ headers: { 'x-store-id': '99' } })

      await expect(run(request)).rejects.toBeInstanceOf(ForbiddenException)

      expect(request.activeStore).toBeUndefined()
      expect(request.activeStoreId).toBeUndefined()
    })
  })

  describe('without an authenticated user', () => {
    it('refuses the request rather than passing it on unscoped', async () => {
      /*
       * FAIL CLOSED, and this assertion is the point of the change.
       *
       * Every route that mounts this guard today also mounts
       * SessionAuthGuard at the controller level, so in practice the
       * auth guard rejects first and this branch is unreachable. It
       * used to `return true` anyway, and that was a fail-open waiting
       * for its first caller: a route added later with
       * `@UseGuards(ActiveStoreGuard)` and no auth guard in front would
       * have been allowed through with no identity AND no store.
       *
       * The damage would not have stopped at a late rejection.
       * `request.activeStoreId` stays undefined, `@ActiveStoreId()`
       * hands the service `undefined`, and Prisma DROPS
       * `where: { store_id: undefined }` instead of failing — turning a
       * query that was meant to be scoped to one store into a query
       * across every store. The tenant guard cannot catch it either,
       * because TenantContext was never populated.
       */
      const request = makeRequest({ user: undefined })

      await expect(run(request)).rejects.toThrow(UnauthorizedException)

      // And it refuses without resolving or publishing anything.
      expect(resolve).not.toHaveBeenCalled()
      expect(request.activeStore).toBeUndefined()
      expect(request.activeStoreId).toBeUndefined()
    })

    it('accepts a JWT-shaped user whose id lives on `sub`', async () => {
      await run(makeRequest({ user: { sub: '7' }, headers: { 'x-store-id': '2' } }))

      expect(resolve).toHaveBeenCalledWith('7', '2')
    })
  })
})

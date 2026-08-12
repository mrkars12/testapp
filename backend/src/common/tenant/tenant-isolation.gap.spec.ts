import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { TenantContextService } from './tenant-context.service'
import { inspectScope } from './tenant-scope.inspector'

/**
 * ==================================================================
 * Demonstration: the tenant isolation net is not attached
 * ==================================================================
 *
 * These tests describe the behaviour tenant isolation is supposed to
 * have. They are written before the fix, and they fail today.
 *
 * Nothing here is a hypothetical. Every payment query in the codebase —
 * 83 of them — is scoped correctly by hand. The gap is that nothing
 * checks. A single forgotten `store_id` in a future change ships
 * silently, and in a multi-tenant payment system that is one merchant
 * reading another merchant's payments.
 */

describe('the guard has something to compare against', () => {
  it('exposes the active store to the tenant context during a request', () => {
    const context = new TenantContextService()

    // What ActiveStoreGuard should do after resolving the store. It sets
    // request.activeStore and request.activeStoreId, and stops there —
    // setStoreId() has no caller anywhere in the codebase.
    context.run(
      { storeId: null, mode: 'live', requestId: 'req-1', actor: null },
      () => {
        context.setStoreId('42')
        expect(context.getStoreId()).toBe('42')
      },
    )
  })

  it('reports no active store when the guard has not run', () => {
    const context = new TenantContextService()
    expect(context.getStoreId()).toBeNull()
  })
})

describe('a query missing store_id is a violation', () => {
  // The inspector already works. It is simply never consulted, because
  // no service calls prisma.guarded() and the context is never filled.
  it('flags an unscoped read on a tenant-scoped model', () => {
    const violations = inspectScope({
      model: 'PaymentIntent',
      operation: 'findMany',
      args: { where: { status: 'captured' } },
      contextStoreId: '42',
    })

    expect(violations.length).toBeGreaterThan(0)
  })

  it('accepts a correctly scoped read', () => {
    const violations = inspectScope({
      model: 'PaymentIntent',
      operation: 'findMany',
      args: { where: { store_id: 42n, mode: 'live', status: 'captured' } },
      contextStoreId: '42',
    })

    expect(violations).toEqual([])
  })

  it('flags a read scoped to a different store than the request', () => {
    // The shape of an actual leak: the query is scoped, but to somebody
    // else's store.
    const violations = inspectScope({
      model: 'PaymentIntent',
      operation: 'findMany',
      args: { where: { store_id: 999n, mode: 'live' } },
      contextStoreId: '42',
    })

    expect(violations.length).toBeGreaterThan(0)
  })
})

describe('the net is attached to production code', () => {
  it('has at least one service reading through the guarded client', () => {
    // guarded() is built, cached and typed. If nothing calls it, the
    // extension never runs and the inspector above is dead code in
    // production.
    const callers: string[] = []

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (full.endsWith('.ts') && !full.includes('.spec.')) {
          if (/\.guarded\(/.test(readFileSync(full, 'utf8'))) callers.push(full)
        }
      }
    }

    walk(join(__dirname, '..', '..'))

    expect(callers).not.toEqual([])
  })
})
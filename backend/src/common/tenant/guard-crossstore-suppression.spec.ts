import { Logger } from '@nestjs/common'
import { buildTenantGuardDefinition } from './tenant-guard.extension'
import { TenantContextService } from './tenant-context.service'
import { crossModeQuery } from './cross-mode-query'
import { crossStoreQuery } from './cross-store-query'

/**
 * Exercises the real $allOperations dispatch, the same way
 * guard-crossstore-suppression.spec.ts does for crossStoreQuery. A test
 * against the pure inspector alone would not prove the wiring in the
 * extension actually filters the right violation kind — that filtering
 * lives in tenant-guard.extension.ts, not in tenant-scope.inspector.ts,
 * and only running through buildTenantGuardDefinition touches it.
 */

function makeLogger() {
  const warnings: string[] = []
  const debugs: string[] = []
  const logger = {
    warn: (m: string) => warnings.push(m),
    debug: (m: string) => debugs.push(m),
    error: (m: string) => warnings.push(m),
    log: () => undefined,
  } as unknown as Logger
  return { logger, warnings, debugs }
}

async function runThroughGuard(
  extension: any,
  args: { model: string; operation: string; args: unknown },
): Promise<void> {
  const handler = extension.query.$allOperations
  await handler({
    model: args.model,
    operation: args.operation,
    args: args.args,
    query: async () => [],
  })
}

/** PaymentAccount is registered with a modeField; store_id present, mode absent. */
const dualModeShapedRead = {
  model: 'PaymentAccount',
  operation: 'findMany',
  args: { where: { store_id: 1n } },
}

describe('crossModeQuery — case A: suppresses only the mode finding', () => {
  it('emits no warning for a store-scoped, mode-agnostic read', async () => {
    const { logger, warnings, debugs } = makeLogger()
    const extension = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger,
    })

    await crossModeQuery('merchant_dual_mode_view', 'settings screen', () =>
      runThroughGuard(extension, dualModeShapedRead),
    )

    expect(warnings).toEqual([])
    expect(debugs.join(' ')).toContain('merchant_dual_mode_view')
  })
})

describe('crossModeQuery — case B: store violations are NOT suppressed', () => {
  it('still warns on missing_store_scope inside crossModeQuery', async () => {
    const { logger, warnings } = makeLogger()
    const extension = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger,
    })

    // No store_id at all — this must survive the mode-only filter.
    await crossModeQuery('merchant_dual_mode_view', 'no store at all', () =>
      runThroughGuard(extension, {
        model: 'PaymentAccount',
        operation: 'findMany',
        args: { where: {} },
      }),
    )

    expect(warnings.join(' ')).toContain('missing_store_scope')
  })

  it('still warns on store_scope_mismatch inside crossModeQuery', async () => {
    const { logger, warnings } = makeLogger()
    const context = new TenantContextService()

    const extension = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: context,
      logger,
    })

    await context.run(
      { storeId: null, mode: 'live', requestId: 'req-1', actor: null },
      async () => {
        context.setStoreId('42')

        await crossModeQuery('merchant_dual_mode_view', 'wrong store', () =>
          runThroughGuard(extension, {
            model: 'PaymentAccount',
            operation: 'findMany',
            // store_id present, but does not match the request context.
            args: { where: { store_id: 999n } },
          }),
        )
      },
    )

    expect(warnings.join(' ')).toContain('store_scope_mismatch')
  })

  it('does not accidentally behave like crossStoreQuery', async () => {
    // The decisive check: crossModeQuery must never grant the full
    // bypass crossStoreQuery provides. Same unscoped query, run under
    // each mechanism — only crossStoreQuery should come back clean.
    const unscoped = {
      model: 'PaymentAccount',
      operation: 'findMany',
      args: { where: {} },
    }

    const underCrossMode = makeLogger()
    const extensionA = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger: underCrossMode.logger,
    })
    await crossModeQuery('merchant_dual_mode_view', 'x', () =>
      runThroughGuard(extensionA, unscoped),
    )

    const underCrossStore = makeLogger()
    const extensionB = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger: underCrossStore.logger,
    })
    await crossStoreQuery('provider_lookup', 'x', () =>
      runThroughGuard(extensionB, unscoped),
    )

    expect(underCrossMode.warnings.join(' ')).toContain('missing_store_scope')
    expect(underCrossStore.warnings).toEqual([])
  })
})

describe('crossModeQuery — case C: unwrapped queries are unaffected', () => {
  it('warns on missing_mode_scope outside any wrapper', async () => {
    const { logger, warnings } = makeLogger()
    const extension = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger,
    })

    await runThroughGuard(extension, dualModeShapedRead)

    expect(warnings.join(' ')).toContain('missing_mode_scope')
  })

  it('resumes warning once the crossModeQuery scope closes', async () => {
    const { logger, warnings } = makeLogger()
    const extension = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger,
    })

    await crossModeQuery('merchant_dual_mode_view', 'inside', () =>
      runThroughGuard(extension, dualModeShapedRead),
    )
    expect(warnings).toEqual([])

    await runThroughGuard(extension, dualModeShapedRead)
    expect(warnings.join(' ')).toContain('missing_mode_scope')
  })
})

describe('crossModeQuery — case D: survives an await before the query runs', () => {
  it('still filters correctly after a deferred continuation', async () => {
    const { logger, warnings } = makeLogger()
    const extension = buildTenantGuardDefinition({
      enabled: true,
      tenantContext: new TenantContextService(),
      logger,
    })

    await crossModeQuery('merchant_dual_mode_view', 'deferred', async () => {
      await new Promise((resolve) => setImmediate(resolve))
      await runThroughGuard(extension, dualModeShapedRead)
    })

    expect(warnings).toEqual([])
  })
})
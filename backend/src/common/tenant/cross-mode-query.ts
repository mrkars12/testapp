import { AsyncLocalStorage } from 'async_hooks'
import { Logger } from '@nestjs/common'

/**
 * ==================================================================
 * Queries that deliberately span both test and live for one store
 * ==================================================================
 *
 * A sibling to cross-store-query.ts, not a variant of it. The two solve
 * different problems and must not be conflated:
 *
 *   crossStoreQuery suppresses the ENTIRE tenant check — store and mode
 *   together — for queries that genuinely cannot name a store yet, or
 *   that sweep every store on purpose.
 *
 *   crossModeQuery suppresses ONLY the mode check. Store scope stays
 *   fully enforced. This is for a query that knows exactly which store
 *   it is reading, and is deliberately reading across both modes within
 *   that one store — a merchant settings screen that must show live and
 *   test configuration side by side, for instance.
 *
 * Reusing crossStoreQuery for the mode-only case would be strictly too
 * permissive: it would also suppress a missing_store_scope finding at
 * that call site, silently, if one ever appeared. This mechanism cannot
 * do that by construction — the store check is never touched here.
 *
 * ⚠️ This is an escape hatch for one specific, named product need. It is
 * never the fix for "the guard complained about my query." A query
 * missing store scope belongs in the where clause, not in either of
 * these wrappers.
 */

const logger = new Logger('CrossModeQuery')

/** Closed set, deliberately narrow. */
export type CrossModeReason =
  /** A merchant-facing view that must show both live and test
   *  configuration for the same store at once, by product requirement. */
  | 'merchant_dual_mode_view'

interface Scope {
  readonly reason: CrossModeReason
  readonly description: string
}

/**
 * Execution-context-local, mirroring cross-store-query.ts exactly.
 *
 * A prior version of the sibling mechanism used module-level state and
 * that was wrong: two concurrent operations shared one flag, so one
 * opening a scope made an unrelated operation believe it was nested, and
 * — worse — one operation's open scope silently suppressed checks for
 * every other operation running at the same time. AsyncLocalStorage
 * keeps the scope on the async execution context, invisible to
 * everything else.
 */
const storage = new AsyncLocalStorage<Scope>()

/** Whether the current execution context is inside an approved block. */
export function isCrossModeQuery(): boolean {
  return storage.getStore() !== undefined
}

export function currentCrossModeReason(): string | null {
  const scope = storage.getStore()
  if (!scope) return null
  return `${scope.reason}: ${scope.description}`
}

/**
 * Runs a read that deliberately spans modes for one store.
 *
 * Nesting is refused, same as crossStoreQuery — a nested block makes the
 * exit condition ambiguous, and every real case here is a single query.
 * Nesting crossModeQuery inside crossStoreQuery (or the reverse) is also
 * refused: the two mechanisms have different suppression semantics, and
 * silently picking one when both are open would hide which rule
 * actually applied.
 *
 * The callback is awaited *inside* the context, not merely invoked —
 * Prisma promises are lazy, so returning storage.run(scope, run)
 * unawaited would let the context exit before the query executes. That
 * exact bug was found and fixed once already in crossStoreQuery; this
 * mechanism does not repeat it.
 *
 * @param reason  why this is allowed, from the closed set
 * @param description what the query is actually doing, for the audit log
 */
export async function crossModeQuery<T>(
  reason: CrossModeReason,
  description: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = storage.getStore()

  if (existing) {
    throw new Error(
      `Nested crossModeQuery: "${description}" inside "${existing.description}".`,
    )
  }

  return storage.run({ reason, description }, async () => await run())
}
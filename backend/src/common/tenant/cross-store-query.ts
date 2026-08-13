import { AsyncLocalStorage } from 'async_hooks'
import { Logger } from '@nestjs/common'

/**
 * ==================================================================
 * Queries that are deliberately not scoped to one store
 * ==================================================================
 *
 * A few reads genuinely cannot carry a store_id, and contorting them to
 * satisfy the guard would change what they mean:
 *
 *   The fact applier finds an attempt by (account_id, gateway_reference)
 *   because that is what a webhook gives it. There is no store in the
 *   payload — the store is *derived* from the account the attempt
 *   belongs to. Requiring store_id first would mean guessing it.
 *
 *   Reconciliation and the health checks sweep every store by design.
 *   That is the whole point of a platform-wide sweep.
 *
 * Rather than let those read as ordinary unscoped queries — which is
 * indistinguishable from a mistake — they are wrapped here. The wrapper
 * suppresses the guard for exactly the enclosed call, records why, and
 * makes the exception greppable.
 *
 * ⚠️ This is an escape hatch for platform-level reads. It is never the
 * fix for "the guard complained about my query". If a query has a store
 * in scope, it belongs in the where clause.
 */

const logger = new Logger('CrossStoreQuery')

/** Reasons a query may legitimately span stores. Closed set on purpose. */
export type CrossStoreReason =
  /** Resolves the owning store from a provider identifier. */
  | 'provider_lookup'
  /** Platform-wide background sweep. */
  | 'platform_sweep'
  /** Operational health check across all tenants. */
  | 'health_check'

interface Scope {
  readonly reason: CrossStoreReason
  readonly description: string
}

/**
 * Execution-context-local, not module-level.
 *
 * ⚠️ This was module-level state, and that was wrong. Two requests
 * running concurrently — two PaymentFactApplier instances handling two
 * webhooks, say — share a module. One opening a scope made the other
 * believe it was nested, so an unrelated request threw
 * "Nested crossStoreQuery". Worse in the other direction: one request's
 * open scope silently suppressed the tenant guard for every query any
 * other request made while it was open.
 *
 * AsyncLocalStorage keeps the scope on the async execution context, so
 * it propagates through awaits within one logical operation and is
 * invisible to every other.
 */
const storage = new AsyncLocalStorage<Scope>()

/** Whether the current execution context is inside an approved block. */
export function isCrossStoreQuery(): boolean {
  return storage.getStore() !== undefined
}

export function currentCrossStoreReason(): string | null {
  const scope = storage.getStore()
  if (!scope) return null
  return `${scope.reason}: ${scope.description}`
}

/**
 * Runs a read that legitimately spans stores.
 *
 * The scope covers exactly this call and whatever it awaits. It is
 * cleared when the context exits, including on throw — AsyncLocalStorage
 * unwinds with the stack, so there is no leak path a `finally` would
 * need to cover.
 *
 * @param reason  why this is allowed, from the closed set
 * @param description what the query is actually doing, for the audit log
 */
export async function crossStoreQuery<T>(
  reason: CrossStoreReason,
  description: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = storage.getStore()

  if (existing) {
    // Still a hard error, but now it only fires for a genuine nest
    // inside one operation, not for two operations running at once.
    throw new Error(
      `Nested crossStoreQuery: "${description}" inside "${existing.description}".`,
    )
  }

  // ⚠️ The callback is awaited *inside* the context, not merely invoked.
  //
  // Prisma promises are lazy: findFirst() builds a promise and executes
  // nothing. Returning storage.run(scope, run) hands back an unexecuted
  // promise and lets the context exit, so the query — and therefore the
  // guard's handler — ran with no scope at all. The bypass never fired
  // and every approved cross-store read was still reported as a
  // violation.
  //
  // Awaiting here keeps the context alive across the continuation that
  // actually executes the query.
  return storage.run({ reason, description }, async () => await run())
}

/** Logs the exceptions once at boot so they are visible, not buried. */
export function logCrossStoreExceptions(entries: readonly string[]): void {
  if (entries.length === 0) return
  logger.log(`Cross-store reads in use: ${entries.join(', ')}`)
}
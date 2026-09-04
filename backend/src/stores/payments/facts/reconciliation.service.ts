import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../../prisma/prisma.service'
import { PaymentAccountService } from '../payment-account.service'
import { ProviderRegistry } from '../gateways/provider-registry.service'
import { PaymentFactApplier } from './payment-fact.applier'
import { crossStoreQuery } from '../../../common/tenant/cross-store-query'

/**
 * ==================================================================
 * Reconciliation
 * ==================================================================
 *
 * Webhooks are a latency optimisation, not the source of truth. They get
 * lost, silently disabled, blocked by firewalls, and delivered to the
 * wrong environment. This sweep asks each provider directly about
 * intents that have been sitting non-terminal too long, and feeds the
 * answers through the same applier a webhook would use.
 *
 * The system is designed to be correct with every webhook dropped. That
 * claim is only true because this exists.
 */

/** How long an intent may sit non-terminal before it is swept. */
const STALE_AFTER_SECONDS = 300

/**
 * How long before a visited intent becomes eligible again.
 *
 * The sweep stamps `last_reconciled_at` on every intent it VISITS, not
 * only the ones it manages to process, and orders by that column. That
 * is what stops a permanently unprocessable intent — a manual-capture
 * `authorized` waiting weeks, an attempt with no gateway reference, an
 * account whose provider has no status polling — from holding the front
 * of the queue forever and starving every newer, recoverable one behind
 * it.
 *
 * Matching STALE_AFTER_SECONDS keeps one rule instead of two: an intent
 * is looked at at most once every five minutes, whatever happened last
 * time.
 */
const RECHECK_AFTER_SECONDS = 300

/** Cap per run so a backlog cannot monopolise a worker. */
const BATCH_SIZE = 50

const NON_TERMINAL = [
  'created',
  'requires_payment_method',
  'requires_action',
  'processing',
  'authorized',
  'partially_captured',
] as const

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name)

  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly accounts: PaymentAccountService,
    private readonly applier: PaymentFactApplier,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (this.running) return

    this.running = true
    try {
      const processed = await this.sweep()
      if (processed > 0) {
        this.logger.log(`Reconciliation swept ${processed} intents.`)
      }
    } catch (error) {
      this.logger.error(
        `Reconciliation sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
      )
    } finally {
      this.running = false
    }
  }

  /** Exposed separately so it can be invoked on demand. */
  async sweep(now = new Date()): Promise<number> {
    const intents = await this.findEligible(now, BATCH_SIZE)

    let processed = 0

    for (const intent of intents) {
      try {
        if (await this.reconcileIntent(intent)) processed += 1
      } catch (error) {
        // One provider being unreachable must not stop the sweep.
        this.logger.warn(
          `Reconciling intent ${intent.id} failed: ${(error as Error).message}`,
        )
      } finally {
        /*
         * STAMPED WHATEVER HAPPENED — this is the whole fix.
         *
         * In `finally`, so an intent that threw is marked too. An
         * unreachable provider must not turn into a row that is retried
         * ahead of everything else forever; it goes to the back and is
         * tried again on a later pass, like every other visited row.
         *
         * Its own write, outside the reconcile path, so a rollback
         * there cannot take the progress marker with it.
         */
        await this.markVisited(intent, now)
      }
    }

    return processed
  }

  /**
   * The intents this run may look at, oldest-unvisited first.
   *
   * Two filters, and they answer different questions:
   *
   *   created_at < staleCutoff          has this been non-terminal long
   *                                     enough to be worth asking about?
   *   last_reconciled_at < recheckCutoff has enough time passed since we
   *                                     last asked?
   *
   * `nulls: 'first'` matters: a never-visited intent is the most urgent
   * thing in the queue, and PostgreSQL sorts NULLs LAST in ASC by
   * default, which would have put brand-new intents behind every row
   * the sweep had already given up on.
   */
  private async findEligible(now: Date, take: number) {
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_SECONDS * 1000)
    const recheckCutoff = new Date(
      now.getTime() - RECHECK_AFTER_SECONDS * 1000,
    )

    // Sweeping every store is the point of a platform-wide sweep. The
    // per-intent work below is scoped normally.
    return crossStoreQuery(
      'platform_sweep',
      'find non-terminal intents across all stores',
      () =>
        this.prisma.platform().paymentIntent.findMany({
          where: {
            status: { in: [...NON_TERMINAL] },
            created_at: { lt: staleCutoff },
            OR: [
              { last_reconciled_at: null },
              { last_reconciled_at: { lt: recheckCutoff } },
            ],
          },
          orderBy: [
            { last_reconciled_at: { sort: 'asc', nulls: 'first' } },
            { created_at: 'asc' },
          ],
          take,
        }),
    )
  }

  /**
   * Records that this run looked at the intent.
   *
   * Written on the TENANT connection, not the platform one: the
   * platform role holds SELECT on `payment_intents` and nothing more,
   * and widening it to UPDATE for a progress marker would trade a real
   * privilege boundary for a convenience. The store and mode are both
   * in hand here, so a normal tenant transaction is available.
   *
   * A failure to stamp is logged and swallowed. The consequence is that
   * this intent is looked at again on the next pass — the behaviour
   * that existed before this column, for one row, for one cycle.
   */
  private async markVisited(
    intent: { id: bigint; store_id: bigint; mode: 'test' | 'live' },
    now: Date,
  ): Promise<void> {
    try {
      await this.prisma.withTenantTransaction(
        intent.store_id,
        intent.mode,
        (tx) =>
          tx.paymentIntent.updateMany({
            where: {
              id: intent.id,
              store_id: intent.store_id,
              mode: intent.mode,
            },
            data: { last_reconciled_at: now },
          }),
      )
    } catch (error) {
      this.logger.warn(
        `Could not stamp last_reconciled_at on intent ${intent.id}: ${
          (error as Error).message
        }`,
      )
    }
  }

  /**
   * How far behind the sweep is, in seconds — the observable that makes
   * starvation visible.
   *
   * The age of the OLDEST intent currently eligible for reconciliation.
   * A healthy system keeps this near `RECHECK_AFTER_SECONDS`, because
   * the sweep reaches everything it is allowed to look at. A number
   * that climbs without bound means the backlog is larger than
   * BATCH_SIZE can drain, which is exactly the condition that used to
   * be invisible.
   *
   * Returns 0 when there is nothing eligible, which is the ordinary
   * quiet state.
   */
  async oldestEligibleAgeSeconds(now = new Date()): Promise<number> {
    const [oldest] = await this.findEligible(now, 1)
    if (!oldest) return 0

    const marker = oldest.last_reconciled_at ?? oldest.created_at
    return Math.max(
      0,
      Math.floor((now.getTime() - new Date(marker).getTime()) / 1000),
    )
  }

  private async reconcileIntent(intent: {
    id: bigint
    store_id: bigint
    mode: 'test' | 'live'
    account_id: bigint | null
  }): Promise<boolean> {
    if (intent.account_id === null) return false

    // Narrowed to a local: TS control-flow narrowing of a property (the
    // null check above) does not survive into a nested closure, and this
    // read now runs inside withTenantTransaction's callback.
    const accountId = intent.account_id

    const account = await this.prisma.withTenantTransaction(
      intent.store_id,
      intent.mode,
      (tx) =>
        tx.paymentAccount.findFirst({
          where: { id: accountId, store_id: intent.store_id, mode: intent.mode },
          select: { id: true, gateway: true },
        }),
    )

    if (!account) return false
    if (!this.providers.has(account.gateway)) return false

    const provider = this.providers.get(account.gateway)

    // Manual methods have no provider to ask. Skipping them is what keeps
    // cash-on-delivery orders from being swept into a wrong state.
    if (!provider.capabilities.statusPolling) return false

    const attempt = await this.prisma.withTenantTransaction(
      intent.store_id,
      intent.mode,
      (tx) =>
        tx.paymentAttempt.findFirst({
          where: { intent_id: intent.id, store_id: intent.store_id, mode: intent.mode },
          orderBy: { sequence: 'desc' },
          select: { gateway_reference: true, next_action_kind: true },
        }),
    )

    if (!attempt?.gateway_reference) return false

    const credentials = await this.accounts.revealCredentialsForGateway(
      intent.store_id,
      intent.mode,
      account.id,
    )

    const facts = await provider.fetchStatus({
      accountId: account.id,
      gatewayReference: attempt.gateway_reference,
      credentials,
      mode: intent.mode,
      // WHICH RESOURCE the reference names, not just its value.
      //
      // One provider can hand out two kinds of id: Moyasar's redirect
      // attempts hold an invoice id and its embedded ones hold a payment
      // id, and the strings are indistinguishable. Omitting this made
      // every embedded attempt reconcile as an invoice lookup —
      // "The Invoice record you were looking for was not found", 404,
      // every sweep, silently doing nothing. The checkout's own sync
      // path already passes this; this is the same fact from the same
      // column, so the two recovery paths cannot disagree.
      //
      // Safe for the intents this job sweeps: it only visits
      // non-terminal ones, whose latest attempt still carries the action
      // kind it was created with (the applier clears it to `none` when a
      // fact lands). See the report for the durable-column follow-up.
      referenceKind: attempt.next_action_kind,
    })

    if (facts.length === 0) return false

    await this.applier.applyMany(facts, 'reconciliation')
    return true
  }
}
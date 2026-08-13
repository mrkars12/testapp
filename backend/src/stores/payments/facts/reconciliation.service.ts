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
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000)

    // Sweeping every store is the point of a platform-wide sweep. The
    // per-intent work below is scoped normally.
    const intents = await crossStoreQuery(
      'platform_sweep',
      'find non-terminal intents across all stores',
      () =>
        this.prisma.guarded().paymentIntent.findMany({
          where: {
            status: { in: [...NON_TERMINAL] },
            created_at: { lt: cutoff },
          },
          orderBy: { created_at: 'asc' },
          take: BATCH_SIZE,
        }),
    )

    let processed = 0

    for (const intent of intents) {
      try {
        if (await this.reconcileIntent(intent)) processed += 1
      } catch (error) {
        // One provider being unreachable must not stop the sweep.
        this.logger.warn(
          `Reconciling intent ${intent.id} failed: ${(error as Error).message}`,
        )
      }
    }

    return processed
  }

  private async reconcileIntent(intent: {
    id: bigint
    store_id: bigint
    mode: 'test' | 'live'
    account_id: bigint | null
  }): Promise<boolean> {
    if (intent.account_id === null) return false

    const account = await this.prisma.guarded().paymentAccount.findFirst({
      where: { id: intent.account_id, store_id: intent.store_id, mode: intent.mode },
      select: { id: true, gateway: true },
    })

    if (!account) return false
    if (!this.providers.has(account.gateway)) return false

    const provider = this.providers.get(account.gateway)

    // Manual methods have no provider to ask. Skipping them is what keeps
    // cash-on-delivery orders from being swept into a wrong state.
    if (!provider.capabilities.statusPolling) return false

    const attempt = await this.prisma.guarded().paymentAttempt.findFirst({
      where: { intent_id: intent.id, store_id: intent.store_id, mode: intent.mode },
      orderBy: { sequence: 'desc' },
      select: { gateway_reference: true },
    })

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
    })

    if (facts.length === 0) return false

    await this.applier.applyMany(facts, 'reconciliation')
    return true
  }
}
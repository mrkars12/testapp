import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LedgerService } from '../../ledger/ledger.service'
import { OutboxDispatcherService } from '../../common/messaging/outbox-dispatcher.service'
import { ReconciliationService } from './facts/reconciliation.service'

/**
 * ==================================================================
 * Payments health check
 * ==================================================================
 *
 * The ledger has an invariant checker and the dispatcher can count dead
 * letters, but nothing was calling either. A silent failure in a money
 * system is the worst kind, so this runs them on a schedule.
 *
 * Three things it watches:
 *
 *   - Unbalanced journal entries. Should be impossible; the ledger
 *     validates before writing. Anything here is a posting bug and every
 *     balance derived from that entry is wrong.
 *
 *   - Dead-lettered outbox messages. A dead message means an event was
 *     never delivered downstream.
 *
 *   - Outbox messages pending well past their SLA, which means the
 *     dispatcher is not running or is wedged.
 *
 * Logging only, deliberately: alert routing belongs to whatever
 * monitoring you attach, not to this class.
 */
@Injectable()
export class PaymentsHealthJob {
  private readonly logger = new Logger(PaymentsHealthJob.name)

  /** Pending longer than this means the dispatcher is not keeping up. */
  private static readonly STALE_AFTER_SECONDS = 300

  /**
   * Money that reached a checkout a paid successor had replaced, and
   * which the automatic reversal then failed to return.
   *
   * Counted separately from the general dead-letter total because it is
   * not the same kind of problem. An undelivered notification is an
   * inconvenience; this is a real customer charge that no Order backs
   * and that nobody has given back. It needs to be visible every ten
   * minutes until an operator clears it, not just in the log line
   * written at the moment the reversal failed.
   */
  private static readonly SUPERSEDED_FUNDS_EVENT =
    'payment.superseded_funds_detected'

  /**
   * How far behind reconciliation may fall before it is worth saying so.
   *
   * The sweep looks at each intent at most once every five minutes, so a
   * healthy lag sits around that. Three times the recheck interval is
   * comfortably clear of ordinary jitter and still catches a backlog
   * early.
   *
   * This is the number that makes STARVATION visible. The sweep used to
   * take the fifty oldest non-terminal intents and re-read the same
   * fifty forever once that many became permanently unprocessable, and
   * nothing said a word — `run()` only logs when it processes
   * something, so the count simply stayed at zero. A silent recovery
   * mechanism is worse than none, because it is trusted.
   */
  private static readonly RECONCILIATION_LAG_WARN_SECONDS = 900

  constructor(
    private readonly ledger: LedgerService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    try {
      await this.check()
    } catch (error) {
      this.logger.error(
        `Payments health check failed to run: ${(error as Error).message}`,
        (error as Error).stack,
      )
    }
  }

  /** Exposed separately so it can be invoked on demand. */
  async check(): Promise<{
    unbalancedEntries: string[]
    deadLetters: number
    stalePending: number
    unreturnedSupersededFunds: number
    reconciliationLagSeconds: number
  }> {
    const [
      unbalanced,
      deadLetters,
      stalePending,
      unreturnedSupersededFunds,
      reconciliationLagSeconds,
    ] = await Promise.all([
      this.ledger.findUnbalancedEntries(20),
      this.dispatcher.deadLetterCount(),
      this.dispatcher.stalePendingCount(PaymentsHealthJob.STALE_AFTER_SECONDS),
      this.dispatcher.deadLetterCount(PaymentsHealthJob.SUPERSEDED_FUNDS_EVENT),
      this.reconciliation
        .oldestEligibleAgeSeconds()
        .catch(() => 0),
    ])

    if (unbalanced.length > 0) {
      this.logger.error(
        `[ledger-invariant] ${unbalanced.length} unbalanced journal entries: ` +
          `${unbalanced.map(String).join(', ')}. ` +
          `Every balance derived from these is wrong.`,
      )
    }

    if (deadLetters > 0) {
      this.logger.error(
        `[outbox-dead-letter] ${deadLetters} messages were never delivered.`,
      )
    }

    if (unreturnedSupersededFunds > 0) {
      this.logger.error(
        `[superseded-funds] ${unreturnedSupersededFunds} reversal(s) were ` +
          `never delivered. Real money is held against checkouts that have ` +
          `no Order. Each needs a MANUAL REVERSAL — search the logs for ` +
          `"[superseded-funds] MANUAL REVERSAL REQUIRED" for the provider ` +
          `references, or read the dead outbox messages of type ` +
          `${PaymentsHealthJob.SUPERSEDED_FUNDS_EVENT}.`,
      )
    }

    if (stalePending > 0) {
      this.logger.warn(
        `[outbox-stale] ${stalePending} messages pending for more than ` +
          `${PaymentsHealthJob.STALE_AFTER_SECONDS}s. Is the dispatcher running?`,
      )
    }

    if (
      reconciliationLagSeconds >
      PaymentsHealthJob.RECONCILIATION_LAG_WARN_SECONDS
    ) {
      this.logger.error(
        `[reconciliation-lag] The oldest intent awaiting reconciliation has ` +
          `been waiting ${reconciliationLagSeconds}s. Reconciliation is the ` +
          `only recovery from a lost webhook, so a growing lag means paid ` +
          `checkouts may have no order and nothing else will notice. Check ` +
          `that the sweep is running and that its batch size is draining ` +
          `the backlog.`,
      )
    }

    return {
      unbalancedEntries: unbalanced.map(String),
      deadLetters,
      stalePending,
      unreturnedSupersededFunds,
      reconciliationLagSeconds,
    }
  }
}
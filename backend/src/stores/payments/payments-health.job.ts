import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LedgerService } from '../../ledger/ledger.service'
import { OutboxDispatcherService } from '../../common/messaging/outbox-dispatcher.service'

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

  constructor(
    private readonly ledger: LedgerService,
    private readonly dispatcher: OutboxDispatcherService,
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
  }> {
    const [unbalanced, deadLetters, stalePending] = await Promise.all([
      this.ledger.findUnbalancedEntries(20),
      this.dispatcher.deadLetterCount(),
      this.dispatcher.stalePendingCount(PaymentsHealthJob.STALE_AFTER_SECONDS),
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

    if (stalePending > 0) {
      this.logger.warn(
        `[outbox-stale] ${stalePending} messages pending for more than ` +
          `${PaymentsHealthJob.STALE_AFTER_SECONDS}s. Is the dispatcher running?`,
      )
    }

    return {
      unbalancedEntries: unbalanced.map(String),
      deadLetters,
      stalePending,
    }
  }
}
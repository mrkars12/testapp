import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Mode,
  PaymentEventSource,
  StorePaymentMode,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../../ledger/ledger.service';
import { captureSucceeded, refundIssued } from '../../../ledger/posting-rules';
import { OutboxService } from '../../../common/messaging/outbox.service';
import { isUniqueConstraintError } from '../../../common/idempotency/idempotency.types';
import type { ObservedFact } from '../gateways/provider.types';
import { decideFact, type FactDecision } from './fact-decision';
import { crossStoreQuery } from '../../../common/tenant/cross-store-query';
import { allocate, money } from '../../../common/money/money.util';
import { CheckoutFinalizerService } from './checkout-finalizer.service';

/**
 * ==================================================================
 * Applying observed facts
 * ==================================================================
 *
 * One consumer, three producers. Webhooks, reconciliation sweeps and a
 * customer returning from a gateway all produce ObservedFacts and all
 * arrive here. Because the dedupe key is derived from the fact's content
 * rather than from how it travelled, the same fact delivered by all
 * three routes is applied exactly once.
 *
 * That is the property that makes the system correct when webhooks are
 * lost, and it only holds if nothing else is allowed to mutate payment
 * state from a provider signal.
 */

/** Facts that mean the money is secured and the order may exist. */
const SECURES_FUNDS = new Set(['attempt_authorized', 'attempt_captured']);

/** Facts that mean the payment will never complete. */
const RELEASES_FUNDS = new Set([
  'attempt_failed',
  'attempt_expired',
  'attempt_voided',
]);

export type ApplyOutcome =
  | 'applied'
  | 'duplicate'
  | 'ignored'
  | 'recorded'
  | 'unmatched';

export interface ApplyResult {
  readonly outcome: ApplyOutcome;
  readonly intentId: bigint | null;
  readonly reason?: string;
}

@Injectable()
export class PaymentFactApplier {
  private readonly logger = new Logger(PaymentFactApplier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly finalizer: CheckoutFinalizerService,
  ) {}

  async applyMany(
    facts: readonly ObservedFact[],
    source: PaymentEventSource,
  ): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];

    for (const fact of facts) {
      results.push(await this.apply(fact, source));
    }

    return results;
  }

  /**
   * @param source which route delivered this fact. Recorded on the event
   * so the audit trail shows whether the webhook, the sweep or the
   * customer's return got there first.
   */
  async apply(
    fact: ObservedFact,
    source: PaymentEventSource,
  ): Promise<ApplyResult> {
    // The attempt is found by (account, gateway reference), which is
    // unique. Scoping to the account rather than the gateway is what
    // stops two stores sharing one provider account from colliding.
    // A webhook carries a provider reference, not a store. The store is
    // derived from the account this attempt belongs to, so requiring
    // store_id here would mean guessing the answer before finding it.
    const attempt = await crossStoreQuery(
      'provider_lookup',
      'resolve the attempt a provider fact belongs to',
      () =>
        this.prisma.guarded().paymentAttempt.findFirst({
          where: {
            account_id: fact.accountId,
            gateway_reference: fact.gatewayReference,
          },
        }),
    );

    if (!attempt) {
      // Not an error: the provider may be faster than our own write, or
      // the reference may belong to a test intent that was purged. The
      // caller decides whether to retry later.
      this.logger.warn(
        `Unmatched fact ${fact.factType} for account ${fact.accountId} ref ${fact.gatewayReference}.`,
      );

      return {
        outcome: 'unmatched',
        intentId: null,
      };
    }

    const intent = await this.prisma.guarded().paymentIntent.findFirst({
      where: {
        id: attempt.intent_id,
        store_id: attempt.store_id,
        mode: attempt.mode,
      },
    });

    if (!intent) {
      throw new NotFoundException(
        `Attempt ${attempt.id} references a missing intent.`,
      );
    }

    const decision = decideFact({
      snapshot: {
        status: intent.status,
        capturedTotalMinor: intent.captured_total_minor,
        refundedTotalMinor: intent.refunded_total_minor,
      },
      amountMinor: intent.amount_minor,
      factType: fact.factType,
      cumulativeAmountMinor: fact.cumulativeAmountMinor,
      providerSequence: fact.providerSequence,
      occurredAt: fact.occurredAt,
    });

    if (decision.kind === 'ignore') {
      // Superseded facts are still stored. Dropping them loses the
      // evidence that would explain a disputed sequence later.
      await this.recordEvent(fact, intent.id, intent.store_id, intent.mode, {
        applied: false,
        supersededReason: decision.reason,
        source,
      });

      return {
        // A fact carrying nothing new is a duplicate, not a fault.
        outcome:
          decision.reason === 'already_applied' ? 'duplicate' : 'ignored',
        intentId: intent.id,
        reason: decision.reason,
      };
    }

    if (decision.kind === 'record_only') {
      await this.recordEvent(fact, intent.id, intent.store_id, intent.mode, {
        applied: false,
        supersededReason: 'not_actionable',
        source,
      });

      return {
        outcome: 'recorded',
        intentId: intent.id,
        reason: decision.note,
      };
    }

    const now = new Date();

    // A refund does not touch the attempt or create a capture, so it has
    // its own path rather than being forced through the capture shape.
    if (decision.kind === 'apply_refund') {
      return this.applyRefund(fact, intent, decision, source, now);
    }

    try {
      await this.prisma.guarded().$transaction(
        async (tx) => {
          // The unique dedupe key on payment_events is the idempotency
          // guarantee. It is inserted first so a duplicate aborts the whole
          // transaction before anything else is written.
          await tx.paymentEvent.create({
            data: {
              intent_id: intent.id,
              store_id: intent.store_id,
              mode: intent.mode,
              event_type: fact.factType,
              dedupe_key: fact.dedupeKey,
              source,
              applied: true,
              payload_redacted: (fact.rawRedacted ??
                null) as Prisma.InputJsonValue,
              occurred_at: fact.occurredAt ?? now,
            },
          });

          // Optimistic concurrency: if another writer moved the intent
          // between the read and here, this matches nothing and the whole
          // transaction is abandoned.
          const updated = await tx.paymentIntent.updateMany({
            where: {
              id: intent.id,
              store_id: intent.store_id,
              mode: intent.mode,
              version: intent.version,
            },
            data: {
              status: decision.intentStatus,
              captured_total_minor: decision.capturedTotalMinor,
              refunded_total_minor: decision.refundedTotalMinor,
              terminal_at: decision.terminal ? now : null,
              version: {
                increment: 1,
              },
            },
          });

          if (updated.count === 0) {
            throw new ConcurrentIntentUpdate(intent.id);
          }

          await tx.paymentAttempt.update({
            where: {
              id: attempt.id,
              store_id: attempt.store_id,
              mode: attempt.mode,
            },
            data: {
              status: decision.attemptStatus,
              next_action_kind: 'none',
              gateway_payment_id:
                fact.refs?.gatewayPaymentId ?? attempt.gateway_payment_id,
            },
          });

          if (decision.newCaptureMinor !== null) {
            const beneficiaryId = await this.findBeneficiary(
              tx as unknown as Prisma.TransactionClient,
              intent.store_id,
              intent.mode,
              intent.currency,
            );

            const capture = await tx.capture.create({
              data: {
                intent_id: intent.id,
                attempt_id: attempt.id,
                store_id: intent.store_id,
                mode: intent.mode,
                amount_minor: decision.newCaptureMinor,
                currency: intent.currency,
                status: 'succeeded',
                gateway_capture_ref: fact.refs?.gatewayCaptureRef ?? null,
                captured_at: fact.occurredAt ?? now,
              },
              select: {
                id: true,
              },
            });

            await tx.captureAllocation.create({
              data: {
                capture_id: capture.id,
                beneficiary_id: beneficiaryId,
                store_id: intent.store_id,
                mode: intent.mode,
                amount_minor: decision.newCaptureMinor,
                kind: 'revenue',
              },
            });

            // Money captured through a gateway lands in a receivable from
            // the provider, cleared later by the settlement.
            await this.ledger.post(tx as unknown as Prisma.TransactionClient, {
              storeId: intent.store_id,
              mode: intent.mode,
              currency: intent.currency,
              entryType: 'payment.captured.gateway',
              sourceKind: 'capture',
              sourceId: capture.id.toString(),
              dedupeKey: `${fact.dedupeKey}:ledger`,
              occurredAt: fact.occurredAt ?? now,
              memo: `Capture for intent ${intent.id}`,
              postings: captureSucceeded({
                totalMinor: decision.newCaptureMinor,
                paymentAccountId: fact.accountId,
                allocations: [
                  {
                    beneficiaryId,
                    amountMinor: decision.newCaptureMinor,
                  },
                ],
              }),
            });
          }

          // A funds_secured checkout has no order until here. Creating it
          // inside this transaction is what makes "order exists implies
          // money secured" true rather than merely usual.
          if (intent.context_kind === 'checkout' && intent.context_id !== '') {
            const checkoutId = BigInt(intent.context_id);

            if (SECURES_FUNDS.has(fact.factType)) {
              await this.finalizer.finalize(
                tx as unknown as Prisma.TransactionClient,
                {
                  checkoutId,
                  storeId: intent.store_id,
                  mode: intent.mode,
                  paid: decision.capturedTotalMinor > 0n,
                  occurredAt: fact.occurredAt ?? now,
                },
              );
            } else if (RELEASES_FUNDS.has(fact.factType)) {
              await this.finalizer.abandon(
                tx as unknown as Prisma.TransactionClient,
                {
                  checkoutId,
                  storeId: intent.store_id,
                  mode: intent.mode,
                  occurredAt: fact.occurredAt ?? now,
                },
              );
            }
          }

          await this.outbox.emit(tx as unknown as Prisma.TransactionClient, {
            storeId: intent.store_id,
            mode: intent.mode,
            aggregateType: 'payment_intent',
            aggregateId: intent.id.toString(),
            eventType: `payment.${fact.factType}`,
            payload: {
              intentId: intent.id.toString(),
              attemptId: attempt.id.toString(),
              factType: fact.factType,
              intentStatus: decision.intentStatus,
              capturedTotalMinor: decision.capturedTotalMinor.toString(),
              currency: intent.currency,
            },
            occurredAt: fact.occurredAt ?? now,
          });
        },
        {
          timeout: 20_000,
          maxWait: 10_000,
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Same fact, already applied by another route.
        return {
          outcome: 'duplicate',
          intentId: intent.id,
        };
      }

      if (error instanceof ConcurrentIntentUpdate) {
        this.logger.warn(
          `Intent ${intent.id} changed underneath fact ${fact.dedupeKey}; not applied.`,
        );

        return {
          outcome: 'ignored',
          intentId: intent.id,
          reason: 'concurrent_update',
        };
      }

      throw error;
    }

    this.logger.log(
      `Applied ${fact.factType} to intent ${intent.id} (${decision.intentStatus}).`,
    );

    return {
      outcome: 'applied',
      intentId: intent.id,
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Applies a refund reported by a provider.
   *
   * Creates the Refund row, allocates it proportionally to the original
   * capture's beneficiaries, posts the ledger entry and advances the
   * intent — all in one transaction, so a refund can never exist without
   * its ledger effect.
   *
   * The ledger rule is chosen from the intent's payment_mode snapshot,
   * never the store's current mode: a store that switches modes must
   * still refund old payments through the route that took them.
   */
  private async applyRefund(
    fact: ObservedFact,
    intent: {
      id: bigint;
      store_id: bigint;
      mode: Mode;
      currency: string;
      version: number;
      account_id: bigint | null;
      payment_mode: StorePaymentMode;
      captured_total_minor: bigint;
    },
    decision: Extract<FactDecision, { kind: 'apply_refund' }>,
    source: PaymentEventSource,
    now: Date,
  ): Promise<ApplyResult> {
    if (intent.payment_mode !== 'MERCHANT_GATEWAY') {
      // No posting rule exists for other modes yet, and guessing one
      // would put wrong numbers in an immutable ledger.
      this.logger.error(
        `Refund for intent ${intent.id} uses payment mode ` +
          `${intent.payment_mode}, which has no ledger rule. Not applied.`,
      );

      return {
        outcome: 'ignored',
        intentId: intent.id,
        reason: 'unsupported_payment_mode',
      };
    }

    if (intent.account_id === null) {
      this.logger.error(
        `Refund for intent ${intent.id} has no payment account.`,
      );

      return {
        outcome: 'ignored',
        intentId: intent.id,
        reason: 'no_account',
      };
    }

    const accountId = intent.account_id;

    try {
      await this.prisma.guarded().$transaction(
        async (tx) => {
          await tx.paymentEvent.create({
            data: {
              intent_id: intent.id,
              store_id: intent.store_id,
              mode: intent.mode,
              event_type: fact.factType,
              dedupe_key: fact.dedupeKey,
              source,
              applied: true,
              payload_redacted: (fact.rawRedacted ??
                null) as Prisma.InputJsonValue,
              occurred_at: fact.occurredAt ?? now,
            },
          });

          const updated = await tx.paymentIntent.updateMany({
            where: {
              id: intent.id,
              store_id: intent.store_id,
              mode: intent.mode,
              version: intent.version,
            },
            data: {
              status: decision.intentStatus,
              refunded_total_minor: decision.refundedTotalMinor,
              version: {
                increment: 1,
              },
            },
          });

          if (updated.count === 0) {
            throw new ConcurrentIntentUpdate(intent.id);
          }

          const allocations = await this.refundAllocations(
            tx as unknown as Prisma.TransactionClient,
            intent,
            decision.newRefundMinor,
          );

          const refund = await tx.refund.create({
            data: {
              intent_id: intent.id,
              store_id: intent.store_id,
              mode: intent.mode,
              amount_minor: decision.newRefundMinor,
              currency: intent.currency,
              status: 'succeeded',
              initiated_by: source === 'merchant' ? 'merchant' : 'provider',
              gateway_refund_ref: fact.refs?.gatewayCaptureRef ?? null,
              succeeded_at: fact.occurredAt ?? now,
            },
            select: {
              id: true,
            },
          });

          await tx.refundAllocation.createMany({
            data: allocations.map((allocation) => ({
              refund_id: refund.id,
              beneficiary_id: allocation.beneficiaryId,
              store_id: intent.store_id,
              mode: intent.mode,
              amount_minor: allocation.amountMinor,
              kind: 'revenue' as const,
            })),
          });

          await this.ledger.post(tx as unknown as Prisma.TransactionClient, {
            storeId: intent.store_id,
            mode: intent.mode,
            currency: intent.currency,
            entryType: 'payment.refunded.gateway',
            sourceKind: 'refund',
            sourceId: refund.id.toString(),
            dedupeKey: `${fact.dedupeKey}:ledger`,
            occurredAt: fact.occurredAt ?? now,
            memo: `Refund for intent ${intent.id}`,
            postings: refundIssued({
              totalMinor: decision.newRefundMinor,
              paymentAccountId: accountId,
              allocations,
            }),
          });

          await this.syncOrderRefundStatus(
            tx as unknown as Prisma.TransactionClient,
            intent,
            decision,
          );

          await this.outbox.emit(tx as unknown as Prisma.TransactionClient, {
            storeId: intent.store_id,
            mode: intent.mode,
            aggregateType: 'payment_intent',
            aggregateId: intent.id.toString(),
            eventType: 'payment.refunded',
            payload: {
              intentId: intent.id.toString(),
              refundId: refund.id.toString(),
              amountMinor: decision.newRefundMinor.toString(),
              refundedTotalMinor: decision.refundedTotalMinor.toString(),
              currency: intent.currency,
            },
            occurredAt: fact.occurredAt ?? now,
          });
        },
        {
          timeout: 20_000,
          maxWait: 10_000,
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return {
          outcome: 'duplicate',
          intentId: intent.id,
        };
      }

      if (error instanceof ConcurrentIntentUpdate) {
        return {
          outcome: 'ignored',
          intentId: intent.id,
          reason: 'concurrent_update',
        };
      }

      throw error;
    }

    this.logger.log(
      `Refunded ${decision.newRefundMinor} on intent ${intent.id} ` +
        `(${decision.intentStatus}).`,
    );

    return {
      outcome: 'applied',
      intentId: intent.id,
    };
  }

  /**
   * Splits a refund across the beneficiaries of the original captures.
   *
   * Proportional, not "all to the store". Under MERCHANT_GATEWAY there
   * is one beneficiary and this is a single row, but the split is what
   * lets a managed model reclaim from each party correctly without
   * reworking the refund path.
   */
  private async refundAllocations(
    tx: Prisma.TransactionClient,
    intent: {
      id: bigint;
      store_id: bigint;
      mode: Mode;
      currency: string;
    },
    amountMinor: bigint,
  ): Promise<
    {
      beneficiaryId: bigint;
      amountMinor: bigint;
    }[]
  > {
    // Scoped to this intent's own captures. Querying every allocation in
    // the store would split a refund across beneficiaries of unrelated
    // orders — invisible while there is one beneficiary, badly wrong the
    // moment there is more than one.
    const captures = await tx.capture.findMany({
      where: {
        intent_id: intent.id,
        store_id: intent.store_id,
        mode: intent.mode,
        status: 'succeeded',
      },
      select: {
        id: true,
      },
    });

    if (captures.length === 0) {
      throw new Error(
        `Intent ${intent.id} has no successful capture to refund.`,
      );
    }

    const captured = await tx.captureAllocation.findMany({
      where: {
        capture_id: {
          in: captures.map((capture) => capture.id),
        },
        store_id: intent.store_id,
        mode: intent.mode,
      },
      select: {
        beneficiary_id: true,
        amount_minor: true,
      },
    });

    const totals = new Map<string, bigint>();

    for (const row of captured) {
      const key = row.beneficiary_id.toString();

      totals.set(key, (totals.get(key) ?? 0n) + row.amount_minor);
    }

    if (totals.size === 0) {
      throw new Error(
        `Intent ${intent.id} has no capture allocations to refund against.`,
      );
    }

    const entries = [...totals.entries()];

    const weights = entries.map(([, amount]) => amount);

    // The intent's real currency, not a placeholder. money() validates
    // against the registry, so a placeholder threw on every refund.
    const shares = allocate(money(amountMinor, intent.currency), weights);

    return entries.map(([beneficiaryId], index) => ({
      beneficiaryId: BigInt(beneficiaryId),
      amountMinor: shares[index].amountMinor,
    }));
  }

  /** Keeps the order's payment_status in step with the intent. */
  private async syncOrderRefundStatus(
    tx: Prisma.TransactionClient,
    intent: {
      store_id: bigint;
      mode: Mode;
      id: bigint;
    },
    decision: Extract<FactDecision, { kind: 'apply_refund' }>,
  ): Promise<void> {
    const checkoutIntent = await tx.paymentIntent.findFirst({
      where: {
        id: intent.id,
        store_id: intent.store_id,
        mode: intent.mode,
      },
      select: {
        context_kind: true,
        context_id: true,
      },
    });

    if (checkoutIntent?.context_kind !== 'checkout') {
      return;
    }

    if (!checkoutIntent.context_id) {
      return;
    }

    await tx.order.updateMany({
      where: {
        store_id: intent.store_id,
        checkout_id: BigInt(checkoutIntent.context_id),
      },
      data: {
        payment_status:
          decision.intentStatus === 'refunded'
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED',
      },
    });
  }

  private async recordEvent(
    fact: ObservedFact,
    intentId: bigint,
    storeId: bigint,
    mode: Mode,
    options: {
      applied: boolean;
      supersededReason: string;
      source: PaymentEventSource;
    },
  ): Promise<void> {
    try {
      await this.prisma.guarded().paymentEvent.create({
        data: {
          intent_id: intentId,
          store_id: storeId,
          mode,
          event_type: fact.factType,
          dedupe_key: fact.dedupeKey,
          source: options.source,
          applied: options.applied,
          superseded_reason: options.supersededReason,
          payload_redacted: (fact.rawRedacted ?? null) as Prisma.InputJsonValue,
          occurred_at: fact.occurredAt ?? new Date(),
        },
      });
    } catch (error) {
      // Already recorded by another route; nothing further to do.
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }
  }

  /**
   * Resolves the store's beneficiary, creating it on first use.
   *
   * Runs inside the caller's transaction and behind an advisory lock.
   * The unique constraint on beneficiaries includes external_ref, which
   * is NULL for the store's own beneficiary, and Postgres treats every
   * NULL as distinct — so the constraint does not prevent duplicates.
   * Two concurrent captures would otherwise each create one, splitting a
   * store's revenue across two ledger accounts that never reconcile.
   */
  private async findBeneficiary(
    tx: Prisma.TransactionClient,
    storeId: bigint,
    mode: Mode,
    currency: string,
  ): Promise<bigint> {
    const lockKey = `beneficiary:${storeId}:${mode}`;

    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and
    // Prisma has no deserializer for that type, so $queryRaw fails with
    // "Failed to deserialize column of type 'void'". Nothing reads the
    // result here — the statement is executed purely for the lock.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${lockKey})
      )
    `;

    const existing = await tx.beneficiary.findFirst({
      where: {
        store_id: storeId,
        mode,
        kind: 'store',
        external_ref: null,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return existing.id;
    }

    const created = await tx.beneficiary.create({
      data: {
        store_id: storeId,
        mode,
        kind: 'store',
        external_ref: null,
        default_currency: currency,
      },
      select: {
        id: true,
      },
    });

    return created.id;
  }
}

/** Raised when optimistic concurrency rejects the update. */
class ConcurrentIntentUpdate extends Error {
  constructor(readonly intentId: bigint) {
    super(`Intent ${intentId} was modified concurrently.`);
    this.name = 'ConcurrentIntentUpdate';
    Object.setPrototypeOf(this, ConcurrentIntentUpdate.prototype);
  }
}

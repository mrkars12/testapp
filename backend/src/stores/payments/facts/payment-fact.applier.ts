import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Mode,
  PaymentEventSource,
  StorePaymentMode,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../../ledger/ledger.service';
import {
  captureSucceeded,
  disputeLost,
  disputeOpened,
  disputeWon,
  refundIssued,
  refundIssuedOffline,
} from '../../../ledger/posting-rules';
import { isTerminalAttempt } from '../payment-intent.state';
import { OutboxService } from '../../../common/messaging/outbox.service';
import { isUniqueConstraintError } from '../../../common/idempotency/idempotency.types';
import type { ObservedFact } from '../gateways/provider.types';
import { decideFact, type FactDecision } from './fact-decision';
import { crossStoreQuery } from '../../../common/tenant/cross-store-query';
import { allocate, money } from '../../../common/money/money.util';
import { CheckoutFinalizerService } from './checkout-finalizer.service';
import { CheckoutSuccessionFundsService } from './checkout-succession-funds.service';

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
    private readonly succession: CheckoutSuccessionFundsService,
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
    // A webhook carries a provider reference, not a store: (accountId,
    // gatewayReference) is all it has. RLS-scoped access needs
    // store_id/mode installed *before* any tenant-scoped table can be
    // read at all, so the tenant has to be discovered first, from
    // something that isn't itself behind that same RLS check.
    //
    // PaymentAccount is the narrowest table that can answer "which
    // store owns this account": one row, addressed by its own global
    // primary key, and nothing more sensitive than store_id/mode is
    // read off it. That is why this one lookup runs on the platform
    // client (a separate connection that is not subject to per-tenant
    // RLS) instead of guessing store_id up front — not the attempt
    // itself, which carries the actual payment data and belongs behind
    // the tenant-scoped connection like everything else in this method.
    const account = await crossStoreQuery(
      'provider_lookup',
      'resolve the store owning a provider account before installing tenant context',
      () =>
        this.prisma.platform().paymentAccount.findUnique({
          where: { id: fact.accountId },
          select: { store_id: true, mode: true },
        }),
    );

    if (!account) {
      // Not an error: the fact may reference an account that was since
      // removed, or a stale test fixture. The caller decides whether to
      // retry later.
      this.logger.warn(
        `Unmatched fact ${fact.factType}: no account ${fact.accountId}.`,
      );

      return {
        outcome: 'unmatched',
        intentId: null,
      };
    }

    // Everything from here on is scoped to the tenant the account
    // belongs to — one tenant transaction, from the attempt lookup to
    // the outbox write, rather than a bare guarded() connection with no
    // context at all.
    //
    // Declared outside the transaction so the catch block below can
    // report which intent a concurrency conflict or a redelivered event
    // belongs to, even when the intent was only ever read inside a
    // transaction that then rolled back.
    let resolvedIntentId: bigint | null = null;

    try {
      return await this.prisma.withTenantTransaction(
        account.store_id,
        account.mode,
        async (tx) => {
          // The attempt is found by (account, gateway reference), which
          // is unique. Scoping to the account rather than the gateway is
          // what stops two stores sharing one provider account from
          // colliding. Now that app.store_id/app.mode are installed on
          // this transaction, this read (and every one after it) is
          // RLS-scoped like any other tenant query.
          let attempt = await tx.paymentAttempt.findFirst({
            where: {
              account_id: fact.accountId,
              gateway_reference: fact.gatewayReference,
              store_id: account.store_id,
              mode: account.mode,
            },
          });

          // A provider-assigned reference can be resolved *after* the
          // attempt was first stored under a provisional one — Stripe's
          // Checkout Sessions are the current example: the attempt is
          // created under the Checkout Session id, and a
          // `payment_intent.*` webhook carrying the real PaymentIntent
          // id can arrive before anything has resolved the two together
          // (see stripe.adapter.ts's `initializePayment`/`fetchStatus`).
          // `fact.internalIntentRef` is our own `PaymentIntent.id`,
          // round-tripped through provider metadata every adapter
          // already sends — it identifies the row unambiguously without
          // depending on that resolution having happened first.
          if (!attempt && fact.internalIntentRef) {
            const internalIntentId = parseInternalIntentRef(fact.internalIntentRef);

            if (internalIntentId !== null) {
              const fallbackIntent = await tx.paymentIntent.findFirst({
                where: {
                  id: internalIntentId,
                  store_id: account.store_id,
                  mode: account.mode,
                },
                select: { id: true },
              });

              if (fallbackIntent) {
                const fallbackAttempt = await tx.paymentAttempt.findFirst({
                  where: {
                    intent_id: fallbackIntent.id,
                    account_id: fact.accountId,
                    store_id: account.store_id,
                    mode: account.mode,
                  },
                  orderBy: { sequence: 'desc' },
                });

                if (fallbackAttempt) {
                  if (fallbackAttempt.gateway_reference === fact.gatewayReference) {
                    attempt = fallbackAttempt;
                  } else if (fallbackAttempt.gateway_reference === null) {
                    // The attempt has no provider reference yet, so this
                    // fact is the first thing that knows it. Bind it here,
                    // in the same transaction as the discovery — every
                    // fact after this one finds the row on the primary
                    // lookup with no further fallback needed.
                    //
                    // This is the embedded/browser-created case (the form
                    // creates the payment, so the id only exists once it
                    // reports back) and Stripe's late-resolved
                    // PaymentIntent id.
                    attempt = await tx.paymentAttempt.update({
                      where: {
                        id: fallbackAttempt.id,
                        store_id: fallbackAttempt.store_id,
                        mode: fallbackAttempt.mode,
                      },
                      data: { gateway_reference: fact.gatewayReference },
                    });

                    this.logger.log(
                      `Bound attempt ${attempt.id} to gateway reference ` +
                        `${fact.gatewayReference} via internal intent ref ` +
                        `${fact.internalIntentRef}.`,
                    );
                  } else if (
                    fallbackAttempt.gateway_payment_id === fact.gatewayReference
                  ) {
                    /*
                     * THE SAME PAYMENT, ALREADY KNOWN BY THIS ROW.
                     *
                     * The attempt is on file under a provisional
                     * reference, but it already records this very
                     * provider object as its `gateway_payment_id` —
                     * something only a previous fact about the same
                     * payment could have written. Whatever arrives now
                     * is another report of it, not a second payment.
                     *
                     * This is the sync-first ordering: reconciliation
                     * resolved the PaymentIntent through the ordinary
                     * primary lookup and recorded its id, and the
                     * webhook for the same payment arrives afterwards.
                     * `gateway_reference` is deliberately left alone —
                     * it is still the identifier the row was created
                     * under and the one sync will keep asking about.
                     */
                    attempt = fallbackAttempt;
                  } else if (!isTerminalAttempt(fallbackAttempt.status)) {
                    /*
                     * A DIFFERENT reference on an attempt that has NO
                     * OUTCOME YET: the same payment, under the identity
                     * the provider has only now resolved.
                     *
                     * Stripe's hosted Checkout is the case that forced
                     * this branch. Stripe does not create the
                     * PaymentIntent until the customer submits payment,
                     * so the attempt is stored under the Checkout
                     * SESSION id and the first `payment_intent.*`
                     * webhook arrives carrying the PaymentIntent id. The
                     * two ids are not two payments — the intent is the
                     * session's child — and this fact is the attempt's
                     * first outcome, not a second one.
                     *
                     * Distinguished from the retry below by the
                     * attempt's own state, which is the thing that
                     * actually differs and needs no provider-specific
                     * knowledge: a non-terminal attempt has nothing on
                     * the record to protect, so re-keying loses no
                     * history. A terminal one does, and is handled
                     * below.
                     */
                    attempt = await tx.paymentAttempt.update({
                      where: {
                        id: fallbackAttempt.id,
                        store_id: fallbackAttempt.store_id,
                        mode: fallbackAttempt.mode,
                      },
                      data: { gateway_reference: fact.gatewayReference },
                    });

                    this.logger.log(
                      `Re-keyed attempt ${attempt.id} from provisional ` +
                        `reference ${fallbackAttempt.gateway_reference} to ` +
                        `${fact.gatewayReference} via internal intent ref ` +
                        `${fact.internalIntentRef}.`,
                    );
                  } else {
                    /*
                     * A DIFFERENT provider object for an intent whose
                     * newest attempt is already TERMINAL: the payer
                     * tried again.
                     *
                     * This used to overwrite the existing attempt's
                     * reference, which destroyed the record of what the
                     * first payment was and filed a second payment's
                     * outcome against the first payment's row. Observed
                     * live: a declined attempt's `gateway_reference` was
                     * silently replaced by the id of the payment the
                     * customer succeeded with afterwards.
                     *
                     * The schema has always modelled this correctly —
                     * `PaymentAttempt.sequence`, unique per intent — it
                     * simply had no writer. This is that writer: a retry
                     * gets its own attempt row, so attempt #1 keeps its
                     * decline and its reference, and attempt #2 carries
                     * the new one. `psp_idempotency_key` is derived from
                     * the sequence exactly as `CheckoutService` derives
                     * it, so it stays deterministic per attempt.
                     */
                    attempt = await tx.paymentAttempt.create({
                      data: {
                        intent_id: fallbackAttempt.intent_id,
                        store_id: fallbackAttempt.store_id,
                        mode: fallbackAttempt.mode,
                        sequence: fallbackAttempt.sequence + 1,
                        account_id: fallbackAttempt.account_id,
                        offering_id: fallbackAttempt.offering_id,
                        status: 'processing',
                        gateway_reference: fact.gatewayReference,
                        gateway_payment_id:
                          fact.refs?.gatewayPaymentId ?? null,
                        next_action_kind: 'none',
                        psp_idempotency_key:
                          `psp:${fallbackAttempt.store_id.toString()}:` +
                          `${fallbackAttempt.intent_id.toString()}:` +
                          `${fallbackAttempt.sequence + 1}:initialize`,
                      },
                    });

                    this.logger.log(
                      `Opened attempt ${attempt.id} (sequence ` +
                        `${attempt.sequence}) on intent ` +
                        `${fallbackAttempt.intent_id} for a new provider ` +
                        `reference ${fact.gatewayReference}.`,
                    );
                  }
                }
              }
            }
          }

          if (!attempt) {
            // Not an error: the provider may be faster than our own
            // write, or the reference may belong to a test intent that
            // was purged. The caller decides whether to retry later.
            this.logger.warn(
              `Unmatched fact ${fact.factType} for account ${fact.accountId} ref ${fact.gatewayReference}.`,
            );

            return {
              outcome: 'unmatched',
              intentId: null,
            };
          }

          const intent = await tx.paymentIntent.findFirst({
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

          resolvedIntentId = intent.id;

          /* ── Round 5 — the succession funds invariant ─────────────
           *
           *   A checkout with any descendant that has secured funds
           *   must not itself secure funds again.
           *
           * Taken HERE: inside the transaction, before the chain is
           * read, and before anything is written.
           *
           * The lock is taken for EVERY checkout-context fact, not only
           * the ones that get blocked — including the successor's own
           * capture, which is the write that makes a predecessor
           * blocked. A lock that only the reader takes serialises
           * nothing, and the race this closes (READ COMMITTED, two
           * different intents, no row in common) is otherwise invisible
           * to the optimistic `version` check below.
           */
          const checkoutContextId =
            intent.context_kind === 'checkout' && intent.context_id !== ''
              ? BigInt(intent.context_id)
              : null;

          let supersededByFundsSecured = false;

          if (checkoutContextId !== null) {
            await this.succession.lockChain(
              tx,
              intent.store_id,
              intent.mode,
              checkoutContextId,
            );

            /*
             * The CART lock, taken second and always after the chain
             * lock, so the two have one global order and cannot deadlock
             * against each other.
             *
             * The chain lock cannot serialise the case this closes: when
             * the browser lost `supersedes_checkout_token` on a reload,
             * the two checkouts for one basket are in two DIFFERENT
             * chains and contend on nothing at all. See
             * `CheckoutSuccessionFundsService.lockCart`.
             */
            await this.succession.lockCart(
              tx,
              intent.store_id,
              intent.mode,
              checkoutContextId,
            );

            /*
             * TWO ARMS OF ONE INVARIANT, and either blocking is enough:
             *
             *   the chain — a descendant of this checkout already
             *               secured funds (Round 5/6, client-declared
             *               succession);
             *   the cart  — this checkout's basket already became
             *               somebody else's Order (Round 8's
             *               server-authoritative identity).
             *
             * The chain arm is untouched and still runs first, so every
             * behaviour it already had is unchanged; the cart arm only
             * ever adds refusals the chain could not see.
             */
            supersededByFundsSecured =
              (await this.succession.isBlocked(
                tx,
                intent.store_id,
                intent.mode,
                checkoutContextId,
              )) ||
              (await this.succession.isCartConvertedElsewhere(
                tx,
                intent.store_id,
                intent.mode,
                checkoutContextId,
              ));
          }

          const decision = decideFact({
            snapshot: {
              status: intent.status,
              capturedTotalMinor: intent.captured_total_minor,
              refundedTotalMinor: intent.refunded_total_minor,
            },
            amountMinor: intent.amount_minor,
            // The verification half: what the order was priced in, and
            // what the provider says it actually settled in. A mismatch
            // is recorded and refused rather than applied.
            currency: intent.currency,
            factCurrency: fact.currency,
            factType: fact.factType,
            cumulativeAmountMinor: fact.cumulativeAmountMinor,
            providerSequence: fact.providerSequence,
            occurredAt: fact.occurredAt,
          });

          if (decision.kind === 'ignore') {
            // Superseded facts are still stored. Dropping them loses the
            // evidence that would explain a disputed sequence later.
            await this.recordEvent(
              tx,
              fact,
              intent.id,
              intent.store_id,
              intent.mode,
              {
                applied: false,
                supersededReason: decision.reason,
                source,
              },
            );

            return {
              // A fact carrying nothing new is a duplicate, not a fault.
              outcome:
                decision.reason === 'already_applied'
                  ? 'duplicate'
                  : 'ignored',
              intentId: intent.id,
              reason: decision.reason,
            };
          }

          if (decision.kind === 'record_only') {
            await this.recordEvent(
              tx,
              fact,
              intent.id,
              intent.store_id,
              intent.mode,
              {
                applied: false,
                supersededReason: 'not_actionable',
                source,
              },
            );

            return {
              outcome: 'recorded',
              intentId: intent.id,
              reason: decision.note,
            };
          }

          const now = new Date();

          // A refund does not touch the attempt or create a capture, so
          // it has its own path rather than being forced through the
          // capture shape. Runs inside this same transaction — apply()
          // already holds one scoped to this intent's store/mode, and
          // opening a second one here would nest transactions for no
          // gain.
          if (decision.kind === 'apply_refund') {
            return this.applyRefund(tx, fact, intent, decision, source, now);
          }

          // A dispute touches neither the attempt nor the intent's
          // totals — the payment still happened — so it has its own
          // path for the same reason a refund does.
          if (decision.kind === 'apply_dispute') {
            return this.applyDispute(tx, fact, intent, decision, source, now);
          }

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
              // Only an attempt_failed fact carries a failure reason — a
              // later success/void fact must never overwrite it, so both
              // fields fall back to whatever the attempt already has.
              error_code: fact.failureCode ?? attempt.error_code,
              error_message_raw: failureMessageOf(fact) ?? attempt.error_message_raw,
            },
          });

          if (decision.newCaptureMinor !== null) {
            const beneficiaryId = await this.findBeneficiary(
              tx,
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
            await this.ledger.post(tx, {
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
          if (checkoutContextId !== null) {
            const checkoutId = checkoutContextId;

            if (SECURES_FUNDS.has(fact.factType)) {
              if (supersededByFundsSecured) {
                /*
                 * The invariant, enforced.
                 *
                 * Money has reached a checkout that a paid successor
                 * replaced. Everything above this line has ALREADY run:
                 * the intent, the attempt, the capture row and the
                 * ledger post. That is deliberate and it is the whole
                 * difference between this and dropping the fact —
                 * the money is real, so the books say so.
                 *
                 * What does NOT happen is finalisation. No second
                 * Order, no second committed checkout, no second
                 * inventory conversion, no `checkout.committed`.
                 *
                 * And because refusing the Order while keeping the money
                 * would be the worst outcome of all, the same
                 * transaction emits the remediation event that returns
                 * it. The event is written here, in the transaction that
                 * observed the money, so it cannot be lost if this
                 * process dies immediately afterwards.
                 */
                await this.outbox.emit(tx, {
                  storeId: intent.store_id,
                  mode: intent.mode,
                  aggregateType: 'payment_intent',
                  aggregateId: intent.id.toString(),
                  eventType: 'payment.superseded_funds_detected',
                  payload: {
                    intentId: intent.id.toString(),
                    attemptId: attempt.id.toString(),
                    checkoutId: checkoutId.toString(),
                    accountId: fact.accountId.toString(),
                    factType: fact.factType,
                    intentStatus: decision.intentStatus,
                    capturedTotalMinor: decision.capturedTotalMinor.toString(),
                    currency: intent.currency,
                    gatewayReference: fact.gatewayReference,
                    gatewayPaymentId: fact.refs?.gatewayPaymentId ?? null,
                    gatewayCaptureRef: fact.refs?.gatewayCaptureRef ?? null,
                  },
                  occurredAt: fact.occurredAt ?? now,
                });

                this.logger.error(
                  `Checkout ${checkoutId} secured funds after being superseded ` +
                    `by a paid successor (intent ${intent.id}, ` +
                    `${decision.capturedTotalMinor} ${intent.currency}). No order ` +
                    `was created; the funds are queued to be returned.`,
                );
              } else {
                await this.finalizer.finalize(tx, {
                  checkoutId,
                  storeId: intent.store_id,
                  mode: intent.mode,
                  paid: decision.capturedTotalMinor > 0n,
                  occurredAt: fact.occurredAt ?? now,
                });
              }
            } else if (RELEASES_FUNDS.has(fact.factType)) {
              await this.finalizer.abandon(tx, {
                checkoutId,
                storeId: intent.store_id,
                mode: intent.mode,
                occurredAt: fact.occurredAt ?? now,
              });
            }
          }

          await this.outbox.emit(tx, {
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

          this.logger.log(
            `Applied ${fact.factType} to intent ${intent.id} (${decision.intentStatus}).`,
          );

          return {
            outcome: 'applied',
            intentId: intent.id,
          };
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
          intentId: resolvedIntentId,
        };
      }

      if (error instanceof ConcurrentIntentUpdate) {
        this.logger.warn(
          `Intent ${error.intentId} changed underneath fact ${fact.dedupeKey}; not applied.`,
        );

        return {
          outcome: 'ignored',
          intentId: error.intentId,
          reason: 'concurrent_update',
        };
      }

      throw error;
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * Applies a refund of money that was collected outside any gateway.
   *
   * COD and bank transfer have no provider to report a fact and no
   * gateway reference to key one on, so the usual apply() entry point —
   * which resolves the tenant and the attempt *from* a provider
   * reference — cannot be used. The intent is already known here, so this
   * skips straight to the same decision and the same writer the gateway
   * path uses. Everything downstream (Refund row, proportional
   * allocations, ledger entry, order status, outbox) is literally the
   * same code; only the posting rule differs.
   *
   * The dedupe key is derived from the cumulative refunded total, exactly
   * as buildFactDedupeKey does for a provider fact, so replaying the same
   * cumulative refund is a duplicate rather than a second refund.
   */
  async applyOfflineRefund(input: {
    storeId: bigint;
    mode: Mode;
    intentId: bigint;
    amountMinor: bigint;
    reason?: string;
  }): Promise<ApplyResult> {
    const now = new Date();

    try {
      return await this.prisma.withTenantTransaction(
        input.storeId,
        input.mode,
        async (tx) => {
          const intent = await tx.paymentIntent.findFirst({
            where: {
              id: input.intentId,
              store_id: input.storeId,
              mode: input.mode,
            },
          });

          if (!intent) {
            throw new NotFoundException(`Intent ${input.intentId} not found.`);
          }

          const cumulativeAmountMinor =
            intent.refunded_total_minor + input.amountMinor;

          const fact: ObservedFact = {
            dedupeKey: `offline_refund:intent:${intent.id}:${cumulativeAmountMinor}`,
            accountId: intent.account_id ?? 0n,
            gatewayReference: `offline:intent:${intent.id}`,
            factType: 'refund_succeeded',
            cumulativeAmountMinor,
            currency: intent.currency,
            occurredAt: now,
            rawRedacted: input.reason ? { reason: input.reason } : undefined,
          };

          const decision = decideFact({
            snapshot: {
              status: intent.status,
              capturedTotalMinor: intent.captured_total_minor,
              refundedTotalMinor: intent.refunded_total_minor,
            },
            amountMinor: intent.amount_minor,
            factType: fact.factType,
            cumulativeAmountMinor,
            occurredAt: now,
          });

          if (decision.kind !== 'apply_refund') {
            await this.recordEvent(
              tx,
              fact,
              intent.id,
              intent.store_id,
              intent.mode,
              {
                applied: false,
                supersededReason:
                  decision.kind === 'ignore' ? decision.reason : 'not_actionable',
                source: 'merchant',
              },
            );

            return {
              outcome:
                decision.kind === 'ignore' && decision.reason === 'already_applied'
                  ? ('duplicate' as const)
                  : ('ignored' as const),
              intentId: intent.id,
              reason: decision.kind === 'ignore' ? decision.reason : undefined,
            };
          }

          return this.applyRefund(tx, fact, intent, decision, 'merchant', now, {
            offline: true,
          });
        },
        {
          timeout: 20_000,
          maxWait: 10_000,
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { outcome: 'duplicate', intentId: input.intentId };
      }

      if (error instanceof ConcurrentIntentUpdate) {
        this.logger.warn(
          `Intent ${error.intentId} changed underneath an offline refund; not applied.`,
        );

        return {
          outcome: 'ignored',
          intentId: error.intentId,
          reason: 'concurrent_update',
        };
      }

      throw error;
    }
  }

  /**
   * Applies a dispute reported by a provider.
   *
   * Three transitions, each a new append-only ledger entry rather than a
   * change to an earlier one:
   *
   *   opened → hold the money  (disputes_held ← psp_receivable)
   *   won    → give it back    (psp_receivable ← disputes_held)
   *   lost   → write it off    (chargeback_loss ← disputes_held)
   *
   * The Dispute row is the state machine. Opening one twice is a
   * duplicate rather than a second hold, and resolving one that is
   * already resolved is refused — without that, a redelivered "lost"
   * would write the amount off twice.
   */
  private async applyDispute(
    tx: Prisma.TransactionClient,
    fact: ObservedFact,
    intent: {
      id: bigint;
      store_id: bigint;
      mode: Mode;
      currency: string;
      account_id: bigint | null;
    },
    decision: Extract<FactDecision, { kind: 'apply_dispute' }>,
    source: PaymentEventSource,
    now: Date,
  ): Promise<ApplyResult> {
    if (intent.account_id === null) {
      // Every dispute posting names the payment account whose receivable
      // moves. Without one there is no account to move it against.
      this.logger.error(`Dispute for intent ${intent.id} has no payment account.`);

      return { outcome: 'ignored', intentId: intent.id, reason: 'no_account' };
    }

    const accountId = intent.account_id;
    const disputeRef = fact.refs?.gatewayCaptureRef ?? null;
    const occurredAt = fact.occurredAt ?? now;

    const existing = disputeRef
      ? await tx.dispute.findFirst({
          where: {
            store_id: intent.store_id,
            gateway_dispute_ref: disputeRef,
          },
        })
      : null;

    // The dedupe key on payment_events is inserted first, so a
    // redelivered fact aborts the whole transaction before any of this
    // is written. This state check catches the other case: the same
    // outcome arriving under a *different* event, which has a different
    // dedupe key and would otherwise post twice.
    if (decision.disputeStatus === 'open') {
      if (existing) {
        return {
          outcome: 'duplicate',
          intentId: intent.id,
          reason: 'already_applied',
        };
      }
    } else {
      if (!existing) {
        // A resolution for a dispute that was never opened here. Recorded
        // rather than acted on: posting a release or a write-off with no
        // matching hold would drive disputes_held negative.
        await this.recordEvent(tx, fact, intent.id, intent.store_id, intent.mode, {
          applied: false,
          supersededReason: 'dispute_not_open',
          source,
        });

        return {
          outcome: 'ignored',
          intentId: intent.id,
          reason: 'dispute_not_open',
        };
      }

      if (existing.status !== 'open') {
        return {
          outcome: 'duplicate',
          intentId: intent.id,
          reason: 'already_applied',
        };
      }
    }

    await tx.paymentEvent.create({
      data: {
        intent_id: intent.id,
        store_id: intent.store_id,
        mode: intent.mode,
        event_type: fact.factType,
        dedupe_key: fact.dedupeKey,
        source,
        applied: true,
        payload_redacted: (fact.rawRedacted ?? null) as Prisma.InputJsonValue,
        occurred_at: occurredAt,
      },
    });

    // The amount always comes from the dispute as it was opened, never
    // from the resolving event: a provider that reported a different
    // figure on close would otherwise release more than was ever held.
    const amountMinor =
      decision.disputeStatus === 'open'
        ? decision.amountMinor
        : existing!.amount_minor;

    let disputeId: bigint;

    if (decision.disputeStatus === 'open') {
      const capture = await tx.capture.findFirst({
        where: {
          intent_id: intent.id,
          store_id: intent.store_id,
          mode: intent.mode,
          status: 'succeeded',
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      });

      const created = await tx.dispute.create({
        data: {
          intent_id: intent.id,
          capture_id: capture?.id ?? null,
          store_id: intent.store_id,
          mode: intent.mode,
          amount_minor: amountMinor,
          currency: intent.currency,
          status: 'open',
          reason: this.disputeReason(fact),
          gateway_dispute_ref: disputeRef,
          opened_at: occurredAt,
        },
        select: { id: true },
      });

      disputeId = created.id;
    } else {
      // Compare-and-set on the status: two resolutions racing each other
      // cannot both post, because only the first finds the row open.
      const claimed = await tx.dispute.updateMany({
        where: {
          id: existing!.id,
          store_id: intent.store_id,
          mode: intent.mode,
          status: 'open',
        },
        data: {
          status: decision.disputeStatus,
          resolved_at: occurredAt,
        },
      });

      if (claimed.count === 0) {
        throw new ConcurrentIntentUpdate(intent.id);
      }

      disputeId = existing!.id;
    }

    await this.ledger.post(tx, {
      storeId: intent.store_id,
      mode: intent.mode,
      currency: intent.currency,
      entryType: `payment.dispute.${decision.disputeStatus}`,
      sourceKind: 'dispute',
      sourceId: disputeId.toString(),
      dedupeKey: `${fact.dedupeKey}:ledger`,
      occurredAt,
      memo: `Dispute ${decision.disputeStatus} for intent ${intent.id}`,
      postings:
        decision.disputeStatus === 'open'
          ? disputeOpened({ totalMinor: amountMinor, paymentAccountId: accountId })
          : decision.disputeStatus === 'won'
            ? disputeWon({ totalMinor: amountMinor, paymentAccountId: accountId })
            : disputeLost({ totalMinor: amountMinor }),
    });

    await this.outbox.emit(tx, {
      storeId: intent.store_id,
      mode: intent.mode,
      aggregateType: 'payment_intent',
      aggregateId: intent.id.toString(),
      eventType: `payment.dispute.${decision.disputeStatus}`,
      payload: {
        intentId: intent.id.toString(),
        disputeId: disputeId.toString(),
        amountMinor: amountMinor.toString(),
        currency: intent.currency,
        status: decision.disputeStatus,
      },
      occurredAt,
    });

    this.logger.log(
      `Dispute ${decision.disputeStatus} (${amountMinor} ${intent.currency}) ` +
        `on intent ${intent.id}.`,
    );

    return { outcome: 'applied', intentId: intent.id };
  }

  /** The provider's reason string, trimmed to the column. */
  private disputeReason(fact: ObservedFact): string | null {
    const reason = fact.rawRedacted?.reason;
    return typeof reason === 'string' && reason.length > 0
      ? reason.slice(0, 120)
      : null;
  }

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
    tx: Prisma.TransactionClient,
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
    options: { offline?: boolean } = {},
  ): Promise<ApplyResult> {
    const offline = options.offline === true;

    // Only the gateway path is bound to a payment mode: refundIssuedOffline
    // reverses cash the merchant handled directly, which is the right rule
    // whatever gateway mode the store is otherwise configured for.
    if (!offline && intent.payment_mode !== 'MERCHANT_GATEWAY') {
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

    if (!offline && intent.account_id === null) {
      this.logger.error(
        `Refund for intent ${intent.id} has no payment account.`,
      );

      return {
        outcome: 'ignored',
        intentId: intent.id,
        reason: 'no_account',
      };
    }

    // Runs on the caller's tenant transaction (apply() already opened
    // one scoped to intent.store_id/intent.mode). A ConcurrentIntentUpdate
    // or unique-constraint throw here propagates out through that
    // transaction and is classified by apply()'s single catch block —
    // there is no separate transaction or error handling here to keep in
    // sync with it.
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
      tx,
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

    await this.ledger.post(tx, {
      storeId: intent.store_id,
      mode: intent.mode,
      currency: intent.currency,
      entryType: offline ? 'payment.refunded.offline' : 'payment.refunded.gateway',
      sourceKind: 'refund',
      sourceId: refund.id.toString(),
      dedupeKey: `${fact.dedupeKey}:ledger`,
      occurredAt: fact.occurredAt ?? now,
      memo: `Refund for intent ${intent.id}`,
      postings: offline
        ? // collected: true — an offline refund is only reachable once the
          // money was actually collected, so the credit leg is the cash
          // that now goes back out, mirroring offlineCollected().
          refundIssuedOffline({
            totalMinor: decision.newRefundMinor,
            collected: true,
            allocations,
          })
        : refundIssued({
            totalMinor: decision.newRefundMinor,
            // Non-null on this branch: the guard above returns early for a
            // gateway refund with no account.
            paymentAccountId: intent.account_id as bigint,
            allocations,
          }),
    });

    await this.syncOrderRefundStatus(tx, intent, decision);

    await this.outbox.emit(tx, {
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

  /**
   * Records an ignored or record-only fact for the audit trail.
   *
   * Takes the caller's tenant transaction rather than opening its own:
   * this always runs inside apply()'s single withTenantTransaction, and
   * a second transaction here would nest for no reason. If two routes
   * race to record the exact same superseded fact, the unique dedupe_key
   * on payment_events rejects the second insert; that error propagates
   * out through apply()'s transaction rather than being swallowed here,
   * and apply()'s own catch — which already exists to classify this
   * exact class of error for the capture and refund paths — reports it
   * as `duplicate`. The guarantee this exists for (a fact is recorded at
   * most once) holds either way; only the classification of a
   * simultaneous duplicate on this narrow path moves to one place.
   */
  private async recordEvent(
    tx: Prisma.TransactionClient,
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
    await tx.paymentEvent.create({
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

/**
 * Pulls the free-text failure detail out of a fact's redacted payload, when
 * one is there.
 *
 * Adapters do not agree on the key: Stripe and Moyasar report `message`,
 * Tap reports `response_message`. Reading a small fixed set of known-safe
 * keys here (rather than the whole `rawRedacted` blob) keeps this from
 * ever picking up something that was redacted for a reason.
 */
function failureMessageOf(fact: ObservedFact): string | undefined {
  const raw = fact.rawRedacted as Record<string, unknown> | undefined;
  const value = raw?.message ?? raw?.response_message;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * `ObservedFact.internalIntentRef` is provider-supplied metadata,
 * round-tripped from whatever the outbound call sent — never trust its
 * shape. A malformed or absent value falls back to the ordinary
 * unmatched-fact path rather than throwing.
 */
function parseInternalIntentRef(ref: string): bigint | null {
  if (!/^\d+$/.test(ref)) return null;
  try {
    return BigInt(ref);
  } catch {
    return null;
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

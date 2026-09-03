import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OutboxHandlerRegistry } from '../../../common/messaging/outbox-handler.registry';
import type { OutboxRecord } from '../../../common/messaging/messaging.types';
import { ProviderRegistry } from '../gateways/provider-registry.service';
import type { ObservedFact } from '../gateways/provider.types';
import { PaymentAccountService } from '../payment-account.service';
import { PaymentFactApplier } from '../facts/payment-fact.applier';

const EVENT = 'payment.superseded_funds_detected';

/**
 * ==================================================================
 * Returning funds that reached a superseded checkout
 * ==================================================================
 *
 * The other half of the invariant, and the half that makes it safe.
 *
 * `PaymentFactApplier` refuses to create a second Order for money that
 * arrived on a checkout a paid successor replaced. Refusing the Order
 * and keeping the money would be a worse outcome than the duplicate
 * Order it prevents — a real customer charge with nothing behind it —
 * so the money is given back here.
 *
 * Why a consumer and not a call inside the applier: the provider call is
 * network I/O, and a database transaction must never be held open across
 * it. The applier writes the event in the same transaction that observed
 * the money, so the intent to refund is durable the instant the money is
 * recorded; this then runs it with the outbox's retry and dead-letter
 * behaviour behind it.
 *
 * A failure here is never swallowed. It is logged at ERROR with
 * everything an operator needs to settle it by hand, and rethrown so the
 * outbox retries and eventually dead-letters it — because the one thing
 * that must not happen is real money quietly staying taken.
 */
@Injectable()
export class SupersededFundsConsumer implements OnModuleInit {
  private readonly logger = new Logger(SupersededFundsConsumer.name);

  readonly consumerName = 'superseded-funds';

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly accounts: PaymentAccountService,
    private readonly applier: PaymentFactApplier,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(EVENT, this);
  }

  async handle(message: OutboxRecord): Promise<void> {
    const payload = message.payload as {
      intentId?: string;
      checkoutId?: string;
      accountId?: string;
      factType?: string;
      capturedTotalMinor?: string;
      currency?: string;
      gatewayReference?: string | null;
      gatewayPaymentId?: string | null;
      gatewayCaptureRef?: string | null;
    };

    const storeId = message.storeId;
    const mode = message.mode;
    const capturedMinor = BigInt(payload.capturedTotalMinor ?? '0');
    const gatewayReference = payload.gatewayReference ?? null;

    // Without a provider reference there is nothing to address the
    // reversal to. Retrying cannot invent one, so this is surfaced and
    // acknowledged rather than burning the outbox's attempts.
    if (!gatewayReference || !payload.accountId) {
      this.alert(message, 'no provider reference to reverse against');
      return;
    }

    const accountId = BigInt(payload.accountId);

    const account = await this.prisma.withTenantTransaction(
      storeId,
      mode,
      (tx) =>
        tx.paymentAccount.findFirst({
          where: { id: accountId, store_id: storeId, mode },
          select: { id: true, gateway: true },
        }),
    );

    if (!account || !this.providers.has(account.gateway)) {
      this.alert(message, `payment account ${accountId} is unavailable`);
      return;
    }

    const provider = this.providers.get(account.gateway);

    const credentials = await this.accounts.revealCredentialsForGateway(
      storeId,
      mode,
      account.id,
    );

    /*
     * Void an authorisation, refund a capture.
     *
     * A hold that was never captured is released, not refunded — voiding
     * costs the customer nothing and clears the hold immediately, while
     * refunding an uncaptured authorisation is either rejected by the
     * provider or, worse, captures first.
     */
    const isCapture = capturedMinor > 0n;

    // Deterministic: a retry of this same message must reach the
    // provider with the key it used before, or a refund is duplicated.
    const idempotencyKey = `superseded-reversal:${message.id.toString()}`;

    try {
      let facts: ObservedFact[];

      if (isCapture) {
        // A gateway that cannot reverse must never look like it did.
        if (!provider.refund) {
          throw new Error(
            `Gateway ${account.gateway} cannot refund; manual reversal required.`,
          );
        }

        facts = await provider.refund({
          accountId: account.id,
          gatewayReference,
          gatewayPaymentId: payload.gatewayPaymentId ?? null,
          gatewayCaptureRef: payload.gatewayCaptureRef ?? null,
          amountMinor: capturedMinor,
          currency: payload.currency ?? '',
          reason: 'superseded_checkout',
          credentials,
          idempotencyKey,
          mode,
        });
      } else {
        if (!provider.voidAuthorization) {
          throw new Error(
            `Gateway ${account.gateway} cannot void; manual reversal required.`,
          );
        }

        facts = await provider.voidAuthorization({
          accountId: account.id,
          gatewayReference,
          gatewayPaymentId: payload.gatewayPaymentId ?? null,
          credentials,
          idempotencyKey,
          mode,
        });
      }

      // Fed back through the same applier every other fact goes through,
      // so the reversal is recorded, ledgered and deduped identically.
      if (facts.length > 0) {
        await this.applier.applyMany(facts, 'reconciliation');
      }

      this.logger.log(
        `Returned superseded funds for checkout ${payload.checkoutId} ` +
          `(intent ${payload.intentId}): ${isCapture ? 'refunded' : 'voided'} ` +
          `${capturedMinor} ${payload.currency ?? ''} via ${account.gateway}.`,
      );
    } catch (error) {
      this.alert(message, (error as Error).message);
      // Rethrown deliberately: the outbox retries, and dead-letters if
      // it keeps failing. Money that could not be returned must stay
      // visible as an unfinished job, never be acknowledged away.
      throw error;
    }
  }

  /**
   * The operational alert.
   *
   * Deliberately ERROR and deliberately verbose: every field an operator
   * needs to find the payment at the provider and reverse it by hand is
   * on this one line, because the alternative to acting on it is a
   * customer who paid and has nothing.
   */
  private alert(message: OutboxRecord, reason: string): void {
    const payload = message.payload;

    this.logger.error(
      `[superseded-funds] MANUAL REVERSAL REQUIRED — superseded checkout ` +
        `kept real funds. ` +
        `reason="${reason}" store=${message.storeId} mode=${message.mode} ` +
        `checkout=${String(payload.checkoutId)} intent=${String(payload.intentId)} ` +
        `attempt=${String(payload.attemptId)} account=${String(payload.accountId)} ` +
        `gatewayReference=${String(payload.gatewayReference)} ` +
        `gatewayPaymentId=${String(payload.gatewayPaymentId)} ` +
        `amountMinor=${String(payload.capturedTotalMinor)} ` +
        `currency=${String(payload.currency)} outboxMessage=${message.id.toString()}`,
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import type { Mode } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentAccountService } from '../payment-account.service';
import { ProviderRegistry } from '../gateways/provider-registry.service';
import { PaymentFactApplier } from '../facts/payment-fact.applier';
import { ProviderError, webhookSecretField } from '../gateways/provider.types';
import type { WebhookDescriptor } from '../gateways/provider.types';
import { isWebhookCapable } from '../gateways/payment-provider.interface';
import {
  WebhookAccountResolver,
  type WebhookResolutionFailure,
} from './webhook-account-resolver.service';
import { isUniqueConstraintError } from '../../../common/idempotency/idempotency.types';

/**
 * ==================================================================
 * Webhook ingestion
 * ==================================================================
 *
 * Verifies, records, normalises and applies an inbound provider
 * callback.
 *
 * Rules this follows, each of which is a common way to get webhooks
 * wrong:
 *
 *   1. The signature is verified before the body is trusted for
 *      anything. The URL is not a secret and is not treated as one.
 *
 *   2. The route's gateway segment is checked against the account's
 *      real gateway. Without it, a signed Stripe body could be posted
 *      to /paymob/:id and be parsed by whichever adapter the path
 *      named.
 *
 *   3. Every callback that reaches a real account is recorded before it
 *      is parsed, so a crash mid-processing leaves evidence rather than
 *      silence.
 *
 *   4. The same provider event is applied once. A unique constraint on
 *      (account_id, provider_event_id) enforces that in the database,
 *      and the applier's own fact dedupe is a second, independent layer.
 *
 *   5. Nothing here mutates payment state directly. It produces
 *      ObservedFacts and hands them to the same applier reconciliation
 *      uses.
 */

export type IngestOutcome =
  | 'applied'
  | 'duplicate'
  | 'ignored'
  | 'unmatched'
  | 'unsupported';

export interface IngestResult {
  readonly outcome: IngestOutcome;
  readonly factCount: number;
  readonly detail?: string;
}

/**
 * Recorded lifecycle of one inbound callback.
 *
 * Text rather than an enum, matching `entry_type`: the set grows with
 * every gateway added, and an enum would need a migration each time.
 */
const STATUS = {
  received: 'received',
  gatewayMismatch: 'gateway_mismatch',
  unsupported: 'unsupported',
  rejected: 'rejected_signature',
  duplicate: 'duplicate',
  unknownEvent: 'unknown_event',
  ignored: 'ignored',
  applied: 'applied',
  unmatched: 'unmatched',
  failed: 'failed',
} as const;

@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly accounts: PaymentAccountService,
    private readonly applier: PaymentFactApplier,
    private readonly resolver: WebhookAccountResolver,
  ) {}

  async ingest(input: {
    /** The `:gateway` segment of the callback URL, as sent. */
    gateway: string;
    accountId: string;
    rawBody: Buffer | undefined;
    headers: Record<string, string | string[] | undefined>;
    /** Callback URL query string; carries the signature for some providers. */
    query?: Record<string, string | string[] | undefined>;
  }): Promise<IngestResult> {
    if (!input.rawBody || input.rawBody.length === 0) {
      // Signature schemes hash the exact bytes, so a parsed-and-restringified
      // body cannot be verified. An empty raw body means the app is
      // misconfigured, not that the provider sent nothing.
      return {
        outcome: 'unsupported',
        factCount: 0,
        detail: 'missing raw body',
      };
    }

    /**
     * Which account is this about?
     *
     * Delegated rather than parsed from the path here, so a provider
     * that identifies the merchant inside the body is a resolution
     * strategy the adapter declares instead of a second ingestion path.
     * For every adapter shipped today this is still exactly the endpoint
     * lookup it replaces.
     */
    const resolution = await this.resolver.resolve({
      gateway: input.gateway,
      endpointAccountId: input.accountId,
      rawBody: input.rawBody,
      headers: input.headers,
    });

    if (resolution.kind === 'unresolved') {
      // Deliberately not recorded. This endpoint is unauthenticated, so
      // persisting before an account is resolved would let anyone fill
      // the table by posting to invented ids. Everything from here on is
      // addressed to a real account, which bounds that.
      this.logger.warn(
        `Webhook for gateway "${input.gateway}" could not be routed ` +
          `(${resolution.reason}).`,
      );

      return {
        outcome: unresolvedOutcome(resolution.reason),
        factCount: 0,
        detail: resolution.reason,
      };
    }

    const account = resolution.account;

    // Durable, and before anything is parsed: if the process dies later
    // in this method there is still a record that the callback arrived.
    const record = await this.record({
      gateway: input.gateway,
      accountId: account.id,
      storeId: account.store_id,
      mode: account.mode,
      rawBody: input.rawBody,
    });

    /**
     * The path segment must name the account's real gateway.
     *
     * The signature check alone does not cover this: it proves the body
     * came from *a* provider holding this account's secret, not that the
     * adapter named in the path is the one that should interpret it.
     * Rejecting here also stops a mismatch from reaching an adapter that
     * would parse another provider's payload shape.
     */
    if (input.gateway !== account.gateway) {
      this.logger.warn(
        `Webhook path gateway "${input.gateway}" does not match account ` +
          `${account.id} gateway "${account.gateway}"; rejected.`,
      );

      await this.finish(record, STATUS.gatewayMismatch, {
        failureCode: 'gateway_mismatch',
      });

      return {
        outcome: 'unmatched',
        factCount: 0,
        detail: 'gateway mismatch',
      };
    }

    if (!this.providers.has(account.gateway)) {
      await this.finish(record, STATUS.unsupported, {
        failureCode: 'no_adapter',
      });

      return {
        outcome: 'unsupported',
        factCount: 0,
        detail: 'no adapter',
      };
    }

    const provider = this.providers.get(account.gateway);

    if (!isWebhookCapable(provider)) {
      await this.finish(record, STATUS.unsupported, {
        failureCode: 'no_webhook_support',
      });

      return {
        outcome: 'unsupported',
        factCount: 0,
        detail: `${account.gateway} does not send webhooks`,
      };
    }

    const credentials = await this.accounts.revealCredentialsForGateway(
      account.store_id,
      account.mode,
      account.id,
    );

    // Which credential holds it is the adapter's declaration, not a name
    // core assumes: Stripe calls it a webhook signing secret, Paymob an
    // HMAC secret.
    const secretField = webhookSecretField(provider.capabilities);
    const signingSecret = credentials[secretField] ?? '';

    if (signingSecret.length === 0) {
      // Without a secret the callback cannot be authenticated, and applying
      // an unauthenticated payment event is how fraudulent "paid" webhooks
      // succeed.
      this.logger.error(
        `Account ${account.id} (${account.gateway}) has no ${secretField}; rejecting callback.`,
      );

      await this.finish(record, STATUS.unsupported, {
        failureCode: 'no_signing_secret',
      });

      return {
        outcome: 'unsupported',
        factCount: 0,
        detail: 'no signing secret',
      };
    }

    let facts;

    try {
      facts = await provider.parseWebhook({
        accountId: account.id,
        // The exact bytes, never a re-serialised copy.
        rawBody: input.rawBody,
        headers: input.headers,
        query: input.query ?? {},
        signingSecret,
        mode: account.mode,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        // A bad signature or an unparseable body. Neither has touched
        // payment state: facts are produced here and applied below, so
        // failing at this point cannot have changed anything.
        this.logger.error(
          `Webhook rejected for account ${account.id} (${error.code}): ${error.message}`,
        );

        await this.finish(record, STATUS.rejected, {
          failureCode: error.code,
        });

        return {
          outcome: 'unsupported',
          factCount: 0,
          detail: error.code,
        };
      }

      throw error;
    }

    // Past this point the body is authenticated, so reading the envelope
    // out of it is safe.
    const descriptor = provider.describeWebhook
      ? provider.describeWebhook({ rawBody: input.rawBody })
      : null;

    // Claiming the provider's event id is what makes a redelivery a
    // no-op: the unique constraint rejects the second claim, and the
    // second delivery returns without applying anything.
    if (descriptor) {
      const claimed = await this.claim(record, descriptor);

      if (!claimed) {
        this.logger.log(
          `Duplicate webhook ${descriptor.eventId} for account ${account.id}; not reapplied.`,
        );

        await this.finish(record, STATUS.duplicate, {
          eventType: descriptor.eventType,
        });

        return {
          outcome: 'duplicate',
          factCount: 0,
          detail: 'already processed',
        };
      }
    }

    if (facts.length === 0) {
      // Recognised-but-inert and never-heard-of are different problems.
      // Collapsing them hides a gateway sending something we should
      // handle behind a pile of expected heartbeats.
      const unknown = descriptor !== null && !descriptor.recognised;

      await this.finish(
        record,
        unknown ? STATUS.unknownEvent : STATUS.ignored,
        { eventType: descriptor?.eventType },
      );

      return {
        outcome: 'ignored',
        factCount: 0,
        detail: unknown ? 'unknown event type' : undefined,
      };
    }

    let results;

    try {
      results = await this.applier.applyMany(facts, 'webhook');
    } catch (error) {
      // A genuine processing failure, not a rejected callback. The claim
      // is released so the provider's retry is processed rather than
      // dismissed as a duplicate, and the error propagates so the
      // provider sees a non-2xx and does retry.
      await this.release(record, error);

      throw error;
    }

    const applied = results.filter((r) => r.outcome === 'applied').length;
    const unmatched = results.filter((r) => r.outcome === 'unmatched').length;

    if (applied > 0) {
      await this.finish(record, STATUS.applied, {
        eventType: descriptor?.eventType,
        factCount: applied,
      });

      return {
        outcome: 'applied',
        factCount: applied,
      };
    }

    if (unmatched === results.length) {
      // The provider is ahead of our own write. Reconciliation will pick
      // the intent up once the attempt row exists.
      this.logger.warn(
        `All ${results.length} facts unmatched for account ${account.id}.`,
      );

      await this.finish(record, STATUS.unmatched, {
        eventType: descriptor?.eventType,
        factCount: results.length,
      });

      return {
        outcome: 'unmatched',
        factCount: results.length,
      };
    }

    await this.finish(record, STATUS.duplicate, {
      eventType: descriptor?.eventType,
      factCount: results.length,
    });

    return {
      outcome: 'duplicate',
      factCount: results.length,
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Writes the arrival record.
   *
   * On the platform connection because there is no tenant context yet —
   * the store is only known once the account has been resolved, and this
   * row has to exist before the body is trusted for anything.
   *
   * The raw body is hashed, not stored: a payment callback carries
   * customer data, and the digest is enough to prove which bytes arrived.
   */
  private async record(input: {
    gateway: string;
    accountId: bigint;
    storeId: bigint;
    mode: Mode;
    rawBody: Buffer;
  }): Promise<bigint | null> {
    try {
      const created = await this.prisma.platform().webhookEvent.create({
        data: {
          gateway: input.gateway.slice(0, 40),
          account_id: input.accountId,
          store_id: input.storeId,
          mode: input.mode,
          status: STATUS.received,
          body_sha256: createHash('sha256').update(input.rawBody).digest('hex'),
          body_bytes: input.rawBody.length,
        },
        select: { id: true },
      });

      return created.id;
    } catch (error) {
      // Audit must never be the reason a legitimate callback is dropped.
      // Losing the record is bad; refusing the payment event is worse.
      this.logger.error(
        `Could not record inbound webhook for account ${input.accountId}: ${
          (error as Error).message
        }`,
      );

      return null;
    }
  }

  /**
   * Claims the provider's event id for this record.
   *
   * Returns false when another delivery already holds it — the unique
   * constraint on (account_id, provider_event_id) is the arbiter, so two
   * concurrent deliveries cannot both win.
   */
  private async claim(
    recordId: bigint | null,
    descriptor: WebhookDescriptor,
  ): Promise<boolean> {
    if (recordId === null) return true;

    try {
      await this.prisma.platform().webhookEvent.update({
        where: { id: recordId },
        data: {
          provider_event_id: descriptor.eventId,
          event_type: descriptor.eventType,
          signature_verified: true,
        },
      });

      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      throw error;
    }
  }

  /** Records the outcome. Never throws: this is bookkeeping, not the operation. */
  private async finish(
    recordId: bigint | null,
    status: string,
    extra: {
      failureCode?: string;
      eventType?: string;
      factCount?: number;
    } = {},
  ): Promise<void> {
    if (recordId === null) return;

    try {
      await this.prisma.platform().webhookEvent.update({
        where: { id: recordId },
        data: {
          status,
          processed_at: new Date(),
          ...(extra.failureCode ? { failure_code: extra.failureCode } : {}),
          ...(extra.eventType ? { event_type: extra.eventType } : {}),
          ...(extra.factCount === undefined
            ? {}
            : { fact_count: extra.factCount }),
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not update webhook record ${recordId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Marks a processing failure and gives the event id back.
   *
   * Without releasing it, the provider's retry would collide with this
   * record's claim and be dismissed as a duplicate — turning a
   * recoverable failure into a permanently lost event.
   */
  private async release(recordId: bigint | null, error: unknown): Promise<void> {
    if (recordId === null) return;

    try {
      await this.prisma.platform().webhookEvent.update({
        where: { id: recordId },
        data: {
          status: STATUS.failed,
          provider_event_id: null,
          failure_code: 'processing_error',
          payload_redacted: {
            error: (error as Error).message?.slice(0, 500) ?? 'unknown',
          } as Prisma.InputJsonValue,
          processed_at: new Date(),
        },
      });
    } catch (updateError) {
      this.logger.error(
        `Could not release webhook record ${recordId}: ${
          (updateError as Error).message
        }`,
      );
    }
  }
}

/**
 * How a routing failure is reported to the caller.
 *
 * `unmatched` means the callback was addressed to something we do not
 * have; `unsupported` means we could not read the address at all. The
 * split matters operationally: the first is usually a stale endpoint at
 * the provider, the second is a gateway we are not equipped for.
 */
function unresolvedOutcome(reason: WebhookResolutionFailure): IngestOutcome {
  switch (reason) {
    case 'not_extractable':
    case 'unsupported_strategy':
    case 'no_adapter':
      return 'unsupported';
    default:
      return 'unmatched';
  }
}

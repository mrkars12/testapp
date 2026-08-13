import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentAccountService } from '../payment-account.service';
import { ProviderRegistry } from '../gateways/provider-registry.service';
import { PaymentFactApplier } from '../facts/payment-fact.applier';
import { ProviderError } from '../gateways/provider.types';
import { crossStoreQuery } from '../../../common/tenant/cross-store-query';

/**
 * ==================================================================
 * Webhook ingestion
 * ==================================================================
 *
 * Verifies, normalises and applies an inbound provider callback.
 *
 * Three rules this follows, each of which is a common way to get
 * webhooks wrong:
 *
 *   1. The signature is verified before the body is trusted for
 *      anything. The URL is not a secret and is not treated as one.
 *
 *   2. The response is always fast and always 2xx once the signature
 *      passes. Providers retry on non-2xx and disable endpoints that
 *      fail repeatedly, so a downstream problem must not surface as
 *      a 5xx to the provider.
 *
 *   3. Nothing here mutates payment state directly. It produces
 *      ObservedFacts and hands them to the same applier reconciliation
 *      uses, so a fact delivered twice by two routes is applied once.
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

@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly accounts: PaymentAccountService,
    private readonly applier: PaymentFactApplier,
  ) {}

  async ingest(input: {
    accountId: string;
    rawBody: Buffer | undefined;
    headers: Record<string, string | string[] | undefined>;
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

    let accountId: bigint;

    try {
      accountId = BigInt(input.accountId);
    } catch {
      return {
        outcome: 'unmatched',
        factCount: 0,
        detail: 'bad account id',
      };
    }

    /**
     * The webhook URL gives us the payment-account id, but not the tenant.
     * This lookup is therefore an explicit provider_lookup cross-store
     * resolution. The store and mode become known from the account itself
     * and are then carried into all subsequent operations.
     */
    const account = await crossStoreQuery(
      'provider_lookup',
      'resolve payment account for inbound webhook',
      () =>
        this.prisma.guarded().paymentAccount.findFirst({
          where: {
            id: accountId,
          },
          select: {
            id: true,
            store_id: true,
            mode: true,
            gateway: true,
            status: true,
          },
        }),
    );

    if (!account) {
      this.logger.warn(`Webhook for unknown account ${input.accountId}.`);

      return {
        outcome: 'unmatched',
        factCount: 0,
        detail: 'unknown account',
      };
    }

    if (!this.providers.has(account.gateway)) {
      return {
        outcome: 'unsupported',
        factCount: 0,
        detail: 'no adapter',
      };
    }

    const provider = this.providers.get(account.gateway);

    if (!provider.capabilities.webhooks || !provider.parseWebhook) {
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

    const signingSecret = credentials.webhook_secret ?? '';

    if (signingSecret.length === 0) {
      // Without a secret the callback cannot be authenticated, and applying
      // an unauthenticated payment event is how fraudulent "paid" webhooks
      // succeed.
      this.logger.error(
        `Account ${account.id} (${account.gateway}) has no webhook secret; rejecting callback.`,
      );

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
        rawBody: input.rawBody,
        headers: input.headers,
        signingSecret,
        mode: account.mode,
      });
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.error(
          `Webhook rejected for account ${account.id} (${error.code}): ${error.message}`,
        );

        return {
          outcome: 'unsupported',
          factCount: 0,
          detail: error.code,
        };
      }

      throw error;
    }

    if (facts.length === 0) {
      // A recognised but uninteresting event, e.g. a provider heartbeat.
      return {
        outcome: 'ignored',
        factCount: 0,
      };
    }

    const results = await this.applier.applyMany(facts, 'webhook');

    const applied = results.filter((r) => r.outcome === 'applied').length;

    const unmatched = results.filter((r) => r.outcome === 'unmatched').length;

    if (applied > 0) {
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

      return {
        outcome: 'unmatched',
        factCount: results.length,
      };
    }

    return {
      outcome: 'duplicate',
      factCount: results.length,
    };
  }
}

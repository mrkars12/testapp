import { Injectable, Logger } from '@nestjs/common'
import type { Mode } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { ProviderRegistry } from '../gateways/provider-registry.service'
import {
  resolveWebhookAccountRef,
  type WebhookAccountRef,
  type WebhookRefFailure,
  type WebhookResolutionRequest,
} from '../gateways/webhook-resolution'
import { crossStoreQuery } from '../../../common/tenant/cross-store-query'

/**
 * ==================================================================
 * Webhook account resolution
 * ==================================================================
 *
 * Turns "a callback arrived" into "this is the account it is about",
 * for any resolution strategy an adapter declares.
 *
 * Ingestion used to do this itself, by parsing the id out of the path.
 * That is still what happens for an endpoint-scoped provider — it is the
 * safest possible routing, since nothing in the body is read to decide
 * it — but it is now one strategy among several rather than the only
 * thing the system can do.
 *
 * A payload-scoped provider posts every merchant's events to one URL and
 * names the merchant inside the body. Resolving that means parsing
 * unverified bytes, so the boundary is drawn tightly: the adapter
 * returns a *reference*, this service turns it into a row, and the row's
 * signing secret is then used to verify. Nothing the payload says is
 * trusted beyond choosing which secret must reject it.
 *
 * The lookup for a provider-side reference uses `connected_account_ref`,
 * the column that already exists to hold the provider's own identifier
 * for a merchant account. No provider-specific parsing lives here.
 */

export interface ResolvedWebhookAccount {
  readonly id: bigint
  readonly store_id: bigint
  readonly mode: Mode
  readonly gateway: string
  readonly status: string
}

export type WebhookResolutionFailure =
  | WebhookRefFailure
  | 'unknown_account'
  | 'ambiguous_account'
  | 'no_adapter'

export type WebhookAccountResolution =
  | {
      readonly kind: 'resolved'
      readonly account: ResolvedWebhookAccount
      readonly ref: WebhookAccountRef
    }
  | { readonly kind: 'unresolved'; readonly reason: WebhookResolutionFailure }

@Injectable()
export class WebhookAccountResolver {
  private readonly logger = new Logger(WebhookAccountResolver.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
  ) {}

  async resolve(
    request: WebhookResolutionRequest,
  ): Promise<WebhookAccountResolution> {
    /**
     * The strategy comes from the adapter named in the *path*, which is
     * not yet known to be the account's real gateway — that check happens
     * in ingestion, once an account exists to compare against. Using it
     * here only selects how to look, and a mismatch is rejected before
     * anything is parsed for meaning.
     */
    if (!this.providers.has(request.gateway)) {
      // An unknown path segment can still be endpoint-scoped: the URL
      // carries the account, and ingestion will reject the gateway
      // mismatch with a record of it. Falling back keeps that audit
      // trail rather than dropping the callback silently.
      return request.endpointAccountId
        ? this.byRef(this.endpointRef(request), request)
        : { kind: 'unresolved', reason: 'no_adapter' }
    }

    const provider = this.providers.get(request.gateway)

    const outcome = resolveWebhookAccountRef({
      strategy: provider.capabilities.webhookResolution,
      request,
      extract: provider.extractWebhookAccountRef
        ? (input) => provider.extractWebhookAccountRef!(input)
        : undefined,
    })

    if (outcome.kind === 'unresolved') {
      return { kind: 'unresolved', reason: outcome.reason }
    }

    return this.byRef(outcome.ref, request)
  }

  /* ---------------------------------------------------------------- */

  private endpointRef(request: WebhookResolutionRequest): WebhookAccountRef {
    // Only reached when endpointAccountId is present; a malformed value
    // is rejected by the lookup below rather than throwing here.
    return {
      kind: 'account_id',
      accountId: safeBigInt(request.endpointAccountId) ?? -1n,
    }
  }

  private async byRef(
    ref: WebhookAccountRef,
    request: WebhookResolutionRequest,
  ): Promise<WebhookAccountResolution> {
    if (ref.kind === 'account_id' && ref.accountId < 0n) {
      return { kind: 'unresolved', reason: 'bad_endpoint_account' }
    }

    /**
     * The callback carries no tenant, so this is an explicit
     * provider_lookup cross-store resolution. Store and mode become known
     * from the account itself and are carried into everything after.
     */
    const accounts = await crossStoreQuery(
      'provider_lookup',
      'resolve payment account for inbound webhook',
      () =>
        this.prisma.platform().paymentAccount.findMany({
          where:
            ref.kind === 'account_id'
              ? { id: ref.accountId }
              : {
                  connected_account_ref: ref.providerAccountRef,
                  // Scoped to the gateway named in the path: a provider
                  // reference is only unique within its own provider, and
                  // two gateways could mint the same string.
                  gateway: request.gateway as never,
                },
          select: {
            id: true,
            store_id: true,
            mode: true,
            gateway: true,
            status: true,
          },
          take: 2,
        }),
    )

    if (accounts.length === 0) {
      return { kind: 'unresolved', reason: 'unknown_account' }
    }

    if (accounts.length > 1) {
      // Two accounts answering to one provider reference means the
      // callback cannot be attributed. Applying it to either would be a
      // guess about someone's money.
      this.logger.error(
        `Webhook reference for gateway "${request.gateway}" matches more than ` +
          `one payment account; refusing to guess.`,
      )

      return { kind: 'unresolved', reason: 'ambiguous_account' }
    }

    return { kind: 'resolved', account: accounts[0], ref }
  }
}

function safeBigInt(value: string | undefined): bigint | null {
  if (value === undefined) return null

  try {
    return BigInt(value)
  } catch {
    return null
  }
}

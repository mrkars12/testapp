import type { GatewayCapabilities } from './provider.types'

/**
 * ==================================================================
 * Catalog / registry parity
 * ==================================================================
 *
 * The catalog is what a merchant is *offered*; the registry is what can
 * actually take a payment. They are separate on purpose — a gateway can
 * be listed before its adapter lands — but the ways they can disagree
 * are not equally acceptable:
 *
 *   adapter with no catalog entry   A bug. The gateway can process
 *                                   payments but no merchant can ever
 *                                   configure it, so the adapter is
 *                                   dead code that looks alive.
 *
 *   catalog entry with no adapter   Expected, and already handled:
 *                                   `PaymentAccountService.upsert`
 *                                   refuses to *enable* such a gateway.
 *                                   Worth reporting, not worth failing.
 *
 *   adapter serving a method the    A bug. The merchant can never
 *   catalog does not list           create an offering for it, so the
 *                                   capability is unreachable.
 *
 *   catalog lists a method the      A bug in the other direction: the
 *   adapter cannot serve            merchant can enable an offering
 *                                   that fails at the customer's
 *                                   checkout.
 *
 * Pure functions over plain data, so the same checks run at boot and in
 * a unit test without a Nest module or a database.
 */

export interface CatalogEntryView {
  readonly key: string
  readonly methods: readonly string[]
  readonly requires_credentials: boolean
  readonly credential_fields: readonly { readonly key: string }[]
}

export interface ParityReport {
  /** Registered adapters with no catalog entry. Always a defect. */
  readonly adaptersWithoutCatalogEntry: readonly string[]
  /** Catalog entries with no adapter. Expected while a provider is pending. */
  readonly catalogEntriesWithoutAdapter: readonly string[]
  /** Per-gateway disagreements that make a declared capability unreachable. */
  readonly methodMismatches: readonly {
    readonly gateway: string
    readonly adapterOnly: readonly string[]
    readonly catalogOnly: readonly string[]
  }[]
  /** Adapters whose credentials the merchant has no way to enter. */
  readonly credentialGaps: readonly string[]
}

export function checkGatewayParity(input: {
  catalog: readonly CatalogEntryView[]
  adapters: readonly GatewayCapabilities[]
}): ParityReport {
  const byKey = new Map(input.catalog.map((entry) => [entry.key, entry]))
  const adapterKeys = new Set(input.adapters.map((c) => c.gateway))

  const adaptersWithoutCatalogEntry = input.adapters
    .filter((c) => !byKey.has(c.gateway))
    .map((c) => c.gateway)
    .sort()

  const catalogEntriesWithoutAdapter = input.catalog
    .filter((entry) => !adapterKeys.has(entry.key))
    .map((entry) => entry.key)
    .sort()

  const methodMismatches: {
    gateway: string
    adapterOnly: string[]
    catalogOnly: string[]
  }[] = []
  const credentialGaps: string[] = []

  for (const capabilities of input.adapters) {
    const entry = byKey.get(capabilities.gateway)
    if (!entry) continue

    const catalogMethods = new Set<string>(entry.methods)
    const adapterMethods = new Set<string>(capabilities.methods)

    const adapterOnly = [...adapterMethods].filter((m) => !catalogMethods.has(m)).sort()
    const catalogOnly = [...catalogMethods].filter((m) => !adapterMethods.has(m)).sort()

    if (adapterOnly.length > 0 || catalogOnly.length > 0) {
      methodMismatches.push({
        gateway: capabilities.gateway,
        adapterOnly,
        catalogOnly,
      })
    }

    // An adapter that reaches a provider needs credentials, and the only
    // place a merchant can supply them is the catalog's field list.
    // Offline adapters are exempt: bank transfer's fields are details to
    // show the customer, and cash on delivery has none at all.
    const online = capabilities.offlineCommitmentKind === null
    const hasFields = entry.requires_credentials && entry.credential_fields.length > 0

    if (online && !hasFields) {
      credentialGaps.push(capabilities.gateway)
    }
  }

  return {
    adaptersWithoutCatalogEntry,
    catalogEntriesWithoutAdapter,
    methodMismatches,
    credentialGaps: credentialGaps.sort(),
  }
}

/**
 * The subset of parity findings that must stop a boot.
 *
 * A catalog entry awaiting its adapter is not here: that is the normal
 * state of every provider not yet built, and failing on it would mean
 * the catalog could never describe planned work.
 */
export function parityFailures(report: ParityReport): string[] {
  const failures: string[] = []

  for (const gateway of report.adaptersWithoutCatalogEntry) {
    failures.push(
      `Adapter "${gateway}" is registered but absent from the gateway catalog, ` +
        `so no merchant can configure it.`,
    )
  }

  for (const mismatch of report.methodMismatches) {
    if (mismatch.adapterOnly.length > 0) {
      failures.push(
        `Adapter "${mismatch.gateway}" serves [${mismatch.adapterOnly.join(', ')}] ` +
          `but the catalog does not offer them.`,
      )
    }

    if (mismatch.catalogOnly.length > 0) {
      failures.push(
        `Catalog offers [${mismatch.catalogOnly.join(', ')}] for "${mismatch.gateway}" ` +
          `but the adapter cannot serve them.`,
      )
    }
  }

  for (const gateway of report.credentialGaps) {
    failures.push(
      `Adapter "${gateway}" calls a provider but the catalog declares no ` +
        `credential fields for it.`,
    )
  }

  return failures
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ProviderRegistry } from './provider-registry.service'
import { parityFailures } from './gateway-parity'

/**
 * Fails the boot when the catalog and the adapters disagree.
 *
 * Separate from the registry on purpose. The registry's invariants are
 * about an adapter on its own — a claim it makes and does not back — and
 * hold for any adapter, including the synthetic ones tests register.
 * Parity is about the *shipped set*: whether a real merchant can reach
 * what is registered, and whether what a merchant can reach exists.
 *
 * A catalog entry still waiting for its adapter is logged, not thrown.
 * The catalog is allowed to describe planned providers, and
 * `PaymentAccountService.upsert` already refuses to *enable* a gateway
 * with no adapter behind it.
 */
@Injectable()
export class GatewayParityCheck implements OnModuleInit {
  private readonly logger = new Logger(GatewayParityCheck.name)

  constructor(private readonly registry: ProviderRegistry) {}

  onModuleInit(): void {
    const report = this.registry.parity()
    const failures = parityFailures(report)

    if (failures.length > 0) {
      throw new Error(`Gateway catalog/registry mismatch: ${failures.join(' ')}`)
    }

    if (report.catalogEntriesWithoutAdapter.length > 0) {
      this.logger.log(
        `Catalog gateways awaiting an adapter: ` +
          `${report.catalogEntriesWithoutAdapter.join(', ')}.`,
      )
    }
  }
}

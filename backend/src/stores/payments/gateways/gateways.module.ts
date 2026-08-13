import { Module } from '@nestjs/common'
import { PAYMENT_PROVIDERS } from './payment-provider.interface'
import { ProviderRegistry } from './provider-registry.service'
import { CodAdapter } from './adapters/cod.adapter'
import { BankTransferAdapter } from './adapters/bank-transfer.adapter'
import { StripeAdapter } from './adapters/stripe/stripe.adapter'
import {
  STRIPE_CLIENT_FACTORY,
  defaultStripeClientFactory,
} from './adapters/stripe/stripe-client'

/**
 * Gateway adapters.
 *
 * Adding a provider is: write the adapter, add it to `adapters` below,
 * add it to the PAYMENT_PROVIDERS factory. Nothing else in the codebase
 * changes.
 *
 * No dependency on PaymentsModule: adapters receive already-decrypted
 * credentials in the call context, so this module never touches the
 * credential store and there is no cycle.
 */
const adapters = [CodAdapter, BankTransferAdapter, StripeAdapter]

@Module({
    providers: [
        { provide: STRIPE_CLIENT_FACTORY, useValue: defaultStripeClientFactory },
    ...adapters,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (...instances: unknown[]) => instances,
      inject: [...adapters],
    },
    ProviderRegistry,
  ],
  exports: [ProviderRegistry],
})
export class GatewaysModule {}

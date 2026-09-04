import { Module } from '@nestjs/common'
import { PAYMENT_PROVIDERS } from './payment-provider.interface'
import { ProviderRegistry } from './provider-registry.service'
import { GatewayParityCheck } from './gateway-parity.check'
import { CredentialValidationPipeline } from './credential-validation.service'
import { CodAdapter } from './adapters/cod.adapter'
import { BankTransferAdapter } from './adapters/bank-transfer.adapter'
import { StripeAdapter } from './adapters/stripe/stripe.adapter'
import { PaymobAdapter } from './adapters/paymob/paymob.adapter'
import { MoyasarAdapter } from './adapters/moyasar/moyasar.adapter'
import { TapAdapter } from './adapters/tap/tap.adapter'
import {
  STRIPE_CLIENT_FACTORY,
  defaultStripeClientFactory,
} from './adapters/stripe/stripe-client'
import { PAYMOB_HTTP, defaultPaymobHttp } from './adapters/paymob/paymob-client'
import { MOYASAR_HTTP, defaultMoyasarHttp } from './adapters/moyasar/moyasar-client'
import { TAP_HTTP, defaultTapHttp } from './adapters/tap/tap-client'

/**
 * Gateway adapters.
 *
 * Adding a provider is: write the adapter, add it to `adapters` below,
 * add a conformance case. Nothing else in the codebase changes — the
 * PAYMENT_PROVIDERS factory injects whatever is in that array, and
 * `GatewayParityCheck` fails the boot if the catalog and the adapter
 * disagree about what the new gateway offers.
 *
 * No dependency on PaymentsModule: adapters receive already-decrypted
 * credentials in the call context, so this module never touches the
 * credential store and there is no cycle.
 */
const adapters = [
  CodAdapter,
  BankTransferAdapter,
  StripeAdapter,
  PaymobAdapter,
  MoyasarAdapter,
  TapAdapter,
]

@Module({
    providers: [
        { provide: STRIPE_CLIENT_FACTORY, useValue: defaultStripeClientFactory },
    { provide: PAYMOB_HTTP, useValue: defaultPaymobHttp },
    { provide: MOYASAR_HTTP, useValue: defaultMoyasarHttp },
    { provide: TAP_HTTP, useValue: defaultTapHttp },
    ...adapters,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (...instances: unknown[]) => instances,
      inject: [...adapters],
    },
    ProviderRegistry,
    CredentialValidationPipeline,
    GatewayParityCheck,
  ],
  exports: [ProviderRegistry, CredentialValidationPipeline],
})
export class GatewaysModule {}

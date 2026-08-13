/**
 * Narrow view of the Stripe SDK.
 *
 * The adapter depends on this instead of the SDK's own types so it can be
 * unit-tested with a plain stub. Widening it later is a deliberate act
 * rather than an accident of autocomplete.
 */
export interface StripeClientLike {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>
    retrieve(id: string, params?: Record<string, unknown>): Promise<any>
    capture(id: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>
    cancel(id: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>
  }
  refunds: {
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<any>
  }
  balance: {
    retrieve(): Promise<any>
  }
  webhooks: {
    constructEvent(payload: string | Buffer, header: string, secret: string): any
  }
}

/** DI token for the factory, so the adapter can be given a stub in tests. */
export const STRIPE_CLIENT_FACTORY = Symbol('STRIPE_CLIENT_FACTORY')

/** Builds a client from a merchant's secret key. */
export type StripeClientFactory = (secretKey: string) => StripeClientLike

/**
 * Default factory. Imported lazily so the SDK is only loaded when a
 * merchant actually has Stripe configured.
 */
export const defaultStripeClientFactory: StripeClientFactory = (secretKey) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require('stripe')
  return new Stripe(secretKey, {
    // Pinning matters: an unpinned version means Stripe can change
    // response shapes underneath a running deployment.
    apiVersion: '2024-06-20',
    maxNetworkRetries: 2,
    timeout: 20_000,
  }) as StripeClientLike
}

import {
  allowedCredentialKeys,
  allowedMethods,
  findGateway,
  isSupportedGateway,
  listGateways,
} from './gateway-catalog'

// enum PaymentProviderKey values that exist in the database
const PROVIDER_KEYS = [
  'stripe','paymob','fawry','paytabs','tap','moyasar','hyperpay','checkout_com',
  'my_fatoorah','telr','opay','kashier','geidea','xpay','fawaterk','easykash',
  'amazon_payment_services','tabby','tamara','cod','bank_transfer',
]

// enum PaymentMethodKey values declared in schema.prisma
const METHOD_KEYS = [
  'card','mada','knet','benefit','apple_pay','google_pay','wallet','kiosk',
  'bank_transfer','cod','bnpl',
]

describe('gateway catalog', () => {
  it('every gateway key is a valid PaymentProviderKey enum value', () => {
    for (const g of listGateways()) {
      expect(PROVIDER_KEYS).toContain(g.key)
    }
  })

  it('every declared method is a valid PaymentMethodKey enum value', () => {
    for (const g of listGateways()) {
      for (const m of g.methods) expect(METHOD_KEYS).toContain(m)
    }
  })

  it('gateway keys are unique', () => {
    const keys = listGateways().map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('credential field keys are unique within a gateway', () => {
    for (const g of listGateways()) {
      const keys = g.credential_fields.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('gateways requiring credentials declare at least one field', () => {
    for (const g of listGateways()) {
      if (g.requires_credentials) expect(g.credential_fields.length).toBeGreaterThan(0)
      else expect(g.credential_fields).toHaveLength(0)
    }
  })

  it('every gateway offers at least one method', () => {
    for (const g of listGateways()) expect(g.methods.length).toBeGreaterThan(0)
  })

  it('resolves and rejects lookups', () => {
    expect(findGateway('stripe')?.name_en).toBe('Stripe')
    expect(findGateway('nope')).toBeUndefined()
    expect(isSupportedGateway('cod')).toBe(true)
    expect(isSupportedGateway('nope')).toBe(false)
  })

  it('exposes allow-lists used for input validation', () => {
    expect(allowedCredentialKeys('stripe')).toContain('secret_key')
    expect(allowedCredentialKeys('cod')).toHaveLength(0)
    expect(allowedCredentialKeys('nope')).toHaveLength(0)
    expect(allowedMethods('paymob')).toEqual(
      expect.arrayContaining(['card', 'wallet', 'kiosk']),
    )
  })

  it('marks paymob as multi-integration and stripe as single', () => {
    expect(findGateway('paymob')?.supports_multiple_integrations).toBe(true)
    expect(findGateway('stripe')?.supports_multiple_integrations).toBe(false)
  })

  it('manual gateways have no test mode', () => {
    expect(findGateway('cod')?.supports_test_mode).toBe(false)
    expect(findGateway('bank_transfer')?.supports_test_mode).toBe(false)
  })
})

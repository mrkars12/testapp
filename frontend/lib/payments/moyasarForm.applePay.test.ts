import { describe, expect, it, vi } from 'vitest'
import { mountMoyasarForm, readFormConfig } from './moyasarForm'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Apple Pay options, on their way to the provider's form
 *
 * The failure mode being guarded is specific and severe: Moyasar's form
 * THROWS on mount when `applepay` is among its methods and any of
 * `apple_pay_label`, `apple_pay_country` or
 * `apple_pay_validate_merchant_url` is missing or malformed. A throw is
 * not a missing Apple Pay button — the whole form fails to mount and the
 * payer is left with no card fields either.
 *
 * So the rule this file pins down is "all three or none", enforced on
 * our side of the boundary as well as the backend's, because this is the
 * last code that runs before a third party's `init()`.
 * ══════════════════════════════════════════════════════════════════════
 */

/** The client-safe config the backend sends for the embedded form. */
const BASE = {
  amount: 5000,
  currency: 'SAR',
  description: 'Order 1',
  callback_url: 'https://shop.example/stores/dartpay/checkout?token=abc',
  methods: ['creditcard'],
  metadata: { intent_id: '1' },
}

const APPLE_PAY = {
  apple_pay_label: 'Dart Store',
  apple_pay_country: 'SA',
  apple_pay_validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate',
}

describe('readFormConfig — Apple Pay options', () => {
  it('passes a complete Apple Pay configuration through', () => {
    const config = readFormConfig({
      ...BASE,
      methods: ['creditcard', 'applepay'],
      ...APPLE_PAY,
    })

    expect(config?.methods).toEqual(['creditcard', 'applepay'])
    expect(config?.applePayOptions).toEqual(APPLE_PAY)
  })

  it('passes the optional lists through when present', () => {
    const config = readFormConfig({
      ...BASE,
      ...APPLE_PAY,
      apple_pay_supported_countries: ['SA', 'AE'],
      apple_pay_merchant_capabilities: ['supports3DS'],
    })

    expect(config?.applePayOptions.apple_pay_supported_countries).toEqual(['SA', 'AE'])
    expect(config?.applePayOptions.apple_pay_merchant_capabilities).toEqual(['supports3DS'])
  })

  it('drops a partial Apple Pay configuration entirely', () => {
    // Half of it is what makes the form throw, so half reads as none.
    const config = readFormConfig({ ...BASE, apple_pay_label: 'Dart Store' })

    expect(config?.applePayOptions).toEqual({})
  })

  it('rejects a country the provider form would reject', () => {
    const config = readFormConfig({
      ...BASE,
      ...APPLE_PAY,
      apple_pay_country: 'Saudi Arabia',
    })

    expect(config?.applePayOptions).toEqual({})
  })

  it('refuses a non-HTTPS merchant validation URL', () => {
    // This URL receives our publishable key and returns the object that
    // authorises an Apple Pay sheet in our name. Plaintext is not an
    // option, whatever the backend sent.
    const config = readFormConfig({
      ...BASE,
      ...APPLE_PAY,
      apple_pay_validate_merchant_url: 'http://api.moyasar.com/v1/applepay/initiate',
    })

    expect(config?.applePayOptions).toEqual({})
  })

  it('copies only the Apple Pay keys it knows', () => {
    // The object is handed straight to a third party's init(). Anything
    // the backend adds later must not silently become form configuration.
    const config = readFormConfig({
      ...BASE,
      ...APPLE_PAY,
      apple_pay_something_new: 'surprise',
      unrelated: 'value',
    })

    expect(Object.keys(config?.applePayOptions ?? {}).sort()).toEqual([
      'apple_pay_country',
      'apple_pay_label',
      'apple_pay_validate_merchant_url',
    ])
  })

  it('leaves a card-only config with no Apple Pay options at all', () => {
    const config = readFormConfig(BASE)
    expect(config?.applePayOptions).toEqual({})
  })
})

describe('mountMoyasarForm', () => {
  it('spreads the Apple Pay options as top-level form options', () => {
    // Moyasar's contract is flat: `apple_pay_label`, not
    // `apple_pay: { label }`. Nesting them is a silent no-op that ends
    // as "Apple Pay label is required".
    const init = vi.fn()
    const config = readFormConfig({
      ...BASE,
      methods: ['creditcard', 'applepay'],
      ...APPLE_PAY,
    })!

    mountMoyasarForm({ init }, '#host', 'pk_test_key', config)

    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0][0]).toMatchObject({
      methods: ['creditcard', 'applepay'],
      apple_pay_label: 'Dart Store',
      apple_pay_country: 'SA',
      apple_pay_validate_merchant_url:
        'https://api.moyasar.com/v1/applepay/initiate',
    })
  })

  it('forwards the merchant’s own card networks to the form', () => {
    // `supported_networks` belongs to the card component and defaults to
    // ["amex","mada","visa","mastercard"]. Dropping the backend's list
    // is what showed a mada badge to a merchant who never enabled mada.
    const init = vi.fn()
    const config = readFormConfig({
      ...BASE,
      supported_networks: ['visa', 'mastercard', 'amex'],
    })!

    mountMoyasarForm({ init }, '#host', 'pk_test_key', config)

    expect(init.mock.calls[0][0]).toMatchObject({
      supported_networks: ['visa', 'mastercard', 'amex'],
    })
  })

  it('leaves the provider default alone when the backend sent no list', () => {
    // The merchant Test Payment tool groups nothing, so the backend
    // omits the option entirely. Sending an empty array instead would
    // be a form that accepts no card at all.
    const init = vi.fn()
    mountMoyasarForm({ init }, '#host', 'pk_test_key', readFormConfig(BASE)!)

    expect('supported_networks' in (init.mock.calls[0][0] as object)).toBe(false)
  })

  it('ignores a malformed network list rather than forwarding it', () => {
    const init = vi.fn()
    const config = readFormConfig({ ...BASE, supported_networks: 'visa,mada' })!

    mountMoyasarForm({ init }, '#host', 'pk_test_key', config)

    expect('supported_networks' in (init.mock.calls[0][0] as object)).toBe(false)
  })

  it('sends no Apple Pay keys for a card-only form', () => {
    const init = vi.fn()
    mountMoyasarForm({ init }, '#host', 'pk_test_key', readFormConfig(BASE)!)

    const options = init.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(options).some((key) => key.startsWith('apple_pay'))).toBe(
      false,
    )
  })
})

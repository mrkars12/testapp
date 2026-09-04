import { describe, it, expect } from 'vitest'
import { resolvePaymentAction } from './actions'

/**
 * The dispatcher is the single place provider differences are resolved,
 * so these assert over *action kinds*, never gateway names. The four
 * shapes below are exactly what the six in-scope adapters emit today.
 */
describe('resolvePaymentAction dispatches on the normalized action kind', () => {
  it('resolves a GET redirect (Stripe Checkout Session, Paymob, Moyasar, Tap)', () => {
    const action = resolvePaymentAction({
      next_action: { kind: 'redirect', url: 'https://gateway.example/pay/1', method: 'GET' },
    })
    expect(action).toEqual({
      kind: 'redirect',
      url: 'https://gateway.example/pay/1',
      method: 'GET',
      formFields: undefined,
    })
  })

  it('resolves a POST redirect with its form fields', () => {
    const action = resolvePaymentAction({
      next_action: {
        kind: 'redirect',
        url: 'https://gateway.example/pay',
        method: 'POST',
        form_fields: { token: 'abc' },
      },
    })
    expect(action).toMatchObject({ kind: 'redirect', method: 'POST', formFields: { token: 'abc' } })
  })

  it('defaults an unspecified redirect method to GET rather than guessing POST', () => {
    const action = resolvePaymentAction({
      next_action: { kind: 'redirect', url: 'https://gateway.example/pay' },
    })
    expect(action).toMatchObject({ method: 'GET' })
  })

  it('resolves bank_instructions from a nested `fields` object', () => {
    const action = resolvePaymentAction({
      next_action: { kind: 'bank_instructions', fields: { IBAN: 'SA00', Bank: 'Al Rajhi' } },
    })
    expect(action).toEqual({ kind: 'bank_instructions', fields: { IBAN: 'SA00', Bank: 'Al Rajhi' } })
  })

  it('resolves bank_instructions when the payload is inlined beside `kind`', () => {
    // The response builder flattens the payload alongside `kind`, so the
    // transport keys have to be stripped without eating real instructions.
    const action = resolvePaymentAction({
      next_action: { kind: 'bank_instructions', IBAN: 'SA00', Bank: 'Al Rajhi' },
    })
    expect(action).toEqual({ kind: 'bank_instructions', fields: { IBAN: 'SA00', Bank: 'Al Rajhi' } })
  })

  it('resolves COD to `none` when next_action is null', () => {
    expect(resolvePaymentAction({ next_action: null })).toEqual({ kind: 'none' })
  })

  it('resolves an explicit `none` kind to `none`', () => {
    expect(resolvePaymentAction({ next_action: { kind: 'none' } })).toEqual({ kind: 'none' })
  })

  it('prefers a real next_action over the flattened payment_redirect_url', () => {
    // Reading the convenience field first is how bank instructions used to
    // get silently downgraded to a redirect and dropped on the floor.
    const action = resolvePaymentAction({
      next_action: { kind: 'bank_instructions', fields: { IBAN: 'SA00' } },
      payment_redirect_url: 'https://gateway.example/should-not-be-used',
    })
    expect(action.kind).toBe('bank_instructions')
  })

  it('falls back to payment_redirect_url only when there is no next_action', () => {
    const action = resolvePaymentAction({
      next_action: null,
      payment_redirect_url: 'https://gateway.example/legacy',
    })
    expect(action).toEqual({ kind: 'redirect', url: 'https://gateway.example/legacy', method: 'GET' })
  })

  it('parses a client_sdk action into what the in-page form needs', () => {
    // The embedded path: the provider's own form is mounted in the
    // checkout from exactly these values, so each one is asserted rather
    // than the shape as a whole.
    const action = resolvePaymentAction({
      next_action: {
        kind: 'client_sdk',
        publishable_key: 'pk_test_1',
        config: {
          amount: 10000,
          currency: 'SAR',
          callback_url: 'https://shop.test/stores/shop1/checkout?token=abc',
          methods: ['creditcard'],
        },
        sdk_hints: { form_version: '1.19.0' },
      },
    })
    expect(action).toEqual({
      kind: 'client_sdk',
      clientSecret: null,
      publishableKey: 'pk_test_1',
      config: {
        amount: 10000,
        currency: 'SAR',
        callback_url: 'https://shop.test/stores/shop1/checkout?token=abc',
        methods: ['creditcard'],
      },
      sdkHints: { form_version: '1.19.0' },
    })
  })

  it('still reads a publishable key a backend put only in the sdk hints', () => {
    // The older placement. Falling back keeps an embedded payment
    // working against a backend that has not been redeployed yet.
    const action = resolvePaymentAction({
      next_action: {
        kind: 'client_sdk',
        client_secret: 'pi_1_secret_x',
        sdk_hints: { publishable_key: 'pk_test_1' },
      },
    })
    expect(action).toMatchObject({
      kind: 'client_sdk',
      clientSecret: 'pi_1_secret_x',
      publishableKey: 'pk_test_1',
    })
  })

  it('marks an unhandled kind as `unsupported` instead of silently succeeding', () => {
    // `iframe`/`reference_code`/`poll` are declared but emitted by nothing.
    // Falling through to `none` would render "order placed" for a payment
    // that never happened.
    expect(resolvePaymentAction({ next_action: { kind: 'iframe', url: 'x' } })).toEqual({
      kind: 'unsupported',
      rawKind: 'iframe',
    })
  })

  it('treats a redirect with no URL as unsupported, never as a silent success', () => {
    expect(resolvePaymentAction({ next_action: { kind: 'redirect' } })).toMatchObject({
      kind: 'unsupported',
    })
  })
})

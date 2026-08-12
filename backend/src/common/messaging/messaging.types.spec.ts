import { OutboxPayloadError, assertPayloadIsSafe } from './messaging.types'

describe('payload safety', () => {
  it('accepts identifiers and state', () => {
    expect(() =>
      assertPayloadIsSafe({ orderId: '1', status: 'paid', amountMinor: '1050' }),
    ).not.toThrow()
  })

  it('rejects secret-looking keys at any depth', () => {
    expect(() => assertPayloadIsSafe({ secret_key: 'x' })).toThrow(
      OutboxPayloadError,
    )
    expect(() => assertPayloadIsSafe({ a: { b: { api_key: 'x' } } })).toThrow(
      OutboxPayloadError,
    )
    expect(() => assertPayloadIsSafe({ list: [{ credentials: {} }] })).toThrow(
      OutboxPayloadError,
    )
    expect(() => assertPayloadIsSafe({ CardNumber: '4242' })).toThrow(
      OutboxPayloadError,
    )
  })

  it('tolerates primitives and null', () => {
    expect(() => assertPayloadIsSafe(null)).not.toThrow()
    expect(() => assertPayloadIsSafe('x')).not.toThrow()
    expect(() => assertPayloadIsSafe(42)).not.toThrow()
  })
})

describe('payload safety — key normalization', () => {
  it('still blocks an exact short token', () => {
    expect(() => assertPayloadIsSafe({ pan: '4242' })).toThrow(OutboxPayloadError)
    expect(() => assertPayloadIsSafe({ PAN: '4242' })).toThrow(OutboxPayloadError)
  })

  it('catches camelCase, kebab-case and spaced variants', () => {
    for (const key of [
      'cardNumber', 'card-number', 'CARD NUMBER',
      'apiKey', 'api-key', 'ApiKey',
      'secretKey', 'privateKey', 'credentialsEncrypted',
    ]) {
      expect(() => assertPayloadIsSafe({ [key]: 'x' })).toThrow(OutboxPayloadError)
    }
  })

  it('still allows innocuous keys', () => {
    for (const key of [
      'orderId', 'card_brand_label', 'checkoutId', 'amountMinor',
      // رموز قصيرة كانت بتتمنع بالغلط قبل التشديد
      'expandedItems', 'companyPanel', 'panel_id', 'spanClass',
    ]) {
      expect(() => assertPayloadIsSafe({ [key]: 'x' })).not.toThrow()
    }
  })
})

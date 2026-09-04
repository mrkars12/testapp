import {
  mapPaymobError,
  paymobErrorMessage,
  paymobErrorText,
} from './paymob-error-map'
import { DOCUMENTED_ERRORS } from './paymob-fixtures'
import {
  classifyPaymentError,
  isPaymentErrorCode,
} from '../../provider.types'

describe('documented errors', () => {
  it('maps an unknown integration id to a configuration problem', () => {
    // The merchant's integration ID is wrong, is for the other mode, or
    // is not configured — all merchant configuration, none of it
    // retryable and none of it the customer's fault.
    expect(
      mapPaymobError({ status: 404, body: DOCUMENTED_ERRORS.unknownIntegration }),
    ).toBe('configuration_error')
  })

  it('maps the field-required bodies to a configuration problem', () => {
    for (const body of [
      DOCUMENTED_ERRORS.missingItemName,
      DOCUMENTED_ERRORS.missingPhone,
    ]) {
      expect(mapPaymobError({ status: 400, body })).toBe('configuration_error')
    }
  })

  it('maps an over-large refund to an amount limit', () => {
    expect(
      mapPaymobError({ status: 400, body: DOCUMENTED_ERRORS.refundTooLarge }),
    ).toBe('amount_limit')
  })

  it('maps an over-large capture to an amount limit', () => {
    expect(
      mapPaymobError({ status: 400, body: DOCUMENTED_ERRORS.captureTooLarge }),
    ).toBe('amount_limit')
  })

  it('maps an invalid transaction id to a configuration problem', () => {
    expect(
      mapPaymobError({ status: 404, body: DOCUMENTED_ERRORS.invalidTransaction }),
    ).toBe('configuration_error')
  })
})

describe('undocumented failures', () => {
  it('reads a rejected key from the status', () => {
    expect(mapPaymobError({ status: 401, body: null })).toBe('configuration_error')
    expect(mapPaymobError({ status: 403, body: null })).toBe('configuration_error')
  })

  it('reads throttling and outages from the status', () => {
    expect(mapPaymobError({ status: 429, body: null })).toBe('rate_limited')
    expect(mapPaymobError({ status: 500, body: null })).toBe('provider_unavailable')
    expect(mapPaymobError({ status: 502, body: null })).toBe('provider_unavailable')
  })

  it('does not guess a decline for a 4xx it has no documentation for', () => {
    // Telling a customer to try another card for a fault of ours is
    // worse than admitting we do not know.
    const code = mapPaymobError({ status: 422, body: { detail: 'something new' } })

    expect(code).toBe('unknown')
    expect(classifyPaymentError(code).customerActionable).toBe(false)
  })
})

describe('classification', () => {
  it('produces codes the retry and failover policies understand', () => {
    const bodies = Object.values(DOCUMENTED_ERRORS)

    for (const body of bodies) {
      const code = mapPaymobError({ status: 400, body })

      expect(isPaymentErrorCode(code)).toBe(true)

      const classification = classifyPaymentError(code)
      expect(typeof classification.retryable).toBe('boolean')
      expect(typeof classification.failover).toBe('boolean')
      expect(typeof classification.customerActionable).toBe('boolean')
    }
  })

  it('does not make a merchant configuration error retryable', () => {
    // Retrying a wrong integration ID just wastes the customer's time.
    expect(classifyPaymentError('configuration_error').retryable).toBe(false)
    // But it is worth trying another account, if one is configured.
    expect(classifyPaymentError('configuration_error').failover).toBe(true)
  })

  it('makes an outage retryable', () => {
    expect(classifyPaymentError('provider_unavailable').retryable).toBe(true)
  })
})

describe('messages', () => {
  it('reads the documented body shapes', () => {
    expect(paymobErrorMessage(DOCUMENTED_ERRORS.refundTooLarge)).toContain(
      'maximum refund amount',
    )
    expect(paymobErrorMessage(DOCUMENTED_ERRORS.captureTooLarge)).toBe(
      'Capture amount cannot exceed auth amount',
    )
  })

  it('flattens the field-error maps', () => {
    expect(paymobErrorMessage(DOCUMENTED_ERRORS.missingPhone)).toBe(
      'billing_data.phone_number: This field is required.',
    )
  })

  it('always says something, even for an empty body', () => {
    expect(paymobErrorText({ status: 500, body: null })).toBe(
      'Paymob returned 500.',
    )
  })

  it('carries only the provider text, never our request', () => {
    // The request body holds customer data and the headers hold the
    // secret key; neither is ever assembled into an error.
    const text = paymobErrorText({ status: 400, body: DOCUMENTED_ERRORS.captureTooLarge })

    expect(text).toContain('Paymob returned 400')
    expect(text).toContain('Capture amount cannot exceed auth amount')
  })

  it('truncates a long provider message', () => {
    const text = paymobErrorText({ status: 400, body: { detail: 'x'.repeat(1000) } })

    expect(text.length).toBeLessThan(400)
  })
})

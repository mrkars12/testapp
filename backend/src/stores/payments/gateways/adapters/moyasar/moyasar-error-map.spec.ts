import {
  mapMoyasarError,
  moyasarErrorMessage,
  moyasarErrorText,
  moyasarErrorType,
} from './moyasar-error-map'
import { DOCUMENTED_ERRORS } from './moyasar-fixtures'
import { classifyPaymentError, isPaymentErrorCode } from '../../provider.types'

describe('documented error types', () => {
  it('maps each published type to a code core understands', () => {
    const expected: Record<string, string> = {
      invalid_request_error: 'configuration_error',
      authentication_error: 'configuration_error',
      rate_limit_error: 'rate_limited',
      api_connection_error: 'provider_unavailable',
      account_inactive_error: 'configuration_error',
      api_error: 'provider_unavailable',
      '3ds_auth_error': 'authentication_failed',
    }

    for (const [type, code] of Object.entries(expected)) {
      expect(mapMoyasarError({ status: 400, body: { type } })).toBe(code)
    }
  })

  it('maps the documented invalid-key body', () => {
    expect(
      mapMoyasarError({ status: 401, body: DOCUMENTED_ERRORS.invalidKey }),
    ).toBe('configuration_error')
  })

  it('maps the documented validation body', () => {
    expect(
      mapMoyasarError({ status: 400, body: DOCUMENTED_ERRORS.validationFailed }),
    ).toBe('configuration_error')
  })

  it("maps the invoice endpoint's shorter type spelling", () => {
    // The Create Invoice 400 example says `invalid_request` where the
    // Errors page says `invalid_request_error`. Both are documented.
    expect(
      mapMoyasarError({ status: 400, body: DOCUMENTED_ERRORS.invalidRequest }),
    ).toBe('configuration_error')
  })

  it('treats a failed 3DS attempt as something the customer can act on', () => {
    // "failed due unauthorized attempt by the cardholder" — trying again,
    // or another card, is the right advice.
    const code = mapMoyasarError({ status: 400, body: { type: '3ds_auth_error' } })

    expect(classifyPaymentError(code).customerActionable).toBe(true)
    expect(classifyPaymentError(code).retryable).toBe(false)
  })
})

describe('undocumented bodies fall back to the documented statuses', () => {
  it('reads a rejected key from the status', () => {
    expect(mapMoyasarError({ status: 401, body: null })).toBe('configuration_error')
    expect(mapMoyasarError({ status: 403, body: null })).toBe('configuration_error')
  })

  it('reads an unactivated live account from 405', () => {
    // "405 Method Not Allowed – Entity not activated to use live
    // account" — a merchant configuration problem, not a method error.
    expect(mapMoyasarError({ status: 405, body: null })).toBe('configuration_error')
  })

  it('reads throttling and outages from the status', () => {
    expect(mapMoyasarError({ status: 429, body: null })).toBe('rate_limited')
    expect(mapMoyasarError({ status: 500, body: null })).toBe('provider_unavailable')
    expect(mapMoyasarError({ status: 503, body: null })).toBe('provider_unavailable')
  })

  it('does not guess a decline for a status it has no documentation for', () => {
    const code = mapMoyasarError({ status: 418, body: {} })

    expect(code).toBe('unknown')
    expect(classifyPaymentError(code).customerActionable).toBe(false)
  })
})

describe('classification', () => {
  it('produces codes the retry and failover policies understand', () => {
    for (const body of Object.values(DOCUMENTED_ERRORS)) {
      const code = mapMoyasarError({ status: 400, body })

      expect(isPaymentErrorCode(code)).toBe(true)

      const classification = classifyPaymentError(code)
      expect(typeof classification.retryable).toBe('boolean')
      expect(typeof classification.failover).toBe('boolean')
      expect(typeof classification.customerActionable).toBe('boolean')
    }
  })

  it('makes an outage retryable and a bad key not', () => {
    expect(classifyPaymentError('provider_unavailable').retryable).toBe(true)
    expect(classifyPaymentError('configuration_error').retryable).toBe(false)
  })
})

describe('messages', () => {
  it('reads the documented body shape', () => {
    expect(moyasarErrorType(DOCUMENTED_ERRORS.invalidKey)).toBe('authentication_error')
    expect(moyasarErrorMessage(DOCUMENTED_ERRORS.invalidKey)).toBe(
      'Invalid authorization credentials',
    )
  })

  it('flattens the field validation errors so the merchant sees the field', () => {
    expect(moyasarErrorMessage(DOCUMENTED_ERRORS.validationFailed)).toBe(
      'Validation Failed; amount: must be an integer',
    )
  })

  it('always says something, even for an empty body', () => {
    expect(moyasarErrorText({ status: 500, body: null })).toBe(
      'Moyasar returned 500.',
    )
  })

  it('truncates a long provider message', () => {
    const text = moyasarErrorText({ status: 400, body: { message: 'x'.repeat(1000) } })

    expect(text.length).toBeLessThan(400)
  })
})

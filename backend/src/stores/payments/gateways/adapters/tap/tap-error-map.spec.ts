import {
  mapTapError,
  mapTapResponseCode,
  tapErrorCode,
  tapErrorMessage,
  tapErrorText,
} from './tap-error-map'
import { DOCUMENTED_ERRORS } from './tap-fixtures'
import {
  PAYMENT_ERROR_CODES,
  isCustomerActionable,
  isRetryable,
  shouldFailover,
} from '../../provider.types'

/**
 * Tap's two error surfaces → the closed taxonomy.
 *
 * The codes asserted here are Tap's own published ones: the
 * `errors[].code` values from the Error Handling reference and the
 * Create-a-Charge 400 example, and the whole Charge Response Codes
 * table.
 */

describe('reading a documented error body', () => {
  it('finds the code and the description', () => {
    expect(tapErrorCode(DOCUMENTED_ERRORS.unableToProcess)).toBe('1125')
    expect(tapErrorMessage(DOCUMENTED_ERRORS.missingAuthorization)).toBe(
      '7022: Missing required header: authorization',
    )
  })

  it('is empty for a body that is not Tap’s error shape', () => {
    expect(tapErrorCode(null)).toBe('')
    expect(tapErrorCode({})).toBe('')
    expect(tapErrorCode({ errors: 'nope' })).toBe('')
    expect(tapErrorMessage(undefined)).toBe('')
  })
})

describe('mapTapError', () => {
  it('maps the documented error codes', () => {
    // 7022 Invalid_Data — missing authorization header, bad field.
    expect(
      mapTapError({ status: 400, body: DOCUMENTED_ERRORS.missingAuthorization }),
    ).toBe('configuration_error')

    // 7017 Not_Found.
    expect(mapTapError({ status: 400, body: DOCUMENTED_ERRORS.notFound })).toBe(
      'configuration_error',
    )

    // 1125 — "verify your payment method or card details and try again".
    expect(
      mapTapError({ status: 400, body: DOCUMENTED_ERRORS.unableToProcess }),
    ).toBe('declined_card_invalid')
  })

  it('falls back to the HTTP status when the code is not one Tap documents', () => {
    expect(mapTapError({ status: 401, body: null })).toBe('configuration_error')
    expect(mapTapError({ status: 403, body: null })).toBe('configuration_error')
    expect(mapTapError({ status: 404, body: null })).toBe('configuration_error')
    expect(mapTapError({ status: 429, body: null })).toBe('rate_limited')
    expect(mapTapError({ status: 500, body: null })).toBe('provider_unavailable')
    expect(mapTapError({ status: 503, body: null })).toBe('provider_unavailable')
  })

  it('does not guess a decline out of an undocumented response', () => {
    // Declines never arrive here at all: they come back as a 2xx charge
    // whose status is DECLINED.
    expect(mapTapError({ status: 418, body: null })).toBe('unknown')
  })

  it('keeps only Tap’s own text in the message', () => {
    expect(
      tapErrorText({ status: 400, body: DOCUMENTED_ERRORS.notFound }),
    ).toBe('Tap returned 400: 7017: No matching order found for order.id')

    expect(tapErrorText({ status: 502, body: null })).toBe('Tap returned 502.')
  })
})

describe('mapTapResponseCode', () => {
  it('maps the published decline reasons onto codes the customer can act on', () => {
    expect(mapTapResponseCode('505')).toBe('declined_insufficient_funds') // Insufficient Funds
    expect(mapTapResponseCode('502')).toBe('declined_card_invalid') // Incorrect CSC/CVV
    expect(mapTapResponseCode('407')).toBe('declined_card_invalid') // Expired Card
    expect(mapTapResponseCode('501')).toBe('declined_do_not_honor') // Declined
  })

  it('maps the published authentication reasons', () => {
    expect(mapTapResponseCode('503')).toBe('authentication_failed') // 3DS Incorrect
    expect(mapTapResponseCode('504')).toBe('authentication_required') // Card not Enrolled
    expect(mapTapResponseCode('516')).toBe('authentication_failed') // Authentication Failed
  })

  it('maps the published transport and risk reasons', () => {
    expect(mapTapResponseCode('508')).toBe('provider_timeout') // Issuer - No Reply
    expect(mapTapResponseCode('801')).toBe('provider_timeout') // Timed Out
    expect(mapTapResponseCode('513')).toBe('provider_unavailable') // Acquirer - Error
    expect(mapTapResponseCode('514')).toBe('declined_risk') // Issuer - Risk Check
    expect(mapTapResponseCode('702')).toBe('rate_limited') // Retry Limit Exceeded
    expect(mapTapResponseCode('403')).toBe('duplicate_request') // Failed, Duplicate
    expect(mapTapResponseCode('402')).toBe('configuration_error') // Invalid Parameter
    expect(mapTapResponseCode('506')).toBe('method_unavailable') // Type Not Supported
  })

  it('does not invent a meaning for a code Tap has not published', () => {
    expect(mapTapResponseCode('999')).toBe('unknown')
    expect(mapTapResponseCode(undefined)).toBe('unknown')
  })

  it('only ever produces codes in the closed taxonomy', () => {
    // Every code on Tap's published table, so a new mapping cannot
    // introduce a string the orchestrator cannot classify.
    const published = [
      '301', '302', '303', '304',
      '401', '402', '403', '404', '405', '406', '407', '408',
      '501', '502', '503', '504', '505', '506', '507', '508', '509',
      '510', '511', '512', '513', '514', '515', '516',
      '701', '702', '703', '704',
      '801', '901',
    ]

    for (const code of published) {
      const mapped = mapTapResponseCode(code)

      expect(PAYMENT_ERROR_CODES).toContain(mapped)
      // Retry, failover and customer messaging all key off these.
      expect(typeof isRetryable(mapped)).toBe('boolean')
      expect(typeof shouldFailover(mapped)).toBe('boolean')
      expect(typeof isCustomerActionable(mapped)).toBe('boolean')
    }
  })
})

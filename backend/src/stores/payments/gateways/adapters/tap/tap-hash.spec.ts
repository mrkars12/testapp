import { createHmac } from 'crypto'
import {
  hashMatches,
  tapHash,
  tapHashFields,
  tapHashString,
} from './tap-hash'
import {
  AUTHORIZED_CALLBACK,
  CANCELLED_CHARGE,
  CAPTURED_CHARGE_CALLBACK,
  REFUND_RESPONSE,
} from './tap-fixtures'

/**
 * The `hashstring` scheme, against Tap's own documented recipe.
 *
 * The expected values here are not transcribed from Tap — Tap publishes
 * the algorithm, not a worked digest — so they are recomputed with
 * Node's own HMAC from the concatenation the documentation spells out.
 * What the assertions actually pin down is that this module builds the
 * *string* Tap describes, character for character, which is the part
 * that is easy to get wrong and impossible to debug from a live 401.
 */

/*
 * A DETERMINISTIC, NON-CREDENTIAL TEST SECRET.
 *
 * This used to be the sample key printed in Tap's own API
 * documentation. It was not a live credential and never was one, but
 * it had the shape of a provider test secret key, so GitHub Push
 * Protection refused any push containing it and every secret scanner
 * looking at this repository flagged it, forever. The literal is
 * deliberately not repeated here — quoting it would reintroduce
 * exactly the string that has to stay out of this history.
 *
 * Nothing depends on the SUFFIX: every hash in these specs is recomputed
 * at runtime with Node's own HMAC from whatever this string is, so the
 * assertions pin the ALGORITHM, not a transcribed digest.
 *
 * The `sk_test_` PREFIX is load-bearing and must stay — `TapAdapter`
 * derives test/live mode from it (`key.startsWith(own)`), which is what
 * the `mode_mismatch` specs exercise. What was removed is the 24
 * characters of key-shaped entropy after it, which is the only part a
 * scanner reacts to; the short, obviously-fake `sk_test_` values that
 * were already in this file have never been flagged.
 */
const SECRET = 'sk_test_fixture'

describe('tapHashString', () => {
  it('is the documented concatenation, in the documented order', () => {
    // $toBeHashedString = 'x_id' . $id . 'x_amount' . $amount .
    //   'x_currency' . $currency . 'x_gateway_reference' . $gateway_reference .
    //   'x_payment_reference' . $payment_reference . 'x_status' . $status .
    //   'x_created' . $created . '';
    expect(
      tapHashString({
        id: 'chg_1',
        amount: '1.00',
        currency: 'SAR',
        gatewayReference: 'gw_1',
        paymentReference: 'pay_1',
        status: 'CAPTURED',
        created: '1698392202943',
      }),
    ).toBe(
      'x_idchg_1x_amount1.00x_currencySARx_gateway_referencegw_1' +
        'x_payment_referencepay_1x_statusCAPTUREDx_created1698392202943',
    )
  })
})

describe('tapHashFields', () => {
  it('reads a posted charge exactly as documented', () => {
    // id, amount (rounded to standard decimals), currency,
    // reference.gateway, reference.payment, status, transaction.created.
    expect(tapHashFields(CAPTURED_CHARGE_CALLBACK)).toEqual({
      id: 'chg_TS05A4120230736x9K22710693',
      amount: '1.00',
      currency: 'SAR',
      gatewayReference: 'mada_pg70983e7a-a686-40ba-83e2-c5e9f4074fe5',
      paymentReference: '4327230736106619650',
      status: 'CAPTURED',
      created: '1698392202943',
    })
  })

  it('reads a posted authorize from the same fields', () => {
    expect(tapHashFields(AUTHORIZED_CALLBACK)).toEqual({
      id: 'auth_TS04A1720230745Rt2a2710607',
      amount: '100.00',
      currency: 'SAR',
      gatewayReference: '123456789',
      paymentReference: '2027230745109668360',
      status: 'AUTHORIZED',
      created: '1698392719404',
    })
  })

  it('takes a refund’s created from the top level, not from transaction', () => {
    // "created: charge.transaction.created or authorize.transaction.created
    //  or refunud.created or invoice.created" — a refund keeps it at the
    // top level, and reading the wrong one produces a hash that never
    // matches.
    const fields = tapHashFields(REFUND_RESPONSE)

    expect(fields?.created).toBe('1723481040882')
    expect(fields?.amount).toBe('3.00')
    expect(fields?.id).toBe('re_xxxx')
  })

  it('passes an empty gateway reference when Tap sent none', () => {
    // "If value is not available, please pass empty value."
    const { reference, ...rest } = CANCELLED_CHARGE
    const withoutGateway = {
      ...rest,
      reference: { ...reference, gateway: undefined },
    }

    expect(tapHashFields(withoutGateway)?.gatewayReference).toBe('')
  })

  it('rounds a three-decimal amount to three places', () => {
    expect(tapHashFields(CANCELLED_CHARGE)?.amount).toBe('1.000')
  })

  it('returns null when there is nothing verifiable to hash', () => {
    // Runs on unverified bytes; it must never throw.
    expect(tapHashFields(null)).toBeNull()
    expect(tapHashFields('a string')).toBeNull()
    expect(tapHashFields({})).toBeNull()
    expect(tapHashFields({ id: 'chg_1' })).toBeNull()
    expect(tapHashFields({ id: 'chg_1', amount: 1, currency: 'ZZZ' })).toBeNull()
  })
})

describe('tapHash', () => {
  it('is HMAC-SHA256 of the documented string, keyed by the secret API key', () => {
    // $myHashString = hash_hmac('sha256', $toBeHashedString, $SecretAPIKey);
    const fields = tapHashFields(CAPTURED_CHARGE_CALLBACK)!

    expect(tapHash(fields, SECRET)).toBe(
      createHmac('sha256', SECRET)
        .update(tapHashString(fields), 'utf8')
        .digest('hex'),
    )
  })

  it('changes when any signed field changes', () => {
    const fields = tapHashFields(CAPTURED_CHARGE_CALLBACK)!
    const baseline = tapHash(fields, SECRET)

    for (const altered of [
      { ...fields, id: 'chg_other' },
      { ...fields, amount: '2.00' },
      { ...fields, currency: 'KWD' },
      { ...fields, status: 'VOID' },
      { ...fields, created: '1698392202944' },
      { ...fields, gatewayReference: 'gw_other' },
      { ...fields, paymentReference: 'pay_other' },
    ]) {
      expect(tapHash(altered, SECRET)).not.toBe(baseline)
    }
  })

  it('changes with the key', () => {
    const fields = tapHashFields(CAPTURED_CHARGE_CALLBACK)!

    expect(tapHash(fields, SECRET)).not.toBe(tapHash(fields, 'sk_test_other'))
  })
})

describe('hashMatches', () => {
  it('accepts an identical digest', () => {
    expect(hashMatches('a'.repeat(64), 'a'.repeat(64))).toBe(true)
  })

  it('rejects a different digest of the same length', () => {
    expect(hashMatches('a'.repeat(64), 'b'.repeat(64))).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths; a forged short digest
    // must be a rejection, not a 500.
    expect(hashMatches('abc', 'a'.repeat(64))).toBe(false)
  })

  it('rejects an empty value on either side', () => {
    expect(hashMatches('', 'a'.repeat(64))).toBe(false)
    expect(hashMatches('a'.repeat(64), '')).toBe(false)
  })
})

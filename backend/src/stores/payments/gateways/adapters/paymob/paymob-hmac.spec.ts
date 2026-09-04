import { createHmac } from 'crypto'
import { HMAC_FIELDS, computeHmac, hmacPayload, verifyHmac } from './paymob-hmac'
import { DOCUMENTED_HMAC_STRING, PROCESSED_CALLBACK } from './paymob-fixtures'

const SECRET = 'hmac_secret_for_spec'

describe('the documented concatenation', () => {
  it("reproduces Paymob's worked example exactly", () => {
    // The whole security boundary rests on this string. If our field
    // order, boolean spelling or number formatting drifts from Paymob's,
    // every real callback is rejected — and this is the only place that
    // can catch it without a live gateway.
    expect(hmacPayload(PROCESSED_CALLBACK.obj)).toBe(
      DOCUMENTED_HMAC_STRING,
    )
  })

  it('covers both ends and the shape-dependent keys', () => {
    const payload = hmacPayload(PROCESSED_CALLBACK.obj)

    expect(payload.startsWith('100000')).toBe(true) // amount_cents, first
    expect(payload.endsWith('true')).toBe(true) // success, last
    expect(payload).toContain('217503754') // order.id
    expect(payload).toContain('192036465') // obj.id
  })

  it('is scoped to the POST callback the backend actually receives', () => {
    // The GET "response callback" is a browser redirect to the merchant's
    // site, which this backend never receives — and the docs disagree
    // with themselves about its order key (`order_id` on the HMAC page,
    // `order` in the sample). Left unimplemented rather than guessed.
    expect(HMAC_FIELDS).toHaveLength(20)
    expect(HMAC_FIELDS.every((f) => Array.isArray(f.processed))).toBe(true)
  })

  it('contributes nothing for an absent field', () => {
    // A wallet transaction carries no source_data.pan. Rendering the
    // absence as "undefined" would fail every wallet callback.
    const wallet = {
      ...PROCESSED_CALLBACK.obj,
      source_data: { type: 'wallet', sub_type: 'wallet' },
    }

    const payload = hmacPayload(wallet)

    expect(payload).not.toContain('undefined')
    expect(payload).not.toContain('null')
  })
})

describe('signature verification', () => {
  const valid = () =>
    createHmac('sha512', SECRET)
      .update(DOCUMENTED_HMAC_STRING, 'utf8')
      .digest('hex')

  it('accepts a correctly signed callback', () => {
    expect(
      verifyHmac({
        source: PROCESSED_CALLBACK.obj,
        secret: SECRET,
        received: valid(),
      }),
    ).toBe(true)
  })

  it('uses SHA-512, as documented', () => {
    const digest = computeHmac(PROCESSED_CALLBACK.obj, SECRET)

    expect(digest).toHaveLength(128)
    expect(digest).toBe(valid())
  })

  it('rejects a signature made with a different secret', () => {
    expect(
      verifyHmac({
        source: PROCESSED_CALLBACK.obj,
        secret: SECRET,
        received: createHmac('sha512', 'someone_elses_secret')
          .update(DOCUMENTED_HMAC_STRING, 'utf8')
          .digest('hex'),
      }),
    ).toBe(false)
  })

  it('rejects a callback whose amount was altered after signing', () => {
    // The attack the HMAC exists to stop: a forged "paid" callback, or a
    // real one edited upward in flight.
    const tampered = { ...PROCESSED_CALLBACK.obj, amount_cents: 999_999 }

    expect(
      verifyHmac({
        source: tampered,
        secret: SECRET,
        received: valid(),
      }),
    ).toBe(false)
  })

  it('rejects an empty or wrong-length signature without throwing', () => {
    for (const received of ['', 'abc', valid().slice(0, 60)]) {
      expect(() =>
        verifyHmac({
          source: PROCESSED_CALLBACK.obj,
          secret: SECRET,
          received,
        }),
      ).not.toThrow()

      expect(
        verifyHmac({
          source: PROCESSED_CALLBACK.obj,
          secret: SECRET,
          received,
        }),
      ).toBe(false)
    }
  })

  it('accepts an upper-case digest', () => {
    expect(
      verifyHmac({
        source: PROCESSED_CALLBACK.obj,
        secret: SECRET,
        received: valid().toUpperCase(),
      }),
    ).toBe(true)
  })
})

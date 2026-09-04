import {
  TAP_CHARGE_STATUSES,
  classifyCharge,
  classifyRefund,
  factsFromCharge,
  factsFromPayload,
  factsFromRefund,
  isRecognisedPayload,
  tapObjectKind,
} from './tap-fact-map'
import {
  AUTHORIZED_CALLBACK,
  CANCELLED_CHARGE,
  CAPTURED_CHARGE_CALLBACK,
  CREATE_CHARGE_RESPONSE,
  REFUND_RESPONSE,
} from './tap-fixtures'

/**
 * Tap's objects → ObservedFacts, against Tap's documented statuses.
 *
 * Every status asserted here appears in Tap's own published list; none
 * is invented, and the ones Tap groups as "payment failed" are mapped as
 * failures rather than promoted into finer categories we would be
 * guessing at.
 */

const ACCOUNT = 9n

describe('tapObjectKind', () => {
  it('reads the object field Tap stamps on every payload', () => {
    expect(tapObjectKind(CAPTURED_CHARGE_CALLBACK)).toBe('charge')
    expect(tapObjectKind(AUTHORIZED_CALLBACK)).toBe('authorize')
    expect(tapObjectKind(REFUND_RESPONSE)).toBe('refund')
  })

  it('is null for anything else, and never throws', () => {
    expect(tapObjectKind(null)).toBeNull()
    expect(tapObjectKind('charge')).toBeNull()
    expect(tapObjectKind({})).toBeNull()
    expect(tapObjectKind({ object: 'invoice' })).toBeNull()
  })
})

describe('classifyCharge', () => {
  it('files a captured charge as captured', () => {
    // "CAPTURED - Amount was successfully charged."
    expect(classifyCharge('CAPTURED')).toBe('attempt_captured')
  })

  it('files a void as a void', () => {
    expect(classifyCharge('VOID')).toBe('attempt_voided')
  })

  it('files every other terminal status as a failure, as Tap does', () => {
    // "ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED, VOID,
    //  TIMEDOUT, UNKNOWN - Payment failed."
    for (const status of [
      'ABANDONED',
      'CANCELLED',
      'FAILED',
      'DECLINED',
      'RESTRICTED',
      'TIMEDOUT',
      'UNKNOWN',
    ]) {
      expect(classifyCharge(status)).toBe('attempt_failed')
    }
  })

  it('produces nothing for a charge still in flight', () => {
    // Filing INITIATED would either create an order nobody paid for or
    // cancel a payment still in flight.
    expect(classifyCharge('INITIATED')).toBeNull()
    expect(classifyCharge('IN_PROGRESS')).toBeNull()
  })

  it('produces nothing for a status Tap does not document', () => {
    expect(classifyCharge('SOMETHING_NEW')).toBeNull()
    expect(classifyCharge(undefined)).toBeNull()
    expect(classifyCharge(42)).toBeNull()
  })

  it('covers every status on Tap’s published list', () => {
    // A status Tap documents and this map has never heard of would be
    // silently dropped, which is how a captured payment goes missing.
    for (const status of TAP_CHARGE_STATUSES) {
      const classified = classifyCharge(status)
      const inFlight = status === 'INITIATED' || status === 'IN_PROGRESS'

      expect(classified === null).toBe(inFlight)
    }
  })
})

describe('classifyRefund', () => {
  it('applies only a completed refund', () => {
    expect(classifyRefund('REFUNDED')).toBe('refund_succeeded')
  })

  it('records the documented unsuccessful outcomes as failures', () => {
    for (const status of [
      'DECLINED',
      'FAILED',
      'RESTRICTED',
      'REJECTED',
      'TIMED_OUT',
      'UNKNOWN',
    ]) {
      expect(classifyRefund(status)).toBe('refund_failed')
    }
  })

  it('waits on an in-flight refund', () => {
    // "the completion of the refund will trigger a webhook notification
    // to your server (post.url)" — applying PENDING or ACCEPTED early
    // would credit a customer twice when that callback lands.
    expect(classifyRefund('PENDING')).toBeNull()
    expect(classifyRefund('ACCEPTED')).toBeNull()
  })
})

describe('factsFromCharge', () => {
  it('turns the documented captured callback into one captured fact', () => {
    const [fact, ...rest] = factsFromCharge({
      accountId: ACCOUNT,
      charge: CAPTURED_CHARGE_CALLBACK,
    })

    expect(rest).toHaveLength(0)
    expect(fact.factType).toBe('attempt_captured')
    expect(fact.accountId).toBe(ACCOUNT)
    // Correlated on the charge id, which exists from the create call.
    expect(fact.gatewayReference).toBe('chg_TS05A4120230736x9K22710693')
    expect(fact.currency).toBe('SAR')
    // 1.0 SAR, converted into our minor units.
    expect(fact.cumulativeAmountMinor).toBe(100n)
    expect(fact.occurredAt).toEqual(new Date(1_698_392_202_943))
  })

  it('carries the charge id as the refundable payment id too', () => {
    // Tap keys /v2/refunds on charge_id, so there is no second
    // identifier to wait for.
    const [fact] = factsFromCharge({
      accountId: ACCOUNT,
      charge: CAPTURED_CHARGE_CALLBACK,
    })

    expect(fact.refs?.gatewayPaymentId).toBe('chg_TS05A4120230736x9K22710693')
  })

  it('redacts what it keeps of the raw payload', () => {
    const [fact] = factsFromCharge({
      accountId: ACCOUNT,
      charge: CAPTURED_CHARGE_CALLBACK,
    })

    expect(fact.rawRedacted).toEqual({
      tap_object: 'charge',
      status: 'CAPTURED',
      response_code: '000',
      response_message: 'Captured',
      payment_method: 'MADA',
    })

    // No card, no payer, no raw body.
    const serialised = JSON.stringify(fact, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
    expect(serialised).not.toContain('446404')
    expect(serialised).not.toContain('tok_')
  })

  it('turns a cancelled charge into a failure with its three decimals', () => {
    const [fact] = factsFromCharge({
      accountId: ACCOUNT,
      charge: CANCELLED_CHARGE,
    })

    expect(fact.factType).toBe('attempt_failed')
    expect(fact.currency).toBe('BHD')
    // 1.000 BHD is 1000 minor units, not 100.
    expect(fact.cumulativeAmountMinor).toBe(1_000n)
  })

  it('classifies a declined charge into a structured failure code', () => {
    const [fact] = factsFromCharge({
      accountId: ACCOUNT,
      charge: {
        ...CANCELLED_CHARGE,
        response: { code: '505', message: 'Declined, Insufficient Funds' },
      },
    })

    expect(fact.failureCode).toBe('declined_insufficient_funds')
  })

  it('falls back to unknown for an undocumented response code', () => {
    const [fact] = factsFromCharge({ accountId: ACCOUNT, charge: CANCELLED_CHARGE })

    expect(fact.factType).toBe('attempt_failed')
    expect(fact.failureCode).toBe('unknown')
  })

  it('never sets a failure code on a successful charge', () => {
    const [fact] = factsFromCharge({
      accountId: ACCOUNT,
      charge: CAPTURED_CHARGE_CALLBACK,
    })

    expect(fact.failureCode).toBeUndefined()
  })

  it('produces nothing for the charge Tap has only just initiated', () => {
    expect(
      factsFromCharge({ accountId: ACCOUNT, charge: CREATE_CHARGE_RESPONSE }),
    ).toEqual([])
  })

  it('produces nothing for a charge with no id', () => {
    expect(
      factsFromCharge({
        accountId: ACCOUNT,
        charge: { ...CAPTURED_CHARGE_CALLBACK, id: undefined },
      }),
    ).toEqual([])
  })

  it('gives the same fact the same dedupe key', () => {
    const once = factsFromCharge({
      accountId: ACCOUNT,
      charge: CAPTURED_CHARGE_CALLBACK,
    })
    const again = factsFromCharge({
      accountId: ACCOUNT,
      charge: CAPTURED_CHARGE_CALLBACK,
    })

    expect(once[0].dedupeKey).toBe(again[0].dedupeKey)
  })
})

describe('factsFromRefund', () => {
  it('turns the documented refund response into a refund fact', () => {
    const [fact, ...rest] = factsFromRefund({
      accountId: ACCOUNT,
      refund: REFUND_RESPONSE,
    })

    expect(rest).toHaveLength(0)
    expect(fact.factType).toBe('refund_succeeded')
    // Correlated on the charge, which is what the attempt was recorded
    // against.
    expect(fact.gatewayReference).toBe('chg_TS05A4120230736x9K22710693')
    expect(fact.currency).toBe('AED')
    expect(fact.cumulativeAmountMinor).toBe(300n)
    expect(fact.refs?.gatewayCaptureRef).toBe('re_xxxx')
  })

  it('falls back to the caller’s charge id when the refund omits one', () => {
    const [fact] = factsFromRefund({
      accountId: ACCOUNT,
      refund: { ...REFUND_RESPONSE, charge_id: undefined },
      gatewayReference: 'chg_from_caller',
    })

    expect(fact.gatewayReference).toBe('chg_from_caller')
  })

  it('produces nothing for a refund still being processed', () => {
    expect(
      factsFromRefund({
        accountId: ACCOUNT,
        refund: { ...REFUND_RESPONSE, status: 'PENDING' },
      }),
    ).toEqual([])
  })

  it('produces nothing when there is no charge to attach it to', () => {
    expect(
      factsFromRefund({
        accountId: ACCOUNT,
        refund: { ...REFUND_RESPONSE, charge_id: undefined },
      }),
    ).toEqual([])
  })
})

describe('factsFromPayload', () => {
  it('routes by the object Tap stamped on the payload', () => {
    expect(
      factsFromPayload({ accountId: ACCOUNT, payload: CAPTURED_CHARGE_CALLBACK })[0]
        .factType,
    ).toBe('attempt_captured')

    expect(
      factsFromPayload({ accountId: ACCOUNT, payload: REFUND_RESPONSE })[0].factType,
    ).toBe('refund_succeeded')
  })

  it('recognises an authorize and deliberately produces nothing', () => {
    // This adapter never calls POST /v2/authorize, so no attempt here
    // could correspond to one; mapping it would attach a fact to a
    // payment we did not start.
    expect(isRecognisedPayload(AUTHORIZED_CALLBACK)).toBe(true)
    expect(
      factsFromPayload({ accountId: ACCOUNT, payload: AUTHORIZED_CALLBACK }),
    ).toEqual([])
  })

  it('produces nothing for an object it does not know', () => {
    expect(
      factsFromPayload({ accountId: ACCOUNT, payload: { object: 'invoice' } }),
    ).toEqual([])
    expect(factsFromPayload({ accountId: ACCOUNT, payload: null })).toEqual([])
  })
})

describe('isRecognisedPayload', () => {
  it('is true only for a documented object with a documented status', () => {
    expect(isRecognisedPayload(CAPTURED_CHARGE_CALLBACK)).toBe(true)
    expect(isRecognisedPayload(REFUND_RESPONSE)).toBe(true)
    expect(isRecognisedPayload({ object: 'charge', status: 'MADE_UP' })).toBe(false)
    expect(isRecognisedPayload({ object: 'invoice', status: 'PAID' })).toBe(false)
  })
})

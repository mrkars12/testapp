import { Logger } from '@nestjs/common';
import { SupersededFundsConsumer } from './superseded-funds.consumer';
import type { OutboxRecord } from '../../../common/messaging/messaging.types';

/* ══════════════════════════════════════════════════════════════════════
   ROUND 6 — the remediation path.

   The applier refuses to create a second Order for money that reached a
   checkout a paid successor replaced. That refusal is only safe because
   the money is then GIVEN BACK. This is the code that gives it back, and
   these are the ways it can fail.

   The rule every test here defends: real money never quietly stays
   taken. Either the provider reverses it, or an operator is told to.
   ══════════════════════════════════════════════════════════════════════ */

const message = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 77n,
  storeId: 9n,
  mode: 'test',
  aggregateType: 'payment_intent',
  aggregateId: '500',
  eventType: 'payment.superseded_funds_detected',
  eventVersion: 1,
  attempts: 0,
  occurredAt: new Date('2026-09-02T12:00:00Z'),
  payload: {
    intentId: '500',
    attemptId: '600',
    checkoutId: '250',
    accountId: '3',
    factType: 'attempt_captured',
    capturedTotalMinor: '5000',
    currency: 'SAR',
    gatewayReference: 'pay_abc',
    gatewayPaymentId: 'pay_abc',
    gatewayCaptureRef: null,
  },
  ...over,
});

function build(providerOver: Record<string, unknown> = {}) {
  const refund = jest.fn(() =>
    Promise.resolve([{ factType: 'refund_succeeded' }]),
  );
  const voidAuthorization = jest.fn(() =>
    Promise.resolve([{ factType: 'attempt_voided' }]),
  );

  const provider = { refund, voidAuthorization, ...providerOver };

  const applyMany = jest.fn(() => Promise.resolve([] as unknown[]));

  const consumer = new SupersededFundsConsumer(
    {
      withTenantTransaction: (_s: unknown, _m: unknown, cb: never) =>
        (cb as unknown as (tx: unknown) => Promise<unknown>)({
          paymentAccount: {
            findFirst: () => Promise.resolve({ id: 3n, gateway: 'moyasar' }),
          },
        }),
    } as never,
    { has: () => true, get: () => provider } as never,
    {
      revealCredentialsForGateway: () => Promise.resolve({ secret: 'x' }),
    } as never,
    { applyMany } as never,
    { register: jest.fn() } as never,
  );

  const errors: string[] = [];
  jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation((m) => void errors.push(String(m)));
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  return { consumer, refund, voidAuthorization, applyMany, errors };
}

afterEach(() => jest.restoreAllMocks());

describe('returning funds that reached a superseded checkout', () => {
  /* ── A — a captured duplicate is REFUNDED ──────────────────────── */

  it('refunds a capture, for the amount that was captured', async () => {
    const { consumer, refund, voidAuthorization } = build();

    await consumer.handle(message());

    expect(refund).toHaveBeenCalledTimes(1);
    expect(voidAuthorization).not.toHaveBeenCalled();
    expect(
      (refund.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0],
    ).toMatchObject({
      gatewayReference: 'pay_abc',
      amountMinor: 5000n,
      currency: 'SAR',
      reason: 'superseded_checkout',
    });
  });

  /* ── B — an authorized duplicate is VOIDED, not refunded ───────── */

  it('voids an authorisation rather than refunding it', async () => {
    // Refunding an uncaptured authorisation is either rejected by the
    // provider or, worse, captures first. Voiding releases the hold.
    const { consumer, refund, voidAuthorization } = build();

    await consumer.handle(
      message({
        payload: {
          ...message().payload,
          factType: 'attempt_authorized',
          capturedTotalMinor: '0',
        },
      }),
    );

    expect(voidAuthorization).toHaveBeenCalledTimes(1);
    expect(refund).not.toHaveBeenCalled();
  });

  /* ── H — the reversal goes back through the applier ────────────── */

  it('feeds the reversal facts through the same applier as any other fact', async () => {
    // So the reversal is recorded, ledgered and DEDUPED identically —
    // a redelivered reversal callback cannot post twice.
    const { consumer, applyMany } = build();

    await consumer.handle(message());

    expect(applyMany).toHaveBeenCalledTimes(1);
    expect((applyMany.mock.calls as unknown as Array<[unknown]>)[0][0]).toEqual(
      [{ factType: 'refund_succeeded' }],
    );
  });

  /* ── F — a redelivered message reverses with the SAME key ──────── */

  it('derives the provider idempotency key from the outbox message id', async () => {
    // The dispatcher's consumed-event claim already stops a second
    // delivery reaching here. This is the second line: if one ever did,
    // the provider sees the key it saw before and does not refund twice.
    const { consumer, refund } = build();

    await consumer.handle(message());
    await consumer.handle(message());

    const keys = (
      refund.mock.calls as unknown as Array<[{ idempotencyKey: string }]>
    ).map((c) => c[0].idempotencyKey);
    expect(keys).toEqual(['superseded-reversal:77', 'superseded-reversal:77']);
  });

  /* ── C — success is quiet ──────────────────────────────────────── */

  it('raises no alert when the reversal succeeds', async () => {
    const { consumer, errors } = build();

    await consumer.handle(message());

    expect(errors).toHaveLength(0);
  });

  /* ── D — a provider failure is surfaced AND rethrown ───────────── */

  it('surfaces a provider failure and rethrows so the outbox retries', async () => {
    const { consumer, errors } = build({
      refund: jest.fn(() => Promise.reject(new Error('gateway timeout'))),
    });

    // Rethrown: swallowing it would mark the message published and the
    // money would stay taken with nobody told.
    await expect(consumer.handle(message())).rejects.toThrow('gateway timeout');

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('[superseded-funds] MANUAL REVERSAL REQUIRED');
    expect(errors[0]).toContain('gateway timeout');
  });

  /* ── G — a gateway that cannot reverse must not look successful ── */

  it('alerts, and does not silently succeed, when the gateway cannot refund', async () => {
    const { consumer, errors, applyMany } = build({ refund: undefined });

    await expect(consumer.handle(message())).rejects.toThrow(/cannot refund/);

    expect(applyMany).not.toHaveBeenCalled();
    expect(errors[0]).toContain('MANUAL REVERSAL REQUIRED');
  });

  it('alerts when the gateway cannot void an authorisation', async () => {
    const { consumer, errors } = build({ voidAuthorization: undefined });

    await expect(
      consumer.handle(
        message({
          payload: {
            ...message().payload,
            capturedTotalMinor: '0',
          },
        }),
      ),
    ).rejects.toThrow(/cannot void/);

    expect(errors[0]).toContain('MANUAL REVERSAL REQUIRED');
  });

  /* ── E — what the operator is actually given ───────────────────── */

  it('names everything an operator needs to reverse it by hand', async () => {
    const { consumer, errors } = build({
      refund: jest.fn(() => Promise.reject(new Error('nope'))),
    });

    await expect(consumer.handle(message())).rejects.toThrow();

    // If any of these is missing, the alert is not actionable and the
    // money cannot be found at the provider.
    for (const needle of [
      'store=9',
      'mode=test',
      'checkout=250',
      'intent=500',
      'attempt=600',
      'account=3',
      'gatewayReference=pay_abc',
      'amountMinor=5000',
      'currency=SAR',
      'outboxMessage=77',
    ]) {
      expect(errors[0]).toContain(needle);
    }
  });

  it('alerts rather than retrying forever when there is no provider reference', async () => {
    // Retrying cannot invent a reference, so this is surfaced and
    // acknowledged instead of burning the outbox's attempts.
    const { consumer, errors, refund } = build();

    await consumer.handle(
      message({
        payload: {
          ...message().payload,
          gatewayReference: null,
        },
      }),
    );

    expect(refund).not.toHaveBeenCalled();
    expect(errors[0]).toContain('no provider reference');
  });
});

import { Logger } from '@nestjs/common';
import { PaymentsHealthJob } from './payments-health.job';

/* ══════════════════════════════════════════════════════════════════════
   ROUND 6 — is un-returned money actually observable?

   The reversal path alerts at the moment it fails. That line scrolls
   away. This job is the project's existing operational surface — a cron
   that re-states unresolved money problems every ten minutes — and these
   tests pin that a superseded-funds reversal which never got delivered
   keeps showing up there until somebody clears it.
   ══════════════════════════════════════════════════════════════════════ */

function build(
  counts: {
    dead?: number;
    supersededDead?: number;
    reconciliationLagSeconds?: number;
  } = {},
) {
  const deadLetterCount = jest.fn((eventType?: string) =>
    Promise.resolve(
      eventType === 'payment.superseded_funds_detected'
        ? (counts.supersededDead ?? 0)
        : (counts.dead ?? 0),
    ),
  );

  const job = new PaymentsHealthJob(
    { findUnbalancedEntries: () => Promise.resolve([]) } as never,
    { deadLetterCount, stalePendingCount: () => Promise.resolve(0) } as never,
    {
      oldestEligibleAgeSeconds: () =>
        Promise.resolve(counts.reconciliationLagSeconds ?? 0),
    } as never,
  );

  const errors: string[] = [];
  jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation((m) => void errors.push(String(m)));
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  return { job, errors, deadLetterCount };
}

afterEach(() => jest.restoreAllMocks());

describe('payments health — un-returned superseded funds', () => {
  it('says nothing when there is nothing wrong', async () => {
    const { job, errors } = build();

    const result = await job.check();

    expect(result.unreturnedSupersededFunds).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('reports un-returned money separately from ordinary dead letters', async () => {
    // An undelivered notification is an inconvenience. This is a real
    // customer charge with no Order behind it, so it gets its own line.
    const { job, errors } = build({ dead: 3, supersededDead: 2 });

    const result = await job.check();

    expect(result.unreturnedSupersededFunds).toBe(2);

    const line = errors.find((e) => e.includes('[superseded-funds]'));
    expect(line).toBeDefined();
    expect(line).toContain('2 reversal(s) were never delivered');
    // It must tell the operator how to find the money.
    expect(line).toContain('MANUAL REVERSAL REQUIRED');
    expect(line).toContain('payment.superseded_funds_detected');
  });

  it('keeps the existing dead-letter and ledger lines untouched', async () => {
    const { job, errors } = build({ dead: 1, supersededDead: 0 });

    await job.check();

    expect(errors.some((e) => e.includes('[outbox-dead-letter]'))).toBe(true);
    expect(errors.some((e) => e.includes('[superseded-funds]'))).toBe(false);
  });

  it('counts dead superseded-funds messages by event type', async () => {
    const { job, deadLetterCount } = build({ supersededDead: 1 });

    await job.check();

    expect(deadLetterCount).toHaveBeenCalledWith(
      'payment.superseded_funds_detected',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════
   F-07 — is reconciliation STARVATION observable?

   Reconciliation is the only recovery from a lost webhook, and it used
   to fail silently by construction: `run()` logs only when it processed
   something, so a sweep whose entire batch was occupied by permanently
   unprocessable intents reported nothing at all, forever. The lag is
   the number that makes that visible.
   ══════════════════════════════════════════════════════════════════════ */

describe('payments health — reconciliation lag', () => {
  it('says nothing while the sweep is keeping up', async () => {
    // A healthy lag sits near the recheck interval, which is well under
    // the threshold. An alert that fires in the ordinary state is an
    // alert people learn to ignore.
    const { job, errors } = build({ reconciliationLagSeconds: 300 });

    const result = await job.check();

    expect(result.reconciliationLagSeconds).toBe(300);
    expect(errors.filter((e) => e.includes('[reconciliation-lag]'))).toHaveLength(
      0,
    );
  });

  it('reports nothing eligible as zero lag, not as a problem', async () => {
    const { job, errors } = build();

    const result = await job.check();

    expect(result.reconciliationLagSeconds).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('raises an error once the backlog stops draining', async () => {
    const { job, errors } = build({ reconciliationLagSeconds: 4000 });

    const result = await job.check();

    expect(result.reconciliationLagSeconds).toBe(4000);

    const line = errors.find((e) => e.includes('[reconciliation-lag]'));
    expect(line).toBeDefined();
    expect(line).toContain('4000s');
    // Actionable, not just numeric: it has to say why this matters.
    expect(line).toMatch(/lost webhook/i);
    expect(line).toMatch(/no order/i);
  });

  it('never lets a reconciliation read failure take the whole check down', async () => {
    // The other three checks are what an operator relies on when the
    // database is unhappy; a broken fourth must not hide them.
    const job = new PaymentsHealthJob(
      { findUnbalancedEntries: () => Promise.resolve([]) } as never,
      {
        deadLetterCount: () => Promise.resolve(7),
        stalePendingCount: () => Promise.resolve(0),
      } as never,
      {
        oldestEligibleAgeSeconds: () => Promise.reject(new Error('db down')),
      } as never,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await job.check();

    expect(result.deadLetters).toBe(7);
    expect(result.reconciliationLagSeconds).toBe(0);
  });
});

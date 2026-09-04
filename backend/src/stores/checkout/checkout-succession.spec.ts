import {
  chooseSuccessor,
  contactMatches,
  fundsSecuredBySuccessor,
  hasSecuredFunds,
  mayBeSuperseded,
  type DescendantFunds,
} from './checkout-succession';

/* ══════════════════════════════════════════════════════════════════════
   The rules that decide what a caller may claim, and which successor
   answers "what replaced this checkout?".

   Every assertion here is a security decision. The relation is identity
   only — two row ids — and nothing in this file, or in the module it
   tests, can produce a payment outcome.
   ══════════════════════════════════════════════════════════════════════ */

const previous = (
  over: Partial<Parameters<typeof mayBeSuperseded>[0]> = {},
) => ({
  order_id: null,
  customer_phone: '+966 55 000 0000',
  customer_email: 'payer@example.com',
  ...over,
});

describe('may a checkout be superseded', () => {
  it('yes while it has no order', () => {
    expect(mayBeSuperseded(previous())).toBe(true);
  });

  it('NEVER once an order exists', () => {
    // An Order exists only where funds were secured. This is what keeps
    // a paid checkout from ever being the source of a chain — and
    // therefore why a settled success can only be at the end of one.
    expect(mayBeSuperseded(previous({ order_id: 42n }))).toBe(false);
  });
});

describe('the claim must come from the same customer', () => {
  it('matches the same number written with different punctuation', () => {
    // A retry re-sends either the form's own value or the server's copy
    // of it, so the digits are always the same; only spacing, dashes and
    // the leading + can differ between the two.
    expect(contactMatches(previous(), { phone: '+966-55-000-0000' })).toBe(
      true,
    );
    expect(contactMatches(previous(), { phone: '966550000000' })).toBe(true);
  });

  it('does NOT treat a different dialling format as the same number', () => {
    // `0550000000` and `+966550000000` are the same phone to a person
    // and different digits here, and that is the safe direction: this
    // guard exists to refuse claims, and a looser match (comparing only
    // the last N digits) would start accepting other people's.
    expect(contactMatches(previous(), { phone: '0550000000' })).toBe(false);
  });

  it('matches on email regardless of case or padding', () => {
    expect(
      contactMatches(previous(), {
        phone: '0500000001',
        email: '  Payer@Example.com ',
      }),
    ).toBe(true);
  });

  it('refuses a claim that matches neither', () => {
    // The consequence this prevents: someone holding a stranger's
    // checkout token pointing their OWN paid checkout at it, so the
    // stranger's page reports a purchase they never completed.
    expect(
      contactMatches(previous(), {
        phone: '0559999999',
        email: 'someone@else.test',
      }),
    ).toBe(false);
  });

  it('refuses a claim with no contact details at all', () => {
    expect(contactMatches(previous(), {})).toBe(false);
    expect(contactMatches(previous(), { phone: '', email: '' })).toBe(false);
  });

  it('does not let two blank predecessors match each other', () => {
    const blank = previous({ customer_phone: null, customer_email: null });
    expect(contactMatches(blank, { phone: '', email: '' })).toBe(false);
    expect(contactMatches(blank, { phone: '0550000000' })).toBe(false);
  });
});

describe('choosing among successors', () => {
  const candidate = (id: bigint, committed = false) => ({
    id,
    token: `tok_${id}`,
    committed,
  });

  it('has no answer when nothing replaced the checkout', () => {
    expect(chooseSuccessor([])).toBeNull();
  });

  it('prefers the committed successor over a newer uncommitted one', () => {
    // Two tabs retried the same failure. One of them paid; that is the
    // one the customer is asking about.
    const chosen = chooseSuccessor([candidate(10n, true), candidate(11n)]);
    expect(chosen?.id).toBe(10n);
  });

  it('takes the newest when none is committed', () => {
    const chosen = chooseSuccessor([
      candidate(10n),
      candidate(11n),
      candidate(9n),
    ]);
    expect(chosen?.id).toBe(11n);
  });

  it('takes the newest committed one when there are several', () => {
    const chosen = chooseSuccessor([
      candidate(10n, true),
      candidate(12n, true),
    ]);
    expect(chosen?.id).toBe(12n);
  });

  it('returns identity only — no state travels with the choice', () => {
    const chosen = chooseSuccessor([candidate(10n, true)]);
    expect(Object.keys(chosen ?? {})).toEqual(['id', 'token', 'committed']);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   ROUND 5 — the funds invariant.

   > A checkout with any descendant that has secured funds must not
   > itself secure funds again.

   The whole lifecycle matrix lives here, with no database, because the
   cost of getting it wrong is asymmetric in both directions: too lax
   charges a card twice, too strict refuses a legitimate payment and
   silently deletes the failed-payment recovery rule.
   ══════════════════════════════════════════════════════════════════════ */

const descendant = (over: Partial<DescendantFunds> = {}): DescendantFunds => ({
  id: 2n,
  intentStatus: 'processing',
  capturedTotalMinor: 0n,
  hasOrder: false,
  commitmentSecuresFunds: true,
  ...over,
});

/* ══════════════════════════════════════════════════════════════════════
   Succession and cart identity are SEPARATE, and stay separate.

   With a server-side cart there are now two links between checkouts
   that could be confused for each other:

     `supersedes_id` — "which attempt did this one replace?"
     `cart_id`       — "which basket is this?"

   A retry of the same basket writes the SAME cart_id and a NEW
   supersedes_id. Merging them would be a real, tempting mistake: both
   are "the same purchase" in ordinary speech, and neither means the
   other. So this module is kept ignorant of carts entirely, and the
   assertion below is that its whole vocabulary — inputs and outputs —
   is checkout identity and payment state, with no cart concept anywhere
   in it to be confused.
   ══════════════════════════════════════════════════════════════════════ */
describe('succession knows nothing about carts', () => {
  it('decides a successor from checkout identity and payment state alone', () => {
    const chosen = chooseSuccessor([
      { id: 7n, token: 'succ-a', committed: false },
      { id: 9n, token: 'succ-b', committed: true },
    ]);

    // The whole vocabulary is checkout identity plus one payment fact.
    // There is no cart anywhere in the input or the output to be
    // confused with the succession link.
    expect(chosen?.token).toBe('succ-b');
    expect(Object.keys(chosen ?? {}).sort()).toEqual([
      'committed',
      'id',
      'token',
    ]);
  });

  it('never treats an unpaid successor as evidence of anything', () => {
    // A cart being reused for a retry must not, on its own, make the
    // predecessor look settled. Only funds do that.
    expect(
      fundsSecuredBySuccessor([
        { id: 7n, order_id: null, intent: null },
      ] as unknown as DescendantFunds[]),
    ).toBe(false);
  });
});

describe('hasSecuredFunds — when a successor holds money', () => {
  /* ── The states that mean NO money is held ─────────────────────── */

  it.each([
    ['created'],
    ['requires_payment_method'],
    ['requires_action'],
    ['processing'],
  ])('an open successor (%s) has secured nothing', (intentStatus) => {
    expect(hasSecuredFunds(descendant({ intentStatus }))).toBe(false);
  });

  it.each([['failed'], ['cancelled'], ['expired']])(
    'a %s successor has secured nothing — the predecessor stays payable',
    (intentStatus) => {
      expect(hasSecuredFunds(descendant({ intentStatus }))).toBe(false);
    },
  );

  it('a successor with no intent at all has secured nothing', () => {
    expect(hasSecuredFunds(descendant({ intentStatus: null }))).toBe(false);
  });

  /* ── The states that mean money IS held ───────────────────────── */

  it('an authorized successor HAS secured funds, though nothing is captured', () => {
    // An authorisation is a real hold on a real card, SECURES_FUNDS
    // includes attempt_authorized, and finalize() already creates the
    // order at that moment.
    expect(
      hasSecuredFunds(
        descendant({ intentStatus: 'authorized', capturedTotalMinor: 0n }),
      ),
    ).toBe(true);
  });

  it.each([['partially_captured'], ['captured']])(
    'a %s successor has secured funds',
    (intentStatus) => {
      expect(hasSecuredFunds(descendant({ intentStatus }))).toBe(true);
    },
  );

  it('a captured-then-REFUNDED successor still counts — the rule latches', () => {
    // Reading only the current status would unblock the predecessor the
    // instant a refund landed, re-opening the duplicate-order hole
    // through the refund path.
    expect(hasSecuredFunds(descendant({ intentStatus: 'refunded' }))).toBe(
      true,
    );
    expect(
      hasSecuredFunds(descendant({ intentStatus: 'partially_refunded' })),
    ).toBe(true);
  });

  it('captured money counts even if the status has not caught up', () => {
    expect(
      hasSecuredFunds(
        descendant({ intentStatus: 'processing', capturedTotalMinor: 1n }),
      ),
    ).toBe(true);
  });

  /* ── The order term, which is the easiest thing to get wrong ──── */

  it('an order created against SECURED funds counts', () => {
    expect(
      hasSecuredFunds(
        descendant({
          intentStatus: null,
          hasOrder: true,
          commitmentSecuresFunds: true,
        }),
      ),
    ).toBe(true);
  });

  it('an order created against a PROMISE (cash on delivery) does NOT count', () => {
    // The single most important assertion in this file. COD and bank
    // transfer commit an order with no money behind it; treating a bare
    // order_id as proof of funds would freeze a predecessor whose
    // successor was a COD order and permanently refuse a real payment.
    expect(
      hasSecuredFunds(
        descendant({
          intentStatus: null,
          hasOrder: true,
          commitmentSecuresFunds: false,
        }),
      ),
    ).toBe(false);
  });
});

describe('fundsSecuredBySuccessor — the invariant over a whole chain', () => {
  it('is false when there are no descendants at all', () => {
    // Almost every checkout there has ever been. Must be inert.
    expect(fundsSecuredBySuccessor([])).toBe(false);
  });

  it('is false when every descendant failed — recovery is preserved', () => {
    expect(
      fundsSecuredBySuccessor([
        descendant({ id: 2n, intentStatus: 'failed' }),
        descendant({ id: 3n, intentStatus: 'failed' }),
      ]),
    ).toBe(false);
  });

  it('is true when ANY descendant secured funds, however deep', () => {
    // A -> B -> C with only C paid: the closure the caller passes in
    // contains B and C, and C alone must block A.
    expect(
      fundsSecuredBySuccessor([
        descendant({ id: 2n, intentStatus: 'failed' }),
        descendant({ id: 3n, intentStatus: 'captured' }),
      ]),
    ).toBe(true);
  });

  it('is true on an authorized-only chain', () => {
    expect(
      fundsSecuredBySuccessor([descendant({ intentStatus: 'authorized' })]),
    ).toBe(true);
  });

  it('does not block merely because a successor exists', () => {
    // The difference between this rule and `supersedes_id !== null`,
    // which would have deleted the legitimate late-recovery case.
    expect(
      fundsSecuredBySuccessor([
        descendant({ intentStatus: 'requires_action' }),
      ]),
    ).toBe(false);
  });
});

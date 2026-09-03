/* ══════════════════════════════════════════════════════════════════════
   Checkout succession — the rules, with no database in them.

   A retry does not reopen the checkout that failed. It creates a new
   one, with a new token, a new intent and a new attempt, and the old
   row stays exactly as it settled — truthfully failed, forever.

   That is right as a record and wrong as a page. Every attempt leaves
   its own entries in the browser's history (a 3DS payment is a full
   document navigation out to the bank and back), each stamped with the
   token that was live when it was written, so pressing Back after a
   successful third attempt lands on the FIRST one's URL. Asked about
   that token alone, the server answers "failed" — and a customer who
   has already paid is shown a decline and a retry button.

   The missing fact is not an outcome. It is that this checkout was
   REPLACED. These are the rules for writing that down and reading it
   back, kept here — pure, and therefore testable — because every one of
   them is a security decision:

     • what a caller is allowed to claim (`mayBeSuperseded`,
       `contactMatches`), and
     • which of several successors answers "what replaced this?"
       (`chooseSuccessor`).

   Nothing here decides a payment outcome, and nothing here can. The
   relation is identity: two row ids. Whether the successor was paid is
   read from the successor's own record, through the same authoritative
   path as every other reading in this service.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * How far a chain is followed. Three declines make three links; this is
 * well past anything a person does, and it is a bound rather than a
 * guess so a corrupted or adversarial graph cannot spin.
 */
export const MAX_SUCCESSION_DEPTH = 8;

/** And how many rows may be visited in total while doing it. */
export const MAX_SUCCESSION_NODES = 32;

/** The predecessor, as much of it as the decision needs. */
export interface SupersedableCheckout {
  readonly order_id: bigint | null;
  readonly customer_phone: string | null;
  readonly customer_email: string | null;
}

/** A candidate successor, as much of it as the choice needs. */
export interface SuccessorCandidate {
  readonly id: bigint;
  readonly token: string;
  /** An Order exists for it — which only a secured payment produces. */
  readonly committed: boolean;
}

/**
 * Digits only.
 *
 * `+966 55 000 0000`, `0550000000` and `+966-55-000-0000` are the same
 * phone number typed by the same person, and a retry that re-sends the
 * server's own copy must not fail to match the form's.
 */
function normalizePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * The successor is being created by the same customer as the checkout
 * it claims to replace.
 *
 * DEFENCE IN DEPTH, not the boundary. The boundary is the checkout
 * token itself: it is 32 unguessable hex characters and it already
 * gates reading a checkout's status and confirming a payment against
 * it, so a caller who can present it is, by this system's existing
 * model, the person who made it.
 *
 * What this adds is the one consequence that would be new: without it,
 * anyone holding a stranger's checkout token could point their OWN
 * (paid) checkout at it and make the stranger's page report a purchase
 * they never completed. Requiring the contact details to match means
 * the claim has to come from someone already presenting that
 * customer's own details.
 *
 * Either identifier is enough. A retry re-sends whichever the checkout
 * was created with, so the ordinary path always matches; a customer who
 * corrects BOTH between attempts simply gets no link, which costs the
 * history-entry convenience and nothing else.
 */
export function contactMatches(
  previous: SupersedableCheckout,
  next: { phone?: string | null; email?: string | null },
): boolean {
  const previousPhone = normalizePhone(previous.customer_phone);
  const nextPhone = normalizePhone(next.phone);
  if (previousPhone && previousPhone === nextPhone) return true;

  const previousEmail = normalizeEmail(previous.customer_email);
  const nextEmail = normalizeEmail(next.email);
  return !!previousEmail && previousEmail === nextEmail;
}

/**
 * A checkout that already produced an Order may not be superseded.
 *
 * An Order exists only once funds were secured, so such a checkout is
 * not something a customer is retrying — it is something they paid.
 * Refusing the link here is what stops a paid checkout from ever being
 * the SOURCE of a chain, which in turn is why a settled success can
 * only ever be at the END of one.
 */
export function mayBeSuperseded(previous: SupersedableCheckout): boolean {
  return previous.order_id === null;
}

/**
 * Which successor answers "what replaced this checkout?".
 *
 * Two tabs can retry the same failure, and then a checkout genuinely
 * has two successors. A committed one is preferred over an uncommitted
 * one because it is the only kind that can carry the answer the caller
 * is actually looking for; among equals, the newest, because that is
 * the one the customer ended up on.
 *
 * Selection only. This says which checkout to look at, never what its
 * state is — the caller still reads that from the checkout itself.
 */
export function chooseSuccessor(
  candidates: readonly SuccessorCandidate[],
): SuccessorCandidate | null {
  if (candidates.length === 0) return null;

  const newestFirst = [...candidates].sort((a, b) => (a.id > b.id ? -1 : 1));
  return newestFirst.find((candidate) => candidate.committed) ?? newestFirst[0];
}

/* ══════════════════════════════════════════════════════════════════════
   ROUND 5 — the funds invariant, as a pure rule.

   > A checkout with any descendant that has secured funds must not
   > itself secure funds again.

   Everything below decides one thing: given what a descendant's payment
   looks like, has that descendant SECURED FUNDS? It is deliberately
   separate from `chooseSuccessor` above — that answers "which checkout
   should the page look at", a display question, and this answers "may
   this checkout still take money", a money question. Conflating them
   would let a display heuristic move funds.

   No database and no Prisma, because a mistake here does not show a
   customer the wrong panel — it either lets a card be charged twice or
   stops a legitimate payment from completing. That is worth being able
   to test exhaustively with nothing switched on.
   ══════════════════════════════════════════════════════════════════════ */

/** A descendant's payment, as much of it as the funds rule needs. */
export interface DescendantFunds {
  readonly id: bigint;
  /** Its checkout-context intent's status, or null when it has no intent. */
  readonly intentStatus: string | null;
  /** Cumulative captured on that intent. */
  readonly capturedTotalMinor: bigint;
  /**
   * Whether an Order exists for it.
   *
   * Corroborating only — see `hasSecuredFunds`. It is NOT sufficient on
   * its own, and that is the single most important line in this file.
   */
  readonly hasOrder: boolean;
  /**
   * Whether that Order (if any) was created against secured funds rather
   * than an accepted promise. `false` for cash on delivery and bank
   * transfer, which commit an Order with no money behind it.
   */
  readonly commitmentSecuresFunds: boolean;
}

/**
 * Intent statuses that mean money was secured, and STAYS secured for the
 * purposes of this rule.
 *
 * `authorized` counts: an authorisation is a real hold on the payer's
 * card, `PaymentFactApplier`'s SECURES_FUNDS set includes
 * `attempt_authorized`, and `CheckoutFinalizerService.finalize()`
 * already creates the Order (UNPAID) at that moment. A second
 * authorisation on the predecessor is a second real hold on a real card.
 *
 * `partially_refunded` and `refunded` count TOO, and that is the subtle
 * one. They describe a checkout that captured and then gave the money
 * back — it still produced an Order, and the Order does not stop
 * existing because it was refunded. Reading only the *current* status
 * would unblock the predecessor the instant a refund landed, which
 * re-opens the duplicate-Order hole through the refund path and makes
 * the invariant flap. The rule latches: once secured, always secured.
 */
const FUNDS_SECURED_INTENT_STATUSES: ReadonlySet<string> = new Set([
  'authorized',
  'partially_captured',
  'captured',
  'partially_refunded',
  'refunded',
]);

/**
 * Has this descendant secured funds?
 *
 * The intent is authoritative. `hasOrder` is an OR-term, and ONLY when
 * that order was created by the funds-secured path: cash on delivery and
 * bank transfer commit an Order against an unfunded promise, so treating
 * a bare `order_id` as proof of money would freeze a predecessor whose
 * successor was a COD order — the customer's card never touched, and
 * their original payment permanently refused.
 */
export function hasSecuredFunds(descendant: DescendantFunds): boolean {
  if (
    descendant.intentStatus !== null &&
    FUNDS_SECURED_INTENT_STATUSES.has(descendant.intentStatus)
  ) {
    return true;
  }

  if (descendant.capturedTotalMinor > 0n) return true;

  return descendant.hasOrder && descendant.commitmentSecuresFunds;
}

/**
 * THE INVARIANT, as one function.
 *
 * True when this checkout must not be allowed to secure funds, because
 * something that replaced it already did.
 *
 * `descendants` is the TRANSITIVE closure, not the immediate children:
 * A → B → C with only C paid must block A as well as B, and a one-hop
 * check would let A through. The caller does the walk (it needs a
 * database); this decides the verdict.
 *
 * Note what is NOT here: the existence of a successor. A retry whose own
 * payment failed, was cancelled or expired secures nothing, so the
 * predecessor stays payable and the recovery rule in
 * `payment-intent.state.ts` keeps working exactly as it did. That is the
 * difference between this rule and "block whenever supersedes_id is
 * set", and it is why the latter would have silently deleted the
 * legitimate late-recovery case.
 */
export function fundsSecuredBySuccessor(
  descendants: readonly DescendantFunds[],
): boolean {
  return descendants.some(hasSecuredFunds);
}

/**
 * The same rule, applied to the WHOLE chain rather than only forwards.
 *
 * The descendant-only form above is the invariant as specified, and it
 * is not sufficient on its own. It closes the direction a retry creates
 * — an old checkout paying after its replacement did — and leaves the
 * mirror image open:
 *
 *     A fails, the customer retries into B, then A settles LATE and
 *     legitimately (the recovery rule), and only afterwards does B
 *     settle too. B has no descendants, so nothing forward of it has
 *     secured funds, and B is allowed through. Two real charges and two
 *     Orders for one cart — reached without a single illegal state.
 *
 * A chain is one purchase attempt. Money securing anywhere in it is the
 * fact that matters, and which way the link happens to point is an
 * artefact of which checkout the customer created first. So the rule
 * enforced is the chain-wide one, and it strictly contains the
 * descendant-only invariant: every case that blocks there blocks here.
 *
 * `others` is every member of the chain EXCEPT the one being decided.
 * A checkout is never blocked by its own funds — that is what the
 * ordinary ordering guards in `payment-intent.state.ts` are for.
 */
export function fundsSecuredElsewhereInChain(
  others: readonly DescendantFunds[],
): boolean {
  return others.some(hasSecuredFunds);
}

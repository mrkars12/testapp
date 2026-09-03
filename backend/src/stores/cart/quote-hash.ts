import { createHash } from 'crypto';

/* ══════════════════════════════════════════════════════════════════════
   The seal on a priced checkout.

   `Checkout.quote_hash` has existed as a column since phase 1b.2 and
   was never written. This is what writes it, and it does exactly one
   job: it lets the server notice that the basket a checkout was priced
   from is no longer the basket the cart holds.

   IT IS A DETECTOR, NOT A LOCK. What actually prevents a cart moving
   under a live payment is the server-side mutation refusal on the cart
   endpoints (`cart_locked`), which is a different mechanism answering a
   different question. Nothing here refuses anything; a mismatch means
   the tab is told to resync rather than shown a stale amount.

   Computed from the PRICED result — the amounts the server itself
   resolved out of ProductVariant — so it is a statement about what was
   quoted, never about what a browser said it wanted.
   ══════════════════════════════════════════════════════════════════════ */

export interface QuoteHashLine {
  readonly variantId: bigint | string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
}

export interface QuoteHashInput {
  /**
   * The cart's PUBLIC id — never its token.
   *
   * The hash is published to the browser on the status endpoint, so a
   * secret must not be one of its inputs even indirectly: a digest is
   * not encryption, and an offline search over a known-shape preimage
   * is exactly the mistake this avoids.
   *
   * `null` for the cookieless fallback path, which has no cart.
   */
  readonly cartPublicId: string | null;
  readonly cartVersion: number;
  readonly currency: string;
  readonly offeringId: bigint | string;
  readonly totalMinor: bigint;
  readonly lines: readonly QuoteHashLine[];
}

/**
 * A stable, order-independent digest of a priced quote.
 *
 * The lines are sorted before hashing, so two carts holding the same
 * items in a different insertion order seal identically — the order
 * rows happen to come back in is not part of what was bought.
 *
 * Field separators are characters that cannot occur in any component
 * (`|` between fields, `:` inside a line), so no combination of values
 * can be rearranged into a different quote with the same preimage.
 */
export function computeQuoteHash(input: QuoteHashInput): string {
  const lines = input.lines
    .map(
      (line) =>
        `${line.variantId.toString()}:${line.quantity}:${line.unitPriceMinor.toString()}`,
    )
    .sort();

  const preimage = [
    input.cartPublicId ?? '',
    String(input.cartVersion),
    input.currency.toUpperCase(),
    input.offeringId.toString(),
    input.totalMinor.toString(),
    lines.join(','),
  ].join('|');

  return createHash('sha256').update(preimage, 'utf8').digest('hex');
}

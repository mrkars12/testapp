import { parseStorefrontPaymentMode } from './configuration';

/* ══════════════════════════════════════════════════════════════════════
   Which mode the PUBLIC storefront transacts in.

   This decides which PaymentAccount real customers' money goes through,
   so the interesting assertions are all about it staying `live` — the
   override exists to make a merchant's own *test* account reachable on a
   developer's machine, and must be incapable of doing anything else.
   ══════════════════════════════════════════════════════════════════════ */

describe('parseStorefrontPaymentMode', () => {
  it('is live when nothing is set', () => {
    expect(parseStorefrontPaymentMode(undefined, 'development')).toBe('live');
    expect(parseStorefrontPaymentMode('', 'development')).toBe('live');
  });

  it('is live on production even when the override is set', () => {
    // The whole point. A production host with this variable set — by
    // accident, by a copied .env, by a templating mistake — must keep
    // taking real payments through the live account.
    expect(parseStorefrontPaymentMode('test', 'production')).toBe('live');
    expect(parseStorefrontPaymentMode('TEST', 'production')).toBe('live');
    expect(parseStorefrontPaymentMode(' test ', 'production')).toBe('live');
  });

  it('opts a non-production deployment into test when asked exactly', () => {
    expect(parseStorefrontPaymentMode('test', 'development')).toBe('test');
    expect(parseStorefrontPaymentMode('TEST', 'development')).toBe('test');
    expect(parseStorefrontPaymentMode(' test ', undefined)).toBe('test');
  });

  it('ignores anything that is not the word test', () => {
    // Not boolean-shaped on purpose: `true`/`1` mean nothing here, and a
    // misspelling must fail closed rather than into test mode.
    for (const raw of ['live', 'true', '1', 'yes', 'testing', 'tset']) {
      expect(parseStorefrontPaymentMode(raw, 'development')).toBe('live');
    }
  });
});

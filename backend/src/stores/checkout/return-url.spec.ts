import { buildReturnUrlChecker, sanitizeReturnUrl } from './return-url';

const ORIGINS = ['http://localhost:3000', '*.example.com'];

describe('buildReturnUrlChecker', () => {
  const accepts = buildReturnUrlChecker(ORIGINS);

  it('accepts a URL on an exactly allowlisted origin', () => {
    expect(accepts('http://localhost:3000/stores/shop1/checkout')).toBe(true);
  });

  it('accepts a storefront subdomain covered by a wildcard entry', () => {
    expect(accepts('https://shop1.example.com/checkout')).toBe(true);
  });

  it('rejects an origin that is not allowlisted at all', () => {
    // The open-redirect case: a hostile client asking us to have the
    // provider bounce the payer, and the order token, to its own host.
    expect(accepts('https://evil.test/collect')).toBe(false);
  });

  it('rejects a host that merely ends with an allowlisted one', () => {
    expect(accepts('https://example.com.evil.test/')).toBe(false);
  });

  it('rejects the bare apex when only subdomains are allowlisted', () => {
    expect(accepts('https://example.com/checkout')).toBe(false);
  });

  it('rejects a non-http scheme', () => {
    expect(accepts('javascript:alert(1)')).toBe(false);
    expect(accepts('data:text/html,x')).toBe(false);
  });

  it('rejects embedded credentials', () => {
    expect(accepts('http://user:pass@localhost:3000/x')).toBe(false);
  });

  it('rejects a value that is not a URL at all', () => {
    expect(accepts('/stores/shop1/checkout')).toBe(false);
    expect(accepts('')).toBe(false);
  });

  it('distinguishes port', () => {
    expect(accepts('http://localhost:4000/x')).toBe(false);
  });

  it('accepts nothing when no origin is allowlisted', () => {
    expect(buildReturnUrlChecker([])('http://localhost:3000/x')).toBe(false);
  });
});

describe('sanitizeReturnUrl', () => {
  it('passes an allowed URL through unchanged', () => {
    const url = 'http://localhost:3000/stores/shop1/checkout';
    expect(sanitizeReturnUrl(url, ORIGINS)).toBe(url);
  });

  it('drops a disallowed URL rather than throwing', () => {
    // Dropping falls back to the merchant's configured return URL, which
    // is the same path as a client that sent none — a bad field must not
    // be able to block a real order.
    expect(sanitizeReturnUrl('https://evil.test/', ORIGINS)).toBeUndefined();
  });

  it('treats absent values as absent', () => {
    expect(sanitizeReturnUrl(undefined, ORIGINS)).toBeUndefined();
    expect(sanitizeReturnUrl(null, ORIGINS)).toBeUndefined();
  });
});

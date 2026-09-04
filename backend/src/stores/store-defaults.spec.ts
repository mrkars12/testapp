import { BadRequestException } from '@nestjs/common';
import {
  assertNotReservedSlug,
  assertSupportedCurrency,
  normalizeStoreSlug,
} from './store-defaults';

describe('normalizeStoreSlug', () => {
  it('lowercases, strips unsafe characters and collapses whitespace/dashes', () => {
    expect(normalizeStoreSlug('My  Store!!')).toBe('my-store');
    expect(normalizeStoreSlug('ivcg7f-00')).toBe('ivcg7f-00');
    expect(normalizeStoreSlug('  --Weird--Name--  ')).toBe('weird-name');
  });

  it('strips path-traversal and script-injection characters entirely', () => {
    expect(normalizeStoreSlug('../../etc/passwd')).not.toContain('/');
    expect(normalizeStoreSlug('<script>alert(1)</script>')).not.toMatch(/[<>]/);
  });

  it('falls back to a random slug when normalization leaves nothing usable', () => {
    const slug = normalizeStoreSlug('متجري');
    expect(slug).toMatch(/^store-[0-9a-f]{6}$/);
  });

  it('caps length at 40 characters', () => {
    const slug = normalizeStoreSlug('a'.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe('assertNotReservedSlug', () => {
  it('rejects slugs that collide with a merchant route segment', () => {
    // /store/new and /store/all are static routes — a store slugged
    // either would be permanently unreachable at /store/<slug>.
    expect(() => assertNotReservedSlug('new')).toThrow(BadRequestException);
    expect(() => assertNotReservedSlug('all')).toThrow(BadRequestException);
  });

  it('accepts an ordinary slug', () => {
    expect(() => assertNotReservedSlug('dartpay')).not.toThrow();
  });
});

describe('assertSupportedCurrency', () => {
  it('accepts and upper-cases a supported currency', () => {
    expect(assertSupportedCurrency('sar')).toBe('SAR');
    expect(assertSupportedCurrency('USD')).toBe('USD');
  });

  it('rejects an unsupported or missing currency', () => {
    expect(() => assertSupportedCurrency('EUR')).toThrow(BadRequestException);
    expect(() => assertSupportedCurrency(undefined)).toThrow(
      BadRequestException,
    );
  });
});

import { describe, it, expect } from 'vitest'
import { extractStoreSlug, isStoreRoute, isTemporaryAuthRoute } from './storeRoute'

describe('extractStoreSlug', () => {
  it('returns the slug for a real per-merchant store route', () => {
    expect(extractStoreSlug('/store/dartpay')).toBe('dartpay')
    expect(extractStoreSlug('/store/dartpay/orders')).toBe('dartpay')
    expect(extractStoreSlug('/store/dartpay/settings/payments')).toBe('dartpay')
    expect(extractStoreSlug('/store/my-shop-2/products/7/edit')).toBe('my-shop-2')
  })

  it('returns null for the slug-agnostic and reserved sibling routes', () => {
    for (const p of [
      '/store', '/store/', '/store/new', '/store/all',
      '/store/orders', '/store/products', '/store/settings', '/store/menus',
      '/store/pages', '/store/collections', '/store/themes',
    ]) {
      expect(extractStoreSlug(p), p).toBeNull()
    }
  })

  it('returns null for the public storefront and unrelated routes', () => {
    expect(extractStoreSlug('/stores/dartpay')).toBeNull()
    expect(extractStoreSlug('/settings/security')).toBeNull()
    expect(extractStoreSlug('/login')).toBeNull()
    expect(extractStoreSlug(null)).toBeNull()
    expect(extractStoreSlug(undefined)).toBeNull()
  })

  it('isStoreRoute mirrors extractStoreSlug', () => {
    expect(isStoreRoute('/store/dartpay/orders')).toBe(true)
    expect(isStoreRoute('/store/new')).toBe(false)
    expect(isStoreRoute('/settings')).toBe(false)
  })
})

describe('isTemporaryAuthRoute', () => {
  it('flags every auth / onboarding step', () => {
    for (const p of ['/', '/login', '/register', '/register/account-information', '/verify-email', '/select-store', '/auth/oauth-success']) {
      expect(isTemporaryAuthRoute(p), p).toBe(true)
    }
  })
  it('does not flag merchant or settings routes', () => {
    for (const p of ['/store/dartpay', '/store/dartpay/orders', '/settings/security', '/store/new']) {
      expect(isTemporaryAuthRoute(p), p).toBe(false)
    }
  })
})

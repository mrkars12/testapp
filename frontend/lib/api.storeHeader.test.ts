import { describe, it, expect, beforeEach } from 'vitest'
import { getStoreHeaders } from './api'

// Store-scoped admin URLs carry the store as a segment
// (`/store/<slug>/products`), and the interceptor resolves the
// header from that URL and nothing else.
//
// There is no longer any in-memory mirror to consult or to fall behind: a
// request issued at any moment reads the address bar, so the first request
// after a switch cannot carry the store the user just left.
describe('store header resolution follows the [storeSlug] URL segment', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/store/store-a/products')
  })

  it('sends the slug the URL segment names', () => {
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-a' })
  })

  it('follows a store switch, which is a navigation to a new slug segment', () => {
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-a' })

    window.history.pushState({}, '', '/store/store-b/products')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })
  })

  it('falls back to the URL when a request beats the layout to mirroring it', () => {
    // The mirror is empty — this is the first render after landing on a
    // deep link. Reading the slug from the URL is what stops that first
    // fetch going out unscoped and being answered for the backend's
    // default store instead.
    window.history.pushState({}, '', '/store/store-c/orders')
    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-c' })
  })

  it('sends no store header on store-agnostic routes', () => {
    // `/store` lists every store the user owns; scoping that
    // request to one store would be wrong, not merely redundant.
    window.history.pushState({}, '', '/store')
    expect(getStoreHeaders()).toEqual({})
  })

  it('scopes payment settings to the store in the URL, not a previous one', () => {
    // Part 12 regression check (frontend only — no payment code touched).
    // `/stores/payment-settings` carries no slug in its path: which store's
    // gateways come back is decided ENTIRELY by this header. If it lagged a
    // switch, store B's payment settings screen would render store A's
    // configured providers and their credentials.
    window.history.replaceState({}, '', '/store/store-b/settings/payments')

    expect(getStoreHeaders()).toEqual({ 'X-Store-Slug': 'store-b' })
  })
})

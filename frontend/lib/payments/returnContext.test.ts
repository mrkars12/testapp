import { describe, it, expect } from 'vitest'
import {
  buildReturnUrl,
  checkoutPath,
  checkoutUrlWithToken,
  readReturnContext,
} from './returnContext'

const params = (query: string) => new URLSearchParams(query)

describe('readReturnContext — what survives the trip to a provider', () => {
  it('reads the checkout token the backend appended', () => {
    expect(readReturnContext(params('token=abc123def4567890')).token).toBe('abc123def4567890')
  })

  it('reports no return when the page was opened normally', () => {
    expect(readReturnContext(params('')).token).toBeNull()
    expect(readReturnContext(null).token).toBeNull()
  })

  it('refuses a token that is not shaped like one', () => {
    // It arrives through a third party's redirect and is about to be
    // interpolated into a request path; a malformed value must read as
    // "no return in progress", not be sent anywhere.
    expect(readReturnContext(params('token=../../admin')).token).toBeNull()
    expect(readReturnContext(params('token=<script>')).token).toBeNull()
    expect(readReturnContext(params('token=short')).token).toBeNull()
    expect(readReturnContext(params('token=')).token).toBeNull()
  })

  it('recognises a provider cancellation hint', () => {
    const context = readReturnContext(params('token=abc123def4567890&stripe_cancelled=1'))
    expect(context.cancelledHint).toBe(true)
    expect(context.token).toBe('abc123def4567890')
  })

  it('treats anything other than the exact hint value as no hint', () => {
    expect(readReturnContext(params('stripe_cancelled=0')).cancelledHint).toBe(false)
    expect(readReturnContext(params('stripe_cancelled=true')).cancelledHint).toBe(false)
    expect(readReturnContext(params('')).cancelledHint).toBe(false)
  })
})

describe('the return URL is this checkout, on this origin', () => {
  it('points back at the same checkout page of the same store', () => {
    // Not the home page, not a store chooser, not a generic waiting page.
    expect(buildReturnUrl('shop1')).toBe(`${window.location.origin}/stores/shop1/checkout`)
  })

  it('escapes a slug rather than letting it shape the path', () => {
    expect(checkoutPath('a/b')).toBe('/stores/a%2Fb/checkout')
  })

  it('carries the token on the same checkout URL', () => {
    expect(checkoutUrlWithToken('shop1', 'abc123def4567890')).toBe(
      '/stores/shop1/checkout?token=abc123def4567890',
    )
  })

  it('round-trips: the URL written before leaving is readable on return', () => {
    const url = new URL(checkoutUrlWithToken('shop1', 'abc123def4567890'), 'https://example.com')
    expect(readReturnContext(url.searchParams).token).toBe('abc123def4567890')
  })
})

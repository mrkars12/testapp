import { describe, it, expect } from 'vitest'
import {
  isOfferingRenderable,
  leavesTheSite,
  resolvePresentationMode,
} from './presentation'

describe('resolvePresentationMode — gateway capability selection', () => {
  it('uses the mode the backend published', () => {
    expect(resolvePresentationMode({ presentation_mode: 'embedded' })).toBe('embedded')
    expect(resolvePresentationMode({ presentation_mode: 'same_tab_redirect' })).toBe('same_tab_redirect')
    expect(resolvePresentationMode({ presentation_mode: 'offline' })).toBe('offline')
  })

  it('never guesses embedded for an unknown or missing value', () => {
    // Rendering an in-page form for a gateway that has none leaves the
    // customer with no way to pay at all — strictly worse than sending
    // them to a hosted page that definitely works.
    expect(resolvePresentationMode({ presentation_mode: 'popup' })).not.toBe('embedded')
    expect(resolvePresentationMode({})).not.toBe('embedded')
    expect(resolvePresentationMode(null)).not.toBe('embedded')
  })

  it('falls back to the commitment kind on a backend without the field', () => {
    expect(resolvePresentationMode({ commitment_kind: 'awaiting_offline_settlement' })).toBe('offline')
    expect(resolvePresentationMode({ commitment_kind: 'promise_accepted' })).toBe('offline')
    expect(resolvePresentationMode({ commitment_kind: 'funds_secured' })).toBe('same_tab_redirect')
  })

  it('prefers the published mode over the commitment kind', () => {
    expect(
      resolvePresentationMode({
        presentation_mode: 'offline',
        commitment_kind: 'funds_secured',
      }),
    ).toBe('offline')
  })
})

describe('leavesTheSite', () => {
  it('is true only for a gateway that requires a hosted page', () => {
    expect(leavesTheSite({ presentation_mode: 'same_tab_redirect' })).toBe(true)
    expect(leavesTheSite({ presentation_mode: 'embedded' })).toBe(false)
    expect(leavesTheSite({ presentation_mode: 'offline' })).toBe(false)
  })
})

describe('isOfferingRenderable — an unusable gateway is never offered', () => {
  it('accepts an offering whose every action kind this checkout renders', () => {
    expect(isOfferingRenderable({ next_action_kinds: ['redirect'] })).toBe(true)
    expect(isOfferingRenderable({ next_action_kinds: ['bank_instructions'] })).toBe(true)
    expect(isOfferingRenderable({ next_action_kinds: [] })).toBe(true)
  })

  it('accepts an embedded offering now that the checkout renders one', () => {
    // The checkout mounts the provider's own form for `client_sdk`
    // (EmbeddedPaymentPanel). A gateway that can only produce one is
    // therefore usable, and hiding it would hide a working method.
    expect(isOfferingRenderable({ next_action_kinds: ['client_sdk'] })).toBe(true)
    expect(isOfferingRenderable({ next_action_kinds: ['redirect', 'client_sdk'] })).toBe(true)
  })

  it('rejects an offering that can only produce an action we cannot show', () => {
    // Selecting it would fail at the moment the customer presses Pay,
    // which is the worst possible place to discover it.
    expect(isOfferingRenderable({ next_action_kinds: ['reference_code'] })).toBe(false)
    expect(isOfferingRenderable({ next_action_kinds: ['redirect', 'poll'] })).toBe(false)
  })

  it('trusts an older backend that publishes no list', () => {
    expect(isOfferingRenderable({})).toBe(true)
    expect(isOfferingRenderable(null)).toBe(true)
  })
})

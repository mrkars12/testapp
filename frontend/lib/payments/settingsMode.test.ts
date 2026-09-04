import { describe, it, expect } from 'vitest'
import { initialModeFor } from './settingsMode'

const acc = (mode: 'test' | 'live', is_configured = false) => ({ mode, is_configured })

describe('initialModeFor — the settings page opens on the configured account', () => {
  it('opens on test when only the test account is configured', () => {
    /* The reported bug, pinned.
     *
     * dartpay/moyasar really holds: live = draft + unconfigured,
     * test = active + configured. The old rule saw a live row and chose
     * live, so the merchant's configured gateway showed "غير مهيّأة"
     * with empty credential inputs and looked unsaved. */
    expect(initialModeFor({
      supports_test_mode: true,
      accounts: [acc('live'), acc('test', true)],
    })).toBe('test')
  })

  it('prefers live when both modes are configured', () => {
    // Live is the one customers actually pay through.
    expect(initialModeFor({
      supports_test_mode: true,
      accounts: [acc('test', true), acc('live', true)],
    })).toBe('live')
  })

  it('opens on live when only live is configured', () => {
    expect(initialModeFor({
      supports_test_mode: true,
      accounts: [acc('test'), acc('live', true)],
    })).toBe('live')
  })

  it('keeps the previous behaviour when nothing is configured', () => {
    // An existing live row still wins; a test-only gateway still opens
    // on test. Only the configured case changed.
    expect(initialModeFor({ supports_test_mode: true, accounts: [acc('live'), acc('test')] })).toBe('live')
    expect(initialModeFor({ supports_test_mode: true, accounts: [acc('test')] })).toBe('test')
    expect(initialModeFor({ supports_test_mode: true, accounts: [] })).toBe('test')
  })

  it('opens a gateway with no test mode on live', () => {
    expect(initialModeFor({ supports_test_mode: false, accounts: [] })).toBe('live')
  })

  it('never needs a secret to decide', () => {
    // The whole point: the decision is made from `is_configured`, a
    // boolean the server derives from credential material existing. If
    // this ever required a credential VALUE, the server would have to
    // start returning secrets to the browser.
    const decided = initialModeFor({
      supports_test_mode: true,
      accounts: [{ mode: 'live' }, { mode: 'test', is_configured: true }],
    })
    expect(decided).toBe('test')
  })
})

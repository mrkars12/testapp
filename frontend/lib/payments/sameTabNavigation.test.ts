import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { navigateSameTab } from './sameTabNavigation'

/* The whole point of this module is what it does NOT do: it never opens
   a window, never names a target, and never leaves an opener behind. */

describe('navigateSameTab', () => {
  let assign: ReturnType<typeof vi.fn>
  let open: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assign = vi.fn()
    open = vi.fn()
    vi.stubGlobal('open', open)
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign, href: 'https://shop.test/stores/s1/checkout' },
    })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends THIS tab to the provider for a GET redirect', () => {
    expect(navigateSameTab('https://api.moyasar.com/v1/invoices/inv_1', 'GET')).toBe(true)
    expect(assign).toHaveBeenCalledWith('https://api.moyasar.com/v1/invoices/inv_1')
  })

  it('never opens a second window or tab', () => {
    navigateSameTab('https://gateway.test/pay', 'GET')
    expect(open).not.toHaveBeenCalled()
  })

  it('POSTs to the provider top-level, with no target', () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(function (this: HTMLFormElement) {
        // Captured at submit time; the node is removed straight after.
        expect(this.method.toUpperCase()).toBe('POST')
        expect(this.action).toBe('https://gateway.test/pay')
        // No target means "navigate the document this form is in" — the
        // single difference from the old second-tab flow.
        expect(this.target).toBe('')
        expect((this.elements.namedItem('signature') as HTMLInputElement).value).toBe('abc')
      })

    expect(navigateSameTab('https://gateway.test/pay', 'POST', { signature: 'abc' })).toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    // Nothing is left behind in the DOM.
    expect(document.querySelector('form')).toBeNull()
  })

  it('refuses a scheme a browser must not be sent to', () => {
    // Reaching here would mean the normalized next action carried an
    // attacker-supplied value; executing it in our own origin is worse
    // than a failed payment.
    expect(navigateSameTab('javascript:alert(1)', 'GET')).toBe(false)
    expect(navigateSameTab('data:text/html,<script>x</script>', 'GET')).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })
})

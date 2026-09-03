import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SocialAuthButtons from './SocialAuthButtons'

/**
 * Auth-history policy: starting social login must not leave the current
 * auth page (`/login` / `/register`) in history behind the OAuth
 * round-trip. Use `window.location.replace(url)`, not `location.href =`.
 */

vi.mock('@/lib/fingerprint', () => ({ getHardwareFingerprint: vi.fn().mockResolvedValue('fp-123') }))

afterEach(cleanup)

describe('SocialAuthButtons — starts OAuth with location.replace', () => {
  let replaceSpy: ReturnType<typeof vi.fn>
  let hrefSet: string | null

  beforeEach(() => {
    replaceSpy = vi.fn()
    hrefSet = null
    // jsdom's window.location is not configurable enough to fully swap;
    // redefine the two members this component can touch.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        replace: replaceSpy,
        get href() { return 'http://localhost/login' },
        set href(v: string) { hrefSet = v },
        assign: vi.fn(),
      },
    })
  })

  it('clicking a provider calls location.replace and never assigns location.href', async () => {
    render(<SocialAuthButtons mode="login" />)
    await userEvent.click(screen.getByRole('button', { name: /Google/ }))

    expect(replaceSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy.mock.calls[0][0]).toMatch(/\/auth\/oauth\/google\?/)
    expect(hrefSet).toBeNull()
  })
})

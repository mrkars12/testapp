import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import RecoverPasswordClient from './RecoverPasswordClient'

/**
 * Auth-history policy: NO Back-button hacks. This step used to intercept
 * `popstate` and `history.pushState` a guard entry to force the user
 * forward. That is removed — completion does `router.replace('/login')`,
 * which is the correct history semantics.
 */

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('code=abc123'),
}))
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { valid: true } }), post: vi.fn().mockResolvedValue({ data: {} }) },
}))
vi.mock('@/lib/passwordStrength', () => ({
  validatePassword: () => ({ score: 4, valid: true, checks: {} }),
}))

afterEach(cleanup)

describe('RecoverPasswordClient — no popstate/pushState Back-button trap', () => {
  it('does not register a popstate listener or push a guard history entry', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const pushStateSpy = vi.spyOn(window.history, 'pushState')

    render(<RecoverPasswordClient />)
    await waitFor(() => {
      expect(addSpy.mock.calls.some((c) => c[0] === 'popstate')).toBe(false)
    })
    expect(pushStateSpy).not.toHaveBeenCalled()

    addSpy.mockRestore()
    pushStateSpy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AuthNavigationLinks from './AuthNavigationLinks'

/**
 * Auth-history policy: the cross-links between the auth ENTRY pages
 * (`/login` ⇄ `/register` ⇄ `/forgot-password`) must `router.replace`,
 * never `router.push`. A `push` here is the one history entry that
 * survives the rest of the (all-`replace`) auth flow and lets browser
 * Back re-open a completed auth page from an authenticated page.
 */

const replace = vi.fn()
const push = vi.fn()
let mockPath = '/login'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => mockPath,
}))

beforeEach(() => { replace.mockClear(); push.mockClear() })
afterEach(cleanup)

describe('AuthNavigationLinks — auth-entry cross navigation uses replace', () => {
  it('from /login: "create account" and "forgot password" replace, never push', async () => {
    mockPath = '/login'
    render(<AuthNavigationLinks />)
    await userEvent.click(screen.getByRole('button', { name: /أنشئ حسابك الآن/ }))
    await userEvent.click(screen.getByRole('button', { name: /نسيت كلمة المرور/ }))
    expect(push).not.toHaveBeenCalled()
    expect(replace.mock.calls.map((c) => c[0])).toEqual(['/register', '/forgot-password'])
  })

  it('from /register: "already have an account" replaces to /login, never pushes', async () => {
    mockPath = '/register'
    render(<AuthNavigationLinks />)
    await userEvent.click(screen.getByRole('button', { name: /سجل الدخول الآن/ }))
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('from /forgot-password: "already have an account" replaces to /login, never pushes', async () => {
    mockPath = '/forgot-password'
    render(<AuthNavigationLinks />)
    await userEvent.click(screen.getByRole('button', { name: /سجل الدخول الآن/ }))
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/login')
  })
})

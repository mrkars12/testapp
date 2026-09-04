import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import RootPage from './page'

/**
 * Root `/` is a SERVER entry now:
 *   - session cookie present -> server redirect('/store') (an authed user
 *     never renders `/`, so `/` is never a Back destination for them)
 *   - no cookie -> the marketing landing with Login / Register links
 *
 * The forensic root cause was `/` being a *client* page that redirected an
 * authed 2+-store user to `/select-store`; Back to `/` re-ran that. There
 * is no client redirect here any more.
 */

const redirectMock = vi.fn((url: string) => {
  const e = new Error('NEXT_REDIRECT')
  ;(e as unknown as { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`
  throw e
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('./RootEntry', () => ({
  default: ({ landing }: { landing: React.ReactNode }) => <>{landing}</>,
}))

let cookieValue: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'access_token' && cookieValue ? { name: n, value: cookieValue } : undefined) }),
}))

beforeEach(() => { redirectMock.mockClear(); cookieValue = undefined })
afterEach(cleanup)

describe('Root `/` server entry', () => {
  it('no session cookie -> renders the landing (Login + Register links), no redirect', async () => {
    cookieValue = undefined
    const ui = await RootPage()
    render(ui)
    expect(screen.getByRole('link', { name: /تسجيل دخول/ }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: /إنشاء حساب/ }).getAttribute('href')).toBe('/register')
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('session cookie present -> server redirect to /store (never /select-store, never a rendered `/`)', async () => {
    cookieValue = 'jwt.token.value'
    await expect(RootPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/store')
    expect(redirectMock).not.toHaveBeenCalledWith('/select-store')
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import PublicLayout from './layout'

/**
 * NO FORM FLASH: on `/login` / `/register` / `/register/*` the auth form
 * (`children`) renders ONLY for a confirmed guest (`unauthenticated`).
 * `booting` / `authenticated` / anything-else -> the neutral shell. An
 * authenticated visitor is forwarded via `authedHome('resume')` — never
 * `fresh-login`, never `/select-store`.
 */

const replace = vi.fn()
let mockPath = '/login'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => mockPath,
}))

let mockStatus = 'booting'
vi.mock('@/lib/authState', () => ({
  useAuthState: Object.assign(
    (sel?: (s: { status: string }) => unknown) => (sel ? sel({ status: mockStatus }) : { status: mockStatus }),
    { getState: () => ({ status: mockStatus }) },
  ),
}))

const authedHome = vi.fn((ctx: string) => Promise.resolve(ctx === 'resume' ? '/store/original' : '/select-store'))
vi.mock('@/lib/storeBootstrap', () => ({ authedHome: (c: string) => authedHome(c) }))

const FORM = <div data-testid="auth-form">LOGIN FORM</div>
const shell = () => screen.queryByRole('status')
const form = () => screen.queryByTestId('auth-form')

beforeEach(() => {
  replace.mockClear(); authedHome.mockClear(); mockPath = '/login'; mockStatus = 'booting'
  window.history.replaceState({}, '', '/login')
})
afterEach(cleanup)

describe('PublicAuthGuard render gate — no auth-form flash', () => {
  it('status = booting on /login -> neutral shell, NOT the form', () => {
    mockStatus = 'booting'
    render(<PublicLayout>{FORM}</PublicLayout>)
    expect(shell()).toBeTruthy()
    expect(form()).toBeNull()
  })

  it('status = authenticated on /login -> shell + forward via authedHome("resume"), never fresh-login', async () => {
    mockStatus = 'authenticated'
    render(<PublicLayout>{FORM}</PublicLayout>)
    expect(form()).toBeNull()
    expect(shell()).toBeTruthy()
    await waitFor(() => expect(authedHome).toHaveBeenCalledWith('resume'))
    expect(authedHome).not.toHaveBeenCalledWith('fresh-login')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/store/original'))
  })

  it('status = unauthenticated on /login -> renders the real form (guest)', () => {
    mockStatus = 'unauthenticated'
    render(<PublicLayout>{FORM}</PublicLayout>)
    expect(form()).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it('status = unauthenticated on /register -> renders the real form (guest)', () => {
    mockPath = '/register'
    mockStatus = 'unauthenticated'
    render(<PublicLayout>{FORM}</PublicLayout>)
    expect(form()).toBeTruthy()
  })

  it('status = booting on /register/account-information -> neutral shell', () => {
    mockPath = '/register/account-information'
    mockStatus = 'booting'
    render(<PublicLayout>{FORM}</PublicLayout>)
    expect(shell()).toBeTruthy()
    expect(form()).toBeNull()
  })

  it('non-auth route -> always renders children regardless of status', () => {
    mockPath = '/store/shop1'
    mockStatus = 'booting'
    render(<PublicLayout>{FORM}</PublicLayout>)
    expect(form()).toBeTruthy()
  })
})

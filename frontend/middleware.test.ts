import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

/**
 * Root cause of "signup redirects back to login"
 * (FINAL_AUTH_SIGNUP_TECHNICAL_REPAIR_REPORT.md): this middleware used to
 * redirect away from /login and /register whenever an `access_token` cookie
 * was merely present, with no way to verify it at the edge — a stale/
 * expired/garbage cookie still triggered the redirect.
 */
describe('middleware — auth pages stay reachable regardless of cookie validity', () => {
  it('does not redirect /register away, even with a cookie present', () => {
    const req = new NextRequest('http://localhost:3000/register', {
      headers: { cookie: 'access_token=stale-or-invalid-token' },
    })

    const res = middleware(req)

    expect(res.status).not.toBe(307)
    expect(res.status).not.toBe(308)
    expect(res.headers.get('location')).toBeNull()
  })

  it('does not redirect /login away, even with a cookie present', () => {
    const req = new NextRequest('http://localhost:3000/login', {
      headers: { cookie: 'access_token=stale-or-invalid-token' },
    })

    const res = middleware(req)

    expect(res.headers.get('location')).toBeNull()
  })

  it('renders /register normally with no cookie at all', () => {
    const req = new NextRequest('http://localhost:3000/register')

    const res = middleware(req)

    expect(res.headers.get('location')).toBeNull()
  })

  it('still clears the cookie on a forced-logout redirect back to login', () => {
    const req = new NextRequest('http://localhost:3000/login?reason=force_logout', {
      headers: { cookie: 'access_token=stale-or-invalid-token' },
    })

    const res = middleware(req)

    expect(res.headers.get('location')).toBeNull()
    expect(res.cookies.get('access_token')?.value).toBe('')
  })

  it('leaves a protected route alone regardless of cookie state (client-side guard verifies the session)', () => {
    const req = new NextRequest('http://localhost:3000/dashboard')

    const res = middleware(req)

    expect(res.headers.get('location')).toBeNull()
  })
})

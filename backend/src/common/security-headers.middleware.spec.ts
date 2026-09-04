import { applySecurityHeaders } from './security-headers.middleware'

describe('applySecurityHeaders', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  function mockRes() {
    const headers: Record<string, string> = {}
    return {
      setHeader: jest.fn((k: string, v: string) => {
        headers[k] = v
      }),
      headers,
    }
  }

  it('sets baseline headers and calls next()', () => {
    const res = mockRes()
    const next = jest.fn()

    applySecurityHeaders({}, res, next)

    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(res.headers['Permissions-Policy']).toContain('camera=()')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('sets a non-breaking baseline CSP (object-src/base-uri/frame-ancestors only)', () => {
    const res = mockRes()

    applySecurityHeaders({}, res, jest.fn())

    const csp = res.headers['Content-Security-Policy']
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("frame-ancestors 'self'")
    // Deliberately does not restrict script-src/style-src: doing so needs
    // dedicated per-page testing given widespread inline scripts/styles.
    expect(csp).not.toContain('script-src')
    expect(csp).not.toContain('style-src')
  })

  it('does not set HSTS outside production', () => {
    process.env.NODE_ENV = 'test'
    const res = mockRes()

    applySecurityHeaders({}, res, jest.fn())

    expect(res.headers['Strict-Transport-Security']).toBeUndefined()
  })

  it('sets HSTS in production', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes()

    applySecurityHeaders({}, res, jest.fn())

    expect(res.headers['Strict-Transport-Security']).toContain('max-age=')
  })
})

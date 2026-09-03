import { csrfProtection } from './csrf-protection.middleware'

describe('csrfProtection', () => {
  function mockRes() {
    const res: any = {
      statusCode: undefined,
      body: undefined,
      status: jest.fn(function (this: any, code: number) {
        res.statusCode = code
        return res
      }),
      json: jest.fn(function (this: any, payload: unknown) {
        res.body = payload
        return res
      }),
    }
    return res
  }

  function mockReq(overrides: Partial<any> = {}) {
    return {
      method: 'POST',
      path: '/stores/mine',
      cookies: {},
      headers: {},
      ...overrides,
    }
  }

  it('allows safe methods through regardless of cookie/content-type', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const next = jest.fn()
      const res = mockRes()
      csrfProtection(
        mockReq({ method, cookies: { access_token: 'x' }, headers: { 'content-type': 'text/plain' } }),
        res,
        next,
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    }
  })

  it('allows an unauthenticated (no session cookie) mutating request through, any content-type', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(
      mockReq({ cookies: {}, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      res,
      next,
    )

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('allows an authenticated JSON request through', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(
      mockReq({
        cookies: { access_token: 'real-session' },
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
      res,
      next,
    )

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('blocks an authenticated form-urlencoded POST (the classic CSRF shape)', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(
      mockReq({
        cookies: { access_token: 'real-session' },
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      res,
      next,
    )

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toMatchObject({ statusCode: 403 })
  })

  it('blocks an authenticated multipart/form-data POST', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(
      mockReq({
        cookies: { access_token: 'real-session' },
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }),
      res,
      next,
    )

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('blocks an authenticated request with no Content-Type at all', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(mockReq({ cookies: { access_token: 'real-session' }, headers: {} }), res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('allows an authenticated bodyless DELETE through with no Content-Type at all (regression: this used to 403, which the browser reported as a CORS failure)', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(
      mockReq({ method: 'DELETE', cookies: { access_token: 'real-session' }, headers: {} }),
      res,
      next,
    )

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('allows an authenticated bodyless PUT/PATCH through regardless of Content-Type — not a form-submittable, CORS-safelisted method', () => {
    for (const method of ['PUT', 'PATCH']) {
      const next = jest.fn()
      const res = mockRes()

      csrfProtection(
        mockReq({ method, cookies: { access_token: 'real-session' }, headers: { 'content-type': 'text/plain' } }),
        res,
        next,
      )

      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    }
  })

  it('exempts the webhook path prefix even with a stray cookie and non-JSON content-type', () => {
    const next = jest.fn()
    const res = mockRes()

    csrfProtection(
      mockReq({
        path: '/payments/webhooks/stripe/123',
        cookies: { access_token: 'irrelevant' },
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      res,
      next,
    )

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })
})

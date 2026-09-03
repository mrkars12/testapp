import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import RegisterStep1 from './page'
import api from '@/lib/api'

const replace = vi.fn()
const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}))

let startShouldFail = true
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(async () => {
      if (startShouldFail) throw new Error('network error')
      return { data: { flow_id: 'f1', flow_signature: 's1' } }
    }),
  },
}))

beforeEach(() => {
  replace.mockClear()
  push.mockClear()
  startShouldFail = true
})

afterEach(cleanup)

/**
 * Regression test for FINAL_SIGNUP_ROUTE_REDIRECT_FIX_REPORT.md: /register
 * used to call router.replace('/login') whenever POST /auth/register/start
 * failed for any reason (network error, CORS, backend unreachable, ...),
 * making the public registration route's mere reachability depend on a
 * live network call. It must never redirect to /login on failure — only
 * retry, staying on /register.
 */
describe('/register — unauthenticated, API failure', () => {
  it('does NOT redirect to /login when the register/start call fails', async () => {
    render(<RegisterStep1 />)

    await waitFor(() => {
      expect(screen.getByText(/إعادة المحاولة/)).toBeTruthy()
    })

    expect(replace).not.toHaveBeenCalledWith('/login')
    expect(push).not.toHaveBeenCalledWith('/login')
  })

  it('still proceeds to the signup form on success', async () => {
    startShouldFail = false
    render(<RegisterStep1 />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        expect.stringContaining('/register/account-information?flow=f1&sig=s1'),
      )
    })

    expect(replace).not.toHaveBeenCalledWith('/login')
  })

  it('calls the current backend contract: POST /auth/register/start with { accounttype }', async () => {
    startShouldFail = false
    render(<RegisterStep1 />)

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/register/start', {
        accounttype: 'individual',
      })
    })
  })
})

import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RegisterStep2Client from './RegisterStep2Client'

const replace = vi.fn()
const push = vi.fn()
let searchParamsMap: Record<string, string> = { flow: 'flow-1', sig: 'sig-1' }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => ({ get: (k: string) => searchParamsMap[k] ?? null }),
}))

const registerMock = vi.fn()
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ register: registerMock }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}))

vi.mock('@/lib/fingerprint', () => ({
  getHardwareFingerprint: vi.fn(async () => 'test-fingerprint'),
}))

let checkEmailAvailable = true
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(async (url: string) => {
      if (url === '/auth/check-email') return { data: { available: checkEmailAvailable } }
      return { data: {} }
    }),
  },
}))

// TurnstileCaptcha is a pre-existing, unmodified component unrelated to
// this task — stubbed so the test doesn't try to load the real Cloudflare
// script. PhoneInput is real (it's exactly what this task rebuilt) and
// defaults to Egypt on its own, so no country needs to be selected first.
vi.mock('@/components/TurnstileCaptcha', () => ({
  default: ({ onVerify }: any) => {
    onVerify('test-turnstile-token')
    return <div data-testid="turnstile-stub" />
  },
}))

vi.mock('@/components/SocialAuthButtons', () => ({ default: () => <div /> }))
vi.mock('@/components/AuthNavigationLinks', () => ({ default: () => <div /> }))

beforeEach(() => {
  replace.mockClear()
  push.mockClear()
  registerMock.mockReset()
  checkEmailAvailable = true
  searchParamsMap = { flow: 'flow-1', sig: 'sig-1' }
})

afterEach(cleanup)

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('الاسم الأول'), 'Ahmed')
  await user.type(screen.getByLabelText('اسم العائلة'), 'Mohamed')
  await user.type(screen.getByLabelText('رقم الهاتف'), '1012345678')
  await user.type(screen.getByLabelText('البريد الإلكتروني'), 'ahmed@example.com')
  await user.type(screen.getByLabelText('اسم المتجر'), 'My Store')
  await user.selectOptions(screen.getByLabelText('العملة'), 'SAR')
  await user.type(screen.getByLabelText('كلمة المرور'), 'Sup3r$ecret')
  await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'Sup3r$ecret')
}

describe('RegisterStep2Client — no username field', () => {
  it('renders no username input or label anywhere in the form', () => {
    render(<RegisterStep2Client />)
    expect(screen.queryByLabelText(/اسم المستخدم/)).toBeNull()
    expect(screen.queryByPlaceholderText(/4-16 حرف/)).toBeNull()
  })

  it('phone field defaults to a real country (Egypt) — no "+--" fallback', () => {
    render(<RegisterStep2Client />)
    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(screen.queryByText('+--')).not.toBeInTheDocument()
    // The old, separate "البلد" field is gone — the phone control owns
    // country selection on its own now.
    expect(screen.queryByText('البلد')).not.toBeInTheDocument()
  })

  // Caught by an actual browser screenshot during this task, not
  // guessed: on first render, both the phone field (required, so its
  // zod validation always fails against the empty default) and the
  // auto-suggested store slug (derived from an empty store name via a
  // mount-time `setValue(..., { shouldValidate: true })`) rendered a red
  // border and an error message before any user interaction at all.
  it('shows no error/invalid state on any field on first render, before any interaction', () => {
    render(<RegisterStep2Client />)
    expect(screen.queryByText('رقم الهاتف غير صالح')).not.toBeInTheDocument()
    expect(screen.queryByText('معرّف المتجر يجب أن يكون 3 أحرف على الأقل')).not.toBeInTheDocument()
    expect(screen.getByLabelText('رقم الهاتف')).toHaveAttribute('aria-invalid', 'false')
  })

  it('submits without a username field in the payload', async () => {
    registerMock.mockResolvedValue({
      success: true,
      authenticated: true,
      session_id: 'sess-1',
      user: { id: '1' },
      store: { slug: 'my-store' },
    })
    const user = userEvent.setup()
    render(<RegisterStep2Client />)

    await fillValidForm(user)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'إنشاء الحساب' })).not.toBeDisabled()
    })

    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }))

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1))
    const [payload] = registerMock.mock.calls[0]
    expect(payload).not.toHaveProperty('username')
    // Real E.164 output from libphonenumber-js, not the raw typed digits.
    expect(payload.phone).toBe('+201012345678')
  })
})

describe('RegisterStep2Client — validation', () => {
  it('flags mismatched passwords and blocks submission', async () => {
    const user = userEvent.setup()
    render(<RegisterStep2Client />)

    await fillValidForm(user)
    await user.clear(screen.getByLabelText('تأكيد كلمة المرور'))
    await user.type(screen.getByLabelText('تأكيد كلمة المرور'), 'Different1$')
    await user.tab()

    await waitFor(() => {
      expect(screen.getByText('كلمتا المرور غير متطابقتين')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'إنشاء الحساب' })).toBeDisabled()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('rejects a structurally invalid phone number for the selected country', async () => {
    const user = userEvent.setup()
    render(<RegisterStep2Client />)

    await user.type(screen.getByLabelText('رقم الهاتف'), '123')
    await user.tab()

    await waitFor(() => {
      expect(screen.getByText('رقم الهاتف غير صالح')).toBeTruthy()
    })
  })

  it('does not redirect to /login and preserves entered data when the backend call fails', async () => {
    registerMock.mockRejectedValue({ response: { data: { message: 'فشل الاتصال بالخادم' } } })
    const user = userEvent.setup()
    render(<RegisterStep2Client />)

    await fillValidForm(user)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'إنشاء الحساب' })).not.toBeDisabled()
    })
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }))

    await waitFor(() => {
      expect(screen.getByText('فشل الاتصال بالخادم')).toBeTruthy()
    })

    expect(replace).not.toHaveBeenCalledWith('/login')
    expect((screen.getByLabelText('الاسم الأول') as HTMLInputElement).value).toBe('Ahmed')
    expect((screen.getByLabelText('اسم المتجر') as HTMLInputElement).value).toBe('My Store')
  })

  it('guards against duplicate submission from rapid double-click', async () => {
    registerMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        success: true, authenticated: true, session_id: 's', user: {}, store: { slug: 'x' },
      }), 50)),
    )
    const user = userEvent.setup()
    render(<RegisterStep2Client />)

    await fillValidForm(user)
    const submit = screen.getByRole('button', { name: 'إنشاء الحساب' })
    await waitFor(() => expect(submit).not.toBeDisabled())

    await user.click(submit)
    await user.click(submit) // second click while the first is in flight

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1))
  })
})

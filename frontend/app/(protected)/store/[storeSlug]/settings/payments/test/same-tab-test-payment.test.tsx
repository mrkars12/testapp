import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

/* ══════════════════════════════════════════════════════════════════════
   Merchant Test Payment — one tab.

   Replaces `moyasar-failure-return.test.tsx`, which asserted the exact
   opposite: that this page opened the gateway in a window of its own,
   polled the backend from here behind an "أكمل الدفع / تم فتح صفحة الدفع
   في نافذة جديدة" screen, and called `close()` on that window once the
   backend settled. That architecture is gone from this surface, so the
   suite that pinned it down had to go with it — a test asserting removed
   behaviour is not a regression test, it is a blocker.

   What is asserted now is what the storefront checkout already asserts:
   the gateway gets THIS tab, no window is ever opened, and the outcome
   comes from the backend at the result route.

   The three strings are checked by name because a report once claimed
   this UI was gone when it was not.
   ══════════════════════════════════════════════════════════════════════ */

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
  useParams: () => ({ storeSlug: 'demo-store' }),
}))

vi.mock('@/lib/useActiveStoreReady', () => ({
  useActiveStoreReady: () => ({ storeSlug: 'demo-store', ready: true, bootstrapStatus: 'ready' }),
}))

const post = vi.fn()
const get = vi.fn()

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}))

let searchParams = new URLSearchParams()

const GATEWAYS = [
  {
    key: 'moyasar',
    name_ar: '',
    name_en: 'Moyasar',
    supports_test_mode: true,
    accounts: [{ mode: 'test', status: 'active' }],
  },
]

const MOYASAR_URL = 'https://api.moyasar.com/v1/invoices/inv_test_123'
const TOKEN = 'mtest:abc123'

/** Verbatim from the two-window screen this refactor removed. */
const LEGACY = [
  'أكمل الدفع',
  'تم فتح صفحة الدفع في نافذة جديدة',
  'إلغاء والرجوع',
  'نافذة جديدة',
]

let assign: ReturnType<typeof vi.fn>
let openSpy: ReturnType<typeof vi.fn>
let closeSpy: ReturnType<typeof vi.fn>
let replaceState: ReturnType<typeof vi.fn>

async function loadPage() {
  const { default: TestPaymentPage } = await import('./page')
  return TestPaymentPage
}

/** Renders the picker with one testable gateway and starts a payment. */
async function startTestPayment() {
  const TestPaymentPage = await loadPage()
  render(<TestPaymentPage />)
  await waitFor(() => screen.getByText('Moyasar'))
  fireEvent.click(screen.getByRole('button', { name: /ابدأ الدفعة التجريبية/ }))
}

function expectNoLegacyScreen() {
  for (const legacy of LEGACY) {
    expect(screen.queryByText(new RegExp(legacy))).toBeNull()
  }
}

beforeEach(() => {
  replace.mockClear()
  get.mockReset()
  post.mockReset()
  vi.restoreAllMocks()
  searchParams = new URLSearchParams()

  assign = vi.fn()
  openSpy = vi.fn()
  closeSpy = vi.fn()
  replaceState = vi.fn()

  vi.stubGlobal('open', openSpy)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://admin.test', href: 'https://admin.test/store/demo-store/settings/payments/test', assign },
  })
  Object.defineProperty(window, 'history', {
    configurable: true,
    value: { ...window.history, replaceState },
  })
  Object.defineProperty(window, 'close', { configurable: true, value: closeSpy })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/* ── Same-tab redirect ─────────────────────────────────────────────── */

describe('starting a test payment', () => {
  beforeEach(() => {
    get.mockResolvedValueOnce({ data: GATEWAYS })
  })

  it('sends THIS tab to the gateway', async () => {
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })

    await startTestPayment()
    await waitFor(() => expect(assign).toHaveBeenCalledWith(MOYASAR_URL))
  })

  it('never opens a window, and never closes one', async () => {
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })

    await startTestPayment()
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(openSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('never shows the legacy two-window screen', async () => {
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })

    await startTestPayment()
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expectNoLegacyScreen()
  })

  it('remembers the attempt in this tab before leaving', async () => {
    // A Back from the gateway, or a refresh, then lands on a page that
    // knows which attempt to resolve rather than on a blank picker.
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })

    await startTestPayment()
    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(
        null,
        '',
        `/store/demo-store/settings/payments/test?token=${encodeURIComponent(TOKEN)}`,
      ),
    )
  })

  it('asks the provider to return to the result route of this store', async () => {
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })

    await startTestPayment()
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1]).toEqual({
      gateway: 'moyasar',
      return_url: 'https://admin.test/store/demo-store/settings/payments/test/result',
    })
  })

  it('refuses a next action that is not an http(s) URL', async () => {
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: 'javascript:alert(1)' } },
    })

    await startTestPayment()
    await waitFor(() => screen.getByText('تعذّر فتح صفحة الدفع الخاصة بالبوابة.'))
    expect(assign).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('never sends an unperformed action to the result route', async () => {
    /* The reported bug, pinned.
     *
     * Moyasar began returning `client_sdk` for any account with a
     * publishable key. This page handles only `redirect`, and everything
     * else fell through to `goToResult()` — so clicking Start went
     * immediately to
     *   /settings/payments/test/result?token=…
     * showing "requires_action" for a payment that had never reached
     * Moyasar. A pending RESULT was manufactured out of an action nobody
     * had performed.
     *
     * The result route is the RETURN context. It must never be the first
     * destination after Start.
     */
    post.mockResolvedValueOnce({
      data: {
        token: TOKEN,
        status: 'requires_action',
        next_action: { kind: 'client_sdk', publishable_key: 'pk_test_x' },
      },
    })

    await startTestPayment()

    await waitFor(() => screen.getByText(/لا يمكن تنفيذ هذا الإجراء من صفحة الاختبار/))
    // The three things that made this a bug rather than a limitation:
    expect(replace).not.toHaveBeenCalled()   // no result route
    expect(assign).not.toHaveBeenCalled()    // and no navigation at all
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('reports the unhandled kind rather than a payment state', async () => {
    // The merchant must be able to tell "this page cannot do that" from
    // "your gateway is pending" — the old behaviour made them identical.
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'iframe', url: 'https://x.test' } },
    })

    await startTestPayment()
    await waitFor(() => screen.getByText(/iframe/))
    expect(replace).not.toHaveBeenCalled()
  })

  it('goes straight to the result when the backend already settled it', async () => {
    post.mockResolvedValueOnce({ data: { token: TOKEN, status: 'captured', next_action: null } })

    await startTestPayment()
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/store/demo-store/settings/payments/test/result?token=${TOKEN}`),
    )
    expect(assign).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('starts exactly one test payment however many times Start is pressed', async () => {
    // Each one is a real charge against the merchant's gateway.
    post.mockResolvedValue({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })

    const TestPaymentPage = await loadPage()
    render(<TestPaymentPage />)
    await waitFor(() => screen.getByText('Moyasar'))
    const button = screen.getByRole('button', { name: /ابدأ الدفعة التجريبية/ })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(post.mock.calls.filter((c) => c[0] === '/stores/payments/test')).toHaveLength(1)
  })

  it('stays on the picker, unlocked, when the backend refuses to start', async () => {
    post.mockRejectedValueOnce({ response: { data: { message: 'البوابة مش مظبوطة.' } } })

    await startTestPayment()
    await waitFor(() => screen.getByText('البوابة مش مظبوطة.'))
    expect(assign).not.toHaveBeenCalled()
    expectNoLegacyScreen()
    // Unlocked: a second attempt is allowed after a failed start.
    post.mockResolvedValueOnce({
      data: { token: TOKEN, status: 'requires_action', next_action: { kind: 'redirect', url: MOYASAR_URL } },
    })
    fireEvent.click(screen.getByRole('button', { name: /ابدأ الدفعة التجريبية/ }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith(MOYASAR_URL))
  })
})

/* ── Coming back ───────────────────────────────────────────────────── */

describe('returning to this page carrying a token', () => {
  it('verifies with the backend and resolves to the result route', async () => {
    // A Back from the gateway, or a refresh mid-payment. The token only
    // selects the attempt; the outcome comes from the server.
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    post.mockResolvedValueOnce({ data: { token: TOKEN, status: 'failed', next_action: null } })

    const TestPaymentPage = await loadPage()
    render(<TestPaymentPage />)

    await waitFor(() => expect(post).toHaveBeenCalledWith(`/stores/payments/test/${TOKEN}/sync`, {}))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/store/demo-store/settings/payments/test/result?token=${TOKEN}`),
    )
  })

  it('resolves to the result route even when the sync call fails', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    post.mockRejectedValueOnce(new Error('network'))

    const TestPaymentPage = await loadPage()
    render(<TestPaymentPage />)
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(`/store/demo-store/settings/payments/test/result?token=${TOKEN}`),
    )
  })

  it('never re-shows the gateway picker for an attempt that already exists', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    post.mockResolvedValueOnce({ data: { token: TOKEN, status: 'requires_action', next_action: null } })

    const TestPaymentPage = await loadPage()
    render(<TestPaymentPage />)

    expect(screen.queryByRole('button', { name: /ابدأ الدفعة التجريبية/ })).toBeNull()
    expect(get).not.toHaveBeenCalled()
    expectNoLegacyScreen()
  })

  it('opens no window on the way back either', async () => {
    searchParams = new URLSearchParams(`token=${TOKEN}`)
    post.mockResolvedValueOnce({ data: { token: TOKEN, status: 'captured', next_action: null } })

    const TestPaymentPage = await loadPage()
    render(<TestPaymentPage />)
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(openSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
  })
})

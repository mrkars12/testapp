'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useStore, type CartItem } from '../components/StoreContext'
import { normalizePaymentError } from '@/lib/paymentErrors'
import { resolvePaymentAction, type PaymentAction, type RawNextAction } from '@/lib/payments/actions'
import { isTerminalState, resolvePaymentState, type PaymentState } from '@/lib/payments/state'
import { startPaymentPoll, type PaymentPollHandle } from '@/lib/payments/poll'
import { navigateSameTab } from '@/lib/payments/sameTabNavigation'
import {
  buildReturnUrl,
  checkoutUrlWithToken,
  readReturnContext,
} from '@/lib/payments/returnContext'
import {
  allowsCartEditing,
  applyReconciledState,
  applyServerState,
  isBusyPhase,
  isSettledPhase,
  PHASE_HEADLINE,
  phaseForPaymentState,
  showsForm,
  type CheckoutPhase,
} from '@/lib/payments/checkoutMachine'
import {
  hasRealPaymentAttempt,
  readServerAttemptStarted,
} from '@/lib/payments/paymentStart'
import {
  isOfferingRenderable,
  resolvePresentationMode,
  type PaymentPresentationMode,
} from '@/lib/payments/presentation'
import {
  destroyPaymentForm,
  loadMoyasarForm,
  mountMoyasarForm,
  readFormConfig,
  resolveFormVersion,
} from '@/lib/payments/moyasarForm'
import { resolveMethodDisplayName } from '@/lib/payments/methodLabels'
import {
  classifyRetryFailure,
  type RetryFailure,
} from '@/lib/payments/retryFailure'
import {
  announceCheckoutChanged,
  subscribeCheckoutChanges,
} from '@/lib/payments/checkoutSync'

/* ══════════════════════════════════════════════════════════════════════
   ONE checkout surface.

   Cart, contact details, shipping, payment method, the payment itself
   and the payment's outcome all live on this page and this URL. There is
   no second tab, no popup, no "waiting for payment" route, and no
   separate page that decides the result — the arrangement this replaced
   had the outcome depend on which of two pages was mounted in which of
   two tabs, and a customer whose gateway declined without redirecting
   was simply stranded.

   How a gateway is hosted is decided by ONE branch, over the backend's
   `presentation_mode` (lib/payments/presentation.ts):

     offline           — no provider surface at all (COD, bank transfer)
     same_tab_redirect — this tab goes to the provider and comes back
                         here, to this URL, carrying its checkout token
     embedded          — the provider's own form renders in this page

   No gateway is named anywhere below in a *branch*. The one place a
   provider is named is the embedded renderer, which mounts that
   provider's own official component — there is no generic way to mount
   a specific vendor's SDK, and pretending otherwise would mean writing
   our own card fields, which is exactly what must never happen. The
   choice of whether to render it at all is still made by the capability
   layer, never by a gateway name.

   Embedded here means the provider's own form runs inside this page and
   our code never sees a card field. A 3DS challenge is still a
   provider-mandated top-level hop to the bank and back to this same
   URL; that is not a hosted-page redirect and is not described as one.

   The result is always the SERVER's: after any return, completion or
   3DS, the page asks the backend what happened and renders that. A
   provider's query parameter is at most a hint about which message to
   show sooner.
   ══════════════════════════════════════════════════════════════════════ */

interface PaymentOffering {
  id: string
  method: string
  gateway: string
  name_ar: string
  name_en: string
  commitment_kind: string
  position: number
  policy: unknown
  /** Added by the backend capability layer; absent on an older deploy. */
  presentation_mode?: PaymentPresentationMode
  next_action_kinds?: string[]
  /**
   * Every method this one payment EXPERIENCE covers.
   *
   * The backend groups a merchant's offerings by the provider form that
   * hosts them, so one entry here can stand for more than one enabled
   * method — Moyasar's card form accepts mada as a network, so `card`
   * and `mada` arrive as one choice with `methods: ['card','mada']`
   * rather than as two radio buttons mounting the same form. Absent on
   * an older backend, which is read as "just this method".
   */
  methods?: string[]
  /** The merchant offering rows behind this experience. */
  offering_ids?: string[]
  /** Stable id of the provider surface: the form's, or the method's. */
  form_id?: string
}

interface FormState {
  name: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
}

/** What `POST /storefront/:slug/checkout` returns. */
interface CheckoutResponse {
  checkout_token?: string
  next_action?: RawNextAction | null
  payment_redirect_url?: string | null
  order?: { order_number?: string } | null
}

/** What `GET /storefront/:slug/checkout/:token` returns. */
interface CheckoutStatusResponse {
  checkout_token?: string
  /**
   * The state of the BASKET this checkout was priced from.
   *
   * `converted` means the basket became an order — terminal — and this
   * tab must stop being payable whether or not it is the tab that paid.
   * It says nothing about a payment: whether the order was paid is read
   * from `order` below, as always.
   *
   * Absent on an older backend and `null` for a checkout with no cart
   * (the stateless path), both of which read as "no cart to speak of".
   */
  cart_status?: 'active' | 'converted' | 'abandoned' | null
  /**
   * The basket moved after this checkout was priced.
   *
   * A detector, computed server-side from `Checkout.quote_hash`. It
   * refuses nothing and changes no amount — it says the figure on
   * screen is no longer what this basket would cost.
   */
  cart_quote_stale?: boolean
  payment_status?: string | null
  /**
   * The latest attempt's own outcome, which is a different question from
   * the intent's `payment_status`: the intent says whether the order can
   * still be paid, the attempt says what happened to the try just made.
   * A declined card leaves the intent open on purpose, so this is what
   * tells the page to stop spinning and offer a retry.
   */
  attempt_status?: string | null
  attempt_sequence?: number | null
  /**
   * Whether the customer actually SUBMITTED a payment, as opposed to
   * having been handed a form to submit one with.
   *
   * The server's own answer, and the only witness that survives a
   * refresh. An embedded attempt has a row, an intent and a `processing`
   * status from the moment the provider's form is prepared — long before
   * the payer touches it — so without this the page cannot tell "there
   * is a payment to verify" from "someone opened a form".
   *
   * Absent on an older backend, which reads as *unknown* rather than as
   * `false`; see lib/payments/paymentStart.ts.
   */
  payment_attempt_started?: boolean
  /**
   * The checkout's OWN total, in major units, as the server priced it.
   *
   * Distinct from `order.total`, which exists only once a payment has
   * succeeded: a declined checkout has no order at all. This is what the
   * customer was quoted and what a retry will be for, so it is the
   * authoritative amount whenever there is no order yet.
   *
   * Optional: an older backend does not send it, and its absence means
   * "not reported", never "zero".
   */
  total?: string | null
  /**
   * The details this checkout was created with, when the server is
   * willing to hand them back.
   *
   * A declined 3DS payment returns through a redirect, so the page
   * showing the failure is a new document with an empty form — these are
   * what let "try again" go straight back to paying instead of asking
   * for all of it a second time.
   *
   * **`null` whenever the checkout can no longer be paid** (paid,
   * expired, abandoned): the server decides that, and this page must
   * work without them. It does — the retry falls back to the form.
   *
   * The order note is deliberately not among them; nothing in the
   * payment path needs it.
   */
  customer?: {
    name?: string | null
    email?: string | null
    phone?: string | null
    address_line?: string | null
    city?: string | null
  } | null
  selected_offering_id?: string | null
  /**
   * THE CHECKOUT THAT REPLACED THIS ONE — the server's own answer, and
   * identity only.
   *
   * A retry does not reopen the checkout that failed; it creates a new
   * one, and the old token lives on in this tab's history. This is the
   * relation the backend records at that moment
   * (`Checkout.supersedes_id`), resolved to the end of its chain and
   * published here so a page restored onto an old entry can find out
   * that it is holding a spent checkout.
   *
   * It carries no status, no amount and no order — and it is not
   * believed about any of them. What that checkout's payment IS comes
   * from reading that checkout, and only a terminal success there is a
   * success.
   *
   * Absent on an older backend, which reads as "no successor" and is
   * exactly the behaviour that preceded this field.
   */
  superseded_by_token?: string | null
  next_action?: RawNextAction | null
  order?: {
    order_number?: string
    status?: string
    payment_status?: string
    total?: string
  } | null
}

const emptyForm: FormState = { name: '', phone: '', email: '', address: '', city: '', notes: '' }

/**
 * Whether this page still holds the details a checkout needs.
 *
 * Only the fields the server requires; `email` and `notes` are optional
 * and their absence says nothing about whether the rest was entered.
 * False after any full page load — including the redirect back from a
 * 3DS challenge — because the form lives in React state and nothing
 * repopulates it from the server.
 */
function hasCustomerDetails(form: FormState): boolean {
  return (
    form.name.trim() !== '' &&
    form.phone.trim() !== '' &&
    form.address.trim() !== '' &&
    form.city.trim() !== ''
  )
}

const IconMinus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14" /></svg>
)
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
)
/**
 * The amount placeholder, for the window before an authoritative total
 * is known. Deliberately not "0": a real payment of 50 briefly rendered
 * as "0 SAR" on every history restoration, which reads as a lost
 * payment. An em dash reads as "not known yet", which is the truth.
 */
const AMOUNT_UNKNOWN = '—'

const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)
const IconSpinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const IconBag = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)
const IconLock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)
const IconTruck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="1" y="3" width="15" height="13" rx="1" /><path d="M16 8h4l3 3v5h-7V8Z" />
    <circle cx="5.5" cy="18.5" r="1.8" /><circle cx="18.5" cy="18.5" r="1.8" />
  </svg>
)
const IconUser = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
)
const IconCheck = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconAlert = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><path d="M12 8v5" /><path d="M12 16h.01" />
  </svg>
)
export default function CheckoutPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const {
    store, storeSlug, cart, cartCount, cartTotal,
    updateCartQty, removeFromCart, clearCart, setCartLock,
    /*
     * The SERVER's answers about this basket.
     *
     * `cartStatus` is what a second tab learns when the first one pays:
     * `converted` means this basket became an order, and this tab must
     * stop being payable — see `tearDownProviderForm`. `cartPublicId`
     * is what makes a cross-tab ping reach a tab that has no checkout
     * token of its own yet.
     */
    cartStatus, cartPublicId, convertedOrderNumber, refreshCart,
  } = useStore()

  // The store this checkout belongs to comes from the URL and nowhere
  // else. `storeSlug` is the context's copy of the same route param; the
  // param is preferred so a stale context can never point a payment at a
  // different merchant's gateway configuration.
  const slug = (params?.slug as string) || storeSlug

  /* ── Return context ──────────────────────────────────────────────────
     The only thing that survives the trip to a provider and back. Read
     once per URL; validated for shape before it is ever put in a request
     path, because it arrives via a third party's redirect. */
  const returnContext = useMemo(() => readReturnContext(searchParams), [searchParams])

  const [form, setForm] = useState<FormState>(emptyForm)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [paymentMethods, setPaymentMethods] = useState<PaymentOffering[]>([])
  const [loadingMethods, setLoadingMethods] = useState(true)
  const [selectedMethod, setSelectedMethod] = useState<string>('')
  const [methodError, setMethodError] = useState<string | null>(null)

  /* ── The payment phase ───────────────────────────────────────────────
     A page load carrying a checkout token used to be treated, on its
     own, as a return from a provider — it started in RETURNING and
     announced "جارٍ التحقق من نتيجة الدفع". That is wrong for the most
     ordinary thing a customer can do: the token is written into this
     tab's URL when the provider's form is MOUNTED, so refreshing a
     checkout with an untouched payment form in it claimed to be
     verifying a payment that had never been submitted.

     So the token alone no longer means a return. Only the provider's own
     evidence does — a payment id it appended, or a cancellation hint —
     and a bare token is resolved against the server before this page
     says anything at all (§ the resume effect below). */

  /*
   * IDLE, never RETURNING — even when the provider's own evidence is in
   * the URL.
   *
   * `RETURNING` renders "جارٍ التحقق من نتيجة الدفع…", and a mount is
   * not evidence that anything needs verifying: a Back, a Forward or a
   * refresh onto the return URL of a payment that settled minutes ago
   * looks identical to the original return. Starting in RETURNING
   * announced a verification for a finished payment before this page
   * had asked anyone anything.
   *
   * Nothing is rendered from this value while `resuming` is true — the
   * page shows its neutral restoration state instead — and the first
   * authoritative read is what picks the real phase.
   */
  const [phase, setPhase] = useState<CheckoutPhase>('IDLE')
  /**
   * A bare token, not yet resolved.
   *
   * Neither "returning" nor "idle" until the server has been asked, and
   * rendered as neither: the page shows its loading state rather than
   * flashing a payment form at someone who is mid-verification, or a
   * verification at someone who submitted nothing.
   */
  const [resuming, setResuming] = useState(() => !!returnContext.token)
  /**
   * The provider's form reported that the payer pressed Pay.
   *
   * A ref rather than state because it is read inside callbacks that
   * must not be re-created (and re-subscribed) when it flips, and
   * because nothing renders from it. Set from Moyasar's `on_initiating`,
   * which is the provider's own "this customer is submitting now" —
   * see lib/payments/paymentStart.ts for why that is the definition.
   */
  const paymentSubmittedRef = useRef(false)
  const [token, setToken] = useState<string | null>(returnContext.token)
  /**
   * The checkout this page is working on RIGHT NOW, readable from inside
   * an async callback that started before it changed.
   *
   * `token` closes over the render it was read in, which is exactly the
   * wrong thing for work that outlives that render. Reconciliation makes
   * TWO round trips before it writes anything, and a retry pressed
   * beside it changes the answer to "which checkout is this page about?"
   * while they are in flight. Kept in a ref so the check is against the
   * live value, and written synchronously wherever the token moves.
   */
  const activeTokenRef = useRef<string | null>(returnContext.token)
  /**
   * The token this page was OPENED with — the marker that this load
   * arrived as a return from a provider, rather than being the page the
   * payment was started on.
   *
   * Captured once at mount, because the checkout writes its own token
   * into the URL and `useSearchParams()` re-renders on that; comparing
   * against the live value made a normal checkout look like a return.
   *
   * Cleared when an attempt is released: after a retry or a change of
   * method, whatever this page arrived carrying is spent, and the load
   * is no longer standing in front of that payment's result.
   */
  const [openedWithToken, setOpenedWithToken] = useState<string | null>(
    returnContext.token,
  )
  /**
   * THIS PAGE IS RE-VERIFYING A SETTLED, UNSUCCESSFUL PAYMENT.
   *
   * True for exactly one window, and one trigger: a bfcache restore
   * (`pageshow` with `persisted`) of a page that was frozen showing a
   * decline. The browser puts the old pixels back before any script
   * runs, so what is on screen is a claim this document made at some
   * earlier point about a checkout that may since have been replaced —
   * and the customer must not be able to act on it until the server has
   * been asked again.
   *
   * Deliberately NOT armed by focus or by a visibility change. Those
   * mean "the customer looked at a page that has been here all along",
   * and treating them this way blinked the failure panel out from under
   * anyone who switched tabs. A restore is different in kind: the
   * document was frozen and an unknown amount of time passed.
   *
   * Nothing is read from storage to decide this, and nothing is stored.
   * Whether there IS a replacement is the server's answer, on the
   * status endpoint, like everything else on this page.
   */
  const [revalidatingSettled, setRevalidatingSettled] = useState(false)
  /**
   * The token a release just spent, waiting to be declared.
   *
   * `releaseAttempt` drops the old checkout before the replacement
   * exists, and the replacement is what carries the relation: the next
   * `POST /checkout` sends this as `supersedes_checkout_token`, and the
   * BACKEND decides whether the claim holds (same store, same mode, a
   * predecessor that has no order, matching customer details) and
   * writes it into the new row. A ref because nothing renders from it
   * and it is read across an await.
   *
   * Not cleared by a refused retry: that creates no replacement, and
   * the checkout being released is still the one the next attempt will
   * supersede.
   */
  const supersedesTokenRef = useRef<string | null>(null)
  const [status, setStatus] = useState<CheckoutStatusResponse | null>(null)
  /** The poll ran out of budget without a terminal state (§ poll.ts). */
  const [stalled, setStalled] = useState(false)
  /**
   * What the provider's own form needs to mount, once the backend has
   * prepared an embedded payment. Client-safe values only — the backend
   * puts nothing else in a next action.
   */
  const [embedded, setEmbedded] = useState<{
    publishableKey: string
    config: Record<string, unknown>
    sdkHints: Record<string, unknown>
  } | null>(null)
  const [embeddedError, setEmbeddedError] = useState<string | null>(null)
  /**
   * Why a retry could not be started, shown on the failure panel itself.
   *
   * The failure panel is where the customer pressed the button, so it is
   * where the answer belongs. `submitError` cannot serve: it renders
   * inside the checkout form, which is precisely the surface a retry
   * must not put back on screen.
   */
  const [retryNotice, setRetryNotice] = useState<RetryFailure | null>(null)
  /**
   * THE CART LINES THIS PAYMENT WAS PRICED FROM.
   *
   * A checkout is a SNAPSHOT, not a live view of the cart. The server
   * prices `items[]` once, at `POST /checkout`, out of its own product
   * rows — the browser never sends an amount — and that one figure
   * becomes `quote_total_minor`, the `PaymentIntent.amount_minor`, the
   * amount handed to the provider and, on success, the Order total.
   * Nothing the cart does afterwards can move it.
   *
   * Which is exactly why the cart must stop looking live once a payment
   * exists. The order summary sits beside the provider's form with
   * working +/- buttons, so a customer could raise the quantity to 5,
   * watch the summary read 250 SAR, and pay the 50 SAR the form was
   * mounted with. The money was never wrong; the screen was.
   *
   * Captured from the exact array that was sent, so what is displayed is
   * what was priced.
   */
  const [pricedLines, setPricedLines] = useState<typeof cart | null>(null)
  /**
   * The cart as it stood the moment this payment settled UNSUCCESSFULLY.
   *
   * Taken so the page can answer one question afterwards: has the
   * customer changed their order since the decline? Everything the old
   * checkout still holds — its server record, its total — describes the
   * cart in here, and the instant the live cart stops matching it, that
   * record stops being evidence of what the next payment will cost.
   *
   * `pricedLines` is preferred where it exists, and the live cart is the
   * fallback for the load that has no snapshot at all: a 3DS decline
   * comes back as a brand-new document, where the only cart there is is
   * the one restored from storage.
   */
  const [settledLines, setSettledLines] = useState<typeof cart | null>(null)
  /**
   * What the payment that just settled was actually for.
   *
   * A SEPARATE value from the cart total, and that separation is the
   * point: once the cart is editable again the two answer different
   * questions — "what was refused" and "what would I be paying now" —
   * and a single figure serving both meant a declined 300 SAR attempt
   * silently re-labelled itself 400 SAR the moment the customer added
   * two more.
   *
   * Captured once, from the SERVER's own record of that checkout (its
   * `total`), falling back to the snapshot this page was priced from —
   * which is frozen at the instant of the request, not read from the
   * cart afterwards. Never derived from the live cart, at any point.
   */
  const [failedAttemptAmount, setFailedAttemptAmount] = useState<string | null>(null)
  /**
   * The provider has actually put its form into our container.
   *
   * `PROVIDER_UI` is entered the instant the backend's next action
   * arrives, but the provider's assets are only THEN downloaded and
   * mounted. That gap is not instant — a cold CDN fetch measured ~1s in
   * a real browser — and the panel spent it rendering its full chrome
   * around an EMPTY box: the headline "أدخل بيانات البطاقة", a payment
   * method row, an amount and a "تغيير طريقة الدفع" button, with no card
   * fields under any of it.
   *
   * On a RETRY that reads as exactly what this flow exists to prevent —
   * a payment-method screen appearing between the failure panel and the
   * provider's form. So the phase still moves when the action arrives
   * (nothing about the state machine changes), and the PRESENTATION
   * waits here until there is really something to present.
   */
  const [providerFormReady, setProviderFormReady] = useState(false)
  /**
   * The customer has changed their order since the payment settled.
   *
   * The one fact that makes everything the failed checkout still holds
   * stale: its server record, its total, and the snapshot it was priced
   * from all describe a cart that no longer exists. Read here so the
   * retry and the amount on screen answer it the same way.
   */
  const cartEditedSinceSettle = !!settledLines && linesDiffer(settledLines, cart)
  /**
   * What the provider's form actually needs, narrowed out of the next
   * action. Derived rather than stored: an action that does not carry a
   * usable config is a fact about the action, not an event, and the
   * message below is simply what this page shows when it holds one.
   */
  const embeddedConfig = useMemo(
    () => (embedded ? readFormConfig(embedded.config) : null),
    [embedded],
  )
  const embeddedFault = embeddedError ??
    (embedded && !embeddedConfig
      ? 'تعذّر تجهيز نموذج الدفع. اختر طريقة دفع أخرى أو حاول مرة أخرى.'
      : null)

  /**
   * Guards the submit path itself, not just the button's disabled state.
   * A double click, an Enter-key repeat and a re-render racing its own
   * effect all reach handleSubmit before React has painted the new
   * phase; a ref flips synchronously and they don't.
   */
  const submitLockRef = useRef(false)
  /**
   * One idempotency key per logical attempt. The backend's existing
   * checkout idempotency (CheckoutService.createAndCommit) replays the
   * original response for a repeat of the same key instead of creating a
   * second order, ledger entry and stock decrement — so a click that
   * slips past the lock, or a retried request after a network timeout,
   * cannot produce a duplicate. Cleared only on an explicit retry, which
   * is a genuinely new attempt.
   */
  const idempotencyKeyRef = useRef<string | null>(null)
  /**
   * A retry is between its click and its answer.
   *
   * Distinct from `submitLockRef`, which means "an attempt is live" and
   * stays held for as long as the provider's form is mounted — using it
   * here would have made "المحاولة مرة أخرى" a no-op, because a declined
   * payment reaches FAILED with that lock still held.
   *
   * A ref, and read before anything else, because two clicks dispatched
   * before React has re-rendered both see the same `phase`. Cleared in
   * the three places the phase actually leaves RETRY_PREPARING.
   */
  const retryLockRef = useRef(false)
  /** The provider payment reference this page has already confirmed. */
  const confirmedRef = useRef<string | null>(null)
  /** Where the provider's own form is mounted. */
  const embeddedContainerRef = useRef<HTMLDivElement | null>(null)
  /**
   * Which embedded payment is already mounted in that element.
   *
   * Keyed on the callback URL, which carries this checkout's token and is
   * therefore unique per attempt. Without it a re-render or a Strict-Mode
   * double-invoke mounts the provider's form twice into the same element
   * and the customer sees two sets of card fields.
   */
  const mountedFormRef = useRef<string | null>(null)
  const pollRef = useRef<PaymentPollHandle | null>(null)

  const currency = store?.currency || 'EGP'

  /* ── Payment methods ────────────────────────────────────────────────
     Scoped to this store by the slug in the request path. An offering
     whose adapter can only emit an action kind this checkout cannot
     render is dropped rather than offered: a method that fails only at
     the moment the customer presses Pay is worse than one that was never
     shown. */
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    fetch(`/api/storefront/${slug}/payment-methods`)
      .then((res) => res.json())
      .then((data: PaymentOffering[]) => {
        if (cancelled) return
        const usable = (Array.isArray(data) ? data : []).filter(isOfferingRenderable)
        setPaymentMethods(usable)
        if (usable.length > 0) setSelectedMethod((current) => current || usable[0].id)
      })
      .catch(() => { if (!cancelled) setPaymentMethods([]) })
      .finally(() => { if (!cancelled) setLoadingMethods(false) })
    return () => { cancelled = true }
  }, [slug])

  const selectedOffering = paymentMethods.find((m) => m.id === selectedMethod) || null
  const presentationMode = resolvePresentationMode(selectedOffering)

  /* ── Authoritative verification ─────────────────────────────────────
     One round trip: ask the provider through our backend (so the answer
     does not depend on a webhook that may not have landed yet), then
     read the backend's own record. Both are idempotent and the facts go
     through the same applier the webhook uses, so a callback and a
     webhook arriving in either order converge on one state and apply
     once. */
  /**
   * Reads the checkout, and asks the provider NOTHING.
   *
   * Split out from the round trip below so there is a way to find out
   * whether a payment exists that does not itself count as verifying
   * one. This is a plain GET of our own record: no provider call, no
   * fact, no state change on the server.
   */
  /**
   * The same read, WITHOUT publishing what it found.
   *
   * Split out because one caller asks about a checkout that is not the
   * one on screen: the successor lookup below reads a DIFFERENT
   * checkout's record, and publishing that into `status` would put
   * another checkout's total and customer on this page before anything
   * had decided the two are related.
   */
  const fetchCheckoutStatus = useCallback(
    async (activeToken: string): Promise<CheckoutStatusResponse | null> => {
      try {
        const res = await fetch(`/api/storefront/${slug}/checkout/${activeToken}`)
        if (!res.ok) return null
        return (await res.json()) as CheckoutStatusResponse
      } catch {
        return null
      }
    },
    [slug],
  )

  const readCheckoutStatus = useCallback(
    async (activeToken: string): Promise<CheckoutStatusResponse | null> => {
      const data = await fetchCheckoutStatus(activeToken)
      if (!data) return null
      // Targeted revalidation: this is the order and payment summary
      // the page renders, refreshed in place. Nothing else on the page
      // is touched and the document is never reloaded.
      setStatus(data)
      return data
    },
    [fetchCheckoutStatus],
  )

  /** The one state to render, out of everything the status carried. */
  const stateFromStatus = (data: CheckoutStatusResponse): PaymentState | null =>
    resolvePaymentState({
      intentStatus: typeof data.payment_status === 'string' ? data.payment_status : null,
      orderPaymentStatus: data.order?.payment_status ?? null,
      attemptStatus: typeof data.attempt_status === 'string' ? data.attempt_status : null,
      hasOrder: !!data.order,
    })

  const fetchAuthoritativeState = useCallback(
    async (activeToken: string): Promise<PaymentState | null> => {
      try {
        await fetch(`/api/storefront/${slug}/checkout/${activeToken}/sync`, { method: 'POST' })
      } catch {
        /* non-fatal: the read below still reflects last-known state */
      }

      const data = await readCheckoutStatus(activeToken)
      return data ? stateFromStatus(data) : null
    },
    [slug, readCheckoutStatus],
  )

  /**
   * THE AUTHORITATIVE SETTLED SUCCESS THAT REPLACED THIS CHECKOUT — or
   * null, which is the ordinary answer.
   *
   * Asked of one token: the end of this tab's succession chain for the
   * checkout the page is holding. The record says only WHICH checkout
   * replaced it; whether that checkout was paid is read from the server
   * here, on the same endpoint every other reading on this page comes
   * from. A successor that is anything other than a settled success is
   * not one of this function's answers — it returns null, the page
   * stops treating the current checkout as superseded, and behaves
   * exactly as it did before.
   *
   * Deliberately does NOT publish what it read: `status` belongs to the
   * checkout on screen, and it only becomes the successor's when the
   * successor is actually adopted.
   */
  const readSupersedingSuccess = useCallback(
    async (
      current: CheckoutStatusResponse | null,
    ): Promise<{ token: string; data: CheckoutStatusResponse } | null> => {
      /*
       * The SERVER says whether this checkout was replaced, and by
       * which one. Nothing browser-side is consulted, and nothing
       * browser-side could be believed if it were.
       */
      const successor = current?.superseded_by_token
      if (!successor) return null

      /*
       * And the successor's own record says what happened to it — the
       * same authoritative endpoint, read again for a different
       * checkout. A successor that is anything other than a settled
       * SUCCESS is not an answer: the page goes back to being about its
       * own checkout and renders exactly what it always did.
       */
      const data = await fetchCheckoutStatus(successor)
      const state = data ? stateFromStatus(data) : null
      if (!data || state !== 'SUCCESS') return null

      return { token: successor, data }
    },
    // `stateFromStatus` is a pure function of its argument, redeclared
    // each render; nothing about it can go stale.
    [fetchCheckoutStatus],
  )

  /**
   * Makes the settled, successful successor this page's checkout.
   *
   * The one operation a restored stale entry is allowed to perform: a
   * read has already established that the SERVER considers that
   * checkout paid, and everything here is the page catching up with it.
   * No payment is created, nothing is confirmed, nothing is retried.
   *
   * `activeTokenRef` moves first and synchronously, so anything still
   * in flight for the superseded checkout — a reconciliation that
   * started before this one, the poll — sees that it is no longer this
   * page's before it can write an outcome (§ the guard in
   * `reconcileFromBrowserEvent`).
   */
  const adoptSettledSuccessor = useCallback(
    (successorToken: string, data: CheckoutStatusResponse) => {
      activeTokenRef.current = successorToken
      setToken(successorToken)
      /*
       * This load IS standing in front of that payment's result, which
       * is what `arrivedByReturn` means — so the amount comes from the
       * server's own order total and never from the cart, which was
       * emptied when the payment succeeded.
       */
      setOpenedWithToken(successorToken)
      setStatus(data)
      setPhase('PAID')
      /*
       * Whatever provider payment id this stale entry's URL carries
       * belongs to a spent attempt. Marking it confirmed means the
       * confirm effect can never post it, on this mount or after any
       * later re-render.
       */
      if (returnContext.providerPaymentRef) {
        confirmedRef.current = returnContext.providerPaymentRef
      }
      setRevalidatingSettled(false)
      setResuming(false)
      /*
       * And the history entry itself is brought into line with the
       * checkout it actually resolves to — the same `replaceState` that
       * writes a token into this URL in the first place (§ the
       * client_sdk branch). The stale entry then stops naming a spent
       * checkout, so a later refresh or Forward onto it resolves to the
       * paid one directly, without needing this tab's memory at all.
       */
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          null,
          '',
          checkoutUrlWithToken(slug, successorToken),
        )
      }
    },
    [returnContext.providerPaymentRef, slug],
  )

  /**
   * TEARS THE PROVIDER'S FORM OUT OF THE DOCUMENT.
   *
   * This is the requirement that actually protects money, and it is the
   * reason the two-tab story is not merely cosmetic. When the basket has
   * been paid for — here or in another tab — a mounted payment form is a
   * working way to charge the customer a second time. Hiding it with CSS
   * is not enough: a hidden form is still payable, still focusable,
   * still submittable by an Enter key or a stale handler. It has to
   * LEAVE THE DOCUMENT.
   *
   * Unconditional and in this order:
   *   1. `providerFormReady` goes false, so nothing renders chrome
   *      around a form that is about to stop existing;
   *   2. the adapter's own teardown runs, and the container is emptied
   *      regardless of whether the provider offered one
   *      (`destroyPaymentForm`);
   *   3. the mount tracking ref is cleared, so a later legitimate
   *      attempt can mount again;
   *   4. the config and the priced snapshot go with it — keeping them
   *      would let a re-render remount a form whose callback URL names
   *      a spent checkout.
   *
   * The caller moves the phase out of PROVIDER_UI. Doing that here would
   * make this function decide an outcome, and it decides nothing: it
   * removes a surface.
   */
  const tearDownProviderForm = useCallback(() => {
    setProviderFormReady(false)
    destroyPaymentForm(embeddedContainerRef.current)
    mountedFormRef.current = null
    setEmbedded(null)
    setEmbeddedError(null)
    setPricedLines(null)
  }, [])

  /**
   * Reconciliation triggered by the BROWSER — focus, visibility, a
   * bfcache restore, a cross-tab ping.
   *
   * None of those is evidence that a payment happened, so the first
   * thing this does is find out whether one did, with a read that
   * changes nothing. If no payment was ever submitted there is nothing
   * to reconcile and the page does not move: no `/sync`, no provider
   * call, no phase change, no "جارٍ التحقق". That is the whole of the
   * idle-form bug.
   *
   * When there IS a real attempt the behaviour is exactly what it was:
   * ask the provider through our backend, read our own record, and let
   * the server decide. A payment that is genuinely in flight still
   * survives a closed tab, a slow webhook and a 3DS detour.
   */
  const reconcileFromBrowserEvent = useCallback(
    async (activeToken: string): Promise<void> => {
      /*
       * STILL THIS PAGE'S CHECKOUT — checked after every await.
       *
       * This is triggered by things the BROWSER did (focus, visibility,
       * a bfcache restore, a cross-tab ping), so it routinely starts
       * beside a click. Its two round trips then outlive the checkout
       * they were asked about: a customer who clicks back into the tab
       * and presses "المحاولة مرة أخرى" fires a focus and a retry in the
       * same breath, and the answer — the OLD checkout's FAILED —
       * arrived while the new attempt was already in RETRY_PREPARING.
       *
       * `applyReconciledState` could not save it: RETRY_PREPARING is not
       * a settled phase, so a terminal reading is applied, and the panel
       * the customer had just dismissed rendered again for as long as it
       * took the checkout POST to answer (~190ms, measured in a real
       * browser) before the provider's form replaced it.
       *
       * The reading is not wrong — that checkout really did fail — it is
       * simply no longer about the payment on screen. So it is dropped,
       * not applied. Same idiom as the confirm effect's `token !==
       * activeToken` guard, and for the same reason.
       */
      const stillCurrent = () => activeTokenRef.current === activeToken

      if (!stillCurrent()) return
      const data = await readCheckoutStatus(activeToken)
      if (!stillCurrent()) return

      /*
       * THE BASKET WAS BOUGHT — possibly not by this tab.
       *
       * `cart_status` is the server's own statement about the cart this
       * checkout was priced from, and `converted` is terminal: an order
       * exists for it. This tab may still be sitting on a mounted
       * provider form, which is a live way to pay for a basket that has
       * already been paid for, so the form comes out of the document
       * before anything else happens.
       *
       * The screen that replaces it is a courtesy. The server refuses
       * this tab's Place Order regardless (`409 cart_converted`) — that
       * is the guarantee; this is what stops the customer being invited
       * to try.
       *
       * Not a verdict read from a message or from another tab: it came
       * from this tab's own authoritative read, on the same endpoint
       * every other reading here comes from.
       */
      if (data?.cart_status === 'converted') {
        tearDownProviderForm()
        // The cart's own record carries which order it became.
        void refreshCart()
        setPhase((current) => (isSettledPhase(current) ? current : 'PAID'))
        setRevalidatingSettled(false)
        return
      }

      /*
       * The same supersession question the restoration gate asks, for
       * the restore that runs no effects: a bfcache `pageshow` brings a
       * page back with its old DOM and its old phase intact, so the
       * failure panel is already on screen and only this can take it
       * away. Asked whenever the checkout on screen is not itself a
       * success, and answered by the server as always.
       */
      if (stateFromStatus(data ?? {}) !== 'SUCCESS') {
        const superseding = await readSupersedingSuccess(data)
        if (!stillCurrent()) return
        if (superseding) {
          adoptSettledSuccessor(superseding.token, superseding.data)
          return
        }
      }
      /*
       * Asked and answered: whatever is on screen may be acted on
       * again. Cleared here rather than in a `finally` so a reading
       * that arrived for a checkout this page has already left (the
       * `stillCurrent` guards above) does not unlock a panel belonging
       * to the one that replaced it.
       */
      setRevalidatingSettled(false)

      const real = hasRealPaymentAttempt({
        submittedHere: paymentSubmittedRef.current,
        providerPaymentRef: returnContext.providerPaymentRef,
        serverStarted: readServerAttemptStarted(data),
      })
      if (!real) return

      const state = await fetchAuthoritativeState(activeToken)
      if (!stillCurrent()) return
      if (state) setPhase((current) => applyReconciledState(current, state))
    },
    [
      readCheckoutStatus,
      fetchAuthoritativeState,
      readSupersedingSuccess,
      adoptSettledSuccessor,
      returnContext.providerPaymentRef,
      tearDownProviderForm,
      refreshCart,
    ],
  )

  /**
   * Runs whenever there is a payment to resolve and it has not settled.
   *
   * Not while REDIRECTING: the tab is on its way to the provider and a
   * reading from before it left proves nothing.
   */
  const pollActive =
    !!token &&
    // Never from a phase where nothing has been submitted. A token can
    // outlive an attempt (a retry, an abandoned form, a resume that
    // found nothing), and polling from IDLE is how a checkout that the
    // customer was still filling in talked itself into "processing".
    phase !== 'IDLE' &&
    phase !== 'CREATING_PAYMENT' &&
    // The released attempt's token is already gone and the replacement
    // does not exist yet. There is nothing to poll and nothing that a
    // reading could legitimately say about this page.
    phase !== 'RETRY_PREPARING' &&
    phase !== 'REDIRECTING' &&
    // Nothing to poll while the provider's form is on screen: no payment
    // exists yet, and the customer is still typing into it.
    phase !== 'PROVIDER_UI' &&
    phase !== 'PROVIDER_CONFIRMATION' &&
    phase !== 'PAID' &&
    phase !== 'FAILED' &&
    phase !== 'CANCELLED'

  useEffect(() => {
    activeTokenRef.current = token
  }, [token])

  /**
   * Cross-tab and back-from-background reconciliation.
   *
   * Runs for as long as there is a checkout token, INCLUDING after this
   * tab has settled: the interesting case is the opposite of the poll's.
   * A tab showing a payment form for a checkout that was just paid in
   * another tab is the one that must find out, and it is not polling —
   * `pollActive` is false while the provider's form is on screen.
   *
   * What arrives is only ever a hint that something moved — never an
   * outcome, and never a payment. `reconcileFromBrowserEvent` first
   * establishes whether there is a payment at all; only then does it
   * make the same authoritative round trip the poll makes, so a
   * cross-tab ping can do no more than make this tab ask sooner.
   * `applyReconciledState` then decides what that means for the phase:
   * it will not walk back out of a settled one, and it will not tear
   * down a provider form the customer is still using.
   */
  useEffect(() => {
    /*
     * Subscribes on the CART as well as the checkout.
     *
     * A tab that has not pressed Place Order has no checkout token, so
     * a ping keyed on a token is not addressed to it — and that tab is
     * precisely the one still able to start a second payment. Its cart
     * is the same cart, so the cart's public id reaches it.
     */
    if (!token && !cartPublicId) return

    return subscribeCheckoutChanges(token, (trigger) => {
      /*
       * No checkout of this tab's own: there is nothing to reconcile
       * except the basket, and the server is asked for that. Still no
       * outcome from the message — the same rule, one level down.
       */
      if (!token) {
        void refreshCart()
        return
      }

      /*
       * A BFCACHE RESTORE IS NOT EVIDENCE THAT WHAT IS ON SCREEN IS
       * STILL TRUE.
       *
       * The browser has just put back the pixels this document was
       * frozen with — which, for a page frozen on a decline, is a
       * decline, an amount and a retry button for a checkout that may
       * have been replaced and paid in the meantime. It is armed in the
       * same task as the event, so the panel stops being actionable
       * before the customer can press anything, and what stands in its
       * place claims nothing at all until the server answers.
       *
       * Only `restore`. A focus or a visibility change is the customer
       * looking at a page that never went anywhere.
       */
      if (trigger === 'restore') setRevalidatingSettled(true)
      void reconcileFromBrowserEvent(token)
    }, cartPublicId)
  }, [token, cartPublicId, reconcileFromBrowserEvent, refreshCart])

  /**
   * Tells the other tabs once this one has settled.
   *
   * Keyed on the settled phase rather than fired from each transition so
   * a re-render cannot re-announce, and only for a terminal state: an
   * intermediate one is not news any tab needs sooner than its own poll.
   */
  const announcedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!token || !isSettledPhase(phase)) return
    const key = `${token}:${phase}`
    if (announcedRef.current === key) return
    announcedRef.current = key
    /*
     * The cart travels with the ping so a tab that has no checkout of
     * its own still hears it. It is identity, exactly like the token:
     * the receiver's only permitted action remains "ask the server".
     */
    announceCheckoutChanged(token, cartPublicId)
  }, [token, phase, cartPublicId])

  /**
   * Resolving a bare token: the refresh case.
   *
   * A checkout token in the URL with none of the provider's own return
   * evidence beside it means one of two very different things, and only
   * the server can tell them apart:
   *
   *   - the payer went to a gateway and came back (some providers append
   *     nothing of their own), in which case there is a real payment and
   *     it must be verified exactly as before; or
   *   - the payer refreshed a checkout that was sitting on an untouched
   *     payment form, in which case nothing has happened and the
   *     checkout must simply be usable again.
   *
   * Asked with the read that changes nothing, so the second case costs
   * the provider no call and the checkout no state. Until the answer
   * arrives the page renders its loading state and claims neither.
   */
  useEffect(() => {
    if (!resuming || !token) return

    let cancelled = false
    void (async () => {
      const data = await readCheckoutStatus(token)
      if (cancelled) return

      /*
       * ALREADY SETTLED — the history-restoration case.
       *
       * If the server's own record is already terminal then this load is
       * not a payment in progress, it is a page being looked at again:
       * Back, Forward, or a refresh of a checkout that finished. There
       * is nothing to verify and nothing to confirm, so the outcome is
       * rendered directly and no intermediate phase is ever shown.
       *
       * `setStatus(data)` on the same tick is what lets the amount come
       * from the server's own order total immediately, instead of the
       * page briefly rendering an unknown amount beside a known result.
       */
      const settled = data ? stateFromStatus(data) : null

      /*
       * THE OLD-HISTORY-ENTRY CASE, decided before anything is rendered.
       *
       * A restored entry can be holding the token of a checkout that
       * this tab has since replaced — a retry creates a new checkout,
       * and every attempt leaves its own history entries behind. The
       * server, asked about that token, answers "failed" because it
       * did; the customer has nevertheless already paid, on the
       * checkout that replaced it.
       *
       * So a checkout that is NOT itself a success is resolved against
       * its successor before this page claims anything. Only a
       * settled success there outranks it — everything else falls
       * through to the reading below unchanged — and adopting it is a
       * read, not a payment: no confirm, no checkout, no retry.
       *
       * Inside `resuming`, so the whole decision happens behind the
       * neutral restoring state. The old failure panel is never
       * rendered, not even for one commit.
       */
      if (settled !== 'SUCCESS') {
        const superseding = await readSupersedingSuccess(data)
        if (cancelled) return
        if (superseding) {
          adoptSettledSuccessor(superseding.token, superseding.data)
          return
        }
      }

      if (settled && isTerminalState(settled)) {
        setStatus(data)
        setPhase(phaseForPaymentState(settled))
        setResuming(false)
        return
      }

      const real = hasRealPaymentAttempt({
        submittedHere: paymentSubmittedRef.current,
        providerPaymentRef: returnContext.providerPaymentRef,
        serverStarted: readServerAttemptStarted(data),
      })

      if (real) {
        // A payment exists, so this load IS a return and nothing about
        // handling it changes: RETURNING is exactly the phase a bare
        // token used to start in, and the poll below takes over from
        // here — provider sync, authoritative read, server's verdict.
        // The read above only decided WHETHER to be in this branch; it
        // deliberately does not decide the outcome.
        setPhase('RETURNING')
      } else {
        // Nothing was ever submitted. The checkout goes back to being a
        // checkout — cart intact, form editable, no payment claimed.
        //
        // The token goes with it, out of the state and out of the URL:
        // it identifies a checkout the customer walked away from (it
        // expires on its own, releasing its reservations), and leaving
        // it behind would keep this page subscribed and polling on
        // behalf of a payment that does not exist. A new submission
        // creates a new checkout, exactly as "try again" does.
        setToken(null)
        setStatus(null)
        setPhase('IDLE')
        router.replace(`/stores/${slug}/checkout`, { scroll: false })
      }
      setResuming(false)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, token, readCheckoutStatus, returnContext.providerPaymentRef, router, slug])

  useEffect(() => {
    if (!pollActive || !token) return

    // `stalled` is not reset here: it is cleared by the two actions that
    // legitimately restart a wait (retry, "check again"), and a poll that
    // starts fresh always does so from a phase where it is already false.
    const handle = startPaymentPoll({
      fetchState: () => fetchAuthoritativeState(token),
      onState: (state) => setPhase((current) => applyServerState(current, state)),
      onTerminal: (state) => setPhase((current) => applyServerState(current, state)),
      // Bounded, and honest about it: stopping asking is not an outcome.
      onExhausted: () => setStalled(true),
    })

    pollRef.current = handle
    return () => {
      handle.stop()
      pollRef.current = null
    }
  }, [pollActive, token, fetchAuthoritativeState])

  /**
   * The embedded return: the provider's form sent the payer back here
   * with its payment id, and the server has to be told about it.
   *
   * The id is a claim and is treated as one — the backend re-fetches it
   * with the store's own credentials and checks it against this
   * checkout's intent, amount and currency before anything is applied.
   * Whatever it answers, the poll below then reads the authoritative
   * state, so a rejected confirmation cannot leave the page asserting
   * anything of its own.
   *
   * Runs once per (checkout, payment reference) pair: `confirmedRef`
   * guards a re-render or a Strict-Mode double-invoke from posting the
   * same confirmation twice. A genuine duplicate would be safe anyway —
   * the backend applies facts on the same dedupe keys a webhook uses —
   * but there is no reason to make the request.
   */
  useEffect(() => {
    const activeToken = returnContext.token
    const reference = returnContext.providerPaymentRef
    if (!activeToken || !reference) return
    /*
     * THE RETURN EVIDENCE MUST STILL BE THIS PAGE'S.
     *
     * `token` is what the checkout is actually working on; `activeToken`
     * is only what the URL says. They part company for one window, and
     * exactly one thing opens it: a retry. `releaseAttempt` drops the
     * token and asks the router to take it out of the URL, and
     * `router.replace` is asynchronous — so for a moment the page is
     * preparing a NEW payment while the URL still carries the OLD one's
     * `?id=`, and this effect re-runs because the phase it was gated on
     * is no longer settled.
     *
     * It then confirmed the payment the customer had already been told
     * had failed, and — because a confirmation announces itself —
     * replaced the retry's own neutral preparing state with "جارٍ تأكيد
     * الدفع…" and then "جارٍ التحقق من نتيجة الدفع…": a verification of a
     * spent attempt, on top of a payment that had not been made yet.
     *
     * Only reproducible in a real browser. The test router applies its
     * replace synchronously, which closes the window this lives in.
     */
    if (token !== activeToken) return
    /*
     * RECONCILE BEFORE CONFIRMING.
     *
     * A mount carrying a provider payment id is not proof that this
     * payment still needs confirming — only that one was made at some
     * point in this URL's history. Every fresh mount on that URL looks
     * identical to the original return: a Back that missed the
     * back/forward cache, a Forward onto the return entry, a refresh. A
     * remount resets `confirmedRef`, so this effect used to re-POST a
     * confirmation for a payment that had settled minutes earlier and
     * announce "جارٍ تأكيد الدفع…" while it did.
     *
     * The restoration gate above is what settles that question, for
     * every token-carrying load and with one read: it has already asked
     * the server, and it returns PAID/FAILED/CANCELLED directly without
     * ever reaching here. So arriving here means the server said the
     * payment is NOT terminal — a genuine return that still needs
     * binding — and the confirm below is unchanged for it.
     */
    if (resuming) return
    /*
     * The restoration gate ran and came back terminal: the payment is
     * settled and this is a page being looked at again. Nothing to
     * confirm — and nothing to announce.
     */
    if (isSettledPhase(phase)) return
    if (confirmedRef.current === reference) return
    confirmedRef.current = reference

    void (async () => {
      setPhase((current) => (isSettledPhase(current) ? current : 'PROVIDER_CONFIRMATION'))

      try {
        await fetch(`/api/storefront/${slug}/checkout/${activeToken}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_reference: reference }),
        })
      } catch {
        /* The authoritative read below is what decides the outcome. */
      } finally {
        // Hand over to verification either way. A refused confirmation
        // leaves the payment exactly as the server already had it, and
        // that is what gets rendered.
        setPhase((current) =>
          isSettledPhase(current) ? current : 'VERIFYING',
        )
      }
    })()
    // No disable needed here any more: adding `token` — the guard above —
    // made this dependency list exhaustive on its own.
  }, [returnContext.token, returnContext.providerPaymentRef, slug, resuming, phase, token])

  /**
   * Mounts the provider's own payment form inside this page.
   *
   * Everything sensitive stays on the provider's side of this boundary:
   * the card fields belong to their component, the payment is created by
   * them against a publishable key, and no card number, expiry or CVV
   * ever reaches our JavaScript or our backend. This effect hands over an
   * empty element and the client-safe config the backend put in the next
   * action — that is the whole of our involvement.
   *
   * The assets are pinned to the version the backend's adapter chose, so
   * a third party cannot change our checkout without a deploy.
   *
   * A failure to load is surfaced, never swallowed: an empty box where
   * the card fields should be is worse than a message and a way out.
   */
  useEffect(() => {
    // A missing config is reported by `embeddedFault`, not here: there is
    // nothing to mount and nothing to synchronize.
    if (phase !== 'PROVIDER_UI' || !embedded || !embeddedConfig) return

    const config = embeddedConfig
    const element = embeddedContainerRef.current
    if (!element) return
    if (mountedFormRef.current === config.callback_url) return
    mountedFormRef.current = config.callback_url

    let cancelled = false
    void (async () => {
      try {
        const moyasar = await loadMoyasarForm(resolveFormVersion(embedded.sdkHints))
        // The phase may have moved on while the assets were downloading
        // (a retry, a "change payment method"); mounting then would drop
        // a live card form into a page that has left this state.
        if (cancelled) return
        mountMoyasarForm(moyasar, element, embedded.publishableKey, config, {
          /*
           * The moment a payment starts, and the only one.
           *
           * The provider calls this immediately before it creates the
           * payment, on every submit path its form has — card, Apple
           * Pay, STC Pay. Nothing else in this page may set it: not
           * mounting the form above, not typing into it, not a focus or
           * a visibility change, not a re-render.
           *
           * It does not move the phase. The form must stay exactly where
           * it is, because what happens next belongs to it — a 3DS
           * challenge, an STC Pay OTP modal, an Apple Pay sheet — and
           * unmounting it would take that away. All it does is open the
           * gate on reconciliation, so that from here on a tab switch or
           * a cross-tab ping is allowed to ask the server about a
           * payment that now genuinely exists.
           */
          onInitiating: () => {
            paymentSubmittedRef.current = true
          },
          /*
           * The provider created a payment. Belt and braces for the
           * same gate: on a path where `on_initiating` never ran, this
           * still records that there is now something to reconcile.
           * Deliberately reads nothing out of the payment — the outcome
           * comes from the server, as it always has.
           */
          onCompleted: () => {
            paymentSubmittedRef.current = true
          },
        })
      } catch {
        if (cancelled) return
        // Let the next attempt load the assets again.
        mountedFormRef.current = null
        setEmbeddedError('تعذّر تحميل نموذج الدفع الآمن. تحقّق من اتصالك ثم حاول مرة أخرى.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [phase, embedded, embeddedConfig])

  /*
   * Whether the provider has rendered anything, asked of the DOM.
   *
   * Deliberately not a provider callback: Moyasar's `init` returns
   * before its fields paint, and a gateway added later will have its own
   * shape or none at all. "Is there an element in the container we gave
   * them" is true for every provider and cannot drift out of step with
   * what the customer can actually see.
   */
  useEffect(() => {
    if (phase !== 'PROVIDER_UI') {
      setProviderFormReady(false)
      return
    }
    const element = embeddedContainerRef.current
    if (!element) return
    if (element.childElementCount > 0) {
      setProviderFormReady(true)
      return
    }
    const observer = new MutationObserver(() => {
      if (element.childElementCount > 0) setProviderFormReady(true)
    })
    observer.observe(element, { childList: true })
    return () => observer.disconnect()
    // `embedded` is a dependency because a new config means a new form:
    // the container is emptied and refilled, and this must wait again.
  }, [phase, embedded])

  /**
   * The cart is emptied only once the SERVER says the money is secured.
   *
   * Emptying it at redirect time is what made a declined payment
   * unrecoverable in the old flow: the customer came back to an empty
   * cart and an order they had not paid for.
   */
  useEffect(() => {
    if (phase === 'PAID') clearCart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setErrors((er) => ({ ...er, [field]: undefined }))
  }

  const validate = () => {
    const next: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) next.name = 'Full name is required'
    if (!form.phone.trim()) next.phone = 'Phone number is required'
    else if (!/^[0-9+\s-]{8,}$/.test(form.phone.trim())) next.phone = 'Enter a valid phone number'
    if (!form.address.trim()) next.address = 'Street address is required'
    if (!form.city.trim()) next.city = 'City is required'
    // Required for every method that goes to a gateway, rather than for
    // one named provider: gateways want a payer email for the receipt and
    // for their own risk checks, and a rule keyed on the capability model
    // is one the next gateway inherits for free. Offline methods (cash on
    // delivery, bank transfer) never leave the site, so they don't need it.
    if (presentationMode !== 'offline' && !form.email.trim()) {
      next.email = 'Email is required for online payment'
    } else if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Enter a valid email address'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  /**
   * Dispatches the backend's normalized next action.
   *
   * A switch over action *kinds*, never over gateway names. A new
   * gateway emitting a kind already handled here needs no change.
   */
  const dispatchNextAction = (data: CheckoutResponse, isRetry = false): void => {
    // Whatever this action is, the retry's preparation window is over.
    retryLockRef.current = false
    /*
     * A payment now EXISTS for this checkout, so whatever was refused
     * before it is no longer "the most recent refusal". This is the only
     * event that supersedes it — not the phase leaving FAILED, which
     * also happens for a retry that never gets this far.
     */
    setFailedAttemptAmount(null)
    const checkoutToken = data.checkout_token
    /*
     * The claim this checkout was created with is spent.
     *
     * The relation itself was written by the SERVER, inside the same
     * INSERT that created this checkout, and only if it held up
     * (`resolveSupersededCheckoutId`). Clearing it here stops a later,
     * unrelated checkout in this same page from inheriting it.
     */
    if (checkoutToken) supersedesTokenRef.current = null
    const orderNumber = data.order?.order_number
    const action: PaymentAction = resolvePaymentAction(data)

    switch (action.kind) {
      case 'redirect': {
        if (!checkoutToken) {
          // Without the token there is no way to identify this payment on
          // the way back, and a redirect we cannot verify the return of is
          // worse than no redirect: it ends with a paid customer and a
          // checkout that can never learn about it.
          failAttempt('تعذّر بدء عملية الدفع. حاول مرة أخرى.', isRetry)
          return
        }

        // Written into THIS tab's history before it leaves, so a Back
        // from the provider, a restored session, or a refresh at any
        // point after this lands on a checkout that knows which payment
        // to verify. history.replaceState rather than the router,
        // because it has to be applied synchronously and survive a full
        // document navigation that starts on the next line.
        window.history.replaceState(null, '', checkoutUrlWithToken(slug, checkoutToken))
        setToken(checkoutToken)
        setPhase('REDIRECTING')

        const navigated = navigateSameTab(action.url, action.method, action.formFields)
        if (!navigated) {
          // The normalized action carried something that is not an http(s)
          // URL. Never navigate to it; say the payment could not start.
          setPhase('FAILED')
          setSubmitError('تعذّر فتح صفحة الدفع الآمنة. اختر طريقة دفع أخرى أو حاول مرة أخرى.')
        }
        return
      }

      case 'bank_instructions': {
        // Offline commitment: the order is real, the money arrives out of
        // band, and there is no gateway to wait for. The instructions
        // themselves live on the attempt and are re-read by the order
        // confirmation from the token, so they survive a refresh there —
        // holding a copy on this page would be a second source of the
        // same truth that only exists for the half-second before the
        // navigation.
        goToConfirmation(orderNumber, checkoutToken)
        return
      }

      case 'client_sdk': {
        if (!checkoutToken || !action.publishableKey) {
          failAttempt('تعذّر بدء عملية الدفع. حاول مرة أخرى.', isRetry)
          return
        }

        // The provider's form needs the checkout token in this tab's URL
        // for exactly the same reason a redirect does: it will send the
        // payer back here after 3DS, and the page that receives them has
        // to know which checkout to verify.
        window.history.replaceState(null, '', checkoutUrlWithToken(slug, checkoutToken))
        setToken(checkoutToken)
        setEmbedded({
          publishableKey: action.publishableKey,
          config: action.config,
          sdkHints: action.sdkHints,
        })
        setPhase('PROVIDER_UI')
        return
      }

      case 'unsupported': {
        // A kind this checkout has no renderer for. Say so plainly
        // rather than improvising a surface the provider never
        // published.
        failAttempt('طريقة الدفع هذه غير مدعومة حالياً — اختر طريقة أخرى.', isRetry)
        return
      }

      case 'none':
      default: {
        // Cash on delivery: the order already exists.
        goToConfirmation(orderNumber, checkoutToken)
        return
      }
    }
  }

  /**
   * ADOPTS THE CHECKOUT THIS BASKET ALREADY HAD.
   *
   * The server refused to create a second checkout for one cart and
   * answered with the incumbent's own record instead. Everything below
   * is this tab catching up with a checkout that already exists: no
   * payment is created, nothing is confirmed, nothing is retried.
   *
   * `activeTokenRef` moves first and synchronously, so anything still
   * in flight for the abandoned attempt sees that it is no longer this
   * page's before it can write an outcome — the same idiom
   * `adoptSettledSuccessor` uses, for the same reason.
   *
   * The incumbent's state is the SERVER's, read from the same status
   * endpoint every other reading on this page comes from. Where it
   * carries a pending action, that action is dispatched through the
   * identical switch a self-created checkout goes through, so there is
   * one behaviour rather than a converged special case.
   */
  const adoptConvergedCheckout = (
    data: CheckoutResponse & {
      converged?: boolean
      cart_status?: string | null
    },
    isRetry: boolean,
  ): void => {
    const incumbentToken = data.checkout_token!

    activeTokenRef.current = incumbentToken
    supersedesTokenRef.current = null
    window.history.replaceState(null, '', checkoutUrlWithToken(slug, incumbentToken))
    setToken(incumbentToken)
    setStatus(data as CheckoutStatusResponse)

    /*
     * The incumbent may already be paid — the first tab finished while
     * this one was asking. Then this tab is not converging onto a
     * payable surface, it is finding out the purchase is over, and the
     * form must not exist.
     */
    if (data.cart_status === 'converted' || stateFromStatus(data as CheckoutStatusResponse) === 'SUCCESS') {
      tearDownProviderForm()
      void refreshCart()
      retryLockRef.current = false
      submitLockRef.current = false
      setPhase('PAID')
      return
    }

    const action = resolvePaymentAction(data)

    if (action.kind === 'none' || action.kind === 'unsupported') {
      /*
       * A live checkout with nothing left for the customer to do — it
       * is waiting on the provider. The phase comes from the SERVER's
       * state, never from the fact that a convergence happened.
       */
      retryLockRef.current = false
      submitLockRef.current = false
      const state = stateFromStatus(data as CheckoutStatusResponse)
      setPhase((current) =>
        state ? applyServerState(current, state) : current,
      )
      return
    }

    dispatchNextAction(data, isRetry)
  }

  /**
   * The order confirmation for a method that never involved a gateway.
   *
   * The phase deliberately stays CREATING_PAYMENT until the navigation
   * lands. Entering PAID here would render the success panel for a
   * payment no server has confirmed — and, because the cart is emptied on
   * the next line, it rendered that panel with a total of 0. There is no
   * `status` to read an order total from on this path: no gateway was
   * involved, so nothing was polled. The confirmation page is the surface
   * that reports an offline order, and it reads the real figures from the
   * token.
   */
  const goToConfirmation = (orderNumber?: string, checkoutToken?: string) => {
    clearCart()
    const qs = orderNumber
      ? `order=${encodeURIComponent(orderNumber)}`
      : checkoutToken
        ? `token=${encodeURIComponent(checkoutToken)}`
        : ''
    router.push(`/stores/${slug}/checkout/success${qs ? `?${qs}` : ''}`)
  }

  /**
   * Ends the attempt without leaving the checkout.
   *
   * Where it lands depends on where it was started from. A submission
   * from the form goes back to the form, which is where the error
   * belongs and where the customer already is. A RETRY has no form
   * behind it — dropping it into IDLE is the very thing this flow
   * exists to stop — so it goes back to the failure panel it came from
   * and says what went wrong there, with the retry still on offer.
   */
  const failAttempt = (
    message: string,
    isRetry = false,
    failure?: RetryFailure,
  ) => {
    submitLockRef.current = false
    idempotencyKeyRef.current = null
    retryLockRef.current = false

    if (isRetry) {
      // Classified, so the panel can offer the action that actually
      // works rather than a button the server has already refused.
      setRetryNotice(
        failure ?? { action: 'retry', kind: 'unknown', message },
      )
      setPhase('FAILED')
      return
    }

    /*
     * Back to the editable checkout — so the snapshot goes too.
     *
     * This path is the attempt that never became a payment: the request
     * failed, or the action it returned has no renderer here. Keeping
     * `pricedLines` would leave the cart locked to an amount nothing is
     * charging, with the form back on screen and no way to edit the
     * order. The next Pay prices the cart again from scratch (the
     * idempotency scope is dropped on the line above), so nothing here
     * can be silently reused.
     */
    setPricedLines(null)
    setSubmitError(message)
    setPhase('IDLE')
  }

  /**
   * Creates the checkout and starts a payment from the data already in
   * this page.
   *
   * Split out of `handleSubmit` so that "try again" can reach it without
   * sending the customer back through a form they have already filled
   * in. Validation stays in `handleSubmit`: it belongs to the act of
   * submitting the form, not to starting a payment from data that was
   * validated when it was typed.
   */
  const startPayment = async (override?: {
    details?: FormState
    offeringId?: string
    /**
     * This is a retry, not a submission.
     *
     * It changes exactly two things: the phase the page waits in — a
     * neutral RETRY_PREPARING instead of CREATING_PAYMENT, which keeps
     * the data-entry screen off the screen — and where a failure lands.
     * The request itself, the idempotency scope and the architecture
     * behind it are identical: one new checkout, one new intent, one new
     * attempt.
     */
    retry?: boolean
    /**
     * This call is the ONE re-ask after a `checkout_in_flight`.
     *
     * Carried explicitly rather than counted in a ref so it cannot
     * outlive the attempt it belongs to: a second `checkout_in_flight`
     * on the re-ask stops and tells the customer, instead of looping
     * against a gateway that is simply slow.
     */
    convergeRetry?: boolean
  }) => {
    if (cart.length === 0) return
    if (submitLockRef.current) return

    const isRetry = override?.retry === true

    const offeringId = override?.offeringId ?? selectedMethod
    if (!offeringId) {
      setMethodError('Please choose a payment method')
      return
    }

    /*
     * The details to pay with, taken explicitly rather than read out of
     * whatever `form` happens to hold at this instant. A retry supplies
     * the server's copy directly, so it does not depend on the effect
     * that fills the form in having flushed first.
     */
    const details = override?.details ?? form

    submitLockRef.current = true
    setMethodError(null)
    setSubmitError(null)
    // The lines this payment is about to be priced from. Taken here, from
    // the same array the request below sends, so the summary can show
    // what was actually bought rather than what the cart holds now.
    setPricedLines(cart)
    setPhase(isRetry ? 'RETRY_PREPARING' : 'CREATING_PAYMENT')

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey()
    }

    try {
      const returnUrl = buildReturnUrl(slug)
      const res = await fetch(`/api/storefront/${slug}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Makes a retry of THIS attempt safe end to end — see the ref.
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          payment_offering_id: offeringId,
          items: cart.map((c) => ({ variant_id: c.variantId, quantity: c.qty })),
          customer_name: details.name.trim(),
          customer_email: details.email.trim() || undefined,
          customer_phone: details.phone.trim(),
          address_line: details.address.trim(),
          city: details.city.trim(),
          notes: details.notes.trim() || undefined,
          // The amount and currency are deliberately NOT sent: the server
          // prices the cart itself and verifies the gateway's amount and
          // currency against its own order.
          return_url: returnUrl || undefined,
          /*
           * The checkout this one replaces, when there is one — a
           * retry, or a change of payment method.
           *
           * A CLAIM, and treated as one: the server checks it against
           * the store, the mode, the predecessor's own state and the
           * customer's own details before recording anything, and
           * ignores it otherwise. It cannot assert an outcome, and the
           * page gets nothing back from it except, later, an identity
           * on the status endpoint.
           */
          supersedes_checkout_token: supersedesTokenRef.current ?? undefined,
        }),
      })

      const data: CheckoutResponse & {
        message?: string
        msg?: string
        code?: string
        order_number?: string | null
        converged?: boolean
      } = await res.json()

      /*
       * CONVERGED — this basket already had a checkout, and the server
       * handed back that one instead of creating a second.
       *
       * The winning tab's checkout, its token, and its pending action,
       * read from the server's own record. Nothing was created here: no
       * second intent, no second call to the provider, no second order.
       * The page then behaves exactly as if it had created that
       * checkout itself, which is the point — one purchase, one
       * surface, whichever tab the customer is looking at.
       */
      if (res.ok && data.converged === true && data.checkout_token) {
        adoptConvergedCheckout(data, isRetry)
        return
      }

      if (res.status === 409) {
        /*
         * The server's own reason, when it gave one. These codes are
         * about the BASKET, not about a payment — none of them says
         * anything about whether money moved, and the page does not
         * infer that it did.
         */
        if (data.code === 'cart_converted') {
          /*
           * Already bought, in this browser, possibly in another tab.
           * The form comes out of the document first — it is a live way
           * to pay for a basket that has been paid for — and only then
           * does the screen change.
           */
          tearDownProviderForm()
          void refreshCart()
          retryLockRef.current = false
          submitLockRef.current = false
          setPhase('PAID')
          return
        }

        if (data.code === 'checkout_in_flight') {
          /*
           * Another request is between the cart claim and the checkout
           * it is about to create — the first tab is mid-provider-call
           * right now. Nothing is wrong: waiting and asking again
           * converges on that tab's checkout.
           *
           * One retry, once, after a short pause. A loop here would
           * turn a slow gateway into a request storm against our own
           * backend.
           */
          submitLockRef.current = false
          if (!override?.convergeRetry) {
            setSubmitError(null)
            setPhase(isRetry ? 'RETRY_PREPARING' : 'CREATING_PAYMENT')
            window.setTimeout(() => {
              void startPayment({ ...override, convergeRetry: true })
            }, 1500)
            return
          }
          setSubmitError('جاري تجهيز الدفع… حاول مرة أخرى بعد لحظات.')
          setPhase(isRetry ? 'FAILED' : 'IDLE')
          retryLockRef.current = false
          return
        }

        if (data.code === 'cart_not_active') {
          // The basket is terminal for a reason that is not a purchase
          // (expired, emptied). The server's cart is the answer.
          void refreshCart()
          submitLockRef.current = false
          retryLockRef.current = false
          setSubmitError('انتهت صلاحية سلتك. أضف المنتجات مرة أخرى من فضلك.')
          setPhase('IDLE')
          return
        }

        // The same attempt is already being placed (a second tab, a
        // resend). Not an error and definitely not a reason to start
        // another one.
        // Not an error and not a reason to strand a retry on a blank
        // form: it goes back to the panel it came from, where the retry
        // is still there to press once the first one has answered.
        if (isRetry) {
          retryLockRef.current = false
          setRetryNotice(classifyRetryFailure({ status: 409, body: data }))
          setPhase('FAILED')
        } else {
          setSubmitError('هذا الطلب قيد المعالجة بالفعل — انتظر لحظة من فضلك.')
          setPhase('IDLE')
        }
        submitLockRef.current = false
        return
      }

      if (!res.ok) {
        if (isRetry) {
          // The server's own status and body decide what the customer is
          // offered next — see lib/payments/retryFailure.ts.
          const failure = classifyRetryFailure({ status: res.status, body: data })
          failAttempt(failure.message, true, failure)
          return
        }
        throw new Error(data?.message || data?.msg || 'Something went wrong while placing your order')
      }

      dispatchNextAction(data, isRetry)
    } catch (err: unknown) {
      // No status: the request never completed. Nothing is known to be
      // wrong with the checkout, so a retry stays on offer.
      failAttempt(
        normalizePaymentError(err),
        isRetry,
        isRetry ? classifyRetryFailure({ status: null, error: err }) : undefined,
      )
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cart.length === 0) return
    // Read and set synchronously, before any await or state update.
    if (submitLockRef.current) return
    if (!validate()) return

    await startPayment()
  }

  /**
   * The explicit "try again" path, and the only thing that reopens
   * submission after a payment has started.
   *
   * Keeps the cart and the form; drops the settled attempt and its
   * token, and takes the token back out of the URL so a refresh does not
   * re-verify a payment the customer has already moved on from.
   */
  const releaseAttempt = (options?: { keepServerRecord?: boolean }) => {
    pollRef.current?.stop()
    pollRef.current = null
    /*
     * What is being released, kept until its replacement has an id.
     *
     * The edge between the two is written in `dispatchNextAction`,
     * because that is where the replacement first exists. Not cleared
     * by a failed attempt: a retry the server refuses creates no
     * replacement, and the checkout being released is still the one the
     * NEXT attempt will supersede.
     */
    supersedesTokenRef.current =
      activeTokenRef.current ?? token ?? supersedesTokenRef.current
    // Synchronously, ahead of the render: anything already in flight for
    // the released checkout must see that it is no longer this page's
    // before it can write an outcome into the next attempt.
    activeTokenRef.current = null
    setToken(null)
    /*
     * A retry keeps the released checkout's server record until the
     * replacement's own read supersedes it.
     *
     * It is the same cart at the same price, and it is the only
     * authoritative amount this page holds: dropping it made the retry
     * fall back to the live cart for its figures, which is exactly the
     * source the amount work established must never stand in for a
     * server total. Nothing else reads it in a way that could go stale —
     * the poll is off, the phase is set explicitly, and a declined
     * checkout has no order on it.
     *
     * "Change payment method" does drop it: that goes back to an
     * editable checkout, which is this page's own cart again.
     */
    if (!options?.keepServerRecord) setStatus(null)
    setStalled(false)
    setSubmitError(null)
    setRetryNotice(null)
    // The snapshot belonged to the attempt being released. The next one
    // is priced from whatever the cart holds when it is made.
    setPricedLines(null)
    // The provider's form belonged to the attempt being abandoned. Its
    // config carries that attempt's callback URL, so keeping it would
    // mount a form that reports its payment against a spent token.
    setEmbedded(null)
    setEmbeddedError(null)
    mountedFormRef.current = null
    // The abandoned attempt's evidence goes with it. A fresh form is a
    // fresh "has the customer submitted anything?", and the answer is no.
    paymentSubmittedRef.current = false
    // And its provider payment reference is spent: whatever happens to
    // the URL from here, this page will never confirm that payment.
    if (returnContext.providerPaymentRef) {
      confirmedRef.current = returnContext.providerPaymentRef
    }
    setResuming(false)
    submitLockRef.current = false
    // A new attempt is a new idempotency scope. Reusing the spent key
    // would replay the settled checkout instead of creating another.
    idempotencyKeyRef.current = null
    // Whatever this load arrived carrying is spent; it is not a return
    // any more, and the cart is this checkout's amount again.
    setOpenedWithToken(null)
    /*
     * The token comes OUT of the URL the same way it went in.
     *
     * `history.replaceState` is what wrote it there (§ the client_sdk
     * branch), and in a real browser the router's own replace does not
     * reliably undo a URL the page rewrote underneath it — the query
     * survived, so a refresh after this release resumed the very attempt
     * that was just released and locked the cart again. Next patches
     * `replaceState` to re-render `useSearchParams()` consumers, so this
     * page sees the token go as well.
     */
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/stores/${slug}/checkout`)
    }
    router.replace(`/stores/${slug}/checkout`, { scroll: false })
  }

  /**
   * The details a retry can pay with, or null if there are none.
   *
   * Prefers what is on screen — the customer may have corrected it —
   * and falls back to the server's copy of what this checkout was
   * created with. The fallback is what makes retry work at all after a
   * 3DS decline, where the page is a fresh document and the form is
   * empty.
   */
  const detailsForRetry = (): FormState | null => {
    if (hasCustomerDetails(form)) return form

    const remote = status?.customer
    if (!remote) return null

    const merged: FormState = {
      name: remote.name ?? '',
      phone: remote.phone ?? '',
      email: remote.email ?? '',
      address: remote.address_line ?? '',
      city: remote.city ?? '',
      // The server does not return the note and a payment does not need
      // it; anything the customer has typed here in this page is kept.
      notes: form.notes,
    }
    return hasCustomerDetails(merged) ? merged : null
  }

  /**
   * The offering a retry should pay by, or null.
   *
   * A retry means "the same way, again", so it uses the method this
   * checkout actually used — which the server remembers, and which
   * survives the redirect that the page's own state does not.
   *
   * Null when that method is no longer on the published list: a merchant
   * can disable one between attempts, and the page auto-selects the
   * first available method on load, so proceeding would silently pay by
   * something the customer never chose. That case goes to the chooser.
   */
  const offeringForRetry = (): string | null => {
    const remembered = status?.selected_offering_id
    if (remembered) {
      return paymentMethods.some((offering) => offering.id === remembered)
        ? remembered
        : null
    }
    // No server memory (an older backend, or a decline that never left
    // the page): this session's own selection is the customer's own.
    return selectedMethod || null
  }

  /**
   * "تغيير طريقة الدفع" — the customer wants a DIFFERENT method.
   *
   * Back to the editable checkout, which is where the methods are. This
   * is not a retry and must not restart the same payment.
   */
  const handleChooseAnother = () => {
    // A retry that is still preparing owns an in-flight checkout.
    // Releasing under it would leave that request to land on a page
    // which has already moved on.
    if (retryLockRef.current) return
    releaseAttempt()
    // Back to an editable checkout: there is no failure panel to state a
    // refusal on any more, and the next payment starts its own history.
    setFailedAttemptAmount(null)
    setPhase('IDLE')
  }

  /**
   * "العودة لتعديل الطلب" — the customer wants their CART back.
   *
   * Deliberately a different action from "تغيير طريقة الدفع", even
   * though both release the attempt underneath: that one is about which
   * method pays, this one is about what is being paid for. They land in
   * different places for the customer — the chooser versus the order
   * summary with its controls back — and conflating them is how a
   * customer looking for a quantity button ends up being asked to pick a
   * gateway.
   *
   * What it does NOT do is as important. The released attempt's token,
   * provider form, idempotency scope and priced snapshot all go (see
   * `releaseAttempt`), so nothing of the old payment survives into the
   * next one: no reused amount, no reused provider payment, and no new
   * payment at all until the customer presses Pay again. The amount that
   * comes back is the CURRENT cart's — including a cart another tab
   * changed while this one was locked, which is simply the cart now.
   */
  const handleReturnToEditOrder = () => {
    // A retry mid-flight owns an in-flight checkout; releasing under it
    // would leave that request landing on a page that has moved on.
    if (retryLockRef.current) return
    releaseAttempt()
    // Back to an editable checkout: there is no failure panel to state a
    // refusal on any more, and the next payment starts its own history.
    setFailedAttemptAmount(null)
    setPhase('IDLE')
  }

  /**
   * "المحاولة مرة أخرى" — the customer wants to pay again, the same way.
   *
   * ONE transition, from the failure panel to the provider's form. The
   * customer whose card was declined has already given their contact
   * details, their address and their choice of method; what they want
   * next is a card field, not a checkout.
   *
   * So this never passes through IDLE. It goes FAILED → RETRY_PREPARING
   * → PROVIDER_UI, and RETRY_PREPARING renders a neutral preparing
   * panel rather than the form (`showsForm` is false for it). The
   * intermediate contact / shipping / payment-method screen the customer
   * used to see was CREATING_PAYMENT, which keeps the form mounted on
   * purpose — right for a submission made from that form, wrong for a
   * retry made from a panel.
   *
   * The architecture underneath is unchanged: a new checkout, a new
   * PaymentIntent and a new PaymentAttempt at sequence 1, exactly as
   * before. Only what the customer looks at while that happens is
   * different.
   */
  const handleRetry = () => {
    /*
     * NOT WHILE A SUPERSESSION IS UNRESOLVED.
     *
     * The button is not rendered in that window (§ `resolvingSupersession`),
     * so this is the belt to that braces: a click already dispatched
     * against the old panel, or a keyboard activation racing the
     * restore, must not start a payment for a purchase that may already
     * be paid. It costs nothing when there is nothing to resolve.
     */
    if (revalidatingSettled) return
    /*
     * The duplicate-click guard, and it has to be FIRST.
     *
     * `releaseAttempt` tears down the token, the idempotency scope and
     * the provider form. A second click used to reach it while the first
     * retry's POST was still in flight — the lock only stopped the
     * second `startPayment`, after the teardown had already run against
     * the attempt being created. Read synchronously here, so no pair of
     * clicks can interleave at all.
     */
    if (retryLockRef.current) return

    /*
     * Decided BEFORE anything is released, so a retry that cannot go
     * ahead leaves the failure panel exactly as it is rather than
     * dismantling it on the way to an apology.
     */
    const details = detailsForRetry()
    const offeringId = offeringForRetry()

    if (cart.length === 0 || !details || !offeringId) {
      /*
       * Not enough to repeat the payment exactly as it was made: the
       * server withheld the details, or the method the customer chose
       * has been turned off since.
       *
       * Says so, and stays put. Silently rendering the whole data-entry
       * screen here reads as "your order was thrown away, start again" —
       * which is not what happened, and is a worse answer than naming
       * the one thing that has to be decided. "تغيير طريقة الدفع" is
       * beside this message and is the way on.
       */
      setRetryNotice(
        !offeringId
          ? {
              action: 'change_method',
              kind: 'offering_disabled',
              message:
                'طريقة الدفع السابقة لم تعد متاحة. اختر طريقة دفع أخرى للمتابعة.',
            }
          : cart.length === 0
            ? {
                action: 'restart_checkout',
                kind: 'cart_empty',
                message: 'سلتك فارغة. أضف المنتجات مرة أخرى لبدء عملية دفع جديدة.',
              }
            : {
                action: 'change_method',
                kind: 'details_unavailable',
                message:
                  'تعذّر إعادة المحاولة بنفس البيانات. اختر طريقة دفع أخرى للمتابعة.',
              },
      )
      return
    }

    retryLockRef.current = true
    /*
     * The released checkout's server record is kept only while it still
     * describes what is being bought. It is the authoritative amount for
     * a retry of the SAME cart — which is why it is kept at all — but
     * the moment the customer has edited their order it is the price of
     * something else, and holding it would put the old figure on the
     * provider's panel while the server prices the new one.
     */
    releaseAttempt({ keepServerRecord: !cartEditedSinceSettle })
    void startPayment({ details, offeringId, retry: true })
  }

  /** "Check again" after the poll's budget ran out. Never an outcome. */
  const handleCheckAgain = () => {
    setStalled(false)
    pollRef.current?.refreshNow()
  }

  /**
   * Adopts the server's copy of the details this checkout was made with.
   *
   * Runs when a status read brings them and this page has none — which
   * is every load that did not type them: the redirect back from a
   * declined 3DS payment, a refresh of a failed checkout, a restored
   * history entry. Without it the customer's own contact and shipping
   * information is simply absent from the page that offers them a retry.
   *
   * Only ever FILLS IN. A field the customer has typed into is never
   * overwritten, so this cannot fight the person using the form, and it
   * cannot run twice over its own result: once the fields are populated
   * the guard below stops matching.
   */
  useEffect(() => {
    const remote = status?.customer
    if (!remote) return
    if (hasCustomerDetails(form)) return

    setForm((current) => {
      if (hasCustomerDetails(current)) return current
      const next: FormState = {
        name: current.name || (remote.name ?? ''),
        phone: current.phone || (remote.phone ?? ''),
        email: current.email || (remote.email ?? ''),
        address: current.address || (remote.address_line ?? ''),
        city: current.city || (remote.city ?? ''),
        // Not returned by the server, and not needed to pay.
        notes: current.notes,
      }
      const unchanged = (Object.keys(next) as (keyof FormState)[]).every(
        (key) => next[key] === current[key],
      )
      return unchanged ? current : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.customer])

  /**
   * The same, for the method the customer chose.
   *
   * A retry pays the way they already picked. Only applied when this
   * page has no selection of its own and the offering is still on the
   * published list — a method the merchant has since turned off must not
   * be re-selected from a stale checkout row.
   */
  useEffect(() => {
    const remoteOffering = status?.selected_offering_id
    if (!remoteOffering || selectedMethod) return
    if (!paymentMethods.some((offering) => offering.id === remoteOffering)) return
    setSelectedMethod(remoteOffering)
  }, [status?.selected_offering_id, selectedMethod, paymentMethods])

  /*
   * The order this purchase became.
   *
   * Normally the checkout's own — read from the server's record for the
   * checkout on screen. The fallback is for the tab that did not perform
   * the payment: its checkout may carry no order (it expired, or it was
   * never the one that settled), while its CART did become one, and the
   * cart's record is where that order number lives. Identity in both
   * cases, and in both cases the server's.
   */
  const orderNumber =
    status?.order?.order_number ??
    (cartStatus === 'converted' ? convertedOrderNumber : null) ??
    null

  /**
   * True when this page LOAD arrived carrying a return, rather than the
   * page the customer started the payment on.
   *
   * It matters for what may honestly be shown: after a return, the cart
   * has been re-read from storage and a payment method has been
   * auto-selected for a form the customer never filled in, so neither is
   * evidence of what they actually paid or how. The server's own order
   * total is, and it is used instead wherever it exists.
   *
   * Read from the token this page was OPENED with, captured once, not
   * from the token currently in the URL — because this page puts its own
   * token there. When the provider's form mounts, the checkout rewrites
   * its URL with `history.replaceState`, and Next re-runs
   * `useSearchParams()` on that; comparing against the live value
   * therefore turned true on a checkout that had never been anywhere.
   * Everything downstream then treated a customer sitting in front of a
   * payment form as someone back from a gateway — and refused to show
   * them the amount they were about to pay.
   */
  const arrivedByReturn = !!openedWithToken && token === openedWithToken

  /**
   * What was paid. The server's order total once there is an order —
   * the cart is emptied the moment a payment succeeds, and reading the
   * live cart after that renders a completed payment as "0".
   *
   * UNKNOWN IS NOT ZERO. There is a window on every fresh mount that
   * carries a checkout token — a Back that missed the bfcache, a
   * Forward, a refresh of the return URL — in which the payment is
   * already PAID, the cart is already empty, and the server total has
   * not arrived yet. Falling through to the cart there printed "0 SAR"
   * over a real payment of 50. So the cart is only ever used as the
   * amount while it is genuinely THIS page's cart: before any payment
   * exists, and never after a return. Otherwise the amount is not known
   * yet and says so, until the authoritative read lands.
   */
  /**
   * The snapshot's own total, in major units.
   *
   * Derived rather than stored: it is a fact about the lines that were
   * priced, and storing it as well would be a second copy of the same
   * truth that could disagree with the first.
   */
  const pricedTotal = pricedLines
    ? pricedLines.reduce((sum, item) => sum + item.price * item.qty, 0)
    : null

  /**
   * Whether the cart may still be edited on this page.
   *
   * False from the moment a payment is priced — not merely while the
   * provider's form is up. `token` covers a checkout resumed by a
   * refresh, where the snapshot state is gone but the payment is very
   * much alive; `pricedLines` covers the window before the token lands;
   * the phase covers everything after.
   *
   * "تغيير طريقة الدفع" is what releases the attempt and makes the cart
   * editable again, which is the honest way back: it starts a new
   * checkout, priced from whatever the cart holds then.
   */
  const cartLocked =
    (!!pricedLines || !!token || !showsForm(phase)) && !allowsCartEditing(phase)

  /*
   * The snapshot the release above is measured against.
   *
   * Kept for exactly as long as the phase is a settled unsuccessful one
   * and dropped the moment it is not, so nothing from a payment that is
   * over can outlive it into the next one.
   */
  const cartReleased = allowsCartEditing(phase)
  useEffect(() => {
    if (!cartReleased) {
      setSettledLines(null)
      return
    }
    // Taken ONCE, at the settle: after that it is the fixed thing the
    // live cart is compared with, not a moving copy of it.
    setSettledLines((current) => current ?? pricedLines ?? cart)
  }, [cartReleased, pricedLines, cart])

  /*
   * And what that payment was for, under the same rule.
   *
   * Separate effect because it has a separate source: the server's total
   * for the checkout that failed, which may land a beat after the phase
   * does (the status read is what produced the phase, but an older
   * backend can answer without a total). `current ??` keeps the first
   * answer, so nothing that arrives later can move it.
   */
  useEffect(() => {
    /*
     * NOT reset here.
     *
     * Leaving the settled phase used to clear it, which is right only if
     * leaving means "a new payment is being made". It also means "a
     * retry was pressed" — and a retry whose CHECKOUT POST is refused
     * (raising 6 to 10 is exactly what makes the server answer "not
     * enough stock") comes straight back to this panel having created no
     * payment at all. The refusal had been forgotten by then, so the
     * capture below re-ran and took the only figure left, `pricedTotal`
     * — the edited cart the rejected request had tried to price. The
     * panel then reported the customer had been refused 500 SAR when
     * they had been refused 50 and nothing had ever been submitted at
     * 500.
     *
     * So the reset moved to the one event that really does supersede it:
     * a new payment actually existing (`dispatchNextAction`), plus the
     * two ways back to an editable checkout. See those three sites.
     */
    if (!cartReleased) return
    setFailedAttemptAmount((current) => {
      if (current !== null) return current
      const serverTotal = status?.order?.total ?? status?.total
      if (serverTotal !== undefined && serverTotal !== null && serverTotal !== '') {
        return formatAmount(serverTotal, currency)
      }
      // The snapshot this page sent to be priced. Frozen when the
      // request was made, so it is evidence of the attempt and not of
      // the cart as it stands now.
      if (pricedTotal !== null) return formatAmount(pricedTotal, currency)
      return null
    })
  }, [cartReleased, status, pricedTotal, currency])

  /*
   * The lock, published to the storefront.
   *
   * The cart belongs to the STORE, not to this page: the header's cart
   * button and its drawer are on every page and are where a customer
   * actually changes quantities. So this page does not keep the lock to
   * itself — it declares it, and the provider both enforces it (the
   * mutators refuse) and lets the drawer render the same read-only cart,
   * the same notice and the same way back.
   *
   * The release goes through a ref so the published callback is stable
   * while still calling the current handler; the cleanup unlocks, so
   * navigating away from a checkout never leaves the storefront's cart
   * frozen with nothing on screen to unfreeze it.
   */
  const returnToEditRef = useRef(handleReturnToEditOrder)
  useEffect(() => {
    returnToEditRef.current = handleReturnToEditOrder
  })
  useEffect(() => {
    setCartLock({ locked: cartLocked, release: () => returnToEditRef.current() })
  }, [cartLocked, setCartLock])
  useEffect(() => () => setCartLock({ locked: false, release: null }), [setCartLock])

  /**
   * The lines this page should show.
   *
   * While a payment is locked, what was PRICED — the customer is being
   * charged for that and for nothing else. Once the payment is over and
   * the cart is theirs again, the cart: a summary that still listed the
   * declined order's quantities would be describing a payment nobody is
   * going to make, next to a retry that prices the cart as it is now.
   */
  const summaryLines = cartLocked ? (pricedLines ?? cart) : cart

  /** The figure that goes with those lines, under the same rule. */
  const summaryTotal = cartLocked ? (pricedTotal ?? cartTotal) : cartTotal

  /**
   * The cart has moved on from what this payment was priced from.
   *
   * Not reachable by editing on this page any more — the controls are
   * gone while locked — but very reachable from ANOTHER TAB, which
   * writes the same `cart:<slug>` key, and then from a refresh here.
   * Saying so is the whole point: the payment is still for the snapshot,
   * and the customer is entitled to know that before they pay it.
   */
  const cartDiverged =
    cartLocked &&
    !!pricedLines &&
    (pricedLines.length !== cart.length ||
      pricedLines.some((line) => {
        const current = cart.find((item) => item.variantId === line.variantId)
        return !current || current.qty !== line.qty || current.price !== line.price
      }))

  /**
   * Whether the order summary is shown at all.
   *
   * The cart is normally the answer: it is emptied only when the server
   * confirms the money, and an "0 items / 0 SAR" panel beside a paid
   * order describes nothing that is true.
   *
   * The second clause is the locked window. The cart is written by every
   * tab of this store, so ANOTHER tab can empty it while a payment here
   * is priced and in flight — and the lines that payment was priced from
   * are still exactly what the customer is being charged for. Dropping
   * the summary there would take the amount, the lock notice and the way
   * back off the screen mid-payment. Settled phases keep the old rule.
   */
  const showsSummary =
    cart.length > 0 ||
    (!!pricedLines && pricedLines.length > 0 && !isSettledPhase(phase))

  const amountLabel = (() => {
    const asLabel = (raw: string) => {
      const numeric = Number(raw)
      const shown = Number.isFinite(numeric) ? numeric.toLocaleString('en-US') : raw
      return `${shown} ${currency}`
    }
    const usable = (raw: string | null | undefined): raw is string =>
      raw !== undefined && raw !== null && raw !== ''

    // 1. What was actually charged, once an order exists.
    const orderTotal = status?.order?.total
    if (usable(orderTotal)) return asLabel(orderTotal)

    /*
     * 2. What the checkout was priced at.
     *
     * There is no order until a payment succeeds, so a DECLINED payment
     * has none — and this is the only authoritative amount on that
     * screen. Without it the failed-payment panel showed "—" beside a
     * decline for a checkout whose price was never unknown.
     */
    const checkoutTotal = status?.total
    if (usable(checkoutTotal)) return asLabel(checkoutTotal)

    /*
     * 3. What THIS payment was priced from.
     *
     * Ahead of the live cart, and that ordering is the point: once a
     * payment exists the cart is no longer evidence of its amount. A
     * quantity raised in another tab must not make this page quote a
     * figure the provider was never given.
     */
    if (!arrivedByReturn && pricedTotal !== null) {
      return `${pricedTotal.toLocaleString('en-US')} ${currency}`
    }

    // 4. The cart — evidence of what is ABOUT to be paid, before any
    //    payment exists. After a return it belongs to a different load.
    if (!arrivedByReturn && cart.length > 0) {
      return `${cartTotal.toLocaleString('en-US')} ${currency}`
    }

    // 5. Genuinely unknown. Never zero.
    return AMOUNT_UNKNOWN
  })()

  /* ══════════════════════════════════════════════════════════════════
     Render. One surface: the payment panel replaces the form only while
     a payment is in flight or settled, and the order summary stays.
     ══════════════════════════════════════════════════════════════════ */

   const methodLabel = selectedOffering ? resolveMethodDisplayName(selectedOffering) : null

  /**
   * The order as it stands NOW — a display value, and only that.
   *
   * The cart's own arithmetic, the same the order summary uses. It is
   * never sent anywhere: the retry posts `items[]` and the server prices
   * them. It exists so the failure panel can say what the customer would
   * be paying if they pressed retry, beside what the refused attempt
   * actually was.
   */
  const currentOrderLabel =
    cart.length === 0 ? 'السلة فارغة' : formatAmount(cartTotal, currency)

  const paymentPanel = phase === 'PROVIDER_UI' ? (
    // The provider's form, hosted in this page. It is not a status, so
    // it is not the status panel: the customer still has something to do.
    <EmbeddedPaymentPanel
      containerRef={embeddedContainerRef}
      amountLabel={amountLabel}
      methodLabel={methodLabel}
      error={embeddedFault}
      // Until this is true the panel shows the same neutral preparing
      // state a retry already shows, so the transition the customer sees
      // is one continuous "جارٍ تجهيز الدفع…" and then card fields.
      ready={providerFormReady}
      onChooseAnother={handleChooseAnother}
    />
  ) : phase === 'RETRY_PREPARING' ? (
    /*
     * The whole of what a retry shows between the failure and the card
     * fields. One request long, and it claims nothing: no contact form,
     * no shipping, no method chooser, and no verification of a payment
     * that has not been made.
     */
    <RetryPreparingPanel />
  ) : !showsForm(phase) ? (
    <PaymentStatusPanel
      phase={phase}
      stalled={stalled}
      cancelledHint={returnContext.cancelledHint}
      orderNumber={orderNumber}
      storeSlug={slug}
      amountLabel={amountLabel}
      // The two figures a settled, unsuccessful payment has to keep
      // apart — see `failedAttemptAmount` and `currentOrderLabel`.
      failedAttemptAmount={failedAttemptAmount}
      currentOrderLabel={currentOrderLabel}
      // Never after a return: the selection on screen then is a default
      // this page picked, not the method the customer paid with.
      methodLabel={arrivedByReturn ? null : methodLabel}
      notice={retryNotice}
      onRetry={handleRetry}
      onChooseAnother={handleChooseAnother}
      onCheckAgain={handleCheckAgain}
    />
  ) : null

  /*
   * Resolving a bare token, before this page claims anything.
   *
   * Neutral on purpose. Rendering the checkout form here would flash a
   * payable form at a customer who is actually mid-verification;
   * rendering a status panel would announce a verification to a customer
   * who only pressed refresh. It lasts one GET of our own record.
   */
  /*
   * The restoring state also covers the window in which this page is
   * holding a checkout it may have superseded.
   *
   * Only the two settled UNSUCCESSFUL phases: those are the ones that
   * render a decline, an amount and a retry button, and those are the
   * ones that must not stand as the current truth for a purchase the
   * customer may already have paid for. Everything else — the form, the
   * provider's own UI, a payment in flight, PAID — is untouched, and so
   * is a decline on a checkout nothing has replaced.
   */
  const resolvingSupersession =
    revalidatingSettled && (phase === 'FAILED' || phase === 'CANCELLED')

  if (resuming || resolvingSupersession) {
    return (
      <div
        className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-3 px-6 text-center"
        dir="rtl"
      >
        <span style={{ color: 'var(--color-text-muted)' }} aria-hidden="true">
          <IconSpinner />
        </span>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }} role="status">
          جارٍ تحميل صفحة الدفع…
        </p>
      </div>
    )
  }

  /*
   * An empty cart is only an empty checkout when there is no payment to
   * report. A customer returning from a gateway whose cart was cleared
   * on success must see the outcome, not "your cart is empty".
   *
   * Keyed on `cartLocked` — no priced snapshot, no checkout token, and a
   * phase that still shows the form — so removing the last line while
   * the cart is editable lands here immediately: no payment panel, no
   * stale summary, no token behind it.
   *
   * And on the phase as well, because the lock is no longer the whole
   * answer: a SETTLED payment hands the cart back (§ `allowsCartEditing`)
   * while still being the thing the customer came back to read. A
   * decline whose cart is empty — cleared in another tab, or emptied
   * here after the failure — must still say the payment did not go
   * through, and must not be replaced by a page implying it never
   * happened.
   */
  if (cart.length === 0 && !cartLocked && !isSettledPhase(phase)) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
        >
          <IconBag />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            Your cart is empty
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Add something to your cart before checking out.
          </p>
        </div>
        <Link
          href={`/stores/${slug}`}
          className="mt-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
          style={{ background: 'var(--color-primary)' }}
        >
          Continue shopping
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      {/* Breadcrumb */}
      <nav className="mb-8 flex items-center gap-2 text-[13px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
        <Link href={`/stores/${slug}`} className="transition-colors hover:opacity-70">
          Store
        </Link>
        <span className="opacity-40">/</span>
        <span style={{ color: 'var(--color-text-secondary)' }}>Checkout</span>
      </nav>

      <div className="mb-10 flex items-center justify-between">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[34px]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
          Checkout
        </h1>
        <div
          className="hidden items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-medium sm:flex"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
        >
          <IconLock />
          Secure checkout
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_420px] lg:gap-10">
        {paymentPanel ? (
          <div className="order-2 lg:order-1">{paymentPanel}</div>
        ) : (
        /* ── Customer & shipping form ─────────────────────────────────── */
        <form onSubmit={handleSubmit} className="order-2 flex flex-col gap-6 lg:order-1">
          <Section icon={<IconUser />} title="Contact information" subtitle="We'll use this to confirm your order">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Full name" value={form.name} onChange={handleChange('name')} error={errors.name} placeholder="Jane Doe" />
              <Field label="Phone number" value={form.phone} onChange={handleChange('phone')} error={errors.phone} type="tel" placeholder="+1 555 000 0000" />
              <Field label="Email" value={form.email} onChange={handleChange('email')} error={errors.email} type="email" placeholder={presentationMode === 'offline' ? 'jane@example.com (optional)' : 'jane@example.com *'} full />
              {presentationMode !== 'offline' && (
                <p className="sm:col-span-2 -mt-1 text-[11px] text-amber-600">Email is required when paying online.</p>
              )}
            </div>
          </Section>
          <Section icon={<IconTruck />} title="Shipping address" subtitle="Where should we deliver your order">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Street address" value={form.address} onChange={handleChange('address')} error={errors.address} placeholder="123 Main St, Apt 4B" full />
              <Field label="City" value={form.city} onChange={handleChange('city')} error={errors.city} placeholder="Cairo" />
              <div>
                <label className="mb-2 block text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  Order notes <span className="font-normal opacity-60">(optional)</span>
                </label>
                <input
                  value={form.notes}
                  onChange={handleChange('notes')}
                  placeholder="Delivery instructions, gate code..."
                  className="w-full rounded-xl border px-4 py-3 text-[14px] outline-none transition-all focus:ring-2 focus:ring-offset-0"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-background)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
            </div>
          </Section>

          <Section icon={<IconLock />} title="Payment method" subtitle="Choose how you'd like to pay">
            {loadingMethods ? (
              <div className="flex items-center justify-center py-6" style={{ color: 'var(--color-text-muted)' }}>
                <IconSpinner />
              </div>
            ) : paymentMethods.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                No payment methods are available for this store right now.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {paymentMethods.map((method) => (
                  <label
                    key={method.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors"
                    style={{
                      borderColor: selectedMethod === method.id ? 'var(--color-primary)' : 'var(--color-border)',
                      background: selectedMethod === method.id ? 'var(--color-background)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="payment_method"
                      checked={selectedMethod === method.id}
                      onChange={() => setSelectedMethod(method.id)}
                      className="h-4 w-4"
                    />
                    <span className="text-[13.5px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {resolveMethodDisplayName(method)}
                    </span>
                    <span className="ml-auto text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {/* Says what will happen, from the capability model
                          — not which provider it is. A customer needs to
                          know whether pressing Pay moves the page. */}
                      {resolvePresentationMode(method) === 'same_tab_redirect'
                        ? 'تحويل آمن ثم العودة لهذه الصفحة'
                        : 'الدفع داخل هذه الصفحة'}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {methodError && <p className="mt-2 text-[12px] font-medium text-red-500">{methodError}</p>}
          </Section>

          {submitError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-[13px] font-medium text-red-600">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={isBusyPhase(phase) || paymentMethods.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
            style={{ background: 'var(--color-primary)' }}
          >
            {isBusyPhase(phase) && <IconSpinner />}
            {isBusyPhase(phase) ? PHASE_HEADLINE[phase] : (
              <>
                Place order
                <span className="font-normal opacity-80">
                  &nbsp;· {cartTotal.toLocaleString('en-US')} {currency}
                </span>
              </>
            )}
          </button>

          <p className="text-center text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Shipping and taxes are calculated at fulfillment.
          </p>
        </form>
        )}

        {/* ── Order summary ──────────────────────────────────────────────
            Hidden once the cart has been emptied — which happens only
            when the server confirms the payment. An "0 items / 0 USD"
            summary sitting beside a paid 99 USD order describes nothing
            that is true; the amount and order number the customer needs
            are on the status panel, from the server's own record. */}
        {showsSummary && (
        <aside className="order-1 lg:order-2">
          <div
            className="rounded-2xl border shadow-sm lg:sticky lg:top-6"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="flex items-center justify-between px-6 py-5">
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Order summary
              </h2>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'var(--color-background)', color: 'var(--color-text-secondary)' }}
              >
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="flex max-h-[420px] flex-col divide-y overflow-y-auto px-6" style={{ borderColor: 'var(--color-border)' }}>
              {summaryLines.map((item) => (
                <div key={item.variantId} className="flex gap-4 py-5 first:pt-0">
                  <div
                    className="h-20 w-20 shrink-0 overflow-hidden rounded-xl"
                    style={{ background: 'var(--color-border)' }}
                  >
                    {item.image && <img src={item.image} alt={item.title} className="h-full w-full object-cover" />}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div>
                      <p className="truncate text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
                        {item.title}
                      </p>
                      {item.variantTitle && (
                        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{item.variantTitle}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      {cartLocked ? (
                        /* Priced, and therefore fixed. A control that
                           cannot change this payment's amount must not be
                           offered as though it could. */
                        <span
                          className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold tabular-nums"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                        >
                          × {item.qty}
                        </span>
                      ) : (
                      <div
                        className="flex items-center gap-3 rounded-lg border px-2 py-1.5"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.variantId, item.qty - 1)}
                          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5"
                          style={{ color: 'var(--color-text-secondary)' }}
                          aria-label="Decrease quantity"
                        >
                          <IconMinus />
                        </button>
                        <span
                          className="min-w-[1.25rem] text-center text-[13px] font-semibold tabular-nums"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.variantId, item.qty + 1)}
                          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5"
                          style={{ color: 'var(--color-text-secondary)' }}
                          aria-label="Increase quantity"
                        >
                          <IconPlus />
                        </button>
                      </div>
                      )}

                      {!cartLocked && (
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.variantId)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-red-300 transition-colors hover:bg-red-50 hover:text-red-500"
                          aria-label="Remove item"
                        >
                          <IconTrash />
                        </button>
                      )}
                    </div>
                  </div>

                  <span className="shrink-0 self-start pt-0.5 text-[13.5px] font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                    {(item.price * item.qty).toLocaleString('en-US')} {currency}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Subtotal</span>
                <span className="tabular-nums">{summaryTotal.toLocaleString('en-US')} {currency}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                <span>Shipping</span>
                <span className="italic opacity-70">Calculated at fulfillment</span>
              </div>
              <div
                className="mt-1.5 flex items-center justify-between border-t pt-4 text-[17px] font-bold"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
              >
                <span>Total</span>
                <span className="tabular-nums" data-testid="summary-total">
                  {summaryTotal.toLocaleString('en-US')} {currency}
                </span>
              </div>

              {cartLocked && (
                /* Text only. The order summary is a summary — the cart's
                   own controls, the lock notice and the way back live in
                   the storefront's cart drawer, which is where a
                   customer edits an order. This says why the figure
                   above cannot move, and where to go. */
                <p
                  className="mt-1 text-[11.5px] leading-relaxed"
                  style={{ color: 'var(--color-text-muted)' }}
                  dir="rtl"
                  data-testid="cart-locked-note"
                >
                  🔒 تعديل المنتجات غير متاح أثناء الدفع. لتعديل الطلب، افتح سلة
                  التسوق واختر «العودة لتعديل الطلب».
                </p>
              )}

              {cartDiverged && (
                <p
                  className="mt-2 rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed"
                  style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}
                  dir="rtl"
                  role="alert"
                  data-testid="cart-diverged"
                >
                  {/* The cart moved (another tab), the payment did not.
                      Said out loud rather than reconciled silently: the
                      snapshot is what will be charged, and quietly
                      showing the new figure beside it is how a customer
                      ends up believing they bought something else. */}
                  تغيّرت السلة بعد بدء عملية الدفع. المبلغ أعلاه هو ما سيتم
                  دفعه. لدفع السلة الجديدة، افتح سلة التسوق واختر «العودة لتعديل
                  الطلب».
                </p>
              )}
            </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  )
}


/**
 * One amount, formatted for display. Major units, grouped, never zero
 * as a stand-in for unknown — that is `AMOUNT_UNKNOWN`'s job.
 */
function formatAmount(raw: string | number, currency: string): string {
  const numeric = Number(raw)
  const shown = Number.isFinite(numeric) ? numeric.toLocaleString('en-US') : String(raw)
  return `${shown} ${currency}`
}

/**
 * Whether two sets of cart lines describe different orders.
 *
 * Quantity and unit price as well as identity: a variant whose price
 * moved is a different order at the same quantities, and a payment
 * priced from the old one is not the payment the customer is looking at.
 */
function linesDiffer(a: readonly CartItem[], b: readonly CartItem[]): boolean {
  if (a.length !== b.length) return true
  return a.some((line) => {
    const other = b.find((item) => item.variantId === line.variantId)
    return !other || other.qty !== line.qty || other.price !== line.price
  })
}

/**
 * A fresh idempotency key for one payment attempt.
 *
 * `crypto.randomUUID` where it exists (every browser this app targets,
 * over HTTPS); the fallback is only for a non-secure-context dev origin,
 * where the value still only has to be unique per attempt.
 */
function newIdempotencyKey(): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `ck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

/* ══════════════════════════════════════════════════════════════════════
   The embedded payment surface.

   The provider's own form is mounted into `containerRef` by the effect
   above; everything around it is ours. Nothing in here is an input — the
   card fields are the provider's component, inside their own boundary,
   and this file has no field for a card number to be typed into.

   It is deliberately not the status panel. A status panel says "wait";
   this says "your turn", and it keeps the amount visible so the customer
   can see what they are about to be charged before they type anything.
   ══════════════════════════════════════════════════════════════════════ */
function EmbeddedPaymentPanel({
  containerRef,
  amountLabel,
  methodLabel,
  error,
  ready,
  onChooseAnother,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  amountLabel: string
  methodLabel: string | null
  error: string | null
  /** The provider has rendered its fields into `containerRef`. */
  ready: boolean
  onChooseAnother: () => void
}) {
  /*
   * The container is mounted in BOTH states and is never conditionally
   * removed: it is the element the provider was handed, and taking it
   * away — or hiding it with `display:none`, which stops it being
   * measurable — is how a form fails to mount at all. Only the chrome
   * around it waits.
   */
  const waiting = !ready && !error
  return (
    <div
      className="rounded-2xl border shadow-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      dir="rtl"
    >
      <div
        className="flex flex-col items-center gap-2 px-6 pb-2 pt-8 text-center"
        {...(waiting ? { role: 'status' as const, 'aria-live': 'polite' as const, 'data-testid': 'retry-preparing' } : {})}
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'var(--color-background)', color: 'var(--color-primary)' }}
          aria-hidden="true"
        >
          {waiting ? <IconSpinner /> : <IconLock />}
        </span>
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {waiting ? PHASE_HEADLINE.RETRY_PREPARING : PHASE_HEADLINE.PROVIDER_UI}
        </p>
        <p className="max-w-xs text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {waiting
            ? 'لن نطلب منك إدخال بياناتك مرة أخرى — ستظهر خانة الدفع خلال لحظات.'
            : 'بيانات بطاقتك تُدخَل مباشرة لدى مزوّد الدفع ولا تمر عبر متجرنا.'}
        </p>
      </div>

      {!waiting && (
        <div
          className="mx-6 my-4 flex items-center justify-between rounded-xl border px-4 py-3 text-[13px]"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {methodLabel ?? 'إجمالي الطلب'}
            </span>
            {methodLabel && (
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>طريقة الدفع</span>
            )}
          </div>
          <span className="font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
            {amountLabel}
          </span>
        </div>
      )}

      {error ? (
        <p
          className="mx-6 mb-4 rounded-xl border px-4 py-3 text-[13px] leading-relaxed"
          style={{ borderColor: '#fca5a5', background: '#fef2f2', color: '#b91c1c' }}
          role="alert"
        >
          {error}
        </p>
      ) : (
        /* The provider mounts its form here. Left empty by us, always. */
        <div ref={containerRef} className="mx-6 mb-4" data-testid="embedded-payment-form" />
      )}

      {!waiting && (
        <div className="border-t px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <button
            type="button"
            onClick={onChooseAnother}
            className="w-full rounded-full border px-5 py-2.5 text-[13px] font-semibold transition-all hover:opacity-80 active:scale-[0.98]"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            تغيير طريقة الدفع
          </button>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   RETRY PREPARATION.

   The only thing on screen between "المحاولة مرة أخرى" and the
   provider's own form. It exists so that window is neutral: the previous
   arrangement spent it rendering the full checkout — contact, shipping,
   payment method — because the request behind it was CREATING_PAYMENT,
   the phase the form legitimately stays mounted in.

   It says preparing, not confirming. Nothing has been submitted, there
   is no payment to verify, and announcing one would be a lie a customer
   could act on. No amount either: the released checkout's figure is no
   longer this page's and the replacement's is one request away.
   ══════════════════════════════════════════════════════════════════════ */
function RetryPreparingPanel() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border px-6 py-16 text-center shadow-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      role="status"
      aria-live="polite"
      dir="rtl"
      data-testid="retry-preparing"
    >
      <span style={{ color: 'var(--color-primary)' }} aria-hidden="true">
        <IconSpinner />
      </span>
      <p className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {PHASE_HEADLINE.RETRY_PREPARING}
      </p>
      <p className="max-w-xs text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        لن نطلب منك إدخال بياناتك مرة أخرى — ستظهر خانة الدفع خلال لحظات.
      </p>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   The payment surface — the same page, in a different phase.

   Every message here is driven by a phase that only a server state can
   produce (see checkoutMachine.ts). The one exception is `cancelledHint`,
   which comes from a provider's own return parameter and may only make
   the *cancelled* message appear sooner; it can never contradict a
   server state, because it is consulted only while the phase is still
   non-terminal.
   ══════════════════════════════════════════════════════════════════════ */
function PaymentStatusPanel({
  phase,
  stalled,
  cancelledHint,
  orderNumber,
  storeSlug,
  amountLabel,
  failedAttemptAmount,
  currentOrderLabel,
  methodLabel,
  notice,
  onRetry,
  onChooseAnother,
  onCheckAgain,
}: {
  phase: CheckoutPhase
  stalled: boolean
  cancelledHint: boolean
  orderNumber: string | null
  storeSlug: string
  amountLabel: string
  /**
   * What the payment that failed was for, captured when it settled.
   * Null while nothing is settled, or when no authoritative figure for
   * it was ever available.
   */
  failedAttemptAmount: string | null
  /** What the cart holds now. A display value; nothing is priced from it. */
  currentOrderLabel: string
  methodLabel: string | null
  /** Why a retry could not start, and what to offer. Never an outcome. */
  notice: RetryFailure | null
  onRetry: () => void
  /** A different method — back to the chooser, not another attempt. */
  onChooseAnother: () => void
  onCheckAgain: () => void
}) {
  const settledOk = phase === 'PAID'
  const settledBad = phase === 'FAILED' || phase === 'CANCELLED'
  const waiting = !settledOk && !settledBad

  const headline = PHASE_HEADLINE[phase]
  const detail = (() => {
    if (phase === 'PAID') return 'تم استلام المبلغ وتأكيد طلبك.'
    if (phase === 'FAILED') return 'لم يتم خصم أي مبلغ. يمكنك المحاولة مرة أخرى أو اختيار طريقة دفع مختلفة.'
    if (phase === 'CANCELLED') return 'لم يكتمل الدفع ولم يتم خصم أي مبلغ.'
    if (phase === 'PENDING') {
      return cancelledHint
        // The provider's cancel URL brought us back, but the payment is
        // not settled server-side yet — say what we actually know.
        ? 'يبدو أنك رجعت من صفحة الدفع دون إتمامها. نتحقق الآن من الحالة النهائية.'
        : 'استلمنا العملية وننتظر التأكيد النهائي من البنك. لا تحتاج لتحديث الصفحة.'
    }
    if (phase === 'REDIRECTING') return 'ستعود إلى هذه الصفحة تلقائيًا بعد إتمام الدفع.'
    return 'لا تحتاج لتحديث الصفحة — سنعرض النتيجة هنا فور تأكيدها.'
  })()

  return (
    <div
      className="rounded-2xl border shadow-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      // The outcome arrives with no interaction, so the change has to be
      // announced or the page silently becomes a different page.
      role="status"
      aria-live="polite"
      dir="rtl"
    >
      <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-8 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: 'var(--color-background)',
            color: settledOk ? '#15803d' : settledBad ? '#b91c1c' : 'var(--color-primary)',
          }}
          aria-hidden="true"
        >
          {settledOk ? <IconCheck /> : settledBad ? <IconAlert /> : <IconSpinner />}
        </span>
        <p className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {headline}
        </p>
        <p className="max-w-xs text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {detail}
        </p>
      </div>

      {settledBad && failedAttemptAmount !== null ? (
        /*
         * TWO figures, because after a settled failure there are two.
         *
         * The refused attempt is history and is stated as history; the
         * current order is what the retry beside it would be priced
         * from. They were one value, read from whichever source happened
         * to be available, so a cart edited from 6 to 8 rewrote the
         * amount of a payment that had already been declined — the panel
         * claimed the customer had been refused for 400 SAR when they
         * had been refused for 300.
         */
        <div
          className="mx-6 my-4 flex flex-col gap-2 rounded-xl border px-4 py-3 text-[13px]"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
        >
          {methodLabel && (
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--color-text-muted)' }}>طريقة الدفع</span>
              <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {methodLabel}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between" data-testid="failed-attempt-amount">
            <span style={{ color: 'var(--color-text-muted)' }}>
              {phase === 'CANCELLED' ? 'قيمة المحاولة الملغاة' : 'قيمة المحاولة المرفوضة'}
            </span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
              {failedAttemptAmount}
            </span>
          </div>
          <div className="flex items-center justify-between" data-testid="current-order-total">
            <span style={{ color: 'var(--color-text-muted)' }}>إجمالي الطلب الحالي</span>
            <span className="font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {currentOrderLabel}
            </span>
          </div>
        </div>
      ) : (
      <div
        className="mx-6 my-4 flex items-center justify-between rounded-xl border px-4 py-3 text-[13px]"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {methodLabel ?? 'إجمالي الطلب'}
          </span>
          {methodLabel && (
            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>طريقة الدفع</span>
          )}
        </div>
        <span className="font-bold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
          {amountLabel}
        </span>
      </div>
      )}

      {orderNumber && (
        <p className="mx-6 mb-4 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
          رقم الطلب: <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{orderNumber}</span>
        </p>
      )}

      {waiting && (
        <div className="mx-6 mb-4 flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--color-text-muted)' }}>
          <IconLock />
          دفع آمن ومشفّر
        </div>
      )}

      {stalled && waiting && (
        <div className="mx-6 mb-5 rounded-xl px-4 py-3 text-[12px] leading-relaxed" style={{ background: '#fef3c7', color: '#92400e' }}>
          {/* The poll's budget ran out. This says only that we stopped
              asking — the payment itself is unchanged, and the webhook
              will settle it with or without this page. */}
          لم يصلنا التأكيد النهائي بعد. طلبك محفوظ وسنُعلمك عند تأكيده.
          <button
            type="button"
            onClick={onCheckAgain}
            className="mr-2 font-semibold underline"
          >
            تحقّق الآن
          </button>
          {/* The processing state has to be bounded. Once the poll's
              budget is spent nothing on this page will change on its own,
              and leaving the customer with a spinner and no action is how
              an abandoned 3DS challenge became a dead end. Retry starts a
              fresh checkout and intent, so it cannot double-charge the
              payment this panel is still waiting on. */}
          <button
            type="button"
            onClick={onRetry}
            className="mr-2 font-semibold underline"
          >
            ابدأ عملية دفع جديدة
          </button>
        </div>
      )}

      {settledBad && notice && (
        <p
          className="mx-6 mb-4 rounded-xl border px-4 py-3 text-[13px] leading-relaxed"
          style={{ borderColor: '#fcd34d', background: '#fffbeb', color: '#92400e' }}
          role="alert"
          data-testid="retry-notice"
          data-action={notice.action}
        >
          {notice.message}
        </p>
      )}

      {settledBad && (
        <div className="flex flex-col gap-2 border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
          {/*
            * Retry is offered unless the server has already said it
            * cannot work. Leaving a dead button as the primary action is
            * how a recoverable decline becomes a customer pressing the
            * same thing until they give up — see retryFailure.ts.
            */}
          {notice?.action === 'retry' || !notice ? (
            <button
              type="button"
              onClick={onRetry}
              className="w-full rounded-2xl py-3.5 text-[14px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.99]"
              style={{ background: 'var(--color-primary)' }}
            >
              المحاولة مرة أخرى
            </button>
          ) : null}
          <button
            type="button"
            onClick={onChooseAnother}
            className={
              notice && notice.action !== 'retry'
                ? 'w-full rounded-2xl py-3.5 text-[14px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.99]'
                : 'w-full rounded-2xl border py-3.5 text-[14px] font-semibold transition-colors'
            }
            style={
              notice && notice.action !== 'retry'
                ? { background: 'var(--color-primary)' }
                : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }
            }
          >
            {/* `restart_checkout` really is the method chooser: it
                releases the spent attempt and returns to the editable
                checkout, which is where a new snapshot is priced. */}
            تغيير طريقة الدفع
          </button>
        </div>
      )}

      {settledOk && (
        <div className="border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
          <Link
            href={
              orderNumber
                ? `/stores/${storeSlug}/checkout/success?order=${encodeURIComponent(orderNumber)}`
                : `/stores/${storeSlug}`
            }
            className="flex w-full items-center justify-center rounded-2xl py-3.5 text-[14px] font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.99]"
            style={{ background: 'var(--color-primary)' }}
          >
            {orderNumber ? 'عرض تفاصيل الطلب' : 'متابعة التسوق'}
          </Link>
        </div>
      )}
    </div>
  )
}
function Section({
  icon, title, subtitle, children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl border p-6 shadow-sm sm:p-7"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div className="mb-6 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--color-background)', color: 'var(--color-primary)' }}
        >
          {icon}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function Field({
  label, value, onChange, error, type = 'text', full = false, placeholder,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  type?: string
  full?: boolean
  placeholder?: string
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-2 block text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-xl border px-4 py-3 text-[14px] outline-none transition-all placeholder:opacity-50 focus:ring-2 focus:ring-offset-0"
        style={{
          borderColor: error ? '#fca5a5' : 'var(--color-border)',
          background: 'var(--color-background)',
          color: 'var(--color-text-primary)',
        }}
      />
      {error && <p className="mt-1.5 text-[12px] font-medium text-red-500">{error}</p>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   Moyasar Payment Form loader.

   The provider's official browser component, mounted inside our own
   checkout. Everything sensitive happens inside it: the card fields are
   Moyasar's, the payment is created by Moyasar against a publishable
   key, and no card number, CVV or expiry ever touches our origin's
   JavaScript or our backend. That is not a policy we follow — it is the
   only thing this module is capable of, because it never sees a field.

   Assets are pinned. An unpinned payment form is a third party changing
   our checkout without a deploy; the version is chosen by the backend
   adapter (MOYASAR_FORM_VERSION) and travels in the next action, so the
   pin lives with the integration rather than in a component.

   Docs: https://docs.moyasar.com/guides/card-payments/basic-integration/
         https://docs.moyasar.com/guides/references/form-configuration/
   ══════════════════════════════════════════════════════════════════════ */

const CDN_ORIGIN = 'https://cdn.moyasar.com'

/** Used only when the backend sent no pin — see the adapter. */
const FALLBACK_VERSION = '1.19.0'

export interface MoyasarFormConfig {
  amount: number
  currency: string
  description: string
  callback_url: string
  metadata: Record<string, unknown>
  /**
   * Apple Pay's own options, verbatim from the backend.
   *
   * Passed through as an opaque bag rather than typed field by field on
   * purpose: they are the provider's contract, the backend adapter is
   * what knows it, and re-declaring the shape here would be a second
   * place to keep in sync with Moyasar. Empty for an account that has
   * not configured Apple Pay, in which case `methods` will not contain
   * `applepay` either — the form throws if it does and these are absent.
   */
  applePayOptions: Record<string, unknown>
  /**
   * Which of the form's payment methods to render, chosen by the backend
   * from the offering the customer actually selected.
   *
   * Required rather than optional: the form's own default turns Apple Pay
   * on, and Apple Pay then refuses to initialise without merchant
   * validation configuration this integration does not have — which is a
   * blank payment area instead of a card form. Sending the list is what
   * makes the form render what the merchant enabled and nothing else.
   */
  methods: string[]
  /**
   * The card networks this merchant's enabled offerings add up to, in
   * the form's own `supported_networks` vocabulary.
   *
   * Forwarded rather than dropped, because dropping it is what made the
   * merchant's `mada` offering mean nothing on screen: the option
   * belongs to the card component and defaults to
   * `["amex","mada","visa","mastercard"]`, so a merchant who never
   * switched mada on was still shown a mada badge on their form. The
   * backend already computes the honest list; this is where it reaches
   * the provider.
   *
   * Absent when the backend sent none — the merchant Test Payment tool
   * groups nothing — and then the provider's own default stands, which
   * is exactly the behaviour that surface has always had.
   */
  supportedNetworks?: string[]
}

/**
 * The form's own lifecycle hooks, as the pinned bundle calls them.
 *
 * `on_initiating` is the one that matters most to this checkout: the
 * form calls it with the source it is about to charge, immediately
 * before it creates the payment, on every submit path it has (card,
 * Apple Pay, STC Pay). Returning `true` lets the payment proceed —
 * which is all we do with it. It is the provider telling us, in its own
 * contract, that the customer just pressed Pay, and it is therefore the
 * one honest definition of "a payment has started" available before a
 * provider object exists.
 *
 * `on_completed` and `on_failure` are observational only. Nothing here
 * may decide an outcome from them: the outcome comes from the server,
 * every time, exactly as it did before these existed.
 */
export interface MoyasarFormHandlers {
  /** The payer submitted. Must not block or the payment cannot start. */
  onInitiating?: () => void
  /** The provider created a payment. A hint to reconcile sooner. */
  onCompleted?: (payment: unknown) => void
  /** The provider refused. The form shows its own error and stays up. */
  onFailure?: (error: unknown) => void
}

interface MoyasarGlobal {
  init: (options: Record<string, unknown>) => void
  /**
   * The provider's own teardown, where the loaded build has one.
   *
   * Declared optional and called defensively because it is not part of
   * the documented contract: some builds expose `destroy`, some
   * `unmount`, some neither. `destroyPaymentForm` below tries them and
   * then empties the element itself, so the result does not depend on
   * which build is loaded.
   */
  destroy?: (element?: string | HTMLElement) => void
  unmount?: (element?: string | HTMLElement) => void
}

declare global {
  interface Window {
    Moyasar?: MoyasarGlobal
  }
}

function assetUrl(version: string, file: string): string {
  return `${CDN_ORIGIN}/mpf/${encodeURIComponent(version)}/${file}`
}

/**
 * Loads the script and stylesheet once per document.
 *
 * Keyed on the resolved URL rather than a boolean, so a version change
 * loads the new build instead of silently reusing the old one — and so
 * two mounts of the same version share one download.
 */
const inFlight = new Map<string, Promise<void>>()

function loadOnce(url: string, kind: 'script' | 'style'): Promise<void> {
  const existing = inFlight.get(url)
  if (existing) return existing

  const pending = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`[data-moyasar-asset="${url}"]`)) {
      resolve()
      return
    }

    const el =
      kind === 'script'
        ? Object.assign(document.createElement('script'), { src: url, async: true })
        : Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url })

    el.setAttribute('data-moyasar-asset', url)
    el.addEventListener('load', () => resolve())
    el.addEventListener('error', () =>
      // Surfaced, never swallowed: a form that failed to load must show
      // the customer an error, not an empty area they cannot pay in.
      reject(new Error(`Failed to load ${url}`)),
    )
    document.head.appendChild(el)
  })

  inFlight.set(url, pending)
  // A failed load must not be cached as "already loading" forever — the
  // customer's retry has to be able to try again.
  void pending.catch(() => inFlight.delete(url))
  return pending
}

export function resolveFormVersion(sdkHints: Record<string, unknown>): string {
  const pinned = sdkHints.form_version
  return typeof pinned === 'string' && /^[\d.]+$/.test(pinned) ? pinned : FALLBACK_VERSION
}

/** Loads the pinned assets and resolves with the global the form exposes. */
export async function loadMoyasarForm(version: string): Promise<MoyasarGlobal> {
  await Promise.all([
    loadOnce(assetUrl(version, 'moyasar.css'), 'style'),
    loadOnce(assetUrl(version, 'moyasar.js'), 'script'),
  ])

  const moyasar = window.Moyasar
  if (!moyasar || typeof moyasar.init !== 'function') {
    throw new Error('Moyasar form loaded but exposed no init()')
  }
  return moyasar
}

/**
 * Mounts the form.
 *
 * `callback_url` is where Moyasar sends the payer once the payment (and
 * any 3DS challenge) completes, carrying `?id=<payment id>`. It is the
 * checkout's own return URL, which the backend already validated against
 * this deployment's origin allowlist and stamped with the checkout
 * token — so the page that receives it knows both which checkout and
 * which payment to verify.
 */
export function mountMoyasarForm(
  moyasar: MoyasarGlobal,
  element: string | HTMLElement,
  publishableKey: string,
  config: MoyasarFormConfig,
  handlers: MoyasarFormHandlers = {},
): void {
  moyasar.init({
    element,
    publishable_api_key: publishableKey,
    amount: config.amount,
    currency: config.currency,
    description: config.description,
    callback_url: config.callback_url,
    metadata: config.metadata,
    methods: config.methods,
    ...(config.supportedNetworks && config.supportedNetworks.length > 0
      ? { supported_networks: config.supportedNetworks }
      : {}),
    /*
     * The submit gate.
     *
     * Wrapped rather than passed through: the bundle treats a `false`
     * return as "abort the payment" and anything thrown as a handler
     * error, so a listener of ours must never be able to stop a payment
     * the customer asked for. It records that the press happened and
     * returns `true`, always.
     */
    on_initiating: () => {
      try {
        handlers.onInitiating?.()
      } catch {
        /* Observing a submit may never prevent one. */
      }
      return true
    },
    on_completed: (payment: unknown) => {
      try {
        handlers.onCompleted?.(payment)
      } catch {
        /* Same rule: the provider's flow is not ours to break. */
      }
    },
    on_failure: (error: unknown) => {
      try {
        handlers.onFailure?.(error)
      } catch {
        /* The form renders its own error either way. */
      }
    },
    // Top-level options in Moyasar's contract (apple_pay_label,
    // apple_pay_country, apple_pay_validate_merchant_url, and the
    // optional supported-countries / merchant-capabilities lists).
    ...config.applePayOptions,
  })
}

/** Narrows the backend's client-safe config into what the form needs. */
export function readFormConfig(config: Record<string, unknown>): MoyasarFormConfig | null {
  const amount = typeof config.amount === 'number' ? config.amount : null
  const currency = typeof config.currency === 'string' ? config.currency : null
  const callbackUrl = typeof config.callback_url === 'string' ? config.callback_url : null
  const description = typeof config.description === 'string' ? config.description : ''
  const methods = Array.isArray(config.methods)
    ? config.methods.filter((m): m is string => typeof m === 'string')
    : []

  // No methods means the backend could not name one this form can host.
  // Mounting anyway falls back to the form's default, which is the Apple
  // Pay failure this field exists to avoid.
  if (amount === null || !currency || !callbackUrl || methods.length === 0) return null

  // Shape-checked like everything else handed to a third party's
  // `init()`: the form reads this only when it is an array, and a
  // malformed value is better dropped here than argued about there.
  const supportedNetworks = Array.isArray(config.supported_networks)
    ? config.supported_networks.filter((n): n is string => typeof n === 'string')
    : []

  return {
    amount,
    currency,
    description,
    callback_url: callbackUrl,
    methods,
    ...(supportedNetworks.length > 0 ? { supportedNetworks } : {}),
    applePayOptions: readApplePayOptions(config),
    metadata:
      config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
        ? (config.metadata as Record<string, unknown>)
        : {},
  }
}

/**
 * The Apple Pay options out of the backend's client-safe config.
 *
 * Allow-listed by key rather than spread wholesale: this object is
 * handed straight to a third party's `init()`, and copying every field
 * the backend happened to send would make any future addition to that
 * payload a silent change to the provider's configuration.
 *
 * Shape-checked, not merely copied — `apple_pay_country` must look like
 * a country code and the list fields must be arrays of strings, because
 * the form throws on a malformed value and a thrown form is a checkout
 * with no card fields in it.
 */
function readApplePayOptions(config: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = {}

  const label = config.apple_pay_label
  if (typeof label === 'string' && label.trim().length > 0) {
    options.apple_pay_label = label
  }

  const country = config.apple_pay_country
  if (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) {
    options.apple_pay_country = country
  }

  const validateUrl = config.apple_pay_validate_merchant_url
  if (typeof validateUrl === 'string' && /^https:\/\/.+/.test(validateUrl)) {
    options.apple_pay_validate_merchant_url = validateUrl
  }

  for (const key of ['apple_pay_supported_countries', 'apple_pay_merchant_capabilities']) {
    const value = config[key]
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      options[key] = value
    }
  }

  // All or nothing on the three the form has no default for: a partial
  // set is exactly what makes it throw, so half-configured reads as
  // not-configured and the card component still mounts.
  const required = ['apple_pay_label', 'apple_pay_country', 'apple_pay_validate_merchant_url']
  if (!required.every((key) => key in options)) return {}

  return options
}

/**
 * REMOVES a mounted payment form from the document.
 *
 * This is the function that protects money, and it is deliberately
 * blunt. When a payment has already succeeded — in this tab or another
 * one — a provider form still sitting in the DOM is a working way to
 * charge the customer a second time. Hiding it with CSS is not enough:
 * a hidden form is still payable, still focusable, still submittable by
 * an Enter key, an extension, or a stale event handler. It has to leave
 * the document.
 *
 * Three steps, in order, and each one independent of the last:
 *
 *   1. ask the provider to tear down its own instance, if the build
 *      exposes anything to ask;
 *   2. empty the container unconditionally, so a form whose provider
 *      ignored step 1 — or never offered it — is removed anyway;
 *   3. never throw. This runs on a path where the customer has already
 *      paid, and an exception here must not be able to leave the form
 *      standing or break the screen that reports the payment.
 */
export function destroyPaymentForm(element: HTMLElement | null): void {
  try {
    const moyasar = typeof window === 'undefined' ? undefined : window.Moyasar
    if (moyasar && element) {
      if (typeof moyasar.destroy === 'function') moyasar.destroy(element)
      else if (typeof moyasar.unmount === 'function') moyasar.unmount(element)
    }
  } catch {
    /* The provider's teardown is best-effort; step 2 is the guarantee. */
  }

  try {
    if (element) element.replaceChildren()
  } catch {
    /* Nothing left to do, and never a reason to throw on a paid screen. */
  }
}

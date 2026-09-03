/* ══════════════════════════════════════════════════════════════════════
   Payment next-action dispatch.

   The backend normalizes every provider into one `next_action` shape
   (backend/src/stores/payments/gateways/provider.types.ts). This module
   is the single place that interprets it, so provider names never have to
   be branched on in a component: adding a gateway means the backend emits
   an action kind that already has a handler here, and Checkout is
   untouched.

   Kinds actually emitted by the six in-scope adapters today:
     redirect          — Stripe (hosted Checkout Session), Paymob,
                         Moyasar (hosted Invoice), Tap
     bank_instructions — Bank Transfer
     none / null       — COD
   `client_sdk` is declared in the backend union and handled defensively
   below, but NO adapter currently emits it: Stripe moved to a hosted
   Checkout Session and its adapter states outright that no Stripe.js path
   remains on our own pages.
   ══════════════════════════════════════════════════════════════════════ */

export type NextActionKind =
  | 'redirect'
  | 'client_sdk'
  | 'bank_instructions'
  | 'none'
  | 'unsupported'

/** The wire shape: `kind` inlined alongside that kind's own payload. */
export interface RawNextAction {
  kind?: string
  url?: string
  method?: string
  form_fields?: Record<string, string>
  formFields?: Record<string, string>
  fields?: Record<string, unknown>
  client_secret?: string
  sdk_hints?: Record<string, unknown>
  [key: string]: unknown
}

export type PaymentAction =
  | {
      kind: 'redirect'
      url: string
      method: 'GET' | 'POST'
      formFields?: Record<string, string>
    }
  | {
      /**
       * The provider's own payment UI, to be mounted inside checkout.
       *
       * `clientSecret` is optional because not every provider has one —
       * Moyasar's form is driven by a publishable key plus the payment's
       * parameters. `config` carries those parameters, and only values
       * the provider publishes as browser-safe ever reach it.
       */
      kind: 'client_sdk'
      clientSecret: string | null
      publishableKey: string | null
      config: Record<string, unknown>
      sdkHints: Record<string, unknown>
    }
  | { kind: 'bank_instructions'; fields: Record<string, unknown> }
  | { kind: 'none' }
  | { kind: 'unsupported'; rawKind: string }

/**
 * Interprets the checkout response into exactly one action.
 *
 * `payment_redirect_url` is the response's flattened convenience copy of
 * a `redirect` action's URL. It is read only as a fallback: preferring it
 * would silently downgrade a `bank_instructions` or `client_sdk` response
 * to a redirect, which is how the pre-existing bug in this flow rendered
 * Bank Transfer as a COD-style "order placed" with the instructions
 * dropped on the floor.
 */
export function resolvePaymentAction(response: {
  next_action?: RawNextAction | null
  payment_redirect_url?: string | null
}): PaymentAction {
  const action = response?.next_action ?? null
  const kind = typeof action?.kind === 'string' ? action.kind : null

  if (action && kind === 'redirect') {
    const url = typeof action.url === 'string' ? action.url : null
    if (url) {
      return {
        kind: 'redirect',
        url,
        method: normalizeMethod(action.method),
        formFields: action.form_fields ?? action.formFields,
      }
    }
  }

  if (action && kind === 'client_sdk') {
    const clientSecret =
      typeof action.client_secret === 'string' ? action.client_secret : null
    const publishableKey =
      typeof action.publishable_key === 'string'
        ? action.publishable_key
        : typeof action.sdk_hints?.publishable_key === 'string'
          ? (action.sdk_hints.publishable_key as string)
          : null

    // One or the other must be present: a client secret drives an
    // Elements-style integration, a publishable key drives a form that
    // creates the payment itself. Neither means there is nothing to
    // mount, and falling through to `unsupported` says so rather than
    // rendering an empty box.
    if (clientSecret || publishableKey) {
      return {
        kind: 'client_sdk',
        clientSecret,
        publishableKey,
        config: asRecord(action.config),
        sdkHints: asRecord(action.sdk_hints),
      }
    }
  }

  if (action && kind === 'bank_instructions') {
    return { kind: 'bank_instructions', fields: extractInstructionFields(action) }
  }

  if (action && kind && kind !== 'none') {
    // A kind this frontend has no handler for (`iframe`, `reference_code`,
    // `poll` — declared in the backend union, emitted by nothing today).
    // Named explicitly so the UI can say "we can't complete this here"
    // instead of silently falling through to the COD success path.
    return { kind: 'unsupported', rawKind: kind }
  }

  if (!action && typeof response?.payment_redirect_url === 'string' && response.payment_redirect_url) {
    return { kind: 'redirect', url: response.payment_redirect_url, method: 'GET' }
  }

  return { kind: 'none' }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeMethod(method: unknown): 'GET' | 'POST' {
  return String(method ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
}

/**
 * Bank instructions are free-form merchant-authored key/values meant for
 * direct display. The adapter nests them under `fields`, but the response
 * builder inlines the payload alongside `kind`, so accept both shapes and
 * strip the transport keys that are never instructions themselves.
 */
const NON_FIELD_KEYS = new Set([
  'kind',
  'url',
  'method',
  'form_fields',
  'formFields',
  'client_secret',
  'publishable_key',
  'config',
  'sdk_hints',
  'fields',
])

export function extractInstructionFields(action: RawNextAction): Record<string, unknown> {
  if (action.fields && typeof action.fields === 'object') {
    return action.fields as Record<string, unknown>
  }
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(action)) {
    if (!NON_FIELD_KEYS.has(key)) rest[key] = value
  }
  return rest
}

/** Whether this action sends the customer to a provider-hosted surface. */
export function isRedirectAction(action: PaymentAction): action is Extract<PaymentAction, { kind: 'redirect' }> {
  return action.kind === 'redirect'
}

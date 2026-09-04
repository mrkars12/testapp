/* ══════════════════════════════════════════════════════════════════════
   Payment presentation mode — how the checkout must host a gateway.

   The value is decided by the backend from the adapter's own declared
   capabilities (backend/src/stores/payments/gateways/payment-presentation.ts)
   and published on each offering by
   GET /storefront/:slug/payment-methods. This module only parses it.

   The point of it is that Checkout has exactly one branch — over the
   mode — instead of one branch per gateway. Nothing in the storefront
   may ever ask "is this Moyasar?"; adding a gateway that redirects means
   the backend publishes `same_tab_redirect` for it and the checkout is
   untouched.
   ══════════════════════════════════════════════════════════════════════ */

export type PaymentPresentationMode = 'embedded' | 'same_tab_redirect' | 'offline'

const MODES: readonly string[] = ['embedded', 'same_tab_redirect', 'offline']

/**
 * The commitment kind the backend gives an offering that settles outside
 * any provider. Used only as the fallback signal for a response that
 * predates `presentation_mode`.
 */
const OFFLINE_COMMITMENT_KIND = 'awaiting_offline_settlement'
const PROMISE_COMMITMENT_KIND = 'promise_accepted'

export interface OfferingLike {
  presentation_mode?: string | null
  commitment_kind?: string | null
}

/**
 * Reads the mode off an offering.
 *
 * Falls back to the commitment kind — the field that already told the
 * old checkout whether a method leaves the site — so a backend that has
 * not been redeployed yet still produces a working checkout rather than
 * an unusable one. An unrecognized value falls back the same way: never
 * guess `embedded`, because rendering an in-page form for a gateway that
 * has none is the one failure that leaves a customer with no way to pay.
 */
export function resolvePresentationMode(offering: OfferingLike | null | undefined): PaymentPresentationMode {
  const declared = offering?.presentation_mode
  if (typeof declared === 'string' && MODES.includes(declared)) {
    return declared as PaymentPresentationMode
  }

  const commitment = offering?.commitment_kind
  if (commitment === OFFLINE_COMMITMENT_KIND || commitment === PROMISE_COMMITMENT_KIND) {
    return 'offline'
  }

  return 'same_tab_redirect'
}

/** Whether paying with this offering takes this tab to the provider. */
export function leavesTheSite(offering: OfferingLike | null | undefined): boolean {
  return resolvePresentationMode(offering) === 'same_tab_redirect'
}

/**
 * Whether the storefront can actually complete a payment with this
 * offering.
 *
 * The backend publishes the concrete next-action kinds an adapter may
 * emit. An offering whose adapter can only produce a kind this checkout
 * has no renderer for must not be offered: selecting it would fail only
 * at the moment the customer presses Pay, which is the worst possible
 * place to discover it.
 */
const RENDERABLE_ACTION_KINDS: readonly string[] = [
  'none',
  'redirect',
  'bank_instructions',
  // The provider's own form, mounted in this page. Renderable because
  // the checkout has a renderer for it — see the embedded panel in
  // app/stores/[slug]/checkout/page.tsx. A kind is listed here only
  // once something can actually complete a payment with it.
  'client_sdk',
]

export function isOfferingRenderable(offering: { next_action_kinds?: string[] | null } | null | undefined): boolean {
  const kinds = offering?.next_action_kinds
  // Absent means an older backend that does not publish the list. Trust
  // the offering rather than hiding every payment method.
  if (!Array.isArray(kinds) || kinds.length === 0) return true
  return kinds.every((kind) => RENDERABLE_ACTION_KINDS.includes(kind))
}

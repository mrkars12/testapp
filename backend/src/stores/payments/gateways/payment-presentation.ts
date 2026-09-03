import type { GatewayCapabilities, NextActionKindName } from './provider.types';
import { embeddedAvailable, isOfflineGateway } from './provider.types';

/**
 * ==================================================================
 * Payment presentation mode
 * ==================================================================
 *
 * How the *customer-facing* checkout surface has to host this gateway.
 *
 * Derived from the adapter's already-declared `nextActionKinds` rather
 * than written out per gateway: the list of action kinds an adapter can
 * emit is enforced by the conformance suite (an adapter returning a kind
 * it did not declare fails the contract), so deriving from it cannot
 * drift from what the adapter actually does. A hand-maintained
 * gateway → mode table would be a second copy of the same fact, and the
 * copy is what goes stale.
 *
 * This is presentation only. It never decides an outcome, never gates a
 * state transition, and is not a substitute for dispatching on the
 * concrete `next_action` the initialize call returns — the storefront
 * still does that. Its job is to let the checkout know, *before* the
 * customer commits to a method, whether paying will happen inside the
 * page or will take the tab to the provider, so the UI can say so and
 * prepare the right return context.
 *
 * Three modes, and no more, because these are the three things a
 * checkout page can structurally do:
 *
 *   embedded          — the provider's own payment UI renders inside our
 *                       checkout (an inline SDK form, or a provider-
 *                       hosted iframe the provider officially supports).
 *   same_tab_redirect — the payer must be sent to a provider-hosted page
 *                       and comes back. This tab goes there and returns;
 *                       it is never a second tab or a popup.
 *   offline           — nothing external happens in the browser at all:
 *                       cash on delivery, manual bank transfer, or any
 *                       adapter that settles server-side with no
 *                       customer action.
 */
export const PAYMENT_PRESENTATION_MODES = [
  'embedded',
  'same_tab_redirect',
  'offline',
] as const;

export type PaymentPresentationMode =
  (typeof PAYMENT_PRESENTATION_MODES)[number];

export function isPaymentPresentationMode(
  value: unknown,
): value is PaymentPresentationMode {
  return (
    typeof value === 'string' &&
    (PAYMENT_PRESENTATION_MODES as readonly string[]).includes(value)
  );
}

/**
 * Action kinds the checkout can host without leaving the page.
 *
 * `client_sdk` is the provider's own JS form mounted in our DOM.
 * `iframe` is a provider-hosted document the provider *documents* as
 * embeddable — an adapter that returns it is asserting that support;
 * nothing here fabricates an iframe around a page the provider only
 * publishes as a top-level redirect.
 */
const EMBEDDED_KINDS: ReadonlySet<NextActionKindName> =
  new Set<NextActionKindName>(['client_sdk', 'iframe']);

/**
 * Action kinds that require handing the tab to the provider.
 *
 * `redirect` is the only one: a `reference_code` is displayed in place
 * (the payer takes it to a counter) and `bank_instructions` likewise, so
 * neither takes the customer anywhere.
 */
const REDIRECT_KINDS: ReadonlySet<NextActionKindName> =
  new Set<NextActionKindName>(['redirect']);

/**
 * The mode implied by a single concrete action kind.
 *
 * The per-form counterpart of `presentationModeFor`, which answers for a
 * whole adapter. A provider form names exactly one action kind, so its
 * presentation is a lookup rather than a search — and it goes through
 * the same two sets, so the two answers cannot disagree about what
 * `client_sdk` or `redirect` means.
 */
export function presentationModeForKind(
  kind: NextActionKindName,
): PaymentPresentationMode {
  if (EMBEDDED_KINDS.has(kind)) return 'embedded';
  if (REDIRECT_KINDS.has(kind)) return 'same_tab_redirect';
  return 'offline';
}

/**
 * The mode a checkout must be prepared to host for this gateway.
 *
 * Ordering is deliberate:
 *
 *   1. An offline adapter is offline no matter what else it declares —
 *      there is no provider surface to embed or redirect to. (The
 *      capability model already forbids an offline adapter from claiming
 *      webhooks/capture/3DS; `bank_instructions` is displayed in place.)
 *   2. Embedded wins over redirect when an adapter can do both: staying
 *      in the page is the better experience and the adapter has
 *      committed to supporting it.
 *   3. Redirect otherwise.
 *   4. An online adapter that declares no customer action at all
 *      settles entirely server-side — from the page's point of view
 *      that is indistinguishable from offline: nothing to render, no
 *      tab to move.
 */
export function presentationModeFor(
  capabilities: GatewayCapabilities,
  /**
   * The credential key **names** configured on the account being offered
   * (from `credentials_hint`, which holds masked last-4 values and no
   * secrets). Omitted answers for the adapter in the abstract, which is
   * what the conformance tests want; a real offering always passes it,
   * because whether embedded is reachable is a per-account fact.
   */
  configuredCredentialKeys?: readonly string[],
): PaymentPresentationMode {
  if (isOfflineGateway(capabilities)) return 'offline';

  const kinds = capabilities.nextActionKinds;

  if (kinds.some((kind) => EMBEDDED_KINDS.has(kind))) {
    // An adapter that *can* run embedded still cannot for an account
    // missing what the provider's own component needs to start — a
    // Moyasar account with no publishable key, for instance. Falling
    // through to redirect is the honest answer for that account, and it
    // is why this is resolved per offering rather than per adapter.
    const available =
      configuredCredentialKeys === undefined ||
      embeddedAvailable(capabilities, configuredCredentialKeys);

    if (available) return 'embedded';
  }

  if (kinds.some((kind) => REDIRECT_KINDS.has(kind)))
    return 'same_tab_redirect';

  return 'offline';
}

/** Whether paying with this gateway takes the tab off our own origin. */
export function leavesTheSite(
  capabilities: GatewayCapabilities,
  configuredCredentialKeys?: readonly string[],
): boolean {
  return (
    presentationModeFor(capabilities, configuredCredentialKeys) ===
    'same_tab_redirect'
  );
}

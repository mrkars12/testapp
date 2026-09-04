import type { Mode } from './types'

/* ══════════════════════════════════════════════════════════════════════
   Which mode the payment-settings page opens a gateway on.

   A gateway can hold one account per mode, and only one of them is shown
   at a time. Picking the wrong one is indistinguishable, to the
   merchant, from the save having failed: secrets are never returned to
   the browser by design, so an unconfigured account renders as blank
   inputs and a "غير مهيّأة" badge no matter how much is safely stored
   under the other mode.

   That is exactly what happened. The old rule asked whether a live
   account row EXISTED, not whether it was configured, so an empty
   `draft` live row outranked a fully configured test account — and
   credentials typed into that view were saved onto the live account.
   ══════════════════════════════════════════════════════════════════════ */

export interface ModeAccount {
  mode: Mode
  /** Server-reported: credential material exists. Never a secret. */
  is_configured?: boolean
}

export interface ModeGateway {
  accounts: ModeAccount[]
  supports_test_mode?: boolean
}

/**
 * The mode to open a gateway on.
 *
 * Preference order:
 *  1. a mode whose account is actually configured — live first, because
 *     that is the one customers pay through;
 *  2. otherwise the previous behaviour: live when a live account exists
 *     or the gateway has no test mode, else test.
 *
 * Nothing is guessed beyond what the accounts themselves report.
 */
export function initialModeFor(gateway: ModeGateway): Mode {
  const configured = gateway.accounts.filter((a) => a.is_configured).map((a) => a.mode)
  if (configured.includes('live')) return 'live'
  if (configured.includes('test')) return 'test'

  const hasLive = gateway.accounts.some((a) => a.mode === 'live')
  return hasLive || gateway.supports_test_mode === false ? 'live' : 'test'
}

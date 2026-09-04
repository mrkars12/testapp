/* ══════════════════════════════════════════════════════════════════════
   Shared payment-settings types — single source of truth mirroring
   `PaymentAccountService.listSettings()` / `toPublicAccount()` /
   `webhookStatusFor()` on the backend. Previously these were redeclared
   independently in page.tsx, test/page.tsx, and test/result/page.tsx,
   which is exactly how a prior version of page.tsx ended up with a
   shape that silently didn't match the real API response.
   ══════════════════════════════════════════════════════════════════════ */

export type FieldType = 'text' | 'password' | 'select' | 'textarea'
export type AccountStatus = 'draft' | 'verifying' | 'active' | 'disabled' | 'errored'
export type Mode = 'test' | 'live'

export interface PaymentField {
  key: string
  label_ar: string
  label_en: string
  type: FieldType
  required: boolean
  options?: { value: string; label_ar: string; label_en: string }[]
  placeholder?: string
  help_ar?: string
}

export type WebhookAccountStatus =
  | 'not_configured'
  | 'configured'
  | 'verified'
  | 'verification_failed'
  | 'disabled'

export interface WebhookStatus {
  supported: boolean
  configured: boolean
  status: WebhookAccountStatus
  last_event_at: string | null
  last_event_verified: boolean | null
}

export interface PaymentOffering {
  id: string
  method: string
  gateway_method_config: string
  enabled: boolean
  position: number
  display_name_ar: string | null
  display_name_en: string | null
  constraints: unknown
  commitment_kind: string
  capture_mode: string
}

export interface PublicAccount {
  id: string
  mode: Mode
  gateway: string
  display_name: string
  status: AccountStatus
  settlement_currency: string | null
  is_configured: boolean
  credentials_hint: Record<string, string>
  last_verified_at: string | null
  last_error: string | null
  webhook: WebhookStatus | null
  offerings?: PaymentOffering[]
}

export interface WebhookEventSpec {
  key: string
  label_ar: string
  required: boolean
}

export interface Gateway {
  key: string
  name_ar: string
  name_en: string
  requires_credentials: boolean
  supports_test_mode: boolean
  supports_multiple_integrations: boolean
  methods: string[]
  fields: PaymentField[]
  webhook_events: WebhookEventSpec[]
  webhook_setup_help_ar: string | null
  /** False for catalog-only gateways with no adapter yet (e.g. my_fatoorah, fawry). */
  has_adapter: boolean
  /** true only when the catalog allows test mode AND an adapter is actually registered. */
  test_payment_supported: boolean
  /** Which credential field key holds the webhook signing secret/HMAC — null when the gateway has no webhooks. */
  webhook_secret_field: string | null
  /** True only for gateways whose webhook secret the server can generate for the merchant (Moyasar today) — see gateway-catalog.ts. */
  supports_generated_webhook_secret: boolean
  accounts: PublicAccount[]
}

/** The one-time response from POST .../webhook/secret/generate — the only place `webhook_secret` ever appears in plaintext. */
export interface GeneratedWebhookSecret extends PublicAccount {
  webhook_secret: string
}

/** Runtime-origin-derived, never hardcoded — works in Codespaces, local dev, and production alike. */
export function backendOrigin(): string {
  if (typeof window === 'undefined') return ''
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || `${window.location.origin}/api`
  try {
    return new URL(apiUrl).origin
  } catch {
    return window.location.origin
  }
}

export function webhookUrl(gatewayKey: string, account: PublicAccount | null): string {
  return account ? `${backendOrigin()}/api/payments/webhooks/${gatewayKey}/${account.id}` : ''
}

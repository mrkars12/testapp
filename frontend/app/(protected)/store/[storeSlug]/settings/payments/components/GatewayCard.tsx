import type { Gateway, Mode, PublicAccount } from '@/lib/payments/types'
import { GATEWAY_STATUS_BADGE, GATEWAY_STATUS_LABEL, NOT_CONFIGURED_BADGE, NOT_CONFIGURED_LABEL } from '@/lib/payments/status'
import StatusBadge from './StatusBadge'
import ModeToggle from './ModeToggle'
import SecretField from './SecretField'
import SetupSteps from './SetupSteps'
import WebhookPanel from './WebhookPanel'
import TestPaymentCta from './TestPaymentCta'
import { IconChevron, IconSpinner } from './icons'

/**
 * The one card used for every gateway — Stripe, Paymob, Moyasar, Tap,
 * COD, and Bank Transfer alike. Every section below is gated on a
 * capability flag (`requires_credentials`, `supports_test_mode`,
 * `webhook_events.length`, `test_payment_supported`), never on
 * `gateway.key`. COD ends up with no ModeToggle/no fields/no
 * WebhookPanel/no TestPaymentCta purely because its catalog entry
 * declares none of those capabilities — same for Bank Transfer minus
 * the credential fields it does declare (bank details, not secrets).
 */
export default function GatewayCard({
  gateway,
  mode,
  onModeChange,
  account,
  expanded,
  onToggleExpanded,
  draftValues,
  onDraftChange,
  saving,
  onToggleEnabled,
  onSaveCredentials,
  onClearCredentials,
  error,
  savedFlash,
  copiedUrl,
  onCopy,
  verifying,
  onVerifyWebhook,
  generatedSecret,
  generatingSecret,
  onGenerateSecret,
  onDismissGeneratedSecret,
}: {
  gateway: Gateway
  mode: Mode
  onModeChange: (mode: Mode) => void
  account: PublicAccount | null
  expanded: boolean
  onToggleExpanded: () => void
  draftValues: Record<string, string>
  onDraftChange: (fieldKey: string, value: string) => void
  saving: boolean
  onToggleEnabled: () => void
  onSaveCredentials: () => void
  onClearCredentials: () => void
  error?: string
  savedFlash: boolean
  copiedUrl: string | null
  onCopy: (text: string) => void
  verifying: boolean
  onVerifyWebhook: () => void
  generatedSecret?: string | null
  generatingSecret?: boolean
  onGenerateSecret?: () => void
  onDismissGeneratedSecret?: () => void
}) {
  const isEnabled = account?.status === 'active'
  const canExpand = gateway.requires_credentials && gateway.has_adapter
  const comingSoon = !gateway.has_adapter

  // A required field is satisfied by a non-empty draft value OR by
  // already being on file (credentials_hint present) — leaving a saved
  // field blank means "unchanged", not "delete", the same merge
  // semantics the backend applies (see sanitizeCredentials/
  // buildCredentialUpdate). Mirrors missingRequiredFields() so a
  // merchant never sees Save silently do nothing and never gets a
  // false "required" nag for a value they already saved.
  const missingRequired = gateway.fields.filter(
    (field) =>
      field.required &&
      !(draftValues[field.key] ?? '').trim() &&
      !account?.credentials_hint?.[field.key],
  )

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow ${
        comingSoon ? 'border-gray-100 opacity-70' : 'border-gray-200 hover:shadow-md'
      }`}
    >
      <div
        className={`flex items-center justify-between gap-3 px-4 py-4 ${canExpand ? 'cursor-pointer' : ''}`}
        onClick={() => canExpand && onToggleExpanded()}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14.5px] font-semibold text-gray-900">{gateway.name_ar}</span>
              {comingSoon ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${NOT_CONFIGURED_BADGE}`}>قريباً</span>
              ) : account ? (
                <StatusBadge status={account.status} labelMap={GATEWAY_STATUS_LABEL} colorMap={GATEWAY_STATUS_BADGE} />
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${NOT_CONFIGURED_BADGE}`}>{NOT_CONFIGURED_LABEL}</span>
              )}
              {/* Whether credentials are STORED is a different fact from
                  the account's lifecycle status, and the merchant needs
                  it stated. The secret inputs are deliberately never
                  refilled (the server does not return secrets, by
                  design), so without this a configured-but-not-yet-active
                  account reads as "nothing was saved" — which is exactly
                  how this was reported. `is_configured` comes from the
                  server having credential material; no secret is
                  involved in showing it. */}
              {account?.is_configured && (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                  ✓ البيانات محفوظة
                </span>
              )}
              {gateway.supports_test_mode && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    mode === 'test' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {mode === 'test' ? 'Test' : 'Live'}
                </span>
              )}
              {savedFlash && <span className="text-[11px] font-medium text-green-600">تم الحفظ</span>}
            </div>
            {!comingSoon && (
              <SetupSteps gateway={gateway} account={account} />
            )}
            {account?.status === 'errored' && account.last_error && (
              <span className="truncate text-[12px] text-red-500">{account.last_error}</span>
            )}
            {comingSoon && <span className="text-[12px] text-gray-400">لسه من غير أدابتر مفعّل — قريباً</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
          {!comingSoon && (
            <>
              {saving && !expanded ? (
                <span className="text-gray-400"><IconSpinner /></span>
              ) : (
                <button
                  onClick={onToggleEnabled}
                  role="switch"
                  aria-checked={isEnabled}
                  className="relative h-6 w-11 rounded-full transition-colors"
                  style={{ background: isEnabled ? '#16a34a' : '#e5e7eb' }}
                >
                  <span
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                    style={{ transform: isEnabled ? 'translateX(-22px)' : 'translateX(-2px)', right: 0 }}
                  />
                </button>
              )}
              {canExpand && (
                <button onClick={onToggleExpanded} className="text-gray-400 hover:text-gray-600">
                  <IconChevron open={expanded} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && canExpand && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-4">
          {gateway.supports_test_mode && (
            <div className="mb-4">
              <ModeToggle mode={mode} onChange={onModeChange} />
            </div>
          )}

          <div className="flex flex-col gap-3">
            {gateway.fields.map((field) => (
              <SecretField
                key={field.key}
                field={field}
                value={draftValues[field.key] ?? ''}
                hint={account?.credentials_hint?.[field.key]}
                isWebhookSecret={gateway.webhook_secret_field === field.key}
                onChange={(value) => onDraftChange(field.key, value)}
              />
            ))}
          </div>

          {gateway.webhook_events.length > 0 && (
            <WebhookPanel
              gateway={gateway}
              account={account}
              mode={mode}
              copiedUrl={copiedUrl}
              onCopy={onCopy}
              verifying={verifying}
              onVerify={onVerifyWebhook}
              generatedSecret={generatedSecret}
              generatingSecret={generatingSecret}
              onGenerateSecret={onGenerateSecret}
              onDismissGeneratedSecret={onDismissGeneratedSecret}
            />
          )}

          <TestPaymentCta gateway={gateway} />

          {error && <p className="mt-3 text-[12.5px] text-red-500">{error}</p>}

          {missingRequired.length > 0 && (
            <p className="mt-3 text-[12.5px] text-amber-600">
              محتاج تدخل: {missingRequired.map((f) => f.label_ar).join('، ')}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between">
            {account?.is_configured ? (
              <button onClick={onClearCredentials} className="text-[12.5px] font-medium text-red-500 hover:underline">
                فصل البوابة ومسح البيانات
              </button>
            ) : (
              <span />
            )}

            <button
              onClick={onSaveCredentials}
              disabled={saving || missingRequired.length > 0}
              className="flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving && <IconSpinner />}
              التحقق من البيانات وحفظها
            </button>
          </div>
        </div>
      )}

      {/* COD/manual-only rendering: no credentials, no accordion — the
          toggle above is the entire setup surface, plus a short blurb so
          the card never looks blank. */}
      {!gateway.requires_credentials && !comingSoon && (
        <div className="border-t border-gray-100 px-4 py-3 text-[12px] text-gray-400">
          طريقة يدوية بدون بيانات اعتماد أو ويبهوك — التفعيل/التعطيل بالسويتش فقط.
        </div>
      )}
    </div>
  )
}

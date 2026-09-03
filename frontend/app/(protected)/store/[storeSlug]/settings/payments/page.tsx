'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { useActiveStoreReady } from '@/lib/useActiveStoreReady'
import type { Gateway, GeneratedWebhookSecret, Mode, PublicAccount, WebhookStatus } from '@/lib/payments/types'
import { initialModeFor } from '@/lib/payments/settingsMode'
import GatewayCard from './components/GatewayCard'

/* ══════════════════════════════════════════════════════════════════════
   Admin — Payment Settings (Onboarding Center)
   /store/settings/payments — the active store comes from global
   state, not the URL.
   GET  /api/stores/payment-settings
   PUT  /api/stores/payment-settings/:gateway
   DEL  /api/stores/payment-settings/:gateway/credentials
   GET  /api/stores/payment-settings/:gateway/webhook

   One catalog entry per gateway with an `accounts: PublicAccount[]` array —
   `test` and `live` are two *separate* accounts, never a flag on one
   object. All gateway-specific rendering lives in <GatewayCard> and is
   driven purely by capability flags from the catalog response
   (requires_credentials / supports_test_mode / webhook_events /
   test_payment_supported / has_adapter) — this page never branches on a
   gateway's key or name.
   ══════════════════════════════════════════════════════════════════════ */

export default function PaymentSettingsPage() {
  const router = useRouter()
  const { storeSlug: activeStoreSlug, ready: activeStoreReady } = useActiveStoreReady()
  const storeSlug = activeStoreSlug || ''
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [modeByGateway, setModeByGateway] = useState<Record<string, Mode>>({})
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({})
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null)
  // Plaintext Secret Token from the generate call, held only in memory —
  // keyed like drafts (`gateway:mode`) so switching mode/leaving never
  // shows the wrong account's secret, and a page reload always starts
  // empty (Part 5/6: one-time display, never persisted, never re-fetched).
  const [generatedSecretByKey, setGeneratedSecretByKey] = useState<Record<string, string>>({})
  const [generatingSecretKey, setGeneratingSecretKey] = useState<string | null>(null)

  const loadGateways = async (signal?: AbortSignal) => {
    if (!activeStoreReady) return
    if (!storeSlug) { setLoading(false); return }
    setLoading(true)
    setGateways([])
    setExpandedKey(null)
    try {
      const res = await api.get('/stores/payment-settings', { signal })
      if (signal?.aborted) return
      const data: Gateway[] = res.data
      setGateways(data)
      // Open each gateway on the mode the merchant has actually
      // CONFIGURED.
      //
      // This used to key off whether a live account row merely existed,
      // which is not the same thing: an empty `draft` live row — created
      // by a stray save, or by enabling a gateway before entering
      // credentials — outranked a fully configured test account. The
      // merchant then opened Payments, saw their gateway badged
      // "غير مهيّأة" with blank credential fields, and reasonably
      // concluded the save had failed. Nothing had failed; the page was
      // showing the other account.
      //
      // Worse, typing credentials into that view saved TEST keys onto
      // the LIVE account. Preferring a configured mode removes both.
      //
      // Live still wins when both modes are configured — that is the one
      // a customer actually pays through. Nothing is guessed beyond what
      // the accounts themselves report.
      setModeByGateway((prev) => {
        const next = { ...prev }
        for (const g of data) {
          if (next[g.key]) continue
          next[g.key] = initialModeFor(g)
        }
        return next
      })
    } catch (err: any) {
      if (err?.silent || err?.code === 'ERR_CANCELED') return
      if (err?.response?.status === 404) { router.replace('/store'); return }
      setErrorByKey({ __global: 'تعذر تحميل بوابات الدفع، حاول تاني' })
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    loadGateways(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug, activeStoreReady])

  const modeOf = (gatewayKey: string): Mode => modeByGateway[gatewayKey] || 'live'
  const accountOf = (gateway: Gateway): PublicAccount | null =>
    gateway.accounts.find((a) => a.mode === modeOf(gateway.key)) || null

  const draftKey = (gatewayKey: string) => `${gatewayKey}:${modeOf(gatewayKey)}`

  const setMode = (gatewayKey: string, mode: Mode) => {
    setModeByGateway((prev) => ({ ...prev, [gatewayKey]: mode }))
  }

  const toggleExpanded = (key: string) => setExpandedKey((prev) => (prev === key ? null : key))

  const saveGateway = async (gateway: Gateway, enabled: boolean) => {
    setSavingKey(gateway.key)
    setErrorByKey((prev) => ({ ...prev, [gateway.key]: '' }))
    try {
      const res = await api.put(`/stores/payment-settings/${gateway.key}`, {
        enabled,
        mode: modeOf(gateway.key),
        credentials: drafts[draftKey(gateway.key)] || {},
      })
      const savedAccount: PublicAccount = res.data
      setGateways((prev) =>
        prev.map((g) => {
          if (g.key !== gateway.key) return g
          const others = g.accounts.filter((a) => a.mode !== savedAccount.mode)
          return { ...g, accounts: [...others, savedAccount] }
        }),
      )
      return true
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || 'حصل خطأ'
      setErrorByKey((prev) => ({ ...prev, [gateway.key]: msg }))
      return false
    } finally {
      setSavingKey(null)
    }
  }

  /** تفعيل/تعطيل مباشر من الـ switch (من غير ما يفتح الفورم) */
  const handleToggle = async (gateway: Gateway) => {
    const account = accountOf(gateway)
    const nextEnabled = account?.status !== 'active'

    // لو هيفعّل بوابة لسه مش متظبطة ومحتاجة بيانات — افتحله الفورم بدل ما يفشل بصمت
    if (nextEnabled && gateway.requires_credentials && !account?.is_configured) {
      setExpandedKey(gateway.key)
      return
    }
    await saveGateway(gateway, nextEnabled)
  }

  const handleSaveCredentials = async (gateway: Gateway) => {
    const ok = await saveGateway(gateway, true)
    if (ok) {
      setDrafts((prev) => ({ ...prev, [draftKey(gateway.key)]: {} }))
      setSavedFlash(gateway.key)
      setTimeout(() => setSavedFlash(null), 2000)
    }
  }

  const handleClearCredentials = async (gateway: Gateway) => {
    // Destructive — wipes saved credential material for this gateway+mode
    // and resets the account to draft (never touches orders/payments/
    // ledger data; see PaymentAccountService.clearCredentials), but
    // re-entering credentials is real work the merchant shouldn't lose
    // by accident.
    if (!confirm(`فصل بوابة ${gateway.name_ar} ومسح بياناتها المحفوظة؟ هتحتاج تدخل بيانات الاعتماد تاني عشان تفعّلها من جديد.`)) return
    setSavingKey(gateway.key)
    try {
      await api.delete(
        `/stores/payment-settings/${gateway.key}/credentials?mode=${modeOf(gateway.key)}`,
      )
      await loadGateways()
    } catch (err: any) {
      if (err?.silent) return
      const msg = err?.response?.data?.message || err.message || 'حصل خطأ'
      setErrorByKey((prev) => ({ ...prev, [gateway.key]: msg }))
    } finally {
      setSavingKey(null)
    }
  }

  /** Re-reads the webhook status from the last WebhookEvent actually
      received — never fabricates a "verified" result from credentials alone. */
  const handleVerifyWebhook = async (gateway: Gateway) => {
    const account = accountOf(gateway)
    if (!account) return
    setVerifyingKey(gateway.key)
    try {
      const res = await api.get(`/stores/payment-settings/${gateway.key}/webhook`, {
        params: { mode: modeOf(gateway.key) },
      })
      const webhook: WebhookStatus = res.data
      setGateways((prev) =>
        prev.map((g) => {
          if (g.key !== gateway.key) return g
          return {
            ...g,
            accounts: g.accounts.map((a) => (a.id === account.id ? { ...a, webhook } : a)),
          }
        }),
      )
    } catch {
      // Non-fatal — the badge simply keeps its last known value.
    } finally {
      setVerifyingKey(null)
    }
  }

  /** "إنشاء / إعادة إنشاء Secret Token" — server generates, encrypts, and
      persists the token; the plaintext returned here is the only copy
      this page ever sees, kept only in memory (see generatedSecretByKey
      above). Uses the response account directly to update `gateways`,
      same authoritative-response pattern as saveGateway — never a
      re-fetch of the (momentarily stale) settings list. */
  const handleGenerateWebhookSecret = async (gateway: Gateway) => {
    const account = accountOf(gateway)
    if (account?.webhook?.configured) {
      const ok = confirm(
        'إنشاء Secret جديد سيُبطل الـSecret الحالي.\nيجب تحديث الـSecret في Moyasar أيضًا.',
      )
      if (!ok) return
    }

    const key = draftKey(gateway.key)
    setGeneratingSecretKey(gateway.key)
    setErrorByKey((prev) => ({ ...prev, [gateway.key]: '' }))
    try {
      const res = await api.post(
        `/stores/payment-settings/${gateway.key}/webhook/secret/generate`,
        {},
        { params: { mode: modeOf(gateway.key) } },
      )
      const { webhook_secret, ...savedAccount }: GeneratedWebhookSecret = res.data
      setGateways((prev) =>
        prev.map((g) => {
          if (g.key !== gateway.key) return g
          const others = g.accounts.filter((a) => a.mode !== savedAccount.mode)
          return { ...g, accounts: [...others, savedAccount as PublicAccount] }
        }),
      )
      setGeneratedSecretByKey((prev) => ({ ...prev, [key]: webhook_secret }))
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || 'حصل خطأ'
      setErrorByKey((prev) => ({ ...prev, [gateway.key]: msg }))
    } finally {
      setGeneratingSecretKey(null)
    }
  }

  const dismissGeneratedSecret = (gateway: Gateway) => {
    const key = draftKey(gateway.key)
    setGeneratedSecretByKey((prev) => {
      const { [key]: _drop, ...rest } = prev
      return rest
    })
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedUrl(text)
      setTimeout(() => setCopiedUrl(null), 1500)
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions);
      // the URL is still visible and selectable in the input itself.
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-gray-100" />
        <div className="mb-6 h-4 w-72 animate-pulse rounded-lg bg-gray-100" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />
          ))}
        </div>
      </div>
    )
  }

  if (activeStoreReady && !storeSlug) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="font-semibold text-gray-700">لا يوجد متجر نشط</p>
        <a href="/store" className="text-sm text-blue-600 hover:underline">اختيار متجر</a>
      </div>
    )
  }

  // Implemented gateways (has_adapter) surface first — catalog-only
  // entries (no adapter yet) sink to the bottom as muted "coming soon"
  // cards, never hidden entirely (so the merchant knows they exist).
  const sorted = [...gateways].sort((a, b) => Number(b.has_adapter) - Number(a.has_adapter))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">بوابات الدفع</h1>
          <p className="mt-1 text-sm text-gray-500">
            فعّل بوابات الدفع اللي عايز تقبل بيها الطلبات في متجرك. بياناتك محفوظة ومشفّرة بالكامل.
          </p>
        </div>
        {/*
          Slug-scoped. This was hardcoded without the store segment, which
          404s: the legacy slug-free stub tree covered the payments section
          but never had a `test` child beneath it. This page already knows
          its store, so there is no reason to drop the slug and route
          through a redirect at all.
        */}
        <a
          href={`/store/${encodeURIComponent(storeSlug)}/settings/payments/test`}
          className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
        >
          اختبار بوابة الدفع
        </a>
      </div>

      {errorByKey.__global && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{errorByKey.__global}</div>
      )}

      <div className="flex flex-col gap-3">
        {sorted.map((gateway) => (
          <GatewayCard
            key={gateway.key}
            gateway={gateway}
            mode={modeOf(gateway.key)}
            onModeChange={(m) => setMode(gateway.key, m)}
            account={accountOf(gateway)}
            expanded={expandedKey === gateway.key}
            onToggleExpanded={() => toggleExpanded(gateway.key)}
            draftValues={drafts[draftKey(gateway.key)] || {}}
            onDraftChange={(fieldKey, value) =>
              setDrafts((prev) => ({
                ...prev,
                [draftKey(gateway.key)]: { ...prev[draftKey(gateway.key)], [fieldKey]: value },
              }))
            }
            saving={savingKey === gateway.key}
            onToggleEnabled={() => handleToggle(gateway)}
            onSaveCredentials={() => handleSaveCredentials(gateway)}
            onClearCredentials={() => handleClearCredentials(gateway)}
            error={errorByKey[gateway.key]}
            savedFlash={savedFlash === gateway.key}
            copiedUrl={copiedUrl}
            onCopy={copyToClipboard}
            verifying={verifyingKey === gateway.key}
            onVerifyWebhook={() => handleVerifyWebhook(gateway)}
            generatedSecret={generatedSecretByKey[draftKey(gateway.key)] || null}
            generatingSecret={generatingSecretKey === gateway.key}
            onGenerateSecret={() => handleGenerateWebhookSecret(gateway)}
            onDismissGeneratedSecret={() => dismissGeneratedSecret(gateway)}
          />
        ))}
      </div>
    </div>
  )
}

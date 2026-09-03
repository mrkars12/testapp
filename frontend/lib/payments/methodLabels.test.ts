import { describe, it, expect } from 'vitest'
import { resolveMethodDisplayName, PAYMENT_METHOD_LABELS_AR } from './methodLabels'

describe('resolveMethodDisplayName — UI-only fallback', () => {
  it('prefers display_name_ar when available', () => {
    expect(resolveMethodDisplayName({ method: 'card', name_ar: 'بطاقة مخصصة', name_en: 'Custom Card' })).toBe('بطاقة مخصصة')
  })
  it('falls back to display_name_en when ar is null', () => {
    expect(resolveMethodDisplayName({ method: 'card', name_ar: null, name_en: 'Custom Card' })).toBe('Custom Card')
  })
  it('falls back to method-key mapping when both display names are null', () => {
    expect(resolveMethodDisplayName({ method: 'card', name_ar: null, name_en: null })).toBe(PAYMENT_METHOD_LABELS_AR.card)
    expect(resolveMethodDisplayName({ method: 'mada', name_ar: null, name_en: null })).toBe('مدى')
    expect(resolveMethodDisplayName({ method: 'apple_pay', name_ar: null, name_en: null })).toBe('Apple Pay')
  })
  it('produces distinct labels for distinct method keys even when display names are null', () => {
    const card = resolveMethodDisplayName({ method: 'card', name_ar: null, name_en: null })
    const mada = resolveMethodDisplayName({ method: 'mada', name_ar: null, name_en: null })
    const apple = resolveMethodDisplayName({ method: 'apple_pay', name_ar: null, name_en: null })
    expect(new Set([card, mada, apple]).size).toBe(3)
    expect(card).not.toBe(mada)
    expect(mada).not.toBe(apple)
  })
  it('never collapses to generic "الدفع داخل هذه الصفحة" for distinct methods', () => {
    for (const method of ['card', 'mada', 'apple_pay', 'knet', 'cod', 'bank_transfer']) {
      const label = resolveMethodDisplayName({ method, name_ar: null, name_en: null })
      expect(label).not.toBe('الدفع داخل هذه الصفحة')
    }
  })
  it('existing localized display names still win over fallback', () => {
    expect(resolveMethodDisplayName({ method: 'card', name_ar: 'بطاقة الراجحي', name_en: null })).toBe('بطاقة الراجحي')
    // whitespace trimmed and empty treated as missing
    expect(resolveMethodDisplayName({ method: 'card', name_ar: '   ', name_en: null })).toBe(PAYMENT_METHOD_LABELS_AR.card)
  })
})

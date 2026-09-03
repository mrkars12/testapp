'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AsYouType, isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js'
import type { CountryCode } from 'libphonenumber-js'
import { countries, type Country } from '@/data/countries-original'

export interface PhoneValue {
  e164: string
  country: string
  countryCode: string
  dialCode: string
}

interface PhoneInputProps {
  /** ISO 3166-1 alpha-2 default, e.g. "EG" for an Egypt-first Arabic onboarding flow. */
  defaultCountryCode?: string
  /** Fires with a fully valid, normalized value, or null while the number isn't valid yet. */
  onChange: (value: PhoneValue | null) => void
  error?: string
  label?: string
  id?: string
}

/** "EG" -> 🇪🇬 via Unicode regional indicator symbols — no image asset needed. */
function flagEmoji(iso2: string): string {
  if (!/^[A-Z]{2}$/.test(iso2)) return '🏳️'
  return String.fromCodePoint(...[...iso2].map((c) => 127397 + c.charCodeAt(0)))
}

const sortedCountries = [...countries].sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar'))

/**
 * A real, self-contained phone field backed by libphonenumber-js: its own
 * country picker (flag + calling code, defaulting to `defaultCountryCode`
 * rather than an empty/undefined state) plus the national-number input,
 * built as ONE coherent control instead of borrowing "which country" from
 * a separate, easy-to-miss field elsewhere on the form.
 *
 * That borrowing was the actual bug in the previous version: a real,
 * valid Egyptian number like "01157157215" was rejected not because the
 * library considered it invalid (it doesn't — `isValidPhoneNumber(
 * '01157157215', 'EG')` is `true`) but because no country had been
 * selected yet, so validation ran with an empty country and the dial-code
 * badge rendered the literal fallback text "+--". Giving this control its
 * own explicit default removes that empty state entirely.
 */
export default function PhoneInput({
  defaultCountryCode = 'EG',
  onChange,
  error,
  label = 'رقم الهاتف',
  id,
}: PhoneInputProps) {
  const initialCountry =
    countries.find((c) => c.code === defaultCountryCode) ?? countries.find((c) => c.code === 'EG')!

  const [country, setCountry] = useState<Country>(initialCountry)
  const [rawInput, setRawInput] = useState('')
  const [touched, setTouched] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const reactId = useId()
  const inputId = id || `phone-${reactId}`
  const errorId = `${inputId}-error`
  const listboxId = `${inputId}-listbox`

  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const numberRef = useRef<HTMLInputElement>(null)

  const countryIso = country.code as CountryCode

  const filteredCountries = useMemo(() => {
    if (!query) return sortedCountries
    const q = query.toLowerCase()
    return sortedCountries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.name_ar.includes(query) || c.dial_code.includes(query),
    )
  }, [query])

  const formatted = useMemo(() => {
    if (!rawInput) return ''
    return new AsYouType(countryIso).input(rawInput)
  }, [rawInput, countryIso])

  const isValid = useMemo(() => {
    if (!rawInput) return false
    try {
      return isValidPhoneNumber(rawInput, countryIso)
    } catch {
      return false
    }
  }, [rawInput, countryIso])

  // Re-validate against the newly selected country whenever it changes —
  // the same digits are not assumed valid for a different numbering plan.
  useEffect(() => {
    if (!rawInput) {
      onChange(null)
      return
    }
    if (isValid) {
      const parsed = parsePhoneNumberFromString(rawInput, countryIso)
      onChange(
        parsed
          ? { e164: parsed.number, country: country.name, countryCode: country.code, dialCode: country.dial_code }
          : null,
      )
    } else {
      onChange(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawInput, countryIso, isValid])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const openList = () => {
    setIsOpen(true)
    setQuery('')
    setActiveIndex(Math.max(0, filteredCountries.findIndex((c) => c.code === country.code)))
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const chooseCountry = (c: Country) => {
    setCountry(c)
    setIsOpen(false)
    setTimeout(() => numberRef.current?.focus(), 0)
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      openList()
    }
  }

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filteredCountries.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const c = filteredCountries[activeIndex]
      if (c) chooseCountry(c)
    }
  }

  // "Meaningful input" gate: don't flip to a red invalid state on an
  // untouched field or a still-in-progress number — only once the user has
  // actually left the field, or typed as many digits as a complete number
  // for this country would have. This has to gate the PARENT's `error`
  // prop too, not just this component's own computed message — the parent
  // always has a "phone is required" validation error until a valid
  // number exists, so surfacing it unconditionally showed a red, invalid
  // field the instant the page rendered, before any interaction at all.
  const isPossiblyComplete = rawInput.length >= 7
  const meaningfulInteraction = touched || isPossiblyComplete
  const showInvalid = meaningfulInteraction && rawInput.length > 0 && !isValid
  const showValid = rawInput.length > 0 && isValid
  const errorText = meaningfulInteraction
    ? error || (showInvalid ? 'رقم الهاتف غير صالح' : undefined)
    : undefined

  return (
    <div ref={containerRef}>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>

      <div
        className={`relative flex items-stretch rounded-xl border bg-white dark:bg-gray-900 shadow-sm transition-colors duration-200 focus-within:ring-2 focus-within:ring-emerald-300/50
          ${errorText ? 'border-red-500' : showValid ? 'border-emerald-500' : 'border-gray-300 dark:border-gray-600 focus-within:border-emerald-500'}
        `}
        dir="ltr"
      >
        {/* Country trigger: flag + calling code, a real interactive control */}
        <button
          type="button"
          onClick={() => (isOpen ? setIsOpen(false) : openList())}
          onKeyDown={onTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={`رمز الدولة: ${country.name_ar}, ${country.dial_code}`}
          className="flex items-center gap-2 px-3.5 py-3 border-l border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-r-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 shrink-0"
        >
          <span className="text-xl leading-none" aria-hidden="true">{flagEmoji(country.code)}</span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 font-mono">{country.dial_code}</span>
          <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>

        <input
          ref={numberRef}
          id={inputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={formatted}
          onChange={(e) => setRawInput(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => setTouched(true)}
          placeholder="10 1234 5678"
          aria-invalid={!!errorText}
          aria-describedby={errorText ? errorId : undefined}
          className="min-w-0 flex-1 px-4 py-3 text-sm outline-none bg-transparent tracking-wide"
        />

        {isOpen && (
          <div
            role="listbox"
            id={listboxId}
            aria-label="اختر الدولة"
            onKeyDown={onListKeyDown}
            className="absolute z-20 top-full mt-2 left-0 w-72 max-h-72 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg flex flex-col"
          >
            <div className="p-2 border-b border-gray-100 dark:border-gray-800">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
                placeholder="ابحث عن دولة..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="overflow-y-auto">
              {filteredCountries.length === 0 && (
                <p className="px-4 py-3 text-sm text-gray-400">لا توجد نتائج</p>
              )}
              {filteredCountries.map((c, i) => (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={c.code === country.code}
                  onClick={() => chooseCountry(c)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-right transition-colors
                    ${i === activeIndex ? 'bg-emerald-50 dark:bg-emerald-900/30' : ''}
                    ${c.code === country.code ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-200'}
                  `}
                >
                  <span className="text-lg" aria-hidden="true">{flagEmoji(c.code)}</span>
                  <span className="flex-1">{c.name_ar}</span>
                  <span className="text-gray-400 font-mono text-xs" dir="ltr">{c.dial_code}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {errorText && (
        <p id={errorId} role="alert" className="mt-2.5 text-sm text-red-600">
          {errorText}
        </p>
      )}
    </div>
  )
}

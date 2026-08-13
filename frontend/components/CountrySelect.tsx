'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { countries, findCountryByName } from '@/data/countries-original'

type CountryValue = {
  country: string
  code: string
  dial_code: string
}

export default function CountrySelect({
  value,
  onChange,
  error,
}: {
  value: CountryValue
  onChange: (v: CountryValue) => void
  error?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<any>(null)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)

  // ترتيب الدول بالإنجليزية
  const sortedCountries = useMemo(() => {
    return [...countries].sort((a, b) => 
      a.name.localeCompare(b.name, 'en')
    )
  }, [])

  // فلترة الدول حسب البحث
  const filtered = useMemo(() => {
    if (!query) return sortedCountries
    
    const q = query.toLowerCase()
    return sortedCountries.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.name_ar.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.dial_code.includes(q)
    )
  }, [query, sortedCountries])

  // فتح/إغلاق القائمة
  const toggle = () => {
    setIsOpen(!isOpen)
    if (!isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
        scrollToActive()
      }, 0)
    }
  }

  // اختيار دولة
  const choose = (country: any) => {
    setSelected(country)
    onChange({
      country: country.name, // استخدام الاسم الإنجليزي
      code: country.code,
      dial_code: country.dial_code,
    })
    setIsOpen(false)
    setQuery('')
    setTimeout(() => scrollToActive(), 0)
  }

  // التمرير للعنصر النشط
  const scrollToActive = () => {
    const active = optionsRef.current?.querySelector('.option.active') as HTMLElement
    active?.scrollIntoView({ block: 'center' })
  }

  // إغلاق عند النقر خارج
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // تحديد الدولة الافتراضية
  useEffect(() => {
    if (value?.code) {
      const country = findCountryByName(value.code)
      if (country) setSelected(country)
    } else if (value?.country) {
      const country = findCountryByName(value.country)
      if (country) setSelected(country)
    }
  }, [value])

  return (
    <div ref={containerRef} className="w-full font-sans">
      {/* Label - بالإنجليزية */}
      <label className="label block mb-2 font-semibold text-gray-700">
        Country
      </label>

      {/* Custom Select Container */}
      <div 
        className={`custom-select ${isOpen ? 'open' : ''} ${selected ? 'has-value' : ''}`}
        onClick={toggle}
      >
        {/* Select Trigger */}
        <div className="select-trigger">
          {selected ? (
            <span className="selected-display flex items-center gap-3 flex-1">
              <span className="country-name font-medium text-gray-900">
                {selected.name}
              </span>
            </span>
          ) : (
            <span className="placeholder text-gray-500">
              Select your country...
            </span>
          )}

          {/* Arrow Icon */}
          <svg 
            className={`arrow w-5 h-5 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotated rotate-180' : ''}`}
            viewBox="0 0 20 20" 
            fill="currentColor"
          >
            <path 
              fillRule="evenodd" 
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.06z" 
              clipRule="evenodd" 
            />
          </svg>
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div className="dropdown" onClick={(e) => e.stopPropagation()}>
            {/* Search Box */}
            <div className="search-box">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search country..."
                className="search-input"
              />
              {/* Search Icon */}
              <svg 
                className="search-icon" 
                viewBox="0 0 20 20" 
                fill="currentColor"
              >
                <path 
                  fillRule="evenodd" 
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.48l4.6 4.6a1 1 0 11-1.41 1.41l-4.6-4.6A6 6 0 012 8z" 
                  clipRule="evenodd" 
                />
              </svg>
            </div>

            {/* Options List */}
            <div ref={optionsRef} className="options">
              {filtered.length === 0 ? (
                <div className="no-results">No results found</div>
              ) : (
                filtered.map((country) => (
                  <div
                    key={country.code}
                    className={`option ${country.code === selected?.code ? 'active' : ''}`}
                    onClick={() => choose(country)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="country-name font-medium text-gray-900">
                          {country.name}
                        </span>
                      </div>
                    </div>

                    {country.code === selected?.code && (
                      <svg 
                        className="check" 
                        viewBox="0 0 20 20" 
                        fill="currentColor"
                      >
                        <path 
                          fillRule="evenodd" 
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" 
                          clipRule="evenodd" 
                        />
                      </svg>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <span className="error-text block mt-1 text-sm text-red-600">
          {error}
        </span>
      )}

      <style jsx>{`
        .custom-select {
          position: relative;
          font-family: inherit;
        }


        .select-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #fff;
          cursor: pointer;
          font-size: 15px;
          transition: all 0.2s ease;
          text-align: left;
        }

        .select-trigger:hover {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .has-value .selected-display {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .placeholder {
          color: #9ca3af;
        }

        .arrow {
          width: 18px;
          height: 18px;
          color: #6b7280;
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }

        .arrow.rotated {
          transform: rotate(180deg);
        }

        .dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin-top: 8px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          max-height: 370px;
          overflow: hidden;
          z-index: 1000;
        }

        .search-box {
          position: relative;
          padding: 12px;
          border-bottom: 1px solid #f3f4f6;
          display: flex;
        }

        .search-input {
          width: 100%;
          padding: 12px 40px 12px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          outline: none;
          transition: border 0.2s;
          text-align: left;
        }

        .search-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .search-icon {
          position: absolute;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          width: 18px;
          height: 18px;
          color: #9ca3af;
        }

        .options {
          max-height: 280px;
          overflow-y: auto;
        }

        .option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          cursor: pointer;
          font-size: 14.5px;
          transition: background 0.15s;
          text-align: left;
          direction: ltr;
          border-bottom: 1px solid #f3f4f6;
        }

        .option:last-child {
          border-bottom: none;
        }

        .option:hover,
        .option.active {
          background: #f8faff;
        }

        .option.active {
          color: #2563eb;
          font-weight: 500;
        }

        .check {
          width: 18px;
          height: 18px;
          color: #2563eb;
          flex-shrink: 0;
        }

        .no-results {
          padding: 16px;
          text-align: center;
          color: #6b7280;
          font-size: 14px;
          font-style: italic;
        }

        .label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: #374151;
        }

        .error-text {
          display: block;
          color: #ef4444;
          font-size: 14px;
          margin-top: 5px;
        }
      `}</style>
    </div>
  )
}
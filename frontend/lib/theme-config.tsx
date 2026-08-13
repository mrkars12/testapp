'use client'

import React, { createContext, useContext, useState } from 'react'

// =========================
// Theme Types
// =========================
type ThemeMode = 'light' | 'dark' | 'system'
type ThemeColor = 'blue' | 'purple' | 'green' | 'red' | 'orange'

interface ThemeContextType {
  mode: ThemeMode
  color: ThemeColor
  setMode: (mode: ThemeMode) => void
  setColor: (color: ThemeColor) => void
}

// =========================
// Theme Context
// =========================
const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// =========================
// Theme Provider
// =========================
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light')
  const [color, setColor] = useState<ThemeColor>('blue')

  return (
    <ThemeContext.Provider value={{ mode, color, setMode, setColor }}>
      {children}
    </ThemeContext.Provider>
  )
}

// =========================
// Theme Hook
// =========================
export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}

// =========================
// Theme Config (static)
// =========================
export const themeConfig = {
  colors: {
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
  },
}

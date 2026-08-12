import { create } from 'zustand'
import api from '@/lib/api'

const bc =
  typeof window !== 'undefined'
    ? new BroadcastChannel('balance_channel')
    : null

interface BalanceState {
  balance: string | null
  currency: string
  loading: boolean
  hydrated: boolean
  fetch: (force?: boolean) => Promise<void>
  increase: (amount: string) => Promise<void>
  updateBalance: (balance: string, currency: string) => void
  reset: () => void
}

export const useBalanceStore = create<BalanceState>((set, get) => ({
  balance: null,
  currency: 'USD',
  loading: false,
  hydrated: false,

  fetch: async (force = false) => {

    const state = get()

    if (state.loading && !force) return

    set({ loading: true })

    try {

      const { data } = await api.get('/wallet/super-fast-balance', {
        params: { _: Date.now() }
      })

      set({
        balance: data.balance,
        currency: data.currency,
        hydrated: true
      })

      bc?.postMessage({
        type: 'BALANCE_SYNC',
        balance: data.balance,
        currency: data.currency
      })

    } catch (err) {

      console.error('Balance fetch failed:', err)

    } finally {

      set({ loading: false })

    }
  },

  updateBalance: (balance, currency) => {

    set({
      balance,
      currency,
      hydrated: true
    })

    bc?.postMessage({
      type: 'BALANCE_SYNC',
      balance,
      currency
    })
  },

  increase: async (amount) => {

    set({ loading: true })

    try {

      await api.post('/wallet/top-up', { amount })

      await get().fetch(true)

    } finally {

      set({ loading: false })

    }
  },

  reset: () => {
    set({
      balance: null,
      currency: 'USD',
      loading: false,
      hydrated: false
    })
  }
}))
import { create } from 'zustand'

export type AuthStatus = 'idle' | 'booting' | 'authenticated' | 'logging_out' | 'unauthenticated' | 'refreshing_session'

interface AuthState {
  status: AuthStatus
  sessionId: string | null
  setStatus: (s: AuthStatus) => void
  setSession: (sid: string | null) => void
  reset: () => void
  logout: () => void
}

/**
 * The single client-side auth *status* value. Identity/profile lives in the
 * React Query `['auth-user']` cache (AuthProvider); this store is only the
 * coarse state-machine phase that gates render.
 */
export const useAuthState = create<AuthState>((set) => ({
  status: 'booting',
  sessionId: null,

  setStatus: (status) => set({ status }),

  setSession: (sessionId) => set({ sessionId }),

  logout: () => set({ status: 'logging_out', sessionId: null }),

  reset: () => set({ status: 'unauthenticated', sessionId: null }),
}))

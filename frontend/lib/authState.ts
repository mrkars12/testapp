import { create } from 'zustand'
import { forceCloseSocket } from '@/components/Go'

export type AuthStatus = 'idle' | 'booting' | 'authenticated' | 'logging_out' | 'unauthenticated' | 'refreshing_session'

interface AuthState {
  status: AuthStatus
  sessionId: string | null
  setStatus: (s: AuthStatus) => void
  setSession: (sid: string | null) => void
  reset: () => void
  logout: () => void
}

export const useAuthState = create<AuthState>((set) => ({
  status: 'booting',
  sessionId: null,

  setStatus: (status) => set({ status }),

  setSession: (sessionId) => set({ sessionId }),

  logout: () => {
    forceCloseSocket()
    set({ status: 'logging_out', sessionId: null })
  },

  reset: () => {
    forceCloseSocket()
    set({ status: 'unauthenticated', sessionId: null })   // ← غيرناه
  },
}))
import { create } from 'zustand'

export type AccountType = 'individual' | 'business'

export const useRegisterStore = create<any>((set) => ({
  step: 1,
  form: {
    accounttype: 'individual',
    email: '',
    username: '',
    password: '',
    password_confirmation: '',
    country: '',
    country_code: '',
    mobile_code: '',
    business_name: '',
    entity_type: '',
  },
  setStep: (s: number) => set({ step: s }),
  update: (v: any) =>
    set((state: any) => ({ form: { ...state.form, ...v } })),
}))

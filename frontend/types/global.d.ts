
export {};

declare global {
  interface Window {
    __LOGGING_OUT__?: boolean;
    __INIT_AUTH__?: boolean;
    __SESSION_ID__?: string | null;
    __MANUAL_LOGOUT__?: boolean;
    __AUDIO_UNLOCKED__?: boolean;
    __from_bc?: boolean;

    
    USER: {
      id: string | number; // 🚩 تحديث هذا السطر ليدعم string
      fullname: string | null;
      email: string;
      username: string;
      email_verified_at: string | null;
      accounttype: 'individual' | 'business';
    } | null;
    
  }
}
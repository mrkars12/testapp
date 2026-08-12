// lib/device.ts
import { create } from "zustand";
import api from "@/lib/api";
import { getHardwareFingerprint } from '@/lib/fingerprint';
import { useAuthState } from '@/lib/authState'

/* ========================= INTERFACES ========================= */
export interface Device {
  id: string; 
  display_name: string;
  browser_name: string;
  os_name: string;
  ip_address: string;
  is_current: boolean;
  is_online: boolean;
  is_logged_out: boolean;
  last_active_at: string;
  logged_out_at?: string | Date | null;
  device_type: string; 
}

interface DevicesState {
  devices: Device[];
  loading: boolean;
  error: string | null;
  actionLoading: string | null; 
  markDeviceLoggedOut: (id: string) => void;
  fetchDevices: () => Promise<void>;
  logoutDevice: (id: string) => Promise<void>;
  logoutOthers: () => Promise<void>;
  removeDeviceRecord: (id: string) => Promise<void>;
  reset: () => void;
}

/* ========================= ZUSTAND STORE ========================= */
export const useDevicesStore = create<DevicesState>((set, get) => ({
  devices: [],
  loading: false,
  error: null,
  actionLoading: null,

  /**
   * 1. جلب كافة الأجهزة المرتبطة بالحساب
   */
  fetchDevices: async () => {
    const authState = useAuthState.getState()
    if (authState.status !== 'authenticated') return;

    set({ loading: true, error: null });

    try {
      const fp = await getHardwareFingerprint();
      const { data } = await api.get('/devices', {
        withCredentials: true, // 🚩 تأمين إرسال الكوكي
        headers: {
          'X-Device-Fingerprint': fp,
          'x-device-fingerprint': fp
        }
      });

      if (data.success) {
        set({ devices: data.devices, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (err: any) {
      if (err?.response?.status === 401) {
        set({ loading: false });
        return;
      }
      console.error('❌ Failed to fetch devices:', err);
      set({ loading: false, error: err.message });
    }
  },

  /**
   * 2. تسجيل الخروج من جهاز معين (طرد جهاز واحد)
   */
  logoutDevice: async (id: string) => {
    set({ actionLoading: id });
    try {
      const fp = await getHardwareFingerprint();
      const { data } = await api.post(`/devices/${id}/logout`, {}, {
        withCredentials: true, // 🚩 تأمين الكوكي لمنع الـ Unauthorized Guard
        headers: {
          'X-Device-Fingerprint': fp,
          'x-device-fingerprint': fp
        }
      });

      if (data.success) {
        // تحديث تفاؤلي سريع للواجهة (Optimistic Update)
        set(state => ({
          devices: state.devices.map(d =>
            String(d.id) === String(id)
              ? {
                  ...d,
                  is_logged_out: true,
                  is_online: false,
                  logged_out_at: new Date().toISOString()
                }
              : d
          ),
          actionLoading: null
        }));
      }
    } catch (err) {
      console.error('❌ single logout failed:', err);
      set({ actionLoading: null });
    }
  },

  /**
   * 3. تحديث حالة الجهاز كـ Logged Out فوراً عند استقبال حدث السوكت
   */
  markDeviceLoggedOut: (id: string) => {
    set(state => ({
      devices: state.devices.map(d =>
        String(d.id) === String(id)
          ? {
              ...d,
              is_logged_out: true,
              is_online: false,
              logged_out_at: new Date().toISOString()
            }
          : d
      )
    }));
  },

  /**
   * 4. طرد كافة الأجهزة الأخرى ما عدا الحالي
   */
  logoutOthers: async () => {
    set({ loading: true });
    try {
      const fp = await getHardwareFingerprint();
      const { data } = await api.post('/devices/logout-others', {}, {
        withCredentials: true,
        headers: {
          'X-Device-Fingerprint': fp,
          'x-device-fingerprint': fp
        }
      });

      if (data.success) {
        // 🚩 [حذف الجلب اليدوي المكرر هنا لترك السوكت يحدّث الشاشة بدقة ويمنع الـ Loop]
        set(state => ({
          devices: state.devices.map(d =>
            !d.is_current
              ? {
                  ...d,
                  is_logged_out: true,
                  is_online: false,
                  logged_out_at: new Date().toISOString()
                }
              : d
          )
        }));
      }
    } catch (err) {
      console.error("❌ Bulk logout failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  /**
   * 5. حذف سجل جهاز نهائياً من القائمة
   */
  removeDeviceRecord: async (id: string) => {
    set({ actionLoading: id });
    try {
      const { data } = await api.delete(`/devices/${id}`, {
        withCredentials: true
      });
      if (data.success) {
        set((state) => ({
          devices: state.devices.filter((d) => String(d.id) !== String(id)),
          actionLoading: null,
        }));
      }
    } catch (err) {
      console.error("❌ Deletion failed:", err);
      set({ actionLoading: null });
    }
  },

  reset: () => {
    set({ devices: [], loading: false, actionLoading: null, error: null });
  },
}));
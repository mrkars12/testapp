'use client';

const STORAGE_KEY = 'app_intended_path';

export const RoutingManager = {
  save(path: string) {
    if (typeof window === 'undefined' || !path) return;
    
    // لا نحفظ الصفحات غير المرغوبة
    if (path === '/' || 
        path === '/dashboard' || 
        path.startsWith('/login') || 
        path.startsWith('/register')) {
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, path);
    console.log('✅ RoutingManager.save → حفظ المسار:', path);
  },

  get(): string | null {
    if (typeof window === 'undefined') return null;
    const path = sessionStorage.getItem(STORAGE_KEY);
    if (path) {
      console.log('📖 RoutingManager.get → تم قراءة المسار:', path);
    }
    return path;
  },

  clear() {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(STORAGE_KEY);
    console.log('🗑️ RoutingManager.clear → تم مسح المسار');
  },

  getRedirectPath(defaultPath: string = '/dashboard'): string {
    const saved = this.get();
    
    if (saved) {
      console.log('🎯 RoutingManager.getRedirectPath → سيتم التوجيه إلى المسار المحفوظ:', saved);
      this.clear(); // نمسحه بعد الاستخدام مرة واحدة فقط
      return saved;
    }

    console.log('⚠️ RoutingManager.getRedirectPath → لم يجد مسار محفوظ، نستخدم:', defaultPath);
    return defaultPath;
  },

  reset() {
    this.clear();
  }
};
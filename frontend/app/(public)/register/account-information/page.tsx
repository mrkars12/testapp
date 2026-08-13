// app/(public)/register/account-information/page.tsx

import { Suspense } from 'react';
import RegisterStep2Client from './RegisterStep2Client';  // ← اضبط المسار لو الملف مش في نفس المجلد (مثلًا إذا نقلته لـ components، غيّر لـ '@/components/RegisterStep2Client')

export default function RegisterAccountInformation() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-lg text-gray-600 dark:text-gray-300 animate-pulse">
            جاري تحميل نموذج التسجيل...
          </div>
        </div>
      }
    >
      <RegisterStep2Client />


    </Suspense>
  );
}
'use client'
import { getHardwareFingerprint } from '@/lib/fingerprint';

export default function GoogleLoginButton() {
  const handleGoogleLogin = async () => {
    // 🚩 توليد بصمة الهاردوير العميقة (التي تفرق بين العادي والخفي)
    const hwFingerprint = await getHardwareFingerprint();
    
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"; 
    
    // نبعت البصمة كـ Query Parameter للباك إند
    window.location.href = `${API_URL}/auth/google/redirect?hw_fingerprint=${hwFingerprint}`;
  };

  return (
    <button 
      type="button"
      onClick={handleGoogleLogin}
      className="w-full flex items-center justify-center gap-3 py-4 bg-white border border-gray-200 rounded-2xl font-black text-gray-700 hover:shadow-lg transition-all"
    >
      <span>الدخول بواسطة جوجل</span>
    </button>
  );
}
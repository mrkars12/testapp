// components/AutoIdleLogout.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config'

export default function AutoIdleLogout({ timeoutMinutes = 5 }) {
  const router = useRouter();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const [showWarning, setShowWarning] = useState(false);

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {}
    router.replace('/login?idle=1');
  };

  const resetTimer = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);

    const timeInMs = timeoutMinutes * 460 * 1000;

    // تحذير قبل 30 ثانية
    warningRef.current = setTimeout(() => setShowWarning(true), timeInMs - 30000);

    timeoutRef.current = setTimeout(logout, timeInMs);
  };

  useEffect(() => {
    resetTimer();

    const events = ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll', 'wheel', 'click'];
    events.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      fetch('http://localhost:8000/api/auth/activity', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
    }, 25000);

    return () => {
      events.forEach(event => window.removeEventListener(event, resetTimer));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      clearInterval(heartbeat);
    };
  }, []);

  if (showWarning) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]">
        <div className="bg-white p-8 rounded-2xl text-center max-w-sm shadow-2xl">
          <h2 className="text-2xl font-bold mb-3">هل مازلت هنا؟</h2>
          <p className="text-gray-600 mb-6">سيتم تسجيل خروجك خلال 30 ثانية لحماية حسابك.</p>
          <button
            onClick={() => {
              setShowWarning(false);
              resetTimer();
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-3.5 rounded-xl font-medium"
          >
            أنا هنا - استمر
          </button>
        </div>
      </div>
    );
  }

  return null;
}
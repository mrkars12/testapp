// hooks/useSocket.ts
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDevicesStore } from "@/lib/device";

export const useSocket = (userId: string | number) => {
  const router = useRouter();
  const { fetchDevices } = useDevicesStore();

  useEffect(() => {
    if (!userId) return;

    // الربط مع خادم الجو الخاص بك
    const socket = new WebSocket(`ws://your-go-api.com/ws?user_id=${userId}`);

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      switch (payload.event) {
        case 'device.added':
          // تحديث القائمة فوراً عند دخول جهاز جديد
          fetchDevices();
          break;

        case 'force.logout':
          // إذا كان هذا الجهاز هو المستهدف بالطرد
          // Go يجب أن يرسل الـ session_id المستهدف
          const currentSessionId = localStorage.getItem('session_id');
          if (payload.target_session_id === currentSessionId) {
             localStorage.clear();
             router.push('/login?reason=forced');
          } else {
             fetchDevices(); // تحديث القائمة للباقين ليروا أن الجهاز اختفى
          }
          break;
      }
    };

    return () => socket.close();
  }, [userId, fetchDevices, router]);
};
import axios from 'axios';

import api from '@/lib/api'; // ✅ استيراد api الصح

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export function getCsrfCookie() {
  return api.get('/sanctum/csrf-cookie', {
    __noLoading: true, // 👈 مهم
  });
}

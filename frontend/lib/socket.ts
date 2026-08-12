'use client'

import { io, Socket } from 'socket.io-client'
import { SOCKET_URL } from '@/lib/config'

interface CustomSocket extends Socket {
  roomsJoined?: boolean;
}

export const socket: CustomSocket = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true, // 🚩 إرسال الكوكيز مع طلب الاتصال
  transports: ['websocket', 'polling'], // ترك الـ polling كخيار احتياطي يضمن استقرار الاتصال الأول
  reconnection: true, // تفعيل إعادة الاتصال التلقائي
  reconnectionAttempts: 5,
  timeout: 10000,
})

socket.roomsJoined = false

socket.on('connect', () => {
  console.log('🌐 [SOCKET CONNECTED CLIENT]:', socket.id)
})

socket.on('disconnect', (reason) => {
  socket.roomsJoined = false
  console.log('🔌 [SOCKET DISCONNECTED CLIENT]:', reason)
})

socket.on('connect_error', (err) => {
  console.error('❌ [SOCKET CONNECT ERROR]:', err.message)
})
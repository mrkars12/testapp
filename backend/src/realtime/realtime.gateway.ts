// src/realtime/realtime.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect
} from '@nestjs/websockets'

import { Server, Socket } from 'socket.io'
import { OnEvent } from '@nestjs/event-emitter'

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:3000', // رابط فرونت إند Next.js
    credentials: true
  }
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer()
  server: Server

  /**
   * =================================
   * ✅ الذاكرة المؤقتة: userId -> deviceId -> socketIds
   * =================================
   */
  private users = new Map<string, Map<string, Set<string>>>()

  /**
   * =================================
   * ✅ SOCKET CONNECT
   * =================================
   */
  handleConnection(client: Socket) {
    console.log('🌐 [SOCKET CONNECTED]:', client.id)
  }

  /**
   * =================================
   * ✅ SOCKET DISCONNECT (تنظيف الذاكرة والغرف عند الفصل)
   * =================================
   */
  handleDisconnect(client: Socket) {
    for (const [userId, devices] of this.users.entries()) {
      for (const [deviceId, socketIds] of devices.entries()) {
        
        // إزالة السوكت المفصول من قائمة السوكتس النشطة لهذا الجهاز
        socketIds.delete(client.id)

        // إذا لم يتبقى أي سوكت نشط لهذا الجهاز، احذفه من الميموري
        if (socketIds.size === 0) {
          devices.delete(deviceId)
        }
      }

      // إذا لم يتبقى أي أجهزة نشطة للمستخدم، احذفه بالكامل
      if (devices.size === 0) {
        this.users.delete(userId)
      }
    }

    // مغادرة الغرف بأمان
    for (const room of client.rooms) {
      if (room !== client.id) {
        client.leave(room)
      }
    }

    console.log('🔌 [SOCKET DISCONNECTED]:', client.id)
  }

  /**
   * =================================
   * ✅ AUTH SOCKET (تسجيل التبويب الحالي في الغرف الصلبة)
   * =================================
   */
  @SubscribeMessage('auth')
  auth(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string; deviceId: string }
  ) {
    if (!data?.userId || !data?.deviceId) {
      console.error('❌ [AUTH FAILED]: Missing userId or deviceId in payload')
      return
    }

    // تحويل صارم ونقي للنصوص لمنع مشاكل الـ Types
    const userIdStr = String(data.userId).trim()
    const deviceIdStr = String(data.deviceId).trim()

    // الانضمام إلى غرف البث الصلبة
    client.join(`user:${userIdStr}`)
    client.join(`device:${deviceIdStr}`)

    console.log(`🎯 [ROOM JOINED]: Client [${client.id}] joined -> user:${userIdStr} | device:${deviceIdStr}`)

    // تسجيل البيانات داخل ذاكرة السيرفر للـ Online Status
    const devices = this.users.get(userIdStr) || new Map()
    const existingSockets = devices.get(deviceIdStr) || new Set()
    
    existingSockets.add(client.id)
    devices.set(deviceIdStr, existingSockets)
    this.users.set(userIdStr, devices)

    // تأكيد الاتصال والتوثيق الناجح للفرونت إند (ACK)
    client.emit('socket_authenticated', {
      success: true,
      userId: userIdStr,
      deviceId: deviceIdStr
    })
  }

  /**
   * =================================
   * ✅ DEVICE READY (تأكيد الجاهزية)
   * =================================
   */
  @SubscribeMessage('device_ready')
  deviceReady(
    @MessageBody() data: { userId: string; deviceId: string }
  ) {
    if (!data?.userId || !data?.deviceId) return

    const userIdStr = String(data.userId).trim()
    const deviceIdStr = String(data.deviceId).trim()

    console.log('📱 [DEVICE READY]:', userIdStr, deviceIdStr)

    // بث الحدث لبقية أجهزة المستخدم المفتوحة لإعلامهم بالدخول الجديد دون إدخال التبويب الحالي في Loop
    this.server.to(`user:${userIdStr}`).emit('device_logged_in', {
      deviceId: deviceIdStr
    })
  }

  /**
   * =================================
   * ✅ NOTIFY DEVICE LOGOUT (تحديث الواجهة الفورية عند الخروج)
   * =================================
   */
  notifyDeviceLogout(userId: string, deviceId: string) {
    const userIdStr = String(userId).trim()
    const deviceIdStr = String(deviceId).trim()

    console.log('📢 [NOTIFY LOGOUT EVENT]:', userIdStr, deviceIdStr)

    // إرسال إشارة طرد مرئية لتحديث القوائم والألوان في لوحة التحكم لبقية تبويبات المستخدم المفتوحة
    this.server.to(`user:${userIdStr}`).emit('device_logged_out', {
      deviceId: deviceIdStr
    })
  }

  /**
   * =================================
   * ✅ FORCE LOGOUT (أمر الطرد القسري الصلب لجهاز معين مع دعم تمرير المسار)
   * =================================
   */
  forceLogoutDevice(userId: string, deviceId: string, intendedPath: string = '/login') {
    const userIdStr = String(userId).trim()
    const deviceIdStr = String(deviceId).trim()

    console.log(`🚨 [CRITICAL FORCE LOGOUT]: Emitting to room -> device:${deviceIdStr} with path: ${intendedPath}`)

    // 🎯 طرد فوري وبث المسار المعني المُراد توجيه الضحية إليه
    this.server.to(`device:${deviceIdStr}`).emit('force_logout', {
      deviceId: deviceIdStr,
      intendedPath: intendedPath // 🚩 استقبال المسار وبثه للفرونت إند هنا بدقة
    })

    // إرسال إشارة تحديث قوائم بقية الأجهزة فوراً لمزامنة الألوان
    this.server.to(`user:${userIdStr}`).emit('devices_updated')
  }

  notifyUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.server?.to(`user:${String(userId).trim()}`).emit(event, payload)
  }

  /**
   * =================================
   * ✅ FORCE LOGOUT ALL (طرد كافة الأجهزة)
   * =================================
   */
  forceLogoutAllDevices(userId: string, deviceIds: string[]) {
    const userIdStr = String(userId).trim()
    
    for (const deviceId of deviceIds) {
      const devIdStr = String(deviceId).trim()
      this.notifyDeviceLogout(userIdStr, devIdStr)
      this.forceLogoutDevice(userIdStr, devIdStr, '/login')
    }
  }
  
  /**
   * =================================
   * ✅ GET ONLINE DEVICES
   * =================================
   */
  getOnlineDevices(userId: string) {
    const userIdStr = String(userId).trim()
    return this.users.get(userIdStr) || new Map()
  }

  /**
   * =================================
   * ✅ CHECK DEVICE ONLINE (الفحص الصارم للأونلاين بـ Strings)
   * =================================
   */
  isDeviceOnline(userId: string, deviceId: string): boolean {
    const userIdStr = String(userId).trim()
    const deviceIdStr = String(deviceId).trim()

    const userDevices = this.users.get(userIdStr)
    if (!userDevices) return false

    return userDevices.has(deviceIdStr)
  }

  /**
   * ✅ استقبال حدث حذف الجهاز من الـ DB
   */
  @OnEvent('device.deleted')
  handleDeviceDeleted(payload: { deviceId: string; userId: string }) {
    console.log('🗑️ [DEVICE DELETED]:', payload)
    this.forceLogoutDevice(payload.userId, payload.deviceId, '/dashboard')
  }
}
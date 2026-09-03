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
import { JwtService } from '@nestjs/jwt'
import { parse as parseCookie } from 'cookie'
import { buildCorsOriginChecker } from '../common/config/cors-origin-matcher'

/**
 * Must match the HTTP CORS allowlist in main.ts exactly (same env var,
 * same default, same matcher) — a hardcoded single origin here silently
 * rejects the real deployed frontend origin (e.g. a Codespaces/`*.github.dev`
 * host) even when HTTP CORS is configured correctly, which is exactly what
 * produced the "socket connect error" this fixes.
 */
const isAllowedSocketOrigin = buildCorsOriginChecker(
  (process.env.CORS_ORIGINS ?? 'http://localhost:3000,*.localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      callback(null, isAllowedSocketOrigin(origin))
    },
    credentials: true
  }
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {

  constructor(private readonly jwtService: JwtService) {}

  @WebSocketServer()
  server: Server

  /**
   * ⚠️ يتحقق من هوية العميل من الـ access_token cookie نفسه المستخدم في
   * كل الـ HTTP requests — مش من أي بيانات بيبعتها العميل في رسالة الـ
   * socket. من غيره أي حد يقدر يفتح اتصال socket ويبعت أي userId في
   * حدث 'auth' وينضم لغرفة user:<id> بتاعت حد تاني، ويستقبل كل
   * إشعاراته (بما فيها payment_event) وهو مش مسجّل دخول أصلاً كـ
   * المستخدم ده. الـ userId الوحيد الموثوق هو اللي طالع من التوكن
   * الموقّع، مش اللي العميل بيدّعيه.
   */
  private verifySocketUserId(client: Socket): string | null {
    const cookieHeader = client.handshake.headers.cookie
    if (!cookieHeader) return null

    const token = parseCookie(cookieHeader)['access_token']
    if (!token) return null

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      }) as { sub?: string }

      return payload.sub ? String(payload.sub) : null
    } catch {
      return null
    }
  }

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
    // Verified once at connection time and trusted for the rest of this
    // socket's lifetime — never re-derived from client-supplied payloads.
    client.data.verifiedUserId = this.verifySocketUserId(client)
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

    // السماح بالانضمام لغرفة user:<id> فقط لو الـ id ده مطابق للهوية
    // اللي اتأكّدنا منها من الـ access_token الحقيقي وقت الاتصال —
    // مش أي id بيبعته العميل في رسالة الـ socket نفسها.
    const verifiedUserId = client.data.verifiedUserId as string | null
    if (!verifiedUserId || verifiedUserId !== String(data.userId).trim()) {
      console.error('❌ [AUTH FAILED]: Unverified or mismatched userId — refusing room join')
      client.emit('socket_authenticated', { success: false })
      return
    }

    // تحويل صارم ونقي للنصوص لمنع مشاكل الـ Types
    const userIdStr = verifiedUserId
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
    this.forceLogoutDevice(payload.userId, payload.deviceId, '/verify-email')
  }
}
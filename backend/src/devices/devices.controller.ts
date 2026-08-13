// src/devices/devices.controller.ts

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Req,
  Headers,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException
} from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { PrismaService } from '../prisma/prisma.service'
import { UAParser } from 'ua-parser-js'
import { RealtimeGateway } from '../realtime/realtime.gateway'

@Controller('devices')
@UseGuards(AuthGuard)
export class DevicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway
  ) {}

  /**
   * =================================
   * ✅ GET DEVICES WITH ONLINE STATUS
   * =================================
   */
  @Get()
  async getDevices(
    @Req() req,
    @Headers('x-device-fingerprint') fingerprintLower: string,
    @Headers('X-Device-Fingerprint') fingerprintUpper: string
  ) {
    try {
      const userId = BigInt(req.user.sub)
      const userIdStr = userId.toString()
      const currentFingerprint = (fingerprintLower || fingerprintUpper || '').trim()

      const devicesList = await this.prisma.devices.findMany({
        where: { user_id: userId },
        orderBy: { updated_at: 'desc' }
      })

      return {
        success: true,
        devices: devicesList.map(device => {
          const parser = new UAParser(device.browser || '')
          const res = parser.getResult()
          const deviceIdStr = device.id.toString()

          const isCurrent = device.fingerprint === currentFingerprint && !device.logged_out_at
          const isOnline = !device.logged_out_at && this.realtime.isDeviceOnline(userIdStr, deviceIdStr)

          return {
            id: deviceIdStr,
            display_name: device.device_name || res.device.model || 'جهاز كمبيوتر',
            browser_name: res.browser.name || 'متصفح غير معروف',
            os_name: res.os.name || device.os || 'نظام غير معروف',
            ip_address: device.ip_address || '0.0.0.0',
            is_current: isCurrent,
            is_online: !!isOnline,
            is_logged_out: !!device.logged_out_at,
            last_active_at: device.last_active_at || device.updated_at,
            logged_out_at: device.logged_out_at,
            device_type: res.device.type || (device.platform?.toLowerCase() === 'mobile' ? 'mobile' : 'desktop')
          }
        })
      }
    } catch (error) {
      console.error('Fetch Devices Error:', error)
      throw new InternalServerErrorException('فشل في جلب قائمة الأجهزة')
    }
  }

  /**
   * =================================
   * ✅ CURRENT DEVICE
   * =================================
   */
  @Get('current')
  async current(
    @Req() req: any,
    @Headers('x-device-fingerprint') fingerprintLower: string,
    @Headers('X-Device-Fingerprint') fingerprintUpper: string
  ) {
    const currentFingerprint = (fingerprintLower || fingerprintUpper || '').trim()
    const device = await this.prisma.devices.findFirst({
      where: {
        user_id: BigInt(req.user.sub),
        fingerprint: currentFingerprint
      }
    })
    return { device }
  }

  /**
   * =================================
   * ✅ LOGOUT OTHER DEVICES (طرد بقية الأجهزة)
   * =================================
   */
  @Post('logout-others')
  async logoutOthers(
    @Req() req,
    @Headers('x-device-fingerprint') fingerprintLower: string,
    @Headers('X-Device-Fingerprint') fingerprintUpper: string
  ) {
    try {
      const userId = BigInt(req.user.sub)
      const userIdStr = userId.toString()
      const currentFingerprint = (fingerprintLower || fingerprintUpper || '').trim()

      if (!currentFingerprint) {
        throw new BadRequestException('بصمة الجهاز الحالية مطلوبة لتأمين عملية الطرد')
      }

      const devices = await this.prisma.devices.findMany({
        where: {
          user_id: userId,
          NOT: { fingerprint: currentFingerprint },
          logged_out_at: null
        }
      })

      if (devices.length === 0) {
        return { success: true, message: 'لا توجد أجهزة أخرى نشطة حالياً' }
      }

      await this.prisma.devices.updateMany({
        where: {
          user_id: userId,
          NOT: { fingerprint: currentFingerprint },
          logged_out_at: null
        },
        data: {
          logged_out_at: new Date(),
          session_id: null,
          updated_at: new Date()
        }
      })

      // ✅ إرسال أمر الطرد الموحد والمطهر لكافة الأجهزة المستهدفة بالتوالي
      for (const device of devices) {
        const devIdStr = device.id.toString()
        this.realtime.notifyDeviceLogout(userIdStr, devIdStr)
        this.realtime.forceLogoutDevice(userIdStr, devIdStr, '/dashboard') 
      }

      // 🚩 [تم الحذف]: حذفت السطور المكررة الخاطئة التي كانت خارج الـ Loop هنا وكانت تسبب التشوه بصرياً

      return { success: true, count: devices.length }
    } catch (error) {
      console.error('Logout Others Error:', error)
      if (error instanceof BadRequestException) throw error
      throw new InternalServerErrorException('حدث خطأ أثناء محاولة طرد الأجهزة الأخرى')
    }
  }

  /**
   * =================================
   * ✅ LOGOUT ONE DEVICE (طرد جهاز معين)
   * =================================
   */
  @Post(':id/logout')
  async logoutOne(
    @Param('id') id: string,
    @Req() req,
    @Headers('x-device-fingerprint') fingerprintLower: string,
    @Headers('X-Device-Fingerprint') fingerprintUpper: string
  ) {
    try {
      const userId = BigInt(req.user.sub)
      const userIdStr = userId.toString()
      const currentFingerprint = (fingerprintLower || fingerprintUpper || '').trim()

      if (!id) throw new BadRequestException('معرف الجهاز مطلوب')

      const existing = await this.prisma.devices.findFirst({
        where: {
          id: BigInt(id),
          user_id: userId
        }
      })

      if (!existing) {
        throw new NotFoundException('الجهاز المستهدف غير موجود بالحساب')
      }

      if (existing.fingerprint === currentFingerprint) {
        throw new BadRequestException('لا يمكنك طرد جهازك الحالي من هنا، استخدم زر تسجيل الخروج العادي')
      }

      if (existing.logged_out_at) {
        return { success: true }
      }

      const device = await this.prisma.devices.update({
        where: { id: existing.id },
        data: {
          logged_out_at: new Date(),
          session_id: null,
          updated_at: new Date()
        }
      })

      const devIdStr = device.id.toString()
      this.realtime.notifyDeviceLogout(userIdStr, devIdStr)
      
      // ✅ تصحيح المسار المقصود هنا أيضاً إلى /dashboard لمنع تضارب الرابط في التابات المنسوخة
      this.realtime.forceLogoutDevice(userIdStr, devIdStr, '/dashboard')

      return { success: true }
    } catch (error) {
      console.error('Logout One Device Error:', error)
      if (error instanceof BadRequestException || error instanceof NotFoundException) throw error
      throw new InternalServerErrorException('فشل إنهاء جلسة الجهاز المستهدف')
    }
  }

  /**
   * =================================
   * ✅ DELETE DEVICE
   * =================================
   */
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req) {
    const userId = BigInt(req.user.sub)
    try {
      const existing = await this.prisma.devices.findFirst({
        where: {
          id: BigInt(id),
          user_id: userId
        }
      })

      if (!existing) throw new NotFoundException('الجهاز غير موجود')

      await this.prisma.deleteDevice(existing.id)

      return { success: true }
    } catch (e) {
      throw new NotFoundException('الجهاز غير موجود')
    }
  }
}